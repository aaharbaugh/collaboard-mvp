export const CURSOR_COLORS = [
  '#6b8e5a', // sage green
  '#8b6914', // amber
  '#7a5c3a', // warm brown
  '#5a7a8b', // muted teal
  '#8b5a6b', // dusty rose
  '#6b6b3a', // olive
];

/** Shape fill colors tuned for contrast on light-tan board (--bg-board #eee9e2). */
export const DEFAULT_OBJECT_COLORS: Record<string, string> = {
  stickyNote: '#e6d070',
  rectangle: '#a8c888',
  circle: '#98b8d8',
  star: '#d8b898',
  text: '#1a1a1a',
};

export const STICKY_NOTE_DEFAULTS = {
  width: 160,
  height: 120,
};

/** Skip rendering text when box is smaller than this in screen px (avoids pointless draw). Text scales from 0 with zoom. */
export const MIN_RENDER_SCREEN_PX = 0.5;

/** Minimum font size in screen px so text stays readable in edit and rendered modes (avoids auto-fit shrinking too small). */
export const MIN_READABLE_FONT_SCREEN_PX = 16;
/** Floor font size in screen px when min doesn't fit; we use this if it still fits so text isn't tiny. */
export const FLOOR_READABLE_FONT_SCREEN_PX = 12;

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

/** Default size for new frames (grouping container). */
export const FRAME_DEFAULTS = {
  width: 320,
  height: 220,
};

/** Colors for frames and connections; tuned for contrast on light-tan board. */
export const FRAME_STROKE = '#5a5048';
export const FRAME_FILL = 'rgba(50, 85, 55, 0.09)';
export const FRAME_TITLE_COLOR = '#4a4035';
export const CONNECTION_DEFAULT_COLOR = '#5a5044';
