import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// firebase-admin mock
// ---------------------------------------------------------------------------
const mockGet = jest.fn();
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockRemove = jest.fn().mockResolvedValue(undefined);
const mockOrderByChild = jest.fn().mockReturnValue({ get: mockGet });

const mockChild = jest.fn().mockReturnValue({
  set: mockSet,
  remove: mockRemove,
});

const mockRef = jest.fn().mockReturnValue({
  get: mockGet,
  set: mockSet,
  child: mockChild,
  orderByChild: mockOrderByChild,
});
const mockDb = { ref: mockRef } as unknown as admin.database.Database;

jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  database: jest.fn(),
}));

// Import after mocks
let pushVersion: typeof import('./versionHelper').pushVersion;
let getVersions: typeof import('./versionHelper').getVersions;

beforeAll(async () => {
  const mod = await import('./versionHelper');
  pushVersion = mod.pushVersion;
  getVersions = mod.getVersions;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('pushVersion', () => {
  it('writes a version entry with correct fields', async () => {
    // Mock: no existing versions
    mockGet.mockResolvedValueOnce({
      exists: () => true,
      val: () => ({}),
      forEach: jest.fn(),
    });

    await pushVersion(mockDb, 'board1', 'obj1', 'hello', 'output', 'user_edit', 'user1');

    // Should have called child() to write new version
    expect(mockChild).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalled();
  });
});

describe('getVersions', () => {
  it('returns empty array when no versions exist', async () => {
    mockGet.mockResolvedValueOnce({ exists: () => false });

    const result = await getVersions(mockDb, 'board1', 'obj1');
    expect(result).toEqual([]);
  });

  it('returns versions sorted by timestamp descending', async () => {
    const versions = {
      'v-1': { versionId: 'v-1', timestamp: 100, text: 'a', promptOutput: null, source: 'user_edit', userId: 'u1' },
      'v-2': { versionId: 'v-2', timestamp: 200, text: 'b', promptOutput: null, source: 'prompt_run', userId: 'u1' },
    };
    mockGet.mockResolvedValueOnce({
      exists: () => true,
      val: () => versions,
      forEach: (cb: (child: { val: () => unknown }) => void) => {
        Object.values(versions).forEach((v) => cb({ val: () => v }));
      },
    });

    const result = await getVersions(mockDb, 'board1', 'obj1');
    expect(result).toHaveLength(2);
    expect(result[0].timestamp).toBe(200);
    expect(result[1].timestamp).toBe(100);
  });
});
