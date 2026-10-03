import type { Page } from '@playwright/test';

import { CatalogPage } from './catalog-page';

/** The shop landing page. Its search box is part of the shared site header. */
export class HomePage {
  constructor(private readonly page: Page) {}

  /** Accessible name comes from `shell.searchProducts`; the default country is US. */
  private get searchBox() {
    return this.page.getByRole('searchbox', { name: 'Search products' });
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  /**
   * Types a query and waits for the debounced navigation to the catalog.
   * Returns the resulting page object so callers can assert on results.
   */
  async search(query: string): Promise<CatalogPage> {
    await this.searchBox.fill(query);
    const catalog = new CatalogPage(this.page);
    await catalog.waitForQuery(query);
    return catalog;
  }
}
