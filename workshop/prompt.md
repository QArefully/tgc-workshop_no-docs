# QME-419 — Custom-blend cart editing regression plan

## Business context

Wholesale customers order custom powder blends in 25 kg bags. A cart can contain several saved recipes using the same base material, alongside ordinary products. Prepare a focused regression test plan for editing these blends. The feature already exists; this task requires a plan only.

## Acceptance criteria

- **AC1 — Restore and retain edits:** Editing one of several saved recipes with the same base material restores that recipe's materials, proportions, and cart quantity. Unsaved changes survive a background refresh of cart data.
- **AC2 — Save and combine:** Saving changes preserves the edited line's quantity and updates its composition and price. If the new recipe matches another saved recipe with the same base material, combine their quantities into one blend line with one mixing fee. Other configured lines and ordinary product lines remain unchanged.
- **AC3 — Resulting prices:** Existing material and volume-pricing rules determine material cost and totals at the resulting quantity. After combining lines, recalculate pricing for the combined quantity and charge the mixing fee once. Include a merge where the combined quantity changes the applicable volume pricing.
- **AC4 — Current evaluation:** Save is available only after the current configuration has been accepted by evaluation. Delayed responses for earlier configurations must not replace the current summary or allow saving the wrong configuration.

## Your task

Write only `workshop/e2e-plan.md`, in English, using no more than 1,500 words. This must be the only repository change. Work as a single agent: do not ask questions, use subagents, implement tests, or modify the application.

Use static inspection of relevant source and existing tests only. Do not open a browser, run the application or tests, install dependencies, or reset the database. Stop inspecting once you have enough evidence for a reproducible plan; label remaining unknowns as assumptions. Creating new blends, broad safety/rule matrices, and checkout are outside this regression scope, except where needed to set up edit tests.

Propose no more than four independent scenarios, ordered by risk, with representative coverage of all acceptance criteria. Specify the test level for each scenario; API or component companions are allowed where they provide reliable checks. For each scenario include:

- Priority and brief risk justification, with acceptance-criterion references.
- Reproducible data and setup: materials, proportions, quantities in 25 kg bags, relevant minimum order quantities, country, and currency. Verify chosen data against repository rules.
- Short numbered actions and precise observable expected results.
- Numeric price expectations calculated independently of displayed values or the response under test, with their source and calculation.
- How response order will be controlled where timing matters.

Use exactly these headings, in this order: `## Scenarios`, `## Existing coverage`, `## Risks`, `## Approach`. Summarize relevant existing coverage and gaps concisely. Record material requirement/code discrepancies and assumptions; do not replace required behavior with current code behavior. Keep the approach practical and evidence-backed, with concise references to relevant files.
