# QME-418 — Custom Blend Configurator

## Context

Wholesale customers can create their own 25 kg powder blend from a base material and selected ingredients, then purchase it like any other product. The configurator is accessible from the main category menu without logging in.

## Task

This feature already exists. Prepare a prioritized E2E test plan covering the configurator and adding and editing a blend in the cart. This exercise covers AC1–AC5. Checkout, payment, delivery, discounts, and order confirmation are out of scope.

Prepare the plan using only repository files. Do not open a browser, run the application or tests, install dependencies, or reset the database. Do not implement tests or modify the application.

## Acceptance criteria

- **AC1 — Add to cart:** A customer who is not logged in can select a base material, add at least one ingredient, set valid proportions, and add the blend as a single cart item with a visible total price. They can continue shopping and have an option to proceed to checkout. Verification of this option is limited to its availability and navigation destination; the checkout flow is out of scope.
- **AC2 — Live price updates:** Changing the proportions updates the material cost and total price in the summary without reloading the page. The mixing fee remains fixed. The material cost is determined by the base material, selected ingredients, and proportions, and the total price is the sum of the material cost and the fee; the values in the summary and cart match.
- **AC3 — Safety:** The summary indicates whether the configured blend is suitable for food use. If it is not, it displays visible, clear handling instructions.
- **AC4 — Rejection during evaluation:** If evaluation rejects a combination that the screen allowed the customer to create, display a clear reason, do not add the blend to the cart, and preserve the configuration. After correcting it, the customer can successfully add the blend to the cart.
- **AC5 — Edit a blend:** When the cart contains one blend, editing it restores the base material, ingredients, and proportions in the configurator. Saving changes updates the composition and price of the same cart item instead of adding another one.
