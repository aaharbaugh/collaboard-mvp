import type { Wire, BoardObject } from '../../types/board';
import { NODE_TO_ANCHOR } from './constants';
import { getAnchorWorldPoint, getPillWorldPoint } from '../board/utils/anchorPoint';

/** Returns the outward unit direction for a node number (matches WireLine logic). */
function anchorOutwardDirection(node: number): { dx: number; dy: number } {
  const s = Math.SQRT1_2;
  switch (node) {
    case 1: return { dx: 0, dy: -1 };
    case 2: return { dx: s, dy: -s };
    case 3: return { dx: 1, dy: 0 };
    case 4: return { dx: s, dy: s };
    case 5: return { dx: 0, dy: 1 };
    case 6: return { dx: -s, dy: s };
    case 7: return { dx: -1, dy: 0 };
    case 8: return { dx: -s, dy: -s };
    default: return { dx: 0, dy: -1 };
  }
}

/** Cubic bezier point at parameter t (0-1). */
function bezierAt(p0: number, c1: number, c2: number, p1: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t * p1;
}

/**
 * Compute the screen-space midpoint of a wire's bezier curve.
 * Uses the same control-point logic as WireLine.tsx.
 */
export function getWireMidpointScreen(
  wire: Wire,
  fromObj: BoardObject,
  toObj: BoardObject,
  viewport: { x: number; y: number; scale: number },
): { x: number; y: number } {
  const fromAnchor = NODE_TO_ANCHOR[wire.fromNode];
  const toAnchor = NODE_TO_ANCHOR[wire.toNode];

  const from = fromObj.pills?.length
    ? getPillWorldPoint(fromObj, fromObj.pills, wire.fromNode)
    : getAnchorWorldPoint(fromObj, fromAnchor ?? 'top');
  const to = toObj.pills?.length
    ? getPillWorldPoint(toObj, toObj.pills, wire.toNode)
    : getAnchorWorldPoint(toObj, toAnchor ?? 'top');

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const offset = Math.max(Math.min(40 / viewport.scale, dist * 0.5), dist * 0.3);

  const fromPill = fromObj.pills?.find((p) => p.node === wire.fromNode);
  const toPill = toObj.pills?.find((p) => p.node === wire.toNode);
  const fromDir = fromPill
    ? { dx: fromPill.direction === 'in' ? -1 : 1, dy: 0 }
    : anchorOutwardDirection(wire.fromNode);
  const toDir = toPill
    ? { dx: toPill.direction === 'in' ? -1 : 1, dy: 0 }
    : anchorOutwardDirection(wire.toNode);

  const cp1x = from.x + fromDir.dx * offset;
  const cp1y = from.y + fromDir.dy * offset;
  const cp2x = to.x + toDir.dx * offset;
  const cp2y = to.y + toDir.dy * offset;

  const midX = bezierAt(from.x, cp1x, cp2x, to.x, 0.5);
  const midY = bezierAt(from.y, cp1y, cp2y, to.y, 0.5);

  return {
    x: midX * viewport.scale + viewport.x,
    y: midY * viewport.scale + viewport.y,
  };
}
