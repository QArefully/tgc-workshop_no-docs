import type { FeatureFlagRepository } from './featureFlagRepository.js';

export interface FeatureFlagResolver {
  isEnabled(key: string): boolean;
  invalidate(key: string): void;
}

/** Server-local read-through cache. Mutations invalidate only after their transaction commits. */
export function createFeatureFlagResolver(repository: FeatureFlagRepository): FeatureFlagResolver {
  const cache = new Map<string, boolean>();
  return {
    isEnabled(key) {
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const enabled = repository.get(key)?.enabled ?? false;
      cache.set(key, enabled);
      return enabled;
    },
    invalidate(key) {
      cache.delete(key);
    },
  };
}
