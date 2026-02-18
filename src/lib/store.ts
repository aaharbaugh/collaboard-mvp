import { create } from 'zustand';

export type ToolMode = 'select' | 'move' | 'stickyNote' | 'rectangle' | 'circle' | 'star' | 'text' | 'frame';

/** Order for the Shape [5] cycle: Star -> Circle -> Rectangle -> Star */
export const SHAPE_CYCLE: ToolMode[] = ['star', 'circle', 'rectangle'];

/** Order for the Pointer [1] cycle: Select <-> Move */
export const POINTER_CYCLE: ToolMode[] = ['select', 'move'];

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface BoardStore {
  viewport: Viewport;
  setViewport: (vp: Partial<Viewport>) => void;

  selectedIds: string[];
  setSelection: (ids: string[]) => void;

  toolMode: ToolMode;
  setToolMode: (mode: ToolMode) => void;
  /** Cycle to next shape (Star -> Circle -> Rectangle). Used by hotkey 5. */
  cycleShapeTool: () => void;
  /** Cycle between Select and Move. Used by hotkey 1. */
  cyclePointerTool: () => void;
}

export const useBoardStore = create<BoardStore>((set) => ({
  viewport: { x: 0, y: 0, scale: 1 },
  setViewport: (vp) =>
    set((state) => ({
      viewport: { ...state.viewport, ...vp },
    })),

  selectedIds: [],
  setSelection: (ids) => set({ selectedIds: ids }),

  toolMode: 'select',
  setToolMode: (mode) => set({ toolMode: mode }),
  cycleShapeTool: () =>
    set((state) => {
      const idx = SHAPE_CYCLE.indexOf(state.toolMode);
      const next = idx >= 0 ? SHAPE_CYCLE[(idx + 1) % SHAPE_CYCLE.length] : SHAPE_CYCLE[0];
      return { toolMode: next };
    }),
  cyclePointerTool: () =>
    set((state) => {
      const idx = POINTER_CYCLE.indexOf(state.toolMode);
      const next = idx >= 0 ? POINTER_CYCLE[(idx + 1) % POINTER_CYCLE.length] : POINTER_CYCLE[0];
      return { toolMode: next };
    }),
}));
