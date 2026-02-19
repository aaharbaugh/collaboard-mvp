import * as admin from 'firebase-admin';
import {
  mapColorNameToHex,
  autoSelectAnchors,
  createStickyNote,
  createShape,
  createFrame,
  createConnector,
  createMultiPointConnector,
  connectInSequence,
  moveObject,
  resizeObject,
  updateText,
  changeColor,
  getBoardState,
} from './agentTools';

// ---------------------------------------------------------------------------
// Firebase Admin mock
// ---------------------------------------------------------------------------
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockOnce = jest.fn();
const mockRef = jest.fn().mockReturnValue({ set: mockSet, update: mockUpdate, once: mockOnce });
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
  mockRef.mockReturnValue({ set: mockSet, update: mockUpdate, once: mockOnce });
  mockOnce.mockResolvedValue({ val: () => ({}) });
});

// ---------------------------------------------------------------------------
// mapColorNameToHex
// ---------------------------------------------------------------------------
describe('mapColorNameToHex', () => {
  it('maps known color names to board palette hex', () => {
    expect(mapColorNameToHex('yellow')).toBe('#f5e6ab');
    expect(mapColorNameToHex('pink')).toBe('#e8c5c5');
    expect(mapColorNameToHex('blue')).toBe('#c5d5e8');
    expect(mapColorNameToHex('green')).toBe('#d4e4bc');
    expect(mapColorNameToHex('lavender')).toBe('#d4c5e8');
    expect(mapColorNameToHex('purple')).toBe('#d4c5e8');
  });

  it('passes board palette hex through unchanged', () => {
    expect(mapColorNameToHex('#f5e6ab')).toBe('#f5e6ab');
    expect(mapColorNameToHex('#d4e4bc')).toBe('#d4e4bc');
  });

  it('handles case-insensitive color names', () => {
    expect(mapColorNameToHex('Yellow')).toBe('#f5e6ab');
    expect(mapColorNameToHex('PINK')).toBe('#e8c5c5');
  });

  it('defaults unknown names to warm yellow', () => {
    expect(mapColorNameToHex('chartreuse')).toBe('#f5e6ab');
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
        color: '#f5e6ab',
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
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ color: '#d4c5e8' }));
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
      expect.objectContaining({ color: '#e8c5c5' })
    );
  });

  it('defaults to cyan color', async () => {
    await createConnector('b1', 'f1', 't1', {}, 'u1');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ color: '#c5d5e8' })
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

  it('creates N-1 connections for N objects', async () => {
    await createMultiPointConnector('b1', ['a', 'b', 'c'], {}, 'u1');
    // 3 objects → 2 connections (a→b and b→c)
    // Each connection fetches objects once + writes once
    expect(mockSet).toHaveBeenCalledTimes(2);
  });

  it('returns array of connection ids', async () => {
    const ids = await createMultiPointConnector('b1', ['a', 'b'], {}, 'u1');
    expect(Array.isArray(ids)).toBe(true);
    expect(ids).toHaveLength(1);
  });

  it('adds waypoint when curved option is true', async () => {
    await createMultiPointConnector('b1', ['a', 'b'], { curved: true }, 'u1');
    const callArg = mockSet.mock.calls[0][0];
    // points should be present and non-empty flat array
    expect(callArg.points).toBeDefined();
    expect(Array.isArray(callArg.points)).toBe(true);
    expect(callArg.points.length).toBeGreaterThan(0);
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

  it('creates N-1 forward connections', async () => {
    await connectInSequence('b1', ['a', 'b', 'c', 'd'], {}, 'u1');
    // 4 objects → 3 connections
    expect(mockSet).toHaveBeenCalledTimes(3);
  });

  it('creates 2*(N-1) connections when bidirectional', async () => {
    await connectInSequence('b1', ['a', 'b', 'c'], { direction: 'bidirectional' }, 'u1');
    // 3 objects → 2 forward + 2 backward = 4 connections
    expect(mockSet).toHaveBeenCalledTimes(4);
  });

  it('returns array of connection ids', async () => {
    const ids = await connectInSequence('b1', ['a', 'b', 'c'], {}, 'u1');
    expect(Array.isArray(ids)).toBe(true);
    expect(ids).toHaveLength(2);
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
    expect(mockUpdate).toHaveBeenCalledWith({ color: '#f5e6ab' });
  });

  it('defaults non-palette hex to warm yellow', async () => {
    await changeColor('b1', 'obj1', '#ABCDEF');
    expect(mockUpdate).toHaveBeenCalledWith({ color: '#f5e6ab' });
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
