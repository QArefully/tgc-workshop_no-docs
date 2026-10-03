#!/usr/bin/env python3
"""
show-context.py - Reveal what is actually inside a Claude Code session's
"messages" array: the full conversation that is RESENT to the model on
every single turn.

Built for the "Agentic QA in Large Projects" workshop, blocks:
  [H] "Hello" Chat + Debug   09:50-10:05
  [H] Growing Context        10:15-10:30

Usage:
  python show-context.py                  # latest session in this project
  python show-context.py --list           # list sessions, newest first
  python show-context.py --session <id>   # a specific session
  python show-context.py --full           # do not truncate message bodies
  python show-context.py --grep Hello     # show which turns still contain "Hello"
  python show-context.py --growth         # per-turn context growth table only
  python show-context.py --no-tokens      # message bodies without token accounting
"""
import argparse
import json
import os
import sys
from datetime import datetime

# Windows consoles default to cp1252 and mangle em-dashes / ellipses.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOME = os.path.expanduser("~")
NL = chr(10)
# Plain ASCII: the workshop room runs Windows consoles at cp1252.
ARROW = "|"


def slug_of(cwd):
    r"""Claude Code encodes the cwd as the transcript folder name.

    Separators become hyphens, and so do underscores and dots: the directory
    C:\dev\demo_project_000 is stored as C--dev-demo-project-000. Case is kept
    (testNgFramework stays mixed), so this is not a plain lowercase slug.
    """
    out = cwd
    for ch in (":", chr(92), "/", "_", "."):
        out = out.replace(ch, "-")
    return out


def find_slug_dir(root, path):
    """Locate the transcript dir for `path`, tolerating slug-rule drift.

    Try the computed slug first, then fall back to scanning for a directory
    that normalises to the same thing. The fallback means a future tweak to
    Claude Code's encoding degrades into a working lookup rather than the
    "no transcript directory" wall.
    """
    candidate = os.path.join(root, slug_of(path))
    if os.path.isdir(candidate):
        return candidate
    if not os.path.isdir(root):
        return None
    want = slug_of(path).lower().strip("-")
    for name in os.listdir(root):
        if name.lower().strip("-") == want:
            full = os.path.join(root, name)
            if os.path.isdir(full):
                return full
    return None


def project_dir(cwd, explicit=False):
    """Find the transcript dir for cwd.

    Transcripts are keyed by the directory Claude Code was started in, which is
    usually a repo root. Running this script from a subdirectory (materials/
    scripts/, say) would otherwise look up a slug that never existed, so walk
    up towards the filesystem root and take the first ancestor that has one.
    """
    root = os.path.join(HOME, ".claude", "projects")
    # A Windows path typed unquoted into a POSIX shell (git bash) loses its
    # backslashes: C:\dev\proj arrives as "C:devproj", which abspath would then
    # resolve against the cwd into nonsense. Catch it rather than guess.
    if len(cwd) > 2 and cwd[1] == ':' and cwd[2] not in (chr(92), '/'):
        sys.exit(
            "Path looks mangled by the shell: %s" % cwd
            + NL
            + "Quote it or use forward slashes:"
            + NL
            + r"  --cwd 'C:\dev\workshopPlan'   or   --cwd C:/dev/workshopPlan"
        )

    path = os.path.abspath(cwd)
    tried = []
    while True:
        tried.append(os.path.join(root, slug_of(path)))
        found = find_slug_dir(root, path)
        if found:
            return found
        parent = os.path.dirname(path)
        if parent == path or explicit:
            break
        path = parent

    msg = ["No transcript directory found. Looked for:"]
    msg += ["  " + t for t in tried]
    if os.path.isdir(root):
        existing = sorted(
            d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d))
        )
        if existing:
            msg.append("")
            msg.append("Projects that do have transcripts:")
            msg += ["  " + d for d in existing]
            msg.append("")
            msg.append("Pass the matching directory explicitly, e.g.:")
            msg.append(r"  python show-context.py --cwd C:\dev\workshopPlan")
    sys.exit(NL.join(msg))


def sessions(pdir):
    if not os.path.isdir(pdir):
        sys.exit(f"No transcript directory found at:\n  {pdir}")
    files = [
        os.path.join(pdir, f) for f in os.listdir(pdir) if f.endswith(".jsonl")
    ]
    return sorted(files, key=os.path.getmtime, reverse=True)


def load(path):
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return out


