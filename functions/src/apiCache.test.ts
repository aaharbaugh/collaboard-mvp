import { computeCacheKey } from './apiCache';

// We test the pure functions here. getCachedResult/setCachedResult
// require Firebase mocking which follows the promptRunner.test.ts pattern.

describe('computeCacheKey', () => {
  it('returns a 16-character hex string', () => {
    const key = computeCacheKey('weather', { city: 'NYC' });
    expect(key).toHaveLength(16);
    expect(/^[0-9a-f]+$/.test(key)).toBe(true);
  });

  it('produces consistent keys for same input', () => {
    const key1 = computeCacheKey('weather', { city: 'NYC' });
    const key2 = computeCacheKey('weather', { city: 'NYC' });
    expect(key1).toBe(key2);
  });

  it('produces different keys for different params', () => {
    const key1 = computeCacheKey('weather', { city: 'NYC' });
    const key2 = computeCacheKey('weather', { city: 'LA' });
    expect(key1).not.toBe(key2);
  });

  it('produces different keys for different APIs', () => {
    const key1 = computeCacheKey('weather', { city: 'NYC' });
    const key2 = computeCacheKey('crypto', { city: 'NYC' });
    expect(key1).not.toBe(key2);
  });

  it('sorts params consistently regardless of insertion order', () => {
    const key1 = computeCacheKey('exchange', { from: 'USD', to: 'EUR', amount: '100' });
    const key2 = computeCacheKey('exchange', { amount: '100', to: 'EUR', from: 'USD' });
    expect(key1).toBe(key2);
  });
});
