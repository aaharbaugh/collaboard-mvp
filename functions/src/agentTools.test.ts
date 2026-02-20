import * as admin from 'firebase-admin';
import {
  BOARD_PALETTE_HEX,
  PALETTE,
  mapColorNameToHex,
  autoSelectAnchors,
  createStickyNote,
  createShape,
  createFrame,
  createText,
  executePlan,
  createConnector,
  createMultiPointConnector,
  connectInSequence,
  createBatch,
  connectBatch,
  moveObject,
  resizeObject,
  updateText,
  changeColor,
  addToFrame,
  setLayer,
  rotateObject,
  writeAgentStatus,
  clearAgentStatus,
  getBoardState,
} from './agentTools';

// ---------------------------------------------------------------------------
// Firebase Admin mock
// ---------------------------------------------------------------------------
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockRemove = jest.fn().mockResolvedValue(undefined);
const mockOnce = jest.fn();
const mockRef = jest.fn().mockReturnValue({
  set: mockSet,
  update: mockUpdate,
  remove: mockRemove,
  once: mockOnce,
});
const mockDb = { ref: mockRef };

jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  database: jest.fn(),
}));

// Mock crypto so generated IDs are predictable
let idCounter = 0;
jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => `test-id-${++idCounter}`),
}));

beforeEach(() => {
  jest.clearAllMocks();
  idCounter = 0;
  (admin.database as unknown as jest.Mock).mockReturnValue(mockDb);
  mockRef.mockReturnValue({ set: mockSet, update: mockUpdate, remove: mockRemove, once: mockOnce });
  mockOnce.mockResolvedValue({ val: () => ({}) });
});

