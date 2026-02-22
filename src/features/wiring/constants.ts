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

/** 8 muted colors for wires, indexed by (fromNode - 1) */
export const WIRE_COLORS = [
  '#6b8e9b', // teal-grey
  '#9b7e6b', // warm brown
  '#7b8e6b', // sage
  '#8e6b8e', // muted purple
  '#6b8e7b', // seafoam
  '#8e7b6b', // tan
  '#6b7b8e', // steel blue
  '#8e8e6b', // olive
];

export const WIRE_DEFAULT_COLOR = '#6b8e9b';

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
    .sort((a, b) => a.node - b.node);

  const index = sameDirPills.findIndex((p) => p.node === targetNode);
  const total = sameDirPills.length;

  const x = pill.direction === 'in' ? 0 : width;
  const step = height / (total + 1);
  const y = step * (index + 1);

  return { x, y };
}
