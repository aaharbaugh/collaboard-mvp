import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// firebase-admin mock
// ---------------------------------------------------------------------------
const mockGet = jest.fn();
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockTransaction = jest.fn().mockImplementation((fn: (current: unknown) => unknown) =>
  Promise.resolve(fn(null)),
);
const mockRef = jest.fn().mockReturnValue({
  get: mockGet,
  set: mockSet,
  update: mockUpdate,
  transaction: mockTransaction,
});
const mockDb = { ref: mockRef } as unknown as admin.database.Database;

jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  database: jest.fn(),
}));

// ---------------------------------------------------------------------------
// OpenAI mock
// ---------------------------------------------------------------------------
const mockCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

// ---------------------------------------------------------------------------
// LangSmith mock
// ---------------------------------------------------------------------------
jest.mock('langsmith', () => ({
  Client: jest.fn().mockImplementation(() => ({})),
  RunTree: jest.fn().mockImplementation(() => ({
    postRun: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(undefined),
    patchRun: jest.fn().mockResolvedValue(undefined),
    createChild: jest.fn().mockReturnValue({
      postRun: jest.fn().mockResolvedValue(undefined),
      end: jest.fn().mockResolvedValue(undefined),
      patchRun: jest.fn().mockResolvedValue(undefined),
    }),
  })),
}));

// ---------------------------------------------------------------------------
// apiRegistry mock
// ---------------------------------------------------------------------------
const mockWeatherExecute = jest.fn().mockResolvedValue('NYC: 72F, Sunny');
const mockCryptoExecute = jest.fn().mockResolvedValue('Bitcoin: $50000');

jest.mock('./apiRegistry.js', () => ({
  API_EXECUTORS: {
    weather: { execute: mockWeatherExecute },
    crypto: { execute: mockCryptoExecute },
  },
}));