def text_of(entry):
    """Flatten a message's content blocks into readable text."""
    msg = entry.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return content
    parts = []
    for block in content or []:
        if not isinstance(block, dict):
            parts.append(str(block))
            continue
        btype = block.get("type")
        if btype == "text":
            parts.append(block.get("text", ""))
        elif btype == "thinking":
            parts.append("[thinking] " + block.get("thinking", "")[:400])
        elif btype == "tool_use":
            parts.append(
                "[tool_use: %s] %s"
                % (block.get("name"), json.dumps(block.get("input", {}))[:400])
            )
        elif btype == "tool_result":
            body = block.get("content")
            if isinstance(body, list):
                body = " ".join(
                    b.get("text", "") for b in body if isinstance(b, dict)
                )
            parts.append("[tool_result] " + str(body)[:400])
        else:
            parts.append("[%s]" % btype)
    return "\n".join(p for p in parts if p)


def is_message(entry):
    return entry.get("type") in ("user", "assistant") and entry.get("message")


def usage_of(entry):
    """The token accounting the API returned for an assistant turn.

    Only assistant entries carry it: a user turn is not billed on its own, it
    is billed as part of the next assistant response. Returns None otherwise.
    """
    u = (entry.get("message") or {}).get("usage")
    if not u:
        return None
    read = u.get("cache_read_input_tokens", 0)
    write = u.get("cache_creation_input_tokens", 0)
    fresh = u.get("input_tokens", 0)
    return {
        "read": read,
        "write": write,
        "fresh": fresh,
        "total": read + write + fresh,
        "out": u.get("output_tokens", 0),
    }


def clip(s, n):
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1] + "…"


def fmt(n):
    return f"{n:,}"


def cmd_list(pdir):
    print(f"Sessions in {pdir}\n")
    for path in sessions(pdir):
        entries = load(path)
        msgs = [e for e in entries if is_message(e)]
        when = datetime.fromtimestamp(os.path.getmtime(path))
        first = ""
        for e in msgs:
            if e["type"] == "user":
                first = clip(text_of(e), 60)
                break
        print(
            "  %s  %s  %3d msgs  %8s  %s"
            % (
                os.path.basename(path)[:8],
                when.strftime("%Y-%m-%d %H:%M"),
                len(msgs),
                f"{os.path.getsize(path)//1024}KB",
                first,
            )
        )


def cmd_show(path, width, grep, tokens=True):
    entries = load(path)
    msgs = [e for e in entries if is_message(e)]
    print("=" * 78)
    print("THE MESSAGES ARRAY - resent in full on every turn")
    print("session: %s" % os.path.basename(path))
    print("=" * 78)
    print()

    seen = set()
    idx = 0          # turn number in the real conversation
    matched = 0      # turns actually printed (differs under --grep)
    prev_cached = None
    idx_prev = 0
    cached_before = idx_before = None
    for e in msgs:
        body = text_of(e)
        # An assistant turn is written once per stream chunk. Those repeats
        # share identical usage figures but may differ in text (a later chunk
        # carries more of the reply), so dedup on usage where it exists and
        # fall back to the text only for user turns. Deduping on text alone
        # lets a partial chunk through as a phantom extra turn, which then
        # throws off every subsequent carry-over comparison.
        u_sig = usage_of(e)
        sig = (
            (e["type"], "usage", u_sig["read"], u_sig["write"], u_sig["out"])
            if u_sig
            else (e["type"], body)
        )
        if sig in seen:
            continue
        seen.add(sig)
        # Number the turn and fold its usage into the running carry-over
        # BEFORE applying --grep. Otherwise a filtered-out turn would both
        # renumber the survivors and make two non-adjacent turns look like a
        # broken prefix.
        idx += 1
        u = usage_of(e) if tokens else None
        if u:
            cached_before, idx_before = prev_cached, idx_prev
            prev_cached, idx_prev = u["read"] + u["write"], idx
        if grep and grep.lower() not in body.lower():
            continue
        role = e["type"].upper()
        ts = (e.get("timestamp") or "")[11:19]
        matched += 1
        print("[%02d] %-9s %s" % (idx, role, ts))
        shown = body if width == 0 else clip(body, width)
        for line in shown.splitlines() or [""]:
            print("     " + line)

        if u:
            print(
                "     %s sent to the model: %s in  (%s replayed from cache"
                " + %s new + %s uncached)  ->  %s out"
                % (
                    ARROW,
                    fmt(u["total"]),
                    fmt(u["read"]),
                    fmt(u["write"]),
                    fmt(u["fresh"]),
                    fmt(u["out"]),
                )
            )
            # The proof: this turn's cache read equals what the previous
            # turn had cached, matched to the token. A cache hit requires a
            # byte-identical prefix, so the earlier turns cannot have been
            # dropped or edited.
            #
            # Compare against read+write, not the full total: the handful of
            # uncached `input_tokens` fall after the last cache breakpoint, so
            # they are never written to cache and cannot be read back.
            #
            # A mismatch here is usually NOT a broken prefix. Where the cache
            # breakpoint lands varies, so content already in the conversation
            # (typically the previous reply) can be cached between requests and
            # show up as a larger read. That still means the prefix was resent
            # - only more of it was cached - so the line stays factual about
            # what it observed rather than claiming the context was dropped.
            if cached_before is not None:
                if u["read"] == cached_before:
                    print(
                        "     %s cache read %s == turn %d's cached input %s"
                        " - every earlier message was resent, unchanged"
                        % (ARROW, fmt(u["read"]), idx_before, fmt(cached_before))
                    )
                else:
                    # Prefix changed (compaction, an edited earlier turn, or a
                    # cache entry that expired). Worth showing, not hiding.
                    print(
                        "     %s cache read %s != turn %d's cached input %s"
                        " - prefix grew between turns (a long reply, or a new"
                        " cache breakpoint)"
                        % (ARROW, fmt(u["read"]), idx_before, fmt(cached_before))
                    )
        print()

    if grep:
        print("-" * 78)
        print('Messages still containing "%s": %d' % (grep, matched))
        print("Every one of them is sent again with your NEXT prompt.")


