import { useState } from 'react';
import { Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';

interface RotationHandleProps {
  width: number;
  height: number;
  zoomScale: number;
  /** For circle objects, use the same box as ResizeHandles */
  objectType?: 'stickyNote' | 'rectangle' | 'circle' | 'star' | 'image' | 'text' | 'frame';
  /** Called on mousedown; rotation is then tracked by the stage until mouseup */
  onRotationStart: (e: Konva.KonvaEventObject<MouseEvent>) => void;
}

const HANDLE_GREEN = '#2d5a3a';

/** Circular arrow rotation icon (↻) – arc with arrowhead at end */
function RotationIcon({
  size,
  strokeWidth,
  inverted,
}: { size: number; strokeWidth: number; inverted?: boolean }) {
  const color = inverted ? '#fff' : HANDLE_GREEN;
  const r = size * 0.28;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = (5 * Math.PI) / 4;
  const endAngle = -Math.PI / 4;
  const steps = 16;
  const points: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = startAngle + (i / steps) * (endAngle - startAngle);
    points.push(cx + r * Math.cos(t), cy + r * Math.sin(t));
  }
  const tipX = cx + r * Math.cos(endAngle);
  const tipY = cy + r * Math.sin(endAngle);
  const ah = size * 0.2;
  const dx = Math.cos(endAngle);
  const dy = Math.sin(endAngle);
  const perpX = -dy;
  const perpY = dx;
  const arrowTipX = tipX + dx * ah;
  const arrowTipY = tipY + dy * ah;
  const arrowLeftX = tipX - dx * ah * 0.4 + perpX * ah * 0.5;
  const arrowLeftY = tipY - dy * ah * 0.4 + perpY * ah * 0.5;
  const arrowRightX = tipX - dx * ah * 0.4 - perpX * ah * 0.5;
  const arrowRightY = tipY - dy * ah * 0.4 - perpY * ah * 0.5;
  return (
    <>
      <Line
        points={points}
        stroke={color}
        strokeWidth={strokeWidth}
        lineCap="round"
        lineJoin="round"
      />
      <Line
        points={[arrowTipX, arrowTipY, arrowLeftX, arrowLeftY, arrowRightX, arrowRightY]}
        closed
        fill={color}
        stroke={color}
        strokeWidth={strokeWidth * 0.5}
        lineJoin="round"
      />
    </>
  );
}

const HANDLE_SIZE = 14;
const GAP = 5;

export function RotationHandle({
  width,
  height,
  zoomScale,
  objectType,
  onRotationStart,
}: RotationHandleProps) {
  const [isHovered, setIsHovered] = useState(false);
  const size = HANDLE_SIZE / zoomScale;
  const half = size / 2;
  const strokeWidth = 1.5 / zoomScale;
  const gap = GAP / zoomScale;

  const isCircle = objectType === 'circle';
  const boxW = isCircle ? Math.min(width, height) : width;
  const boxH = isCircle ? Math.min(width, height) : height;
  const boxX = isCircle ? (width - boxW) / 2 : 0;
  const boxY = isCircle ? (height - boxH) / 2 : 0;

  const x = boxX + boxW - half;
  const y = boxY - size - gap;

  const fill = isHovered ? HANDLE_GREEN : '#fff';
  const stroke = isHovered ? HANDLE_GREEN : HANDLE_GREEN;

  return (
    <Group
      x={x}
      y={y}
      onMouseEnter={(e) => {
        e.cancelBubble = true;
        setIsHovered(true);
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = 'grab';
      }}
      onMouseLeave={(e) => {
        e.cancelBubble = true;
        setIsHovered(false);
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = '';
      }}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onRotationStart(e);
      }}
    >
      <Rect
        x={0}
        y={0}
        width={size}
        height={size}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        cornerRadius={2 / zoomScale}
        listening={true}
        hitStrokeWidth={8 / zoomScale}
      />
      <Group x={half} y={half} offsetX={half} offsetY={half} listening={false}>
        <RotationIcon size={size * 0.9} strokeWidth={strokeWidth} inverted={isHovered} />
      </Group>
    </Group>
  );
}
