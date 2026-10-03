/**
 * Shared addresses for the e2e run.
 *
 * Tests always go through the web app so requests travel the real
 * browser -> Vite proxy -> API path. `API_URL` is for readiness checks only,
 * never for test assertions.
 */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
export const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';