def cmd_growth(path):
    entries = load(path)
    print("=" * 78)
    print("CONTEXT GROWTH - what the model receives per turn")
    print("session: %s" % os.path.basename(path))
    print("=" * 78)
    print()
    print(
        "%-5s %-9s %12s %12s %12s %10s"
        % ("turn", "time", "cache read", "cache write", "TOTAL IN", "out")
    )
    print("-" * 78)

    seen, turn, prev = set(), 0, None
    for e in entries:
        if e.get("type") != "assistant":
            continue
        u = (e.get("message") or {}).get("usage")
        if not u:
            continue
        # One assistant turn is logged once per stream chunk; the usage
        # figures are identical across those, so collapse on them.
        sig = (
            u.get("cache_read_input_tokens", 0),
            u.get("cache_creation_input_tokens", 0),
            u.get("output_tokens", 0),
        )
        if sig in seen:
            continue
        seen.add(sig)
        turn += 1
        read = u.get("cache_read_input_tokens", 0)
        write = u.get("cache_creation_input_tokens", 0)
        fresh = u.get("input_tokens", 0)
        total = read + write + fresh
        delta = "" if prev is None else "  (+%s)" % fmt(total - prev)
        prev = total
        print(
            "%-5d %-9s %12s %12s %12s %10s%s"
            % (
                turn,
                (e.get("timestamp") or "")[11:19],
                fmt(read),
                fmt(write),
                fmt(total),
                fmt(u.get("output_tokens", 0)),
                delta,
            )
        )

    print()
    print("cache read  = prior conversation, replayed from cache (cheap, but still sent)")
    print("cache write = new text this turn: your prompt, files read, tool results")
    print("TOTAL IN    = everything the model sees. It only ever goes up.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session")
    ap.add_argument("--cwd", default=os.getcwd())
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--growth", action="store_true")
    ap.add_argument("--grep")
    ap.add_argument(
        "--no-tokens",
        action="store_true",
        help="hide the per-turn token accounting in the message view",
    )
    ap.add_argument("--width", type=int, default=200)
    a = ap.parse_args()

    pdir = project_dir(a.cwd, explicit=a.cwd != os.getcwd())

    if a.list:
        cmd_list(pdir)
        return

    if a.session:
        path = os.path.join(pdir, a.session)
        if not path.endswith(".jsonl"):
            path += ".jsonl"
        if not os.path.exists(path):
            matches = [p for p in sessions(pdir) if a.session in os.path.basename(p)]
            if not matches:
                sys.exit("No session matching: " + a.session)
            path = matches[0]
    else:
        all_s = sessions(pdir)
        if not all_s:
            sys.exit("No sessions found in " + pdir)
        path = all_s[0]

    if a.growth:
        cmd_growth(path)
    else:
        cmd_show(path, 0 if a.full else a.width, a.grep, tokens=not a.no_tokens)


if __name__ == "__main__":
    main()
