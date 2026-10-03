import { describe, expect, it } from 'vitest';
import { resolveLoginReturnPath } from './loginReturnPath';

describe('resolveLoginReturnPath', () => {
  it.each([
    [
      { from: '/products/powdered-water?sort=highest#reviews' },
      '/products/powdered-water?sort=highest#reviews',
    ],
    [undefined, '/'],
    [null, '/'],
    [{}, '/'],
    [{ from: 42 }, '/'],
    [{ from: '//evil.example' }, '/'],
    [{ from: '/\\evil.example' }, '/'],
    [{ from: 'https://evil.example' }, '/'],
    [{ from: '/login' }, '/'],
    [{ from: '/login?from=/products/1' }, '/'],
    [{ from: '/login#form' }, '/'],
  ])('resolves %j to %s', (state, expected) => {
    expect(resolveLoginReturnPath(state)).toBe(expected);
  });
});
