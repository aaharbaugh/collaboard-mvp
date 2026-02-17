import { Rect } from 'react-konva';
import type Konva from 'konva';

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface ResizeHandlesProps {
  width: number;
  height: number;
  zoomScale: number;
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
  onResizeStart,
  onResizeMove,
  onResizeEnd,
}: ResizeHandlesProps) {
  const size = 8 / zoomScale;
  const half = size / 2;

  return (
    <>
      {CORNERS.map(({ corner, getXY, cursor }) => {
        const { x, y } = getXY(width, height);
        return (
          <Rect
            key={corner}
            x={x - half}
            y={y - half}
            width={size}
            height={size}
            fill="#fff"
            stroke="#4a7c59"
            strokeWidth={1 / zoomScale}
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
