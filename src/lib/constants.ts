export const CURSOR_COLORS = [
  '#6b8e5a', // sage green
  '#8b6914', // amber
  '#7a5c3a', // warm brown
  '#5a7a8b', // muted teal
  '#8b5a6b', // dusty rose
  '#6b6b3a', // olive
];

export const DEFAULT_OBJECT_COLORS: Record<string, string> = {
  stickyNote: '#f5e6ab',
  rectangle: '#d4e4bc',
  circle: '#c5d5e8',
  text: '#1a1a1a',
};

export const STICKY_NOTE_DEFAULTS = {
  width: 160,
  height: 120,
};

/** Minimum text size in screen pixels when zoomed out (infinite zoom). Set to 0 to remove; text then scales with zoom only. */
export const MIN_READABLE_TEXT_SCREEN_PX = 8;

/** Default size for standalone text element (heading-style). */
export const TEXT_DEFAULTS = {
  width: 240,
  height: 60,
};

/** Font size multiplier by heading level (1 = largest). Used for zoom-invariant scaling. */
export const HEADING_SCALE: Record<number, number> = {
  1: 2,
  2: 1.5,
  3: 1.25,
  4: 1.1,
  5: 1,
  6: 0.9,
};

export const SHAPE_DEFAULTS = {
  width: 100,
  height: 80,
};
