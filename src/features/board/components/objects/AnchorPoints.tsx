import React from 'react';
import { Circle, Rect, Text, Group } from 'react-konva';
import type Konva from 'konva';
import type { AnchorPosition, PillRef } from '../../../../types/board';
import { NODE_TO_ANCHOR, getPillLocalXY } from '../../../wiring/constants';

interface AnchorPointsProps {
  width: number;
  height: number;
  visible: boolean;
  zoomScale: number;
  objectType?: 'stickyNote' | 'rectangle' | 'circle' | 'star' | 'image' | 'text' | 'frame';
  wiringMode?: boolean;
  pills?: PillRef[];
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

const CIRCLE_ANCHORS: { position: AnchorPosition; getXY: (w: number, h: number) => { x: number; y: number } }[] = [
  { position: 'top', getXY: (w, h) => getCircleAnchorXY(w, h, 'top') },
  { position: 'bottom', getXY: (w, h) => getCircleAnchorXY(w, h, 'bottom') },
  { position: 'left', getXY: (w, h) => getCircleAnchorXY(w, h, 'left') },
  { position: 'right', getXY: (w, h) => getCircleAnchorXY(w, h, 'right') },
];

function getStarAnchorXY(w: number, h: number, pointIndex: number): { x: number; y: number } {
  const r = Math.min(w, h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  const angle = -Math.PI / 2 + pointIndex * (2 * Math.PI / 5);
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

const STAR_ANCHORS: { position: AnchorPosition; getXY: (w: number, h: number) => { x: number; y: number } }[] = [
  { position: 'star-0', getXY: (w, h) => getStarAnchorXY(w, h, 0) },
  { position: 'star-1', getXY: (w, h) => getStarAnchorXY(w, h, 1) },
  { position: 'star-2', getXY: (w, h) => getStarAnchorXY(w, h, 2) },
  { position: 'star-3', getXY: (w, h) => getStarAnchorXY(w, h, 3) },
  { position: 'star-4', getXY: (w, h) => getStarAnchorXY(w, h, 4) },
];

function getAnchorXY(w: number, h: number, anchor: AnchorPosition): { x: number; y: number } {
  const entry = RECTANGLE_ANCHORS.find((a) => a.position === anchor);
  return entry ? entry.getXY(w, h) : { x: w / 2, y: 0 };
}

/** Hover handlers that scale a Konva Group up/down without React re-render */
function hoverIn(e: Konva.KonvaEventObject<MouseEvent>) {
  const group = e.currentTarget as Konva.Group;
  group.to({ scaleX: 1.25, scaleY: 1.25, duration: 0.1 });
  const stage = group.getStage();
  if (stage) stage.container().style.cursor = 'pointer';
}
function hoverOut(e: Konva.KonvaEventObject<MouseEvent>) {
  const group = e.currentTarget as Konva.Group;
  group.to({ scaleX: 1, scaleY: 1, duration: 0.1 });
  const stage = group.getStage();
  if (stage) stage.container().style.cursor = '';
}

export const AnchorPoints = React.memo(function AnchorPoints({
  width,
  height,
  visible,
  zoomScale,
  objectType,
  wiringMode,
  pills,
  onAnchorMouseDown,
  onAnchorMouseUp,
}: AnchorPointsProps) {
  if (!visible) return null;
  if (objectType === 'frame' && !wiringMode) return null;

  const dotR = 6 / zoomScale;

  // ── Wire mode: only pill connectors + one generic connector ──
  if (wiringMode) {
    const hasPills = pills && pills.length > 0;
    const elements: React.ReactElement[] = [];

    if (hasPills) {
      for (const pill of pills!) {
        // Position pills in columns: inputs on left edge, outputs on right edge
        const localPos = getPillLocalXY(width, height, pills!, pill.node);
        if (!localPos) continue;
        const { x, y } = localPos;
        // Keep the real anchor for wiring identification
        const anchor = NODE_TO_ANCHOR[pill.node];
        if (!anchor) continue;
        const isInput = pill.direction === 'in';
        const isApiPill = !!pill.apiGroup;
        const pillColor = isInput ? '#4a7c59' : '#cc7722';
        const labelText = isApiPill ? `${pill.label}` : pill.label;
        const labelW = (labelText.length * 7 + 18) / zoomScale;
        const labelH = 20 / zoomScale;
        const labelFontSize = 10 / zoomScale;

        // Labels point outward: left for inputs, right for outputs
        const labelDir = isInput ? -1 : 1;
        const labelOffsetX = labelDir * (labelW / 2 + 8 / zoomScale);
        const labelOffsetY = 0;

        elements.push(
          <Group
            key={`pill-${pill.id}`}
            x={x}
            y={y}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
            onMouseDown={(e) => { e.cancelBubble = true; onAnchorMouseDown(anchor); }}
            onMouseUp={(e) => { e.cancelBubble = true; onAnchorMouseUp(anchor); }}
          >
            {/* Connector dot at origin (the anchor point) */}
            <Circle
              x={0}
              y={0}
              radius={dotR}
              fill={pillColor}
              stroke="#fff"
              strokeWidth={2 / zoomScale}
              hitStrokeWidth={22 / zoomScale}
            />
            {/* Label badge offset outward */}
            <Rect
              x={labelOffsetX - labelW / 2}
              y={labelOffsetY - labelH / 2}
              width={labelW}
              height={labelH}
              fill={pillColor}
              cornerRadius={4 / zoomScale}
              opacity={0.92}
            />
            <Text
              x={labelOffsetX - labelW / 2}
              y={labelOffsetY - labelH / 2 + 4 / zoomScale}
              width={labelW}
              align="center"
              text={labelText}
              fontSize={labelFontSize}
              fontFamily='"Courier New", Courier, monospace'
              fill="#fff"
              fontStyle="bold"
              listening={false}
            />
          </Group>
        );
      }
    }

    // One generic connector for objects without pills (or as an extra wire point)
    const usedNodes = new Set((pills ?? []).map((p) => p.node));
    const genericNode = [1, 5, 3, 7, 2, 4, 6, 8].find((n) => !usedNodes.has(n)) ?? 1;
    const genericAnchor = NODE_TO_ANCHOR[genericNode];
    if (genericAnchor) {
      const { x, y } = getAnchorXY(width, height, genericAnchor);
      elements.push(
        <Group
          key="generic"
          x={x}
          y={y}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
          onMouseDown={(e) => { e.cancelBubble = true; onAnchorMouseDown(genericAnchor); }}
          onMouseUp={(e) => { e.cancelBubble = true; onAnchorMouseUp(genericAnchor); }}
        >
          <Circle
            x={0}
            y={0}
            radius={dotR * 0.85}
            fill="#999"
            stroke="#fff"
            strokeWidth={1.5 / zoomScale}
            hitStrokeWidth={22 / zoomScale}
          />
        </Group>
      );
    }

    return <>{elements}</>;
  }

  // ── Normal mode: standard anchor dots ──
  const anchors = objectType === 'star'
    ? STAR_ANCHORS
    : objectType === 'circle'
      ? CIRCLE_ANCHORS
      : RECTANGLE_ANCHORS;
  const normalR = 5 / zoomScale;

  return (
    <>
      {anchors.map(({ position, getXY: getPos }) => {
        const { x, y } = getPos(width, height);
        return (
          <Circle
            key={position}
            x={x}
            y={y}
            radius={normalR}
            fill="#4a7c59"
            stroke="#fff"
            strokeWidth={1 / zoomScale}
            onMouseDown={(e) => { e.cancelBubble = true; onAnchorMouseDown(position); }}
            onMouseUp={(e) => { e.cancelBubble = true; onAnchorMouseUp(position); }}
            hitStrokeWidth={10 / zoomScale}
          />
        );
      })}
    </>
  );
});


