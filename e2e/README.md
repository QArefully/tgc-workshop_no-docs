# End-to-end tests

Playwright specs driving a real browser against the web app on
`http://127.0.0.1:5173`, so requests travel the real browser -> Vite proxy -> API path.

## Install browsers

Once per machine:

```bash
npx playwright install chromium
```

Chromium only — extra engines are downloads that can fail on conference wifi.

## Run

```bash
npm run test:e2e      # headless
npm run test:e2e:ui   # interactive runner
```

The config starts `npm run dev` itself and reuses an already-running app, so either
works. A cold start seeds the database and can take a minute.

## Layout

| Path              | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| `*.spec.ts`       | Specs — one file per feature area                  |
| `pages/`          | Page objects: locators and navigation, no assertions |
| `config.ts`       | Base URLs (override via `E2E_BASE_URL`)            |
| `global-setup.ts` | Waits for the API, which starts after Vite         |

## Add a spec

Add locators to a page object in `pages/`, then assert in a `*.spec.ts`.

- Locate by role, label, or placeholder. The app is richly labelled — never add
  `data-testid` to application code.
- Keep assertions in specs; page objects expose `Locator`s and return page objects.
- Use web-first assertions (`await expect(locator).toHaveText(...)`). Never
  `waitForTimeout`.
- Avoid `.first()` on a locator meant to identify one thing — scope it instead, or
  it will hide an ambiguous match.
- Assert a result *count*, not just that one row exists, so a broken filter fails.
- Pin seeded-data facts to named constants and note them in a comment.

## Rule: CLI, not MCP

When you ask an **AI agent** to explore the app — find a locator, check what a
page renders, debug a failing spec — give it
[`@playwright/cli`](https://github.com/microsoft/playwright-cli), not
[`playwright-mcp`](https://github.com/microsoft/playwright-mcp). Both drive a
browser for an agent; we standardize on the CLI.

```bash
npm install -g @playwright/cli@latest
playwright-cli install --skills
```

The agent then drives the browser with shell commands. Each command prints an
accessibility snapshot with `[ref=eNN]` handles; later commands take a ref as
their target:

```bash
playwright-cli open http://127.0.0.1:5173
playwright-cli find "Search products"   # -> searchbox "Search products" [ref=e19]
playwright-cli fill e19 flour
playwright-cli snapshot                 # full accessibility tree
playwright-cli console                  # console messages
playwright-cli requests                 # network requests
playwright-cli close
```

`find` is the locator-authoring tool: it reports every match, so if it returns
two nodes your `getByRole` will be ambiguous too.

Why the CLI here:

1. **Identical in every harness.** MCP is wired up per client
   (`claude mcp add …`, `mcpServers` JSON, editor-specific config). Shell
   commands are the same for everyone in the room, so one set of instructions
   works for all of us.
2. **Cheaper in context.** Per the CLI's own docs, "CLI invocations are more
   token-efficient: they avoid loading large tool schemas and verbose
   accessibility trees into the model context."

MCP is not worse in general — its docs point at exploratory automation and
long-running autonomous loops, where holding browser state beats the token cost.
That is a real tradeoff, just not the one this exercise is standardizing on.

Two practical notes. `@playwright/cli` is pre-1.0 (0.1.x) — check
`playwright-cli --help` if a command here has moved. And it writes a
`.playwright-cli/` directory of snapshots and logs into the working directory,
so run it from outside this repo, or gitignore it before you start.

This is separate from the `playwright test` runner that runs these specs — for
that, see **Run** above.
