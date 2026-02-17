import { create } from 'zustand';

export type ToolMode = 'select' | 'move' | 'stickyNote' | 'rectangle' | 'circle' | 'text';

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
}));