// ---------------------------------------------------------------------------
// PALETTE / BOARD_PALETTE_HEX
// ---------------------------------------------------------------------------
describe('PALETTE', () => {
  it('has named entries that match BOARD_PALETTE_HEX positions', () => {
    expect(PALETTE.yellow).toBe(BOARD_PALETTE_HEX[0]);
    expect(PALETTE.green).toBe(BOARD_PALETTE_HEX[1]);
    expect(PALETTE.blue).toBe(BOARD_PALETTE_HEX[2]);
    expect(PALETTE.rose).toBe(BOARD_PALETTE_HEX[3]);
    expect(PALETTE.lavender).toBe(BOARD_PALETTE_HEX[4]);
    expect(PALETTE.mint).toBe(BOARD_PALETTE_HEX[5]);
    expect(PALETTE.peach).toBe(BOARD_PALETTE_HEX[6]);
    expect(PALETTE.grey).toBe(BOARD_PALETTE_HEX[7]);
  });

  it('BOARD_PALETTE_HEX contains exactly 8 colours', () => {
    expect(BOARD_PALETTE_HEX).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// mapColorNameToHex
// ---------------------------------------------------------------------------
describe('mapColorNameToHex', () => {
  it('maps known color names to board palette hex', () => {
    expect(mapColorNameToHex('yellow')).toBe(PALETTE.yellow);
    expect(mapColorNameToHex('pink')).toBe(PALETTE.rose);
    expect(mapColorNameToHex('blue')).toBe(PALETTE.blue);
    expect(mapColorNameToHex('green')).toBe(PALETTE.green);
    expect(mapColorNameToHex('lavender')).toBe(PALETTE.lavender);
    expect(mapColorNameToHex('purple')).toBe(PALETTE.lavender);
  });

  it('passes board palette hex through unchanged', () => {
    expect(mapColorNameToHex(PALETTE.yellow)).toBe(PALETTE.yellow);
    expect(mapColorNameToHex(PALETTE.green)).toBe(PALETTE.green);
  });

  it('handles case-insensitive color names', () => {
    expect(mapColorNameToHex('Yellow')).toBe(PALETTE.yellow);
    expect(mapColorNameToHex('PINK')).toBe(PALETTE.rose);
  });

  it('defaults unknown names to warm yellow', () => {
    expect(mapColorNameToHex('chartreuse')).toBe(PALETTE.yellow);
  });
});

// ---------------------------------------------------------------------------
// autoSelectAnchors
// ---------------------------------------------------------------------------
describe('autoSelectAnchors', () => {
  const fromObj = { x: 0, y: 100, width: 100, height: 80 };

  it('selects right→left when target is directly to the right', () => {
    const toObj = { x: 200, y: 100, width: 100, height: 80 };
    const result = autoSelectAnchors(fromObj, toObj);
    expect(result).toEqual({ fromAnchor: 'right', toAnchor: 'left' });
  });

  it('selects left→right when target is directly to the left', () => {
    const toObj = { x: -200, y: 100, width: 100, height: 80 };
    const result = autoSelectAnchors(fromObj, toObj);
    expect(result).toEqual({ fromAnchor: 'left', toAnchor: 'right' });
  });

  it('selects bottom→top when target is directly below', () => {
    const toObj = { x: 0, y: 300, width: 100, height: 80 };
    const result = autoSelectAnchors(fromObj, toObj);
    expect(result).toEqual({ fromAnchor: 'bottom', toAnchor: 'top' });
  });

  it('selects top→bottom when target is directly above', () => {
    const toObj = { x: 0, y: -100, width: 100, height: 80 };
    const result = autoSelectAnchors(fromObj, toObj);
    expect(result).toEqual({ fromAnchor: 'top', toAnchor: 'bottom' });
  });

  it('prefers horizontal when dx > dy', () => {
    // dx=200, dy=50 → horizontal wins
    const toObj = { x: 200, y: 150, width: 100, height: 80 };
    const result = autoSelectAnchors(fromObj, toObj);
    expect(result.fromAnchor).toBe('right');
    expect(result.toAnchor).toBe('left');
  });

  it('prefers vertical when dy > dx', () => {
    // dx=50, dy=200 → vertical wins
    const toObj = { x: 50, y: 400, width: 100, height: 80 };
    const result = autoSelectAnchors(fromObj, toObj);
    expect(result.fromAnchor).toBe('bottom');
    expect(result.toAnchor).toBe('top');
  });
});

// ---------------------------------------------------------------------------
// createStickyNote
// ---------------------------------------------------------------------------
describe('createStickyNote', () => {
  it('writes to the correct Firebase path', async () => {
    await createStickyNote('b1', 'Hello', 100, 200, 'yellow', 'u1');
    expect(mockRef).toHaveBeenCalledWith('boards/b1/objects/test-id-1');
  });

  it('writes correct object shape', async () => {
    await createStickyNote('b1', 'Hello', 100, 200, 'yellow', 'u1');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-id-1',
        type: 'stickyNote',
        text: 'Hello',
        x: 100,
        y: 200,
        width: 160,
        height: 120,
        color: PALETTE.yellow,
        createdBy: 'u1',
      })
    );
  });

  it('returns the generated id', async () => {
    const id = await createStickyNote('b1', 'Hi', 0, 0, 'pink', 'u1');
    expect(id).toBe('test-id-1');
  });
});

// ---------------------------------------------------------------------------
// createShape
// ---------------------------------------------------------------------------
describe('createShape', () => {
  it('writes rectangle to correct path', async () => {
    await createShape('b1', 'rectangle', 50, 50, 120, 80, 'blue', 'u1');
    expect(mockRef).toHaveBeenCalledWith('boards/b1/objects/test-id-1');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rectangle', width: 120, height: 80 })
    );
  });

  it('writes circle with correct type', async () => {
    await createShape('b1', 'circle', 0, 0, 100, 100, 'green', 'u1');
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ type: 'circle' }));
  });

  it('writes star with correct type', async () => {
    await createShape('b1', 'star', 0, 0, 80, 80, 'orange', 'u1');
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ type: 'star' }));
  });

  it('maps color names', async () => {
    await createShape('b1', 'rectangle', 0, 0, 100, 80, 'purple', 'u1');
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ color: PALETTE.lavender }));
  });
});

// ---------------------------------------------------------------------------
// createFrame
// ---------------------------------------------------------------------------
describe('createFrame', () => {
  it('writes frame with text field as title', async () => {
    await createFrame('b1', 'Sprint Planning', 0, 0, 320, 220, 'u1');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'frame',
        text: 'Sprint Planning',
        width: 320,
        height: 220,
      })
    );
  });
});

