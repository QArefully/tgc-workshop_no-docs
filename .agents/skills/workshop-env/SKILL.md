---
name: workshop-env
description: Back up and clear global AI customizations (Claude Code plugins/skills/agents, Copilot, Cursor, Codex) so a harness starts with a clean, minimal context for the workshop.
disable-model-invocation: true
---

# Workshop environment: clean and restore

Workshop measure baseline. Baseline dirty = numbers lie.

Big context come from **customizations**, not from harness itself. Plugin with 27 agents + 54 skills = thousands of tokens before user type anything. Must go. Then come back after.

Three commands. Nothing else.

| User say | You do |
|----------|--------|
| "clean my environment", "prepare for workshop" | [Clean](#clean) |
| "what is my baseline", "check environment" | [Status](#status) |
| "restore", "give me my stuff back", "workshop is over" | [Restore](#restore) |

## Rules

1. **Never delete. Move.** Every clean operation is a move into the backup vault. If move fails, stop — do not fall back to delete.
2. **One vault, one manifest.** Vault lives at `~/.workshop-backup/`. Manifest `manifest.json` inside records every move. Restore read manifest, not guess.
3. **Never clobber a vault.** If vault exist and manifest not marked `restored`, STOP and tell user. Second clean would bury first backup forever.
4. **Auth stays.** Never touch `.credentials.json`, `.claude.json`, `argv.json`, or anything holding login. User must still be logged in after clean, or workshop stop dead.
5. **Report tokens.** After clean, tell user to run `/context` and compare. That is the whole point.

## Clean

### Step 1 — safety check

```bash
if [ -f ~/.workshop-backup/manifest.json ] && ! grep -q '"restored": true' ~/.workshop-backup/manifest.json; then
  echo "BLOCKED: unrestored backup exists"; cat ~/.workshop-backup/manifest.json
fi
```

If blocked: show user, ask restore first or name a different vault. Do not continue.

### Step 2 — record what is there

Read current state so restore know where things go back to:

```bash
mkdir -p ~/.workshop-backup
cd ~/.claude 2>/dev/null && cp settings.json ~/.workshop-backup/claude-settings.json.orig 2>/dev/null
```

### Step 3 — move the heavy things

Work through the table. Skip what not exist — absence is fine, never an error.

| What | Where | Why it cost tokens |
|------|-------|--------------------|
| Plugins | `~/.claude/plugins/` | Each plugin agent + skill description load every session |
| Global skills | `~/.claude/skills/` | Same |
| Global agents | `~/.claude/agents/` | Same |
| Global commands | `~/.claude/commands/` | Slash command descriptions |
| Global memory | `~/.claude/CLAUDE.md` | Injected into every session |
| Output styles | `~/.claude/output-styles/` | Loaded if active |
| Copilot config | `~/.copilot/` | Instructions files |
| Cursor rules/skills | `~/.cursor/skills-cursor/`, `~/.cursor/agents/` | Same idea, other harness |
| Codex | `~/.codex/` | Same idea, other harness |
| Agents dir | `~/.agents/` | Harness-agnostic convention |

Move each one that exists:

```bash
mv ~/.claude/plugins ~/.workshop-backup/claude-plugins
```

Record every move in manifest as `{"from": "...", "to": "..."}`.

### Step 4 — disable plugins in settings

Moving the plugin folder is not enough — `~/.claude/settings.json` still list them in `enabledPlugins`. Harness may re-download.

Strip `enabledPlugins` from `settings.json`, keep everything else (permissions, model, thinking). Original already saved in Step 2.

### Step 5 — project-local customizations

Global clean not enough if the workshop repo itself carry skills. Ask user which project folder they run workshop in, then check `<project>/.claude/skills/`, `.claude/agents/`, `.claude/commands/`, `CLAUDE.md`, `AGENTS.md`.

**Careful here.** In the workshop repo the demo project deliberately have no agent docs — that is the measured baseline. Do not invent any. Only move what already exist, and only after user confirm the path.

### Step 6 — write manifest, report

```json
{
  "created": "<ISO timestamp>",
  "restored": false,
  "moves": [{"from": "...", "to": "..."}],
  "settings_edited": ["enabledPlugins removed from ~/.claude/settings.json"]
}
```

Then tell user, short:

- what moved (count, not a wall of paths)
- **restart the harness** — settings and plugins only read at startup
- run `/context`, compare token number to before

## Status

Read-only. Never move anything.

Report: vault exist or not, restored flag, what customizations currently live in the global folders, whether `enabledPlugins` present in settings. Say plainly whether machine is workshop-clean or not.

## Restore

### Step 1 — find manifest

No manifest = nothing to restore. Say so, stop. Do not guess from folder names.

If `"restored": true` already, say already restored, stop.

### Step 2 — move back

Walk `moves` in reverse. For each, move `to` back to `from`.

If destination already exist (user made new config since clean), do NOT overwrite. Park the restored copy next to it as `<name>.from-backup` and list these for user to merge by hand.

### Step 3 — settings

Put back `claude-settings.json.orig` over `~/.claude/settings.json` — this bring back `enabledPlugins`. If user changed settings during workshop, say so and let them pick.

### Step 4 — close out

Mark `"restored": true` in manifest. Leave vault on disk — user delete when happy. Tell user to restart harness and confirm plugins back with `/context`.

## Other harnesses

Table in Step 3 cover harnesses seen so far. If user run something else, same rule apply: find where that harness keep global instructions/skills/agents, move to vault, record in manifest. Never delete. Never touch its credentials.
