import { describe, it, expect } from 'vitest';
import { API_REGISTRY, getApiById, filterApis } from './apiRegistry';

describe('API_REGISTRY', () => {
  it('contains 8 API definitions', () => {
    expect(API_REGISTRY).toHaveLength(8);
  });

  it('each entry has id, name, category, description, icon, and params fields', () => {
    for (const api of API_REGISTRY) {
      expect(api).toHaveProperty('id');
      expect(api).toHaveProperty('name');
      expect(api).toHaveProperty('category');
      expect(api).toHaveProperty('description');
      expect(api).toHaveProperty('icon');
      expect(api).toHaveProperty('params');
      expect(Array.isArray(api.params)).toBe(true);
    }
  });

  it('weather API has a city param', () => {
    const weather = API_REGISTRY.find((a) => a.id === 'weather');
    expect(weather).toBeDefined();
    const paramNames = weather!.params.map((p) => p.name);
    expect(paramNames).toContain('city');
  });

  it('exchange API has from, to, and amount params', () => {
    const exchange = API_REGISTRY.find((a) => a.id === 'exchange');
    expect(exchange).toBeDefined();
    const paramNames = exchange!.params.map((p) => p.name);
    expect(paramNames).toContain('from');
    expect(paramNames).toContain('to');
    expect(paramNames).toContain('amount');
  });
});

describe('getApiById', () => {
  it('returns the weather API for id "weather"', () => {
    const result = getApiById('weather');
    expect(result).toBeDefined();
    expect(result!.id).toBe('weather');
    expect(result!.name).toBe('Weather');
  });

  it('returns undefined for an unknown id', () => {
    const result = getApiById('nonexistent');
    expect(result).toBeUndefined();
  });

  it('returns a correct API definition with matching fields', () => {
    const result = getApiById('dictionary');
    expect(result).toBeDefined();
    expect(result!.id).toBe('dictionary');
    expect(result!.name).toBe('Dictionary');
    expect(result!.category).toBe('Reference');
    expect(result!.description).toContain('Define');
    expect(result!.params.length).toBeGreaterThan(0);
  });
});

describe('filterApis', () => {
  it('returns all APIs for an empty string', () => {
    const result = filterApis('');
    expect(result).toHaveLength(API_REGISTRY.length);
  });

  it('filters by name case-insensitively', () => {
    const result = filterApis('weather');
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((a) => a.name === 'Weather')).toBe(true);
  });

  it('filters by category', () => {
    const result = filterApis('Data');
    expect(result.length).toBeGreaterThan(0);
    for (const api of result) {
      // Each match should have "data" in name, category, or description
      const matchesCategory = api.category.toLowerCase().includes('data');
      const matchesName = api.name.toLowerCase().includes('data');
      const matchesDesc = api.description.toLowerCase().includes('data');
      expect(matchesCategory || matchesName || matchesDesc).toBe(true);
    }
  });

  it('filters by description', () => {
    const result = filterApis('currency');
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((a) => a.id === 'exchange')).toBe(true);
  });

  it('returns an empty array for a nonsense query', () => {
    const result = filterApis('xyzzy123nonexistent');
    expect(result).toHaveLength(0);
  });
});
