import { expect, request } from '@playwright/test';

import { API_URL } from './config';

/**
 * `npm run dev` starts the web and API servers together, and Vite begins
 * listening well before Fastify does. Playwright's `webServer` can only gate on
 * one URL, so without this a run can start while `/api` requests still fail
 * through the Vite proxy — producing empty pages that look like assertion bugs.
 */
async function globalSetup(): Promise<void> {
  const context = await request.newContext();

  try {
    await expect(async () => {
      const response = await context.get(`${API_URL}/health`);
      expect(response.ok()).toBeTruthy();
    }).toPass({ timeout: 180_000, intervals: [500, 1_000, 2_000] });
  } finally {
    await context.dispose();
  }
}

export default globalSetup;
