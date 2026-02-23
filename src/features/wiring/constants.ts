import type { AnchorPosition } from '../../types/board';

/**
 * Maps node numbers 1-8 (clockwise from top) to AnchorPosition values.
 * This ensures every object type uses the same 8-node layout in wiring mode.
 */
export const NODE_TO_ANCHOR: Record<number, AnchorPosition> = {
  1: 'top',
  2: 'top-right',
  3: 'right',
  4: 'bottom-right',
  5: 'bottom',
  6: 'bottom-left',
  7: 'left',
  8: 'top-left',
};

export const ANCHOR_TO_NODE: Record<string, number> = {
  'top': 1,
  'top-right': 2,
  'right': 3,
  'bottom-right': 4,
  'bottom': 5,
  'bottom-left': 6,
  'left': 7,
  'top-left': 8,
};

/** 8 colors for wires, indexed by (fromNode - 1) — red-based palette */
export const WIRE_COLORS = [
  '#cc3333', // red
  '#b82e2e', // dark red
  '#d94444', // bright red
  '#a52a2a', // brown-red
  '#cc4040', // medium red
  '#c03030', // crimson
  '#d63838', // scarlet
  '#b33535', // maroon-red
];

export const WIRE_DEFAULT_COLOR = '#cc3333';

/**
 * Compute local position (relative to object top-left) for a pill.
 * Input pills line up in a column along the left edge.
 * Output pills line up in a column along the right edge.
 * Returns null if the node is not found in the pills array.
 */
export function getPillLocalXY(
  width: number,
  height: number,
  pills: { node: number; direction: 'in' | 'out' }[],
  targetNode: number,
): { x: number; y: number } | null {
  const pill = pills.find((p) => p.node === targetNode);
  if (!pill) return null;

  const sameDirPills = pills
    .filter((p) => p.direction === pill.direction)
    .sort((a, b) => pill.direction === 'in' ? b.node - a.node : a.node - b.node);

  const index = sameDirPills.findIndex((p) => p.node === targetNode);
  const total = sameDirPills.length;

  const x = pill.direction === 'in' ? 0 : width;
  const step = height / (total + 1);
  const y = step * (index + 1);

  return { x, y };
}
