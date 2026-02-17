import { Circle } from 'react-konva';
import type { AnchorPosition } from '../../../../types/board';

interface AnchorPointsProps {
  width: number;
  height: number;
  visible: boolean;
  zoomScale: number;
  /** When 'circle', only 4 anchors (top/bottom/left/right) on the circle edge */
  objectType?: 'stickyNote' | 'rectangle' | 'circle' | 'image';
  onAnchorMouseDown: (anchor: AnchorPosition) => void;
  onAnchorMouseUp: (anchor: AnchorPosition) => void;
}

/** Rectangle/box: 8 anchors at edges and corners */
const RECTANGLE_ANCHORS: { position: AnchorPosition; getXY: (w: number, h: number) => { x: number; y: number } }[] = [
  { position: 'top', getXY: (w: number) => ({ x: w / 2, y: 0 }) },
  { position: 'bottom', getXY: (w: number, h: number) => ({ x: w / 2, y: h }) },
  { position: 'left', getXY: (_w: number, h: number) => ({ x: 0, y: h / 2 }) },
  { position: 'right', getXY: (w: number, h: number) => ({ x: w, y: h / 2 }) },
  { position: 'top-left', getXY: () => ({ x: 0, y: 0 }) },
  { position: 'top-right', getXY: (w: number) => ({ x: w, y: 0 }) },
  { position: 'bottom-left', getXY: (_w: number, h: number) => ({ x: 0, y: h }) },
  { position: 'bottom-right', getXY: (w: number, h: number) => ({ x: w, y: h }) },
];

/** Circle: 4 anchors on the circumference (top, bottom, left, right) */
function getCircleAnchorXY(w: number, h: number, position: AnchorPosition): { x: number; y: number } {
  const r = Math.min(w, h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  switch (position) {
    case 'top': return { x: cx, y: cy - r };
    case 'bottom': return { x: cx, y: cy + r };
    case 'left': return { x: cx - r, y: cy };
    case 'right': return { x: cx + r, y: cy };
    default: return { x: cx, y: cy };
  }
}

const CIRCLE_ANCHORS: { position: AnchorPosition }[] = [
  { position: 'top' },
  { position: 'bottom' },
  { position: 'left' },
  { position: 'right' },
];

export function AnchorPoints({
  width,
  height,
  visible,
  zoomScale,
  objectType,
  onAnchorMouseDown,
  onAnchorMouseUp,
}: AnchorPointsProps) {
  if (!visible) return null;

  const radius = 5 / zoomScale;
  const isCircle = objectType === 'circle';
  const anchors = isCircle
    ? CIRCLE_ANCHORS.map((a) => ({ position: a.position, getXY: (w: number, h: number) => getCircleAnchorXY(w, h, a.position) }))
    : RECTANGLE_ANCHORS;

  return (
    <>
      {anchors.map(({ position, getXY }) => {
        const { x, y } = getXY(width, height);
        return (
          <Circle
            key={position}
            x={x}
            y={y}
            radius={radius}
            fill="#4a7c59"
            stroke="#fff"
            strokeWidth={1 / zoomScale}
            onMouseDown={(e) => {
              e.cancelBubble = true;
              onAnchorMouseDown(position);
            }}
            onMouseUp={(e) => {
              e.cancelBubble = true;
              onAnchorMouseUp(position);
            }}
            hitStrokeWidth={10 / zoomScale}
          />
        );
      })}
    </>
  );
}
