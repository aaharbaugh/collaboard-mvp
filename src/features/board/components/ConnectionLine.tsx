import React from 'react';
import { Group, Arrow, Circle } from 'react-konva';
import type Konva from 'konva';
import type { Connection, BoardObject, AnchorPosition } from '../../../types/board';

interface ConnectionLineProps {
  connection: Connection;
  objects: Record<string, BoardObject>;
  zoomScale: number;
  isSelected?: boolean;
  onSelect?: (connId: string) => void;
  onWaypointDrag?: (connId: string, waypointIndex: number, x: number, y: number) => void;
  onWaypointDragEnd?: (connId: string, points: number[]) => void;
  onDoubleClick?: (connId: string, x: number, y: number) => void;
}

function getAnchorPoint(obj: BoardObject, anchor: AnchorPosition): { x: number; y: number } {
  const { x, y, width: w, height: h } = obj;
  switch (anchor) {
    case 'top': return { x: x + w / 2, y };
    case 'bottom': return { x: x + w / 2, y: y + h };
    case 'left': return { x, y: y + h / 2 };
    case 'right': return { x: x + w, y: y + h / 2 };
    case 'top-left': return { x, y };
    case 'top-right': return { x: x + w, y };
    case 'bottom-left': return { x, y: y + h };
    case 'bottom-right': return { x: x + w, y: y + h };
  }
}

export function ConnectionLine({
  connection,
  objects,
  zoomScale,
  isSelected,
  onSelect,
  onWaypointDrag,
  onWaypointDragEnd,
  onDoubleClick,
}: ConnectionLineProps) {
  const fromObj = objects[connection.fromId];
  const toObj = objects[connection.toId];
  if (!fromObj || !toObj) return null;

  const from = getAnchorPoint(fromObj, connection.fromAnchor);
  const to = getAnchorPoint(toObj, connection.toAnchor);

  // Scale arrow props so they look consistent on screen
  const sw = 2 / zoomScale;
  const ptrLen = 10 / zoomScale;
  const ptrW = 8 / zoomScale;

  // Hide arrow if pointer would be larger than the smallest object edge
  const minEdge = Math.min(fromObj.width, fromObj.height, toObj.width, toObj.height);
  if (ptrLen > minEdge) return null;

  // Normalize waypoints: ensure we have a real array of pairs (x,y); empty/undefined = 0-waypoint arrow
  const rawPoints = connection.points;
  const waypoints =
    Array.isArray(rawPoints) && rawPoints.length >= 2
      ? rawPoints
      : [];

  // For 0-waypoint arrows, use exactly [from, to] so the line goes straight to the destination.
  // Spreading waypoints when empty can avoid any edge cases with Konva's Arrow and 2-point lines.
  const allPoints =
    waypoints.length === 0
      ? [from.x, from.y, to.x, to.y]
      : [from.x, from.y, ...waypoints, to.x, to.y];

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    onSelect?.(connection.id);
  };

  const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    const stage = e.target.getStage();
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const transform = stage.getAbsoluteTransform().copy().invert();
    const worldPos = transform.point(pointer);
    onDoubleClick?.(connection.id, worldPos.x, worldPos.y);
  };

  // Build waypoint circles for editing
  const waypointCircles: React.ReactElement[] = [];
  if (isSelected && waypoints.length >= 2) {
    for (let i = 0; i < waypoints.length; i += 2) {
      const wpIndex = i;
      waypointCircles.push(
        <Circle
          key={`wp-${i}`}
          x={waypoints[i]}
          y={waypoints[i + 1]}
          radius={5 / zoomScale}
          fill="#4a7c59"
          stroke="#fff"
          strokeWidth={1 / zoomScale}
          draggable
          onDragMove={(e) => {
            onWaypointDrag?.(connection.id, wpIndex, e.target.x(), e.target.y());
          }}
          onDragEnd={() => {
            // Collect current waypoint positions
            const newPoints = [...waypoints];
            onWaypointDragEnd?.(connection.id, newPoints);
          }}
        />
      );
    }
  }

  return (
    <Group>
      <Arrow
        points={allPoints}
        tension={0}
        stroke={isSelected ? '#4a7c59' : (connection.color ?? '#6b5d4d')}
        fill={isSelected ? '#4a7c59' : (connection.color ?? '#6b5d4d')}
        strokeWidth={sw}
        pointerLength={ptrLen}
        pointerWidth={ptrW}
        hitStrokeWidth={12 / zoomScale}
        onClick={handleClick}
        onTap={handleClick}
        onDblClick={handleDblClick}
        onDblTap={handleDblClick}
      />
      {waypointCircles}
    </Group>
  );
}