// ---------------------------------------------------------------------------
// apiCache mock
// ---------------------------------------------------------------------------
jest.mock('./apiCache.js', () => ({
  getCachedResult: jest.fn().mockResolvedValue(null),
  setCachedResult: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// versionHelper mock
// ---------------------------------------------------------------------------
jest.mock('./versionHelper.js', () => ({
  pushVersion: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import function under test AFTER mocks are defined
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
let parseSections: any;
let parseItemBlocks: any;
let findFreePosition: any;
let updateRunStatus: any;
let routeOutputToTarget: any;
let resolveTemplate: any;
let runPromptNode: any;

beforeAll(async () => {
  const mod = await import('./promptRunner');
  parseSections = mod.parseSections;
  parseItemBlocks = mod.parseItemBlocks;
  findFreePosition = mod.findFreePosition;
  updateRunStatus = mod.updateRunStatus;
  routeOutputToTarget = mod.routeOutputToTarget;
  resolveTemplate = mod.resolveTemplate;
  runPromptNode = mod.runPromptNode;
});

beforeEach(() => {
  jest.clearAllMocks();
  (admin.database as unknown as jest.Mock).mockReturnValue(mockDb);
  // Reset mockRef to default behavior
  mockRef.mockReturnValue({
    get: mockGet,
    set: mockSet,
    update: mockUpdate,
    transaction: mockTransaction,
  });
});

// ===========================================================================
// parseSections
// ===========================================================================
describe('parseSections', () => {
  it('returns empty map for empty labels array', () => {
    const result = parseSections('Some text content', []);
    expect(result.size).toBe(0);
  });

  it('parses single section correctly', () => {
    const result = parseSections('[summary]: This is it', ['summary']);
    expect(result.get('summary')).toBe('This is it');
  });

  it('parses multiple sections', () => {
    const text = '[summary]: First\n[details]: Second';
    const result = parseSections(text, ['summary', 'details']);
    expect(result.get('summary')).toBe('First');
    expect(result.get('details')).toBe('Second');
  });

  it('matches labels case-insensitively', () => {
    const text = '[SUMMARY]: Uppercase text';
    const result = parseSections(text, ['summary']);
    expect(result.get('summary')).toBe('Uppercase text');
  });

  it('falls back to whole text under first label when no [label]: found', () => {
    const text = 'No labeled sections here, just plain text.';
    const result = parseSections(text, ['summary', 'details']);
    expect(result.get('summary')).toBe('No labeled sections here, just plain text.');
    expect(result.has('details')).toBe(false);
  });

  it('handles multiline content within sections', () => {
    const text = '[summary]: Line one\nLine two\nLine three\n[details]: Detail line';
    const result = parseSections(text, ['summary', 'details']);
    expect(result.get('summary')).toBe('Line one\nLine two\nLine three');
    expect(result.get('details')).toBe('Detail line');
  });
});

// ===========================================================================
// parseItemBlocks
// ===========================================================================
describe('parseItemBlocks', () => {
  it('splits on --- Item N --- markers correctly', () => {
    const text = '--- Item 1 ---\nFirst block\n--- Item 2 ---\nSecond block';
    const result = parseItemBlocks(text, 2);
    expect(result).toEqual(['First block', 'Second block']);
  });

  it('falls back to numbered headers like 1. first 2. second', () => {
    const text = '1. First item\n2. Second item';
    const result = parseItemBlocks(text, 2);
    expect(result).toEqual(['First item', 'Second item']);
  });

  it('replicates whole text when no markers found', () => {
    const text = 'Just a plain block of text';
    const result = parseItemBlocks(text, 3);
    expect(result).toEqual([
      'Just a plain block of text',
      'Just a plain block of text',
      'Just a plain block of text',
    ]);
  });

  it('handles fewer markers than expected by taking what it can and replicating', () => {
    // Only 1 Item marker but asking for 3 items; should fall through to next strategy
    const text = '--- Item 1 ---\nOnly one block';
    const result = parseItemBlocks(text, 3);
    // Falls through Item markers (1 < 3), falls through numbered (none), replicates
    expect(result.length).toBe(3);
    // Since no numbered pattern matches either, it replicates the entire text
    expect(result[0]).toBe(text.trim());
    expect(result[1]).toBe(text.trim());
    expect(result[2]).toBe(text.trim());
  });
});

// ===========================================================================
// findFreePosition
// ===========================================================================
describe('findFreePosition', () => {
  it('returns original position when no existing objects', () => {
    const pos = findFreePosition(100, 200, 160, 120, []);
    expect(pos).toEqual({ x: 100, y: 200 });
  });

  it('shifts down when overlap with existing object', () => {
    const existing = [{ x: 90, y: 190, width: 160, height: 120 }];
    const pos = findFreePosition(100, 200, 160, 120, existing, 8);
    // First attempt overlaps, so y shifts by height+gap = 120+8 = 128
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(200 + 128);
  });

  it('shifts multiple times for stacked overlapping objects', () => {
    const existing = [
      { x: 90, y: 190, width: 160, height: 120 },
      { x: 90, y: 190 + 128, width: 160, height: 120 }, // overlaps second attempt
    ];
    const pos = findFreePosition(100, 200, 160, 120, existing, 8);
    // First attempt (y=200) overlaps obj1 → shift to 328
    // Second attempt (y=328) overlaps obj2 → shift to 456
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(200 + 128 + 128);
  });

  it('stops at maxAttempts and returns last computed position', () => {
    // Create objects that overlap every position
    const existing = Array.from({ length: 25 }, (_, i) => ({
      x: 90,
      y: 190 + i * 128,
      width: 160,
      height: 120,
    }));
    const pos = findFreePosition(100, 200, 160, 120, existing, 8, 3);
    // After 3 attempts, y = 200 + 3 * 128 = 584
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(200 + 3 * 128);
  });
});

// ===========================================================================
// updateRunStatus
// ===========================================================================
describe('updateRunStatus', () => {
  it('writes running status with null error', async () => {
    await updateRunStatus(mockDb, 'board1', 'obj1', 'running');

    expect(mockRef).toHaveBeenCalledWith('boards/board1/objects/obj1');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        lastRunStatus: 'running',
        lastRunError: null,
      }),
    );
    // lastRunAt should be a number (timestamp)
    const call = mockUpdate.mock.calls[0][0];
    expect(typeof call.lastRunAt).toBe('number');
  });

  it('writes success status with null error', async () => {
    await updateRunStatus(mockDb, 'board1', 'obj1', 'success');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        lastRunStatus: 'success',
        lastRunError: null,
      }),
    );
  });

  it('writes error status with error message', async () => {
    await updateRunStatus(mockDb, 'board1', 'obj1', 'error', 'Something failed');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        lastRunStatus: 'error',
        lastRunError: 'Something failed',
      }),
    );
  });
});

