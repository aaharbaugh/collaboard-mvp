import { degToCompass, WMO_CODES, US_STATE_ABBREVS, US_STATE_NAMES, API_EXECUTORS } from './apiRegistry';

describe('degToCompass', () => {
  it('returns N for 0 degrees', () => {
    expect(degToCompass(0)).toBe('N');
  });

  it('returns E for 90 degrees', () => {
    expect(degToCompass(90)).toBe('E');
  });

  it('returns S for 180 degrees', () => {
    expect(degToCompass(180)).toBe('S');
  });

  it('returns W for 270 degrees', () => {
    expect(degToCompass(270)).toBe('W');
  });

  it('returns NE for 45 degrees', () => {
    expect(degToCompass(45)).toBe('NE');
  });

  it('wraps 360 degrees back to N', () => {
    expect(degToCompass(360)).toBe('N');
  });

  it('returns SW for 225 degrees', () => {
    expect(degToCompass(225)).toBe('SW');
  });
});

describe('WMO_CODES', () => {
  it('maps code 0 to Clear sky', () => {
    expect(WMO_CODES[0]).toBe('Clear sky');
  });

  it('maps code 3 to Overcast', () => {
    expect(WMO_CODES[3]).toBe('Overcast');
  });

  it('maps code 95 to Thunderstorm', () => {
    expect(WMO_CODES[95]).toBe('Thunderstorm');
  });

  it('has entries for all major weather codes', () => {
    const majorCodes = [0, 1, 2, 3, 45, 51, 61, 71, 80, 95];
    for (const code of majorCodes) {
      expect(WMO_CODES[code]).toBeDefined();
    }
  });
});

describe('US_STATE_ABBREVS', () => {
  it('maps OH to Ohio', () => {
    expect(US_STATE_ABBREVS['OH']).toBe('Ohio');
  });

  it('maps CA to California', () => {
    expect(US_STATE_ABBREVS['CA']).toBe('California');
  });

  it('maps NY to New York', () => {
    expect(US_STATE_ABBREVS['NY']).toBe('New York');
  });

  it('has 51 entries (50 states + DC)', () => {
    expect(Object.keys(US_STATE_ABBREVS)).toHaveLength(51);
  });
});

describe('US_STATE_NAMES', () => {
  it('contains ohio in lowercase', () => {
    expect(US_STATE_NAMES.has('ohio')).toBe(true);
  });

  it('contains district of columbia', () => {
    expect(US_STATE_NAMES.has('district of columbia')).toBe(true);
  });

  it('has the same count as US_STATE_ABBREVS', () => {
    expect(US_STATE_NAMES.size).toBe(Object.keys(US_STATE_ABBREVS).length);
  });
});

describe('API_EXECUTORS', () => {
  it('has a weather executor with an execute function', () => {
    expect(API_EXECUTORS['weather']).toBeDefined();
    expect(typeof API_EXECUTORS['weather'].execute).toBe('function');
  });

  it('has a dictionary executor with buildUrl and formatResponse', () => {
    expect(API_EXECUTORS['dictionary']).toBeDefined();
    expect(typeof API_EXECUTORS['dictionary'].buildUrl).toBe('function');
    expect(typeof API_EXECUTORS['dictionary'].formatResponse).toBe('function');
  });

  it('has entries for all expected APIs', () => {
    const expectedApis = ['weather', 'crypto', 'exchange', 'time', 'dictionary', 'wikipedia', 'country', 'ip'];
    for (const api of expectedApis) {
      expect(API_EXECUTORS[api]).toBeDefined();
    }
  });
});
