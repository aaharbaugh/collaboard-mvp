import type { BoardObject, AnchorPosition } from '../../../types/board';

/**
 * Single source of truth for connection anchor positions in world coordinates.
 * All anchors (rect corners/edges, circle, star points) are rotated with the object
 * so connection lines stay attached when objects rotate.
 */
export function getAnchorWorldPoint(obj: BoardObject, anchor: AnchorPosition): { x: number; y: number } {
  const { x, y, width: w, height: h } = obj;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rot = obj.rotation ?? 0;

  if (obj.type === 'star' && (anchor === 'star-0' || anchor === 'star-1' || anchor === 'star-2' || anchor === 'star-3' || anchor === 'star-4')) {
    const pointIndex = parseInt(anchor.slice(-1), 10);
    const r = Math.min(w, h) / 2;
    const angle = -Math.PI / 2 + pointIndex * (2 * Math.PI / 5);
    const localX = r * Math.cos(angle);
    const localY = r * Math.sin(angle);
    return rotatePoint(cx, cy, localX, localY, rot);
  }

  const dxdy = rectAnchorOffset(w, h, anchor);
  return rotatePoint(cx, cy, dxdy.dx, dxdy.dy, rot);
}

/** Center-relative offsets for rect/circle anchors (before rotation). */
function rectAnchorOffset(w: number, h: number, anchor: AnchorPosition): { dx: number; dy: number } {
  switch (anchor) {
    case 'top': return { dx: 0, dy: -h / 2 };
    case 'bottom': return { dx: 0, dy: h / 2 };
    case 'left': return { dx: -w / 2, dy: 0 };
    case 'right': return { dx: w / 2, dy: 0 };
    case 'top-left': return { dx: -w / 2, dy: -h / 2 };
    case 'top-right': return { dx: w / 2, dy: -h / 2 };
    case 'bottom-left': return { dx: -w / 2, dy: h / 2 };
    case 'bottom-right': return { dx: w / 2, dy: h / 2 };
    default: return { dx: w / 2, dy: -h / 2 };
  }
}

function rotatePoint(cx: number, cy: number, dx: number, dy: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: cx + dx * c - dy * s,
    y: cy + dx * s + dy * c,
  };
}
