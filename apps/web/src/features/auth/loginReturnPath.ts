/**
 * Resolves the router state saved before an authentication redirect.
 * Only same-origin, non-login paths are valid return destinations.
 */
export function resolveLoginReturnPath(state: unknown): string {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    return '/';
  }

  const from = (state as { from?: unknown }).from;
  if (
    typeof from !== 'string' ||
    !from.startsWith('/') ||
    from.startsWith('//') ||
    from.startsWith('/\\') ||
    from === '/login' ||
    from.startsWith('/login?') ||
    from.startsWith('/login#')
  ) {
    return '/';
  }

  return from;
}