// ---------------------------------------------------------------------------
// createText
// ---------------------------------------------------------------------------
describe('createText', () => {
  it('writes a text object to the correct path', async () => {
    await createText('b1', 'My Heading', 100, 50, 240, 60, '#1a1a1a', 'u1');
    expect(mockRef).toHaveBeenCalledWith('boards/b1/objects/test-id-1');
  });

  it('writes correct object shape', async () => {
    await createText('b1', 'My Heading', 100, 50, 240, 60, '#1a1a1a', 'u1');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-id-1',
        type: 'text',
        text: 'My Heading',
        x: 100,
        y: 50,
        width: 240,
        height: 60,
        color: '#1a1a1a',
        createdBy: 'u1',
      })
    );
  });

  it('returns the generated id', async () => {
    const id = await createText('b1', 'Label', 0, 0, 200, 50, '#333', 'u1');
    expect(id).toBe('test-id-1');
  });
});

// ---------------------------------------------------------------------------
// executePlan
// ---------------------------------------------------------------------------
describe('executePlan', () => {
  it('writes objects and connections in a SINGLE batch update', async () => {
    await executePlan('b1', [
      { tempId: 's1', action: 'createStickyNote', params: { text: 'A', x: 0,   y: 0, color: 'yellow' } },
      { tempId: 's2', action: 'createStickyNote', params: { text: 'B', x: 300, y: 0, color: 'green'  } },
    ], [
      { fromId: 's1', toId: 's2' },
    ], 'u1');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).not.toHaveBeenCalled();

    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    const paths = Object.keys(updateArg);
    expect(paths.filter(p => p.includes('/objects/'))).toHaveLength(2);
    expect(paths.filter(p => p.includes('/connections/'))).toHaveLength(1);
  });

  it('resolves tempIds so connection uses actual Firebase IDs', async () => {
    const result = await executePlan('b1', [
      { tempId: 's1', action: 'createStickyNote', params: { text: 'A', x: 0,   y: 0, color: 'yellow' } },
      { tempId: 's2', action: 'createStickyNote', params: { text: 'B', x: 300, y: 0, color: 'green'  } },
    ], [
      { fromId: 's1', toId: 's2' },
    ], 'u1');

    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    const connPath = Object.keys(updateArg).find(p => p.includes('/connections/'))!;
    const connData = updateArg[connPath] as Record<string, unknown>;

    expect(connData.fromId).toBe(result.idMap['s1']);
    expect(connData.toId).toBe(result.idMap['s2']);
    expect(connData.fromId).not.toBe('s1');
    expect(connData.toId).not.toBe('s2');
  });

  it('returns idMap with tempId→actualId entries', async () => {
    const result = await executePlan('b1', [
      { tempId: 'n1', action: 'createStickyNote', params: { text: 'A', x: 0, y: 0, color: 'yellow' } },
      { tempId: 'n2', action: 'createShape',      params: { type: 'rectangle', x: 200, y: 0, width: 120, height: 80, color: 'blue' } },
    ], [], 'u1');

    expect(result.idMap['n1']).toMatch(/test-id-\d+/);
    expect(result.idMap['n2']).toMatch(/test-id-\d+/);
    expect(result.idMap['n1']).not.toBe(result.idMap['n2']);
  });

  it('works with no connections (objects only, single write)', async () => {
    await executePlan('b1', [
      { tempId: 's1', action: 'createStickyNote', params: { text: 'A', x: 0, y: 0, color: 'yellow' } },
    ], [], 'u1');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(updateArg).every(p => p.includes('/objects/'))).toBe(true);
  });

  it('works with no objects (connections between existing IDs)', async () => {
    // Existing objects already in cache
    const cache = new Map([
      ['existing-1', { x: 0,   y: 0, width: 160, height: 120 }],
      ['existing-2', { x: 300, y: 0, width: 160, height: 120 }],
    ]);
    const result = await executePlan('b1', [], [
      { fromId: 'existing-1', toId: 'existing-2' },
    ], 'u1', cache);

    expect(mockOnce).not.toHaveBeenCalled(); // no Firebase read needed (cache hit)
    expect(result.connectionIds).toHaveLength(1);
  });

  it('populates cache with created objects', async () => {
    const cache = new Map<string, { x: number; y: number; width: number; height: number }>();
    const result = await executePlan('b1', [
      { tempId: 's1', action: 'createStickyNote', params: { text: 'A', x: 10, y: 20, color: 'yellow' } },
    ], [], 'u1', cache);

    expect(cache.has(result.idMap['s1'])).toBe(true);
    expect(cache.get(result.idMap['s1'])).toMatchObject({ x: 10, y: 20, width: 160, height: 120 });
  });

  it('auto-selects anchors from object geometry', async () => {
    await executePlan('b1', [
      { tempId: 'left',  action: 'createStickyNote', params: { text: 'L', x: 0,   y: 0, color: 'yellow' } },
      { tempId: 'right', action: 'createStickyNote', params: { text: 'R', x: 300, y: 0, color: 'green'  } },
    ], [
      { fromId: 'left', toId: 'right' },
    ], 'u1');

    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    const connPath = Object.keys(updateArg).find(p => p.includes('/connections/'))!;
    const connData = updateArg[connPath] as Record<string, unknown>;
    expect(connData.fromAnchor).toBe('right');
    expect(connData.toAnchor).toBe('left');
  });

  it('throws for unknown object action', async () => {
    await expect(
      executePlan('b1', [
        { tempId: 't1', action: 'createStickyNote' as const, params: { text: '', x: 0, y: 0 } },
      ].map(op => ({ ...op, action: 'badAction' as 'createStickyNote' })), [], 'u1')
    ).rejects.toThrow('Unknown executePlan object action');
  });

  it('fetches existing objects from Firebase when tempId is not found in cache', async () => {
    // 'existing-obj' is not in cache — executePlan must fetch from Firebase
    mockOnce.mockResolvedValue({
      val: () => ({ 'existing-obj': { x: 500, y: 0, width: 160, height: 120 } }),
    });

    await executePlan('b1', [
      { tempId: 's1', action: 'createStickyNote', params: { text: 'A', x: 0, y: 0, color: 'yellow' } },
    ], [
      { fromId: 's1', toId: 'existing-obj' },
    ], 'u1');

    expect(mockOnce).toHaveBeenCalledTimes(1); // fetched missing geometry
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// createConnector
// ---------------------------------------------------------------------------
describe('createConnector', () => {
  const fromObj = { id: 'f1', x: 0, y: 100, width: 100, height: 80, type: 'rectangle' };
  const toObj = { id: 't1', x: 250, y: 100, width: 100, height: 80, type: 'rectangle' };

  beforeEach(() => {
    // Return objects when fetched
    mockOnce.mockResolvedValue({
      val: () => ({ f1: fromObj, t1: toObj }),
    });
  });

  it('auto-selects anchors based on object positions', async () => {
    await createConnector('b1', 'f1', 't1', {}, 'u1');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        fromId: 'f1',
        toId: 't1',
        fromAnchor: 'right',
        toAnchor: 'left',
      })
    );
  });

  it('uses explicit anchors when provided', async () => {
    await createConnector('b1', 'f1', 't1', { fromAnchor: 'top', toAnchor: 'bottom' }, 'u1');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ fromAnchor: 'top', toAnchor: 'bottom' })
    );
  });

  it('uses custom color when provided', async () => {
    await createConnector('b1', 'f1', 't1', { color: 'pink' }, 'u1');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ color: PALETTE.rose })
    );
  });

  it('defaults to blue (PALETTE.blue) color', async () => {
    await createConnector('b1', 'f1', 't1', {}, 'u1');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ color: PALETTE.blue })
    );
  });

  it('converts points array from {x,y}[] to flat number[]', async () => {
    await createConnector(
      'b1', 'f1', 't1',
      { points: [{ x: 125, y: 200 }, { x: 150, y: 250 }] },
      'u1'
    );
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ points: [125, 200, 150, 250] })
    );
  });

  it('resolves relative waypoints when pointsRelative is true', async () => {
    await createConnector(
      'b1', 'f1', 't1',
      {
        points: [{ x: 100, y: 140 }, { x: 50, y: 30 }],
        pointsRelative: true,
      },
      'u1'
    );
    // First point absolute (100,140); second is (100+50, 140+30) = (150, 170)
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ points: [100, 140, 150, 170] })
    );
  });

  it('omits points field when no waypoints provided', async () => {
    await createConnector('b1', 'f1', 't1', {}, 'u1');
    const callArg = mockSet.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('points');
  });

  it('writes to the connections path', async () => {
    await createConnector('b1', 'f1', 't1', {}, 'u1');
    expect(mockRef).toHaveBeenCalledWith(expect.stringContaining('boards/b1/connections/'));
  });

  it('throws when fromId object not found', async () => {
    mockOnce.mockResolvedValue({ val: () => ({ t1: toObj }) }); // f1 missing
    await expect(createConnector('b1', 'f1', 't1', {}, 'u1')).rejects.toThrow('f1');
  });

  it('throws when toId object not found', async () => {
    mockOnce.mockResolvedValue({ val: () => ({ f1: fromObj }) }); // t1 missing
    await expect(createConnector('b1', 'f1', 't1', {}, 'u1')).rejects.toThrow('t1');
  });

  it('supports star-specific anchors', async () => {
    await createConnector('b1', 'f1', 't1', { fromAnchor: 'star-0', toAnchor: 'top' }, 'u1');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ fromAnchor: 'star-0', toAnchor: 'top' })
    );
  });
});

