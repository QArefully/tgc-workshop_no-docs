import { expect, test } from '@playwright/test';

import { HomePage } from './pages/home-page';

/**
 * Seeded-data facts this spec relies on (see README.md "Seeded Data"):
 * "flour" matches 11 materials, one of which is named "All-Purpose Flour".
 * Run `npm run reset` if these drift.
 */
const QUERY = 'flour';
const EXPECTED_MATCHES = 11;
const EXPECTED_PRODUCT = 'All-Purpose Flour';

test.describe('catalog search', () => {
  test('searching from the home page narrows the catalog to matching materials', async ({
    page,
  }) => {
    const home = new HomePage(page);
    await home.goto();

    const catalog = await home.search(QUERY);

    await expect(catalog.heading).toHaveText(`Material search results: ${QUERY}`);
    await expect(catalog.resultSummary).toHaveText(`${EXPECTED_MATCHES} materials`);
    await expect(catalog.results).toHaveCount(EXPECTED_MATCHES);
    await expect(catalog.result(EXPECTED_PRODUCT)).toBeVisible();
  });

  test('a query with no matches reports an empty catalog', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();

    const catalog = await home.search('zzzznotathing');

    await expect(catalog.resultSummary).toHaveText('No materials match those filters');
    await expect(catalog.results).toHaveCount(0);
  });
});
