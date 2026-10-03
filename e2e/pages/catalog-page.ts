import { expect, type Locator, type Page } from '@playwright/test';

/** The catalog listing at `/catalog`, including search and filter results. */
export class CatalogPage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { level: 1 });
  }

  /**
   * The "N materials" / "No materials match those filters" line above the grid.
   * Scoped to the toolbar because the empty-state copy also appears in the
   * filter sidebar.
   */
  get resultSummary(): Locator {
    return this.page.getByText(/^(\d[\d,]* materials?|No materials match those filters)$/).first();
  }

  /**
   * One locator per result card. Product titles are the only level-3 headings
   * in the grid, which makes them a reliable stand-in for "a result".
   */
  get results(): Locator {
    return this.page.getByRole('heading', { level: 3 });
  }

  /**
   * A single result by product name. Scoped through the title heading on
   * purpose: each card links to the same product twice (image and title), so an
   * unscoped link query is ambiguous.
   */
  result(productName: string): Locator {
    return this.results.filter({ hasText: productName }).getByRole('link', { name: productName });
  }

  /** Waits for the debounced search navigation to land on this query. */
  async waitForQuery(query: string): Promise<void> {
    await expect(this.page).toHaveURL(
      (url) => url.pathname === '/catalog' && url.searchParams.get('q') === query,
    );
  }
}