// ---------------------------------------------------------------------------
// createMultiPointConnector
// ---------------------------------------------------------------------------
describe('createMultiPointConnector', () => {
  const objs = {
    a: { id: 'a', x: 0, y: 0, width: 100, height: 80 },
    b: { id: 'b', x: 200, y: 0, width: 100, height: 80 },
    c: { id: 'c', x: 400, y: 0, width: 100, height: 80 },
  };

  beforeEach(() => {
    mockOnce.mockResolvedValue({ val: () => objs });
  });

  it('throws when fewer than 2 objects provided', async () => {
    await expect(createMultiPointConnector('b1', ['a'], {}, 'u1')).rejects.toThrow(
      'at least 2'
    );
  });

  it('creates N-1 connections in a single batch write', async () => {
    await createMultiPointConnector('b1', ['a', 'b', 'c'], {}, 'u1');
    // Single update call with 2 connections (a→b and b→c)
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).not.toHaveBeenCalled();
    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(updateArg)).toHaveLength(2);
  });

  it('returns array of connection ids', async () => {
    const ids = await createMultiPointConnector('b1', ['a', 'b'], {}, 'u1');
    expect(Array.isArray(ids)).toBe(true);
    expect(ids).toHaveLength(1);
  });

  it('adds waypoint when curved option is true', async () => {
    await createMultiPointConnector('b1', ['a', 'b'], { curved: true }, 'u1');
    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    const connData = Object.values(updateArg)[0] as Record<string, unknown>;
    // points should be present and non-empty flat array
    expect(connData.points).toBeDefined();
    expect(Array.isArray(connData.points)).toBe(true);
    expect((connData.points as unknown[]).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// connectInSequence
// ---------------------------------------------------------------------------
describe('connectInSequence', () => {
  const objs = {
    a: { id: 'a', x: 0, y: 0, width: 100, height: 80 },
    b: { id: 'b', x: 200, y: 0, width: 100, height: 80 },
    c: { id: 'c', x: 400, y: 0, width: 100, height: 80 },
    d: { id: 'd', x: 600, y: 0, width: 100, height: 80 },
  };

  beforeEach(() => {
    mockOnce.mockResolvedValue({ val: () => objs });
  });

  it('throws when fewer than 2 objects provided', async () => {
    await expect(connectInSequence('b1', ['a'], {}, 'u1')).rejects.toThrow('at least 2');
  });

  it('creates N-1 forward connections in a single batch write', async () => {
    await connectInSequence('b1', ['a', 'b', 'c', 'd'], {}, 'u1');
    // 4 objects → 3 connections in one batch write
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).not.toHaveBeenCalled();
    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(updateArg)).toHaveLength(3);
  });

  it('creates 2*(N-1) connections when bidirectional in a single batch write', async () => {
    await connectInSequence('b1', ['a', 'b', 'c'], { direction: 'bidirectional' }, 'u1');
    // 3 objects → 2 forward + 2 backward = 4 connections in one write
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(updateArg)).toHaveLength(4);
  });

  it('returns array of connection ids', async () => {
    const ids = await connectInSequence('b1', ['a', 'b', 'c'], {}, 'u1');
    expect(Array.isArray(ids)).toBe(true);
    expect(ids).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// createBatch
// ---------------------------------------------------------------------------
describe('createBatch', () => {
  it('returns empty array for empty operations', async () => {
    const result = await createBatch('b1', [], 'u1');
    expect(result).toEqual([]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('creates multiple objects in a single multi-path write', async () => {
    const ops = [
      { tempId: 's1', action: 'createStickyNote' as const, params: { text: 'Note A', x: 100, y: 100, color: 'yellow' } },
      { tempId: 's2', action: 'createStickyNote' as const, params: { text: 'Note B', x: 300, y: 100, color: 'pink' } },
    ];
    const result = await createBatch('b1', ops, 'u1');

    // Single update call (multi-path write)
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).not.toHaveBeenCalled();

    // Returns tempId→actualId mapping
    expect(result).toHaveLength(2);
    expect(result[0].tempId).toBe('s1');
    expect(result[0].actualId).toBeTruthy();
    expect(result[1].tempId).toBe('s2');
  });

  it('writes correct stickyNote shape in batch', async () => {
    await createBatch('b1', [
      { tempId: 't1', action: 'createStickyNote' as const, params: { text: 'Hi', x: 50, y: 60, color: 'green' } },
    ], 'u1');

    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    const objData = Object.values(updateArg)[0] as Record<string, unknown>;
    expect(objData.type).toBe('stickyNote');
    expect(objData.text).toBe('Hi');
    expect(objData.x).toBe(50);
    expect(objData.y).toBe(60);
    expect(objData.width).toBe(160);
    expect(objData.height).toBe(120);
    expect(objData.color).toBe(PALETTE.green);
  });

  it('writes correct frame shape in batch', async () => {
    await createBatch('b1', [
      { tempId: 'f1', action: 'createFrame' as const, params: { title: 'My Frame', x: 0, y: 0, width: 500, height: 400 } },
    ], 'u1');

    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    const objData = Object.values(updateArg)[0] as Record<string, unknown>;
    expect(objData.type).toBe('frame');
    expect(objData.text).toBe('My Frame');
    expect(objData.width).toBe(500);
  });

  it('writes correct text shape in batch', async () => {
    await createBatch('b1', [
      { tempId: 'tx1', action: 'createText' as const, params: { text: 'Heading', x: 100, y: 50, width: 240, height: 60, color: '#1a1a1a' } },
    ], 'u1');

    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    const objData = Object.values(updateArg)[0] as Record<string, unknown>;
    expect(objData.type).toBe('text');
    expect(objData.text).toBe('Heading');
    expect(objData.width).toBe(240);
    expect(objData.height).toBe(60);
    expect(objData.color).toBe('#1a1a1a');
  });

  it('populates cache with created objects', async () => {
    const cache = new Map<string, { x: number; y: number; width: number; height: number }>();
    const result = await createBatch('b1', [
      { tempId: 's1', action: 'createStickyNote' as const, params: { text: 'A', x: 10, y: 20, color: 'blue' } },
    ], 'u1', cache);

    expect(cache.has(result[0].actualId)).toBe(true);
    expect(cache.get(result[0].actualId)).toMatchObject({ x: 10, y: 20, width: 160, height: 120 });
  });

  it('throws for unknown action', async () => {
    await expect(
      createBatch('b1', [
        { tempId: 't1', action: 'createStickyNote' as const, params: { text: '', x: 0, y: 0 } },
      ].map(op => ({ ...op, action: 'unknownAction' as 'createStickyNote' })), 'u1')
    ).rejects.toThrow('Unknown batch action');
  });
});

// ---------------------------------------------------------------------------
// connectBatch
// ---------------------------------------------------------------------------
describe('connectBatch', () => {
  const objs = {
    a: { id: 'a', x: 0, y: 0, width: 100, height: 80 },
    b: { id: 'b', x: 200, y: 0, width: 100, height: 80 },
    c: { id: 'c', x: 400, y: 0, width: 100, height: 80 },
  };

  beforeEach(() => {
    mockOnce.mockResolvedValue({ val: () => objs });
  });

  it('returns empty array for empty connections', async () => {
    const result = await connectBatch('b1', [], 'u1');
    expect(result).toEqual([]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('creates multiple connections in a single multi-path write', async () => {
    const result = await connectBatch('b1', [
      { fromId: 'a', toId: 'b' },
      { fromId: 'b', toId: 'c' },
    ], 'u1');

    // Single update call (multi-path write)
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
  });

  it('reads objects only once regardless of connection count', async () => {
    await connectBatch('b1', [
      { fromId: 'a', toId: 'b' },
      { fromId: 'b', toId: 'c' },
      { fromId: 'a', toId: 'c' },
    ], 'u1');

    // Only one Firebase read despite three connections
    expect(mockOnce).toHaveBeenCalledTimes(1);
  });

  it('skips Firebase read when all IDs are in cache', async () => {
    const cache = new Map([
      ['a', { x: 0, y: 0, width: 100, height: 80 }],
      ['b', { x: 200, y: 0, width: 100, height: 80 }],
    ]);
    await connectBatch('b1', [{ fromId: 'a', toId: 'b' }], 'u1', cache);

    expect(mockOnce).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('auto-selects anchors based on positions', async () => {
    await connectBatch('b1', [{ fromId: 'a', toId: 'b' }], 'u1');

    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    const connData = Object.values(updateArg)[0] as Record<string, unknown>;
    expect(connData.fromAnchor).toBe('right');
    expect(connData.toAnchor).toBe('left');
  });

  it('throws when an object ID is not found', async () => {
    await expect(
      connectBatch('b1', [{ fromId: 'a', toId: 'missing' }], 'u1')
    ).rejects.toThrow('missing');
  });
});

// ---------------------------------------------------------------------------
// moveObject
// ---------------------------------------------------------------------------
describe('moveObject', () => {
  it('updates x and y at the correct path', async () => {
    await moveObject('b1', 'obj1', 300, 400);
    expect(mockRef).toHaveBeenCalledWith('boards/b1/objects/obj1');
    expect(mockUpdate).toHaveBeenCalledWith({ x: 300, y: 400 });
  });
});

// ---------------------------------------------------------------------------
// resizeObject
// ---------------------------------------------------------------------------
describe('resizeObject', () => {
  it('updates width and height at the correct path', async () => {
    await resizeObject('b1', 'obj1', 200, 150);
    expect(mockRef).toHaveBeenCalledWith('boards/b1/objects/obj1');
    expect(mockUpdate).toHaveBeenCalledWith({ width: 200, height: 150 });
  });
});

// ---------------------------------------------------------------------------
// updateText
// ---------------------------------------------------------------------------
describe('updateText', () => {
  it('updates text at the correct path', async () => {
    await updateText('b1', 'obj1', 'New Text');
    expect(mockRef).toHaveBeenCalledWith('boards/b1/objects/obj1');
    expect(mockUpdate).toHaveBeenCalledWith({ text: 'New Text' });
  });
});

// ---------------------------------------------------------------------------
// changeColor
// ---------------------------------------------------------------------------
describe('changeColor', () => {
  it('updates color (mapping name to hex)', async () => {
    await changeColor('b1', 'obj1', 'yellow');
    expect(mockUpdate).toHaveBeenCalledWith({ color: PALETTE.yellow });
  });

  it('defaults non-palette hex to warm yellow', async () => {
    await changeColor('b1', 'obj1', '#ABCDEF');
    expect(mockUpdate).toHaveBeenCalledWith({ color: PALETTE.yellow });
  });
});

// ---------------------------------------------------------------------------
// addToFrame
// ---------------------------------------------------------------------------
describe('addToFrame', () => {
  it('does nothing for empty objectIds', async () => {
    await addToFrame('b1', [], 'frame1');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('sets frameId on all objects in a single multi-path write', async () => {
    await addToFrame('b1', ['obj1', 'obj2', 'obj3'], 'frame1');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg['boards/b1/objects/obj1/frameId']).toBe('frame1');
    expect(updateArg['boards/b1/objects/obj2/frameId']).toBe('frame1');
    expect(updateArg['boards/b1/objects/obj3/frameId']).toBe('frame1');
  });
});

// ---------------------------------------------------------------------------
// setLayer
// ---------------------------------------------------------------------------
describe('setLayer', () => {
  it('sets sentToBack=true to push object behind arrows', async () => {
    await setLayer('b1', 'obj1', true);
    expect(mockRef).toHaveBeenCalledWith('boards/b1/objects/obj1');
    expect(mockUpdate).toHaveBeenCalledWith({ sentToBack: true });
  });

  it('sets sentToBack=false to bring object to front', async () => {
    await setLayer('b1', 'obj1', false);
    expect(mockUpdate).toHaveBeenCalledWith({ sentToBack: false });
  });
});

// ---------------------------------------------------------------------------
// rotateObject
// ---------------------------------------------------------------------------
describe('rotateObject', () => {
  it('sets rotation in degrees at the correct path', async () => {
    await rotateObject('b1', 'obj1', 45);
    expect(mockRef).toHaveBeenCalledWith('boards/b1/objects/obj1');
    expect(mockUpdate).toHaveBeenCalledWith({ rotation: 45 });
  });

  it('sets rotation to 0', async () => {
    await rotateObject('b1', 'obj1', 0);
    expect(mockUpdate).toHaveBeenCalledWith({ rotation: 0 });
  });
});

// ---------------------------------------------------------------------------
// writeAgentStatus / clearAgentStatus
// ---------------------------------------------------------------------------
describe('writeAgentStatus', () => {
  it('writes status to the agentStatus path', async () => {
    await writeAgentStatus('b1', { phase: 'thinking', iteration: 1, maxIterations: 3 });
    expect(mockRef).toHaveBeenCalledWith('boards/b1/agentStatus');
    expect(mockSet).toHaveBeenCalledWith({
      phase: 'thinking',
      iteration: 1,
      maxIterations: 3,
    });
  });

  it('writes calling_tools status with tool names', async () => {
    await writeAgentStatus('b1', { phase: 'calling_tools', tools: ['createBatch', 'connectBatch'] });
    expect(mockSet).toHaveBeenCalledWith({
      phase: 'calling_tools',
      tools: ['createBatch', 'connectBatch'],
    });
  });
});

describe('clearAgentStatus', () => {
  it('removes the agentStatus node', async () => {
    await clearAgentStatus('b1');
    expect(mockRef).toHaveBeenCalledWith('boards/b1/agentStatus');
    expect(mockRemove).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getBoardState
// ---------------------------------------------------------------------------
describe('getBoardState', () => {
  it('reads objects and connections from Firebase', async () => {
    const objects = { obj1: { id: 'obj1', type: 'stickyNote' } };
    const connections = { conn1: { id: 'conn1', fromId: 'obj1', toId: 'obj2' } };

    // First once() call returns objects, second returns connections
    mockOnce
      .mockResolvedValueOnce({ val: () => objects })
      .mockResolvedValueOnce({ val: () => connections });

    const result = await getBoardState('b1');
    expect(result.objects).toEqual(objects);
    expect(result.connections).toEqual(connections);
  });

  it('returns empty objects and connections when board is empty', async () => {
    mockOnce.mockResolvedValue({ val: () => null });
    const result = await getBoardState('b1');
    expect(result.objects).toEqual({});
    expect(result.connections).toEqual({});
  });
});