// ===========================================================================
// routeOutputToTarget
// ===========================================================================
describe('routeOutputToTarget', () => {
  const baseOpts = {
    sourceObjectId: 'src1',
    runStamp: 'abc123',
    wireIdSlug: 'w001',
    userId: 'user1',
    now: 1000000,
    stickyIndex: 0,
  };

  it('update mode: calls db.update with promptOutput', async () => {
    const result = await routeOutputToTarget(
      mockDb, 'board1', 'target1', 'Hello output', 'update', baseOpts,
    );

    expect(mockRef).toHaveBeenCalledWith('boards/board1/objects/target1');
    expect(mockUpdate).toHaveBeenCalledWith({ promptOutput: 'Hello output' });
    expect(result.stickyCreated).toBe(false);
  });

  it('append mode: calls transaction', async () => {
    const result = await routeOutputToTarget(
      mockDb, 'board1', 'target1', 'Appended text', 'append', baseOpts,
    );

    expect(mockRef).toHaveBeenCalledWith('boards/board1/objects/target1/promptOutput');
    expect(mockTransaction).toHaveBeenCalled();
    expect(result.stickyCreated).toBe(false);

    // Verify the transaction function logic
    const txFn = mockTransaction.mock.calls[0][0];
    expect(txFn(null)).toBe('Appended text');
    expect(txFn('Existing')).toBe('Existing\n\nAppended text');
  });

  it('create mode: reads target, creates new sticky note', async () => {
    // Set up mockRef to return different mocks for get vs set
    const getMock = jest.fn().mockResolvedValue({
      val: () => ({ id: 'target1', x: 100, y: 200, width: 160, height: 120 }),
    });

    mockRef.mockImplementation((path: string) => {
      if (path === 'boards/board1/objects/target1') {
        return { get: getMock, set: mockSet, update: mockUpdate, transaction: mockTransaction };
      }
      return { get: mockGet, set: mockSet, update: mockUpdate, transaction: mockTransaction };
    });

    const result = await routeOutputToTarget(
      mockDb, 'board1', 'target1', 'Created content', 'create', baseOpts,
    );

    expect(result.stickyCreated).toBe(true);
    expect(result.newObject).toBeDefined();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stickyNote',
        promptOutput: 'Created content',
        createdBy: 'user1',
      }),
    );
  });
});

// ===========================================================================
// resolveTemplate
// ===========================================================================
describe('resolveTemplate', () => {
  it('replaces input pill tokens with their values', () => {
    const pills = [
      { id: 'p1', label: 'topic', node: 0, direction: 'in' as const },
    ];
    const inputValues = new Map([['p1', 'Machine Learning']]);
    const result = resolveTemplate('Write about {topic} today', pills, inputValues);
    expect(result).toBe('Write about Machine Learning today');
  });

  it('replaces output pill tokens with [label] markers', () => {
    const pills = [
      { id: 'p1', label: 'summary', node: 1, direction: 'out' as const },
    ];
    const inputValues = new Map<string, string>();
    const result = resolveTemplate('Generate {summary}', pills, inputValues);
    expect(result).toBe('Generate [summary]');
  });

  it('strips [API:xxx] markers', () => {
    const pills: Array<{ id: string; label: string; node: number; direction: 'in' | 'out' }> = [];
    const inputValues = new Map<string, string>();
    const result = resolveTemplate('Fetch data [API:weather] and process', pills, inputValues);
    expect(result).toBe('Fetch data and process');
  });

  it('collapses multiple spaces', () => {
    const pills: Array<{ id: string; label: string; node: number; direction: 'in' | 'out' }> = [];
    const inputValues = new Map<string, string>();
    const result = resolveTemplate('Hello   world   test', pills, inputValues);
    expect(result).toBe('Hello world test');
  });

  it('uses overrides when provided', () => {
    const pills = [
      { id: 'p1', label: 'name', node: 0, direction: 'in' as const },
    ];
    const inputValues = new Map([['p1', 'Original']]);
    const overrides = new Map([['p1', 'Override']]);
    const result = resolveTemplate('Hello {name}', pills, inputValues, overrides);
    expect(result).toBe('Hello Override');
  });

  it('skips pills with apiGroup', () => {
    const pills = [
      { id: 'p1', label: 'city', node: 0, direction: 'in' as const, apiGroup: 'weather' },
      { id: 'p2', label: 'topic', node: 1, direction: 'in' as const },
    ];
    const inputValues = new Map([['p1', 'NYC'], ['p2', 'Science']]);
    const result = resolveTemplate('About {city} and {topic}', pills, inputValues);
    // {city} should not be replaced because the pill has apiGroup
    // {topic} should be replaced
    expect(result).toBe('About {city} and Science');
  });
});

