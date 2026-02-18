import { Rect } from 'react-konva';
import type Konva from 'konva';

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface ResizeHandlesProps {
  width: number;
  height: number;
  zoomScale: number;
  /** When 'circle', handles wrap the circle's bounding square (centered, size = min(w,h)) */
  objectType?: 'stickyNote' | 'rectangle' | 'circle' | 'star' | 'image' | 'text' | 'frame';
  onResizeStart: (corner: Corner) => void;
  onResizeMove: (corner: Corner, e: Konva.KonvaEventObject<DragEvent>) => void;
  onResizeEnd: (corner: Corner, e: Konva.KonvaEventObject<DragEvent>) => void;
}

const CORNERS: { corner: Corner; getXY: (w: number, h: number) => { x: number; y: number }; cursor: string }[] = [
  { corner: 'top-left', getXY: () => ({ x: 0, y: 0 }), cursor: 'nwse-resize' },
  { corner: 'top-right', getXY: (w) => ({ x: w, y: 0 }), cursor: 'nesw-resize' },
  { corner: 'bottom-left', getXY: (_w, h) => ({ x: 0, y: h }), cursor: 'nesw-resize' },
  { corner: 'bottom-right', getXY: (w, h) => ({ x: w, y: h }), cursor: 'nwse-resize' },
];

export function ResizeHandles({
  width,
  height,
  zoomScale,
  objectType,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
}: ResizeHandlesProps) {
  const size = 10 / zoomScale;
  const half = size / 2;

  const isRound = objectType === 'circle' || objectType === 'star';
  const boxW = isRound ? Math.min(width, height) : width;
  const boxH = isRound ? Math.min(width, height) : height;
  const boxX = isRound ? (width - boxW) / 2 : 0;
  const boxY = isRound ? (height - boxH) / 2 : 0;

  return (
    <>
      {CORNERS.map(({ corner, getXY, cursor }) => {
        const { x, y } = getXY(boxW, boxH);
        const handleX = boxX + x;
        const handleY = boxY + y;
        return (
          <Rect
            key={corner}
            x={handleX - half}
            y={handleY - half}
            width={size}
            height={size}
            fill="#2d5a3a"
            stroke="#fff"
            strokeWidth={2 / zoomScale}
            draggable
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = cursor;
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = '';
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;
              onResizeStart(corner);
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              onResizeMove(corner, e);
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              onResizeEnd(corner, e);
            }}
            onMouseDown={(e) => { e.cancelBubble = true; }}
            hitStrokeWidth={10 / zoomScale}
          />
        );
      })}
    </>
  );
}
