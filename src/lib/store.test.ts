import { describe, it, expect, beforeEach } from 'vitest';
import { useBoardStore } from './store';

describe('useBoardStore', () => {
  beforeEach(() => {
    useBoardStore.setState({
      toolMode: 'select',
      selectedIds: [],
      viewport: { x: 0, y: 0, scale: 1 },
    });
  });

  it('has initial toolMode select', () => {
    expect(useBoardStore.getState().toolMode).toBe('select');
  });

  it('setToolMode updates toolMode', () => {
    useBoardStore.getState().setToolMode('stickyNote');
    expect(useBoardStore.getState().toolMode).toBe('stickyNote');
  });

  it('setSelection updates selectedIds', () => {
    useBoardStore.getState().setSelection(['id1', 'id2']);
    expect(useBoardStore.getState().selectedIds).toEqual(['id1', 'id2']);
  });

  it('setViewport merges partial viewport', () => {
    useBoardStore.getState().setViewport({ scale: 2 });
    expect(useBoardStore.getState().viewport).toEqual({ x: 0, y: 0, scale: 2 });
    useBoardStore.getState().setViewport({ x: 10, y: 20 });
    expect(useBoardStore.getState().viewport).toEqual({ x: 10, y: 20, scale: 2 });
  });

  it('drawingConnection starts null and can be set/cleared', () => {
    expect(useBoardStore.getState().drawingConnection).toBeNull();
    useBoardStore.getState().setDrawingConnection({
      fromObjectId: 'obj1',
      fromAnchor: 'right',
      currentPoint: { x: 100, y: 200 },
      waypoints: [],
    });
    expect(useBoardStore.getState().drawingConnection).not.toBeNull();
    expect(useBoardStore.getState().drawingConnection!.fromAnchor).toBe('right');
    useBoardStore.getState().setDrawingConnection(null);
    expect(useBoardStore.getState().drawingConnection).toBeNull();
  });
});