// ===========================================================================
// runPromptNode
// ===========================================================================
describe('runPromptNode', () => {
  const BASE_REQ = { boardId: 'board1', objectId: 'test-obj', userId: 'user1' };

  // Helper to set up mockRef with path-based routing
  function setupMockRef(overrides: Record<string, {
    get?: jest.Mock;
    set?: jest.Mock;
    update?: jest.Mock;
    transaction?: jest.Mock;
  }> = {}) {
    mockRef.mockImplementation((path: string) => {
      const baseMock = {
        get: jest.fn().mockResolvedValue({ exists: () => false, val: () => null }),
        set: mockSet,
        update: mockUpdate,
        transaction: mockTransaction,
      };

      for (const [pattern, mock] of Object.entries(overrides)) {
        if (path.includes(pattern)) {
          return { ...baseMock, ...mock };
        }
      }

      return baseMock;
    });
  }

  it('returns error when object not found', async () => {
    setupMockRef({
      'objects/test-obj': {
        get: jest.fn().mockResolvedValue({ exists: () => false, val: () => null }),
      },
    });

    const result = await runPromptNode(BASE_REQ);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Object not found');
  });

  it('returns error when no template and no apiConfig', async () => {
    setupMockRef({
      'objects/test-obj': {
        get: jest.fn().mockResolvedValue({
          exists: () => true,
          val: () => ({ id: 'test-obj', promptTemplate: '', text: '', pills: [] }),
        }),
      },
    });

    const result = await runPromptNode(BASE_REQ);
    expect(result.success).toBe(false);
    expect(result.error).toBe('No prompt template');
  });

  it('marks object as running before execution', async () => {
    // Track all update calls and their paths
    const updateCalls: Array<{ path: string; data: unknown }> = [];
    const localMockUpdate = jest.fn().mockImplementation((data) => {
      updateCalls.push({ path: 'captured', data });
      return Promise.resolve(undefined);
    });

    mockRef.mockImplementation((path: string) => {
      const baseMock = {
        get: jest.fn().mockResolvedValue({ exists: () => false, val: () => null }),
        set: jest.fn().mockResolvedValue(undefined),
        update: localMockUpdate,
        transaction: mockTransaction,
      };

      if (path === `boards/board1/objects/test-obj`) {
        return {
          ...baseMock,
          get: jest.fn().mockResolvedValue({
            exists: () => true,
            val: () => ({
              id: 'test-obj',
              promptTemplate: 'Hello world',
              pills: [],
              x: 0, y: 0, width: 160, height: 120,
            }),
          }),
        };
      }
      if (path.includes('/wires')) {
        return {
          ...baseMock,
          get: jest.fn().mockResolvedValue({ val: () => ({}) }),
        };
      }
      return baseMock;
    });

    // Mock OpenAI response
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Test result' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    await runPromptNode(BASE_REQ);

    // First update call should be 'running' status
    expect(localMockUpdate).toHaveBeenCalled();
    const firstCall = localMockUpdate.mock.calls[0][0];
    expect(firstCall.lastRunStatus).toBe('running');
  });

  it('API path: calls executor, stores result, marks success', async () => {
    const objectData = {
      id: 'test-obj',
      type: 'promptNode',
      apiConfig: { apiId: 'weather' },
      pills: [
        { id: 'p1', label: 'city', node: 0, direction: 'in', apiGroup: 'weather' },
      ],
      x: 100, y: 200, width: 160, height: 120,
    };

    // Track all ref calls for assertions
    const refCalls: string[] = [];
    const localMockUpdate = jest.fn().mockResolvedValue(undefined);
    const localMockSet = jest.fn().mockResolvedValue(undefined);

    mockRef.mockImplementation((path: string) => {
      refCalls.push(path);
      const baseMock = {
        get: jest.fn().mockResolvedValue({ exists: () => false, val: () => null }),
        set: localMockSet,
        update: localMockUpdate,
        transaction: mockTransaction,
      };

      if (path === 'boards/board1/objects/test-obj') {
        return {
          ...baseMock,
          get: jest.fn().mockResolvedValue({
            exists: () => true,
            val: () => objectData,
          }),
        };
      }
      if (path.includes('/wires')) {
        return {
          ...baseMock,
          get: jest.fn().mockResolvedValue({ val: () => ({}) }),
        };
      }
      return baseMock;
    });

    const result = await runPromptNode(BASE_REQ);

    expect(result.success).toBe(true);
    expect(result.output).toBe('NYC: 72F, Sunny');
    expect(mockWeatherExecute).toHaveBeenCalled();

    // Should have stored promptOutput on the object
    expect(localMockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ promptOutput: 'NYC: 72F, Sunny' }),
    );

    // Should have marked status as success
    expect(localMockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ lastRunStatus: 'success' }),
    );
  });

  it('LLM path: calls OpenAI, creates result sticky, marks success', async () => {
    const objectData = {
      id: 'test-obj',
      type: 'promptNode',
      promptTemplate: 'Summarize this topic',
      pills: [],
      x: 100, y: 200, width: 160, height: 120,
    };

    const localMockUpdate = jest.fn().mockResolvedValue(undefined);
    const localMockSet = jest.fn().mockResolvedValue(undefined);

    mockRef.mockImplementation((path: string) => {
      const baseMock = {
        get: jest.fn().mockResolvedValue({ exists: () => false, val: () => null }),
        set: localMockSet,
        update: localMockUpdate,
        transaction: mockTransaction,
      };

      if (path === 'boards/board1/objects/test-obj') {
        return {
          ...baseMock,
          get: jest.fn().mockResolvedValue({
            exists: () => true,
            val: () => objectData,
          }),
        };
      }
      if (path.includes('/wires')) {
        return {
          ...baseMock,
          get: jest.fn().mockResolvedValue({ val: () => ({}) }),
        };
      }
      return baseMock;
    });

    // Mock OpenAI response
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Here is the summary of the topic.' } }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    });

    const result = await runPromptNode(BASE_REQ);

    expect(result.success).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // Should have created a result sticky note (no output pills = unwired single result)
    expect(localMockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stickyNote',
        promptOutput: 'Here is the summary of the topic.',
        createdBy: 'user1',
      }),
    );

    // Should have marked status as success
    expect(localMockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ lastRunStatus: 'success' }),
    );
  });

  it('error handling: marks status as error with message', async () => {
    const objectData = {
      id: 'test-obj',
      type: 'promptNode',
      apiConfig: { apiId: 'nonexistent' },
      pills: [],
      x: 100, y: 200, width: 160, height: 120,
    };

    const localMockUpdate = jest.fn().mockResolvedValue(undefined);

    mockRef.mockImplementation((path: string) => {
      const baseMock = {
        get: jest.fn().mockResolvedValue({ exists: () => false, val: () => null }),
        set: jest.fn().mockResolvedValue(undefined),
        update: localMockUpdate,
        transaction: mockTransaction,
      };

      if (path === 'boards/board1/objects/test-obj') {
        return {
          ...baseMock,
          get: jest.fn().mockResolvedValue({
            exists: () => true,
            val: () => objectData,
          }),
        };
      }
      if (path.includes('/wires')) {
        return {
          ...baseMock,
          get: jest.fn().mockResolvedValue({ val: () => ({}) }),
        };
      }
      return baseMock;
    });

    const result = await runPromptNode(BASE_REQ);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown API');

    // Should have marked status as error
    expect(localMockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        lastRunStatus: 'error',
        lastRunError: expect.stringContaining('Unknown API'),
      }),
    );
  });
});
