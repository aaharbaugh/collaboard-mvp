import React from 'react';
import { Group, Arrow, Circle } from 'react-konva';
import type Konva from 'konva';
import type { Connection, BoardObject } from '../../../types/board';
import { CONNECTION_DEFAULT_COLOR } from '../../../lib/constants';
import { getAnchorWorldPoint } from '../utils/anchorPoint';

interface ConnectionLineProps {
  connection: Connection;
  /** Endpoint objects passed directly so the memo comparison can check only the fields
   *  that affect rendering (position, size, rotation) rather than the entire objects map. */
  fromObj: BoardObject;
  toObj: BoardObject;
  zoomScale: number;
  isSelected?: boolean;
  onSelect?: (connId: string) => void;
  onWaypointDrag?: (connId: string, waypointIndex: number, x: number, y: number) => void;
  onWaypointDragEnd?: (connId: string, points: number[]) => void;
  onDoubleClick?: (connId: string, x: number, y: number) => void;
}

/** Field-level comparison — skip re-render unless something that affects the canvas actually changed. */
function areEqual(prev: ConnectionLineProps, next: ConnectionLineProps): boolean {
  if (prev.zoomScale !== next.zoomScale) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.connection.id !== next.connection.id) return false;
  if (prev.connection.color !== next.connection.color) return false;
  if (prev.connection.fromAnchor !== next.connection.fromAnchor) return false;
  if (prev.connection.toAnchor !== next.connection.toAnchor) return false;
  // Shallow-check waypoints by reference first, then by content
  const pp = prev.connection.points;
  const np = next.connection.points;
  if (pp !== np) {
    if (!pp || !np || pp.length !== np.length) return false;
    for (let i = 0; i < pp.length; i++) if (pp[i] !== np[i]) return false;
  }
  // Compare endpoint geometry (not object references — liveObjects always creates new refs)
  const pf = prev.fromObj, nf = next.fromObj;
  if (pf.x !== nf.x || pf.y !== nf.y || pf.width !== nf.width || pf.height !== nf.height || (pf.rotation ?? 0) !== (nf.rotation ?? 0)) return false;
  const pt = prev.toObj, nt = next.toObj;
  if (pt.x !== nt.x || pt.y !== nt.y || pt.width !== nt.width || pt.height !== nt.height || (pt.rotation ?? 0) !== (nt.rotation ?? 0)) return false;
  // Handler references are stable useCallbacks — only compare if needed
  if (prev.onSelect !== next.onSelect) return false;
  if (prev.onWaypointDrag !== next.onWaypointDrag) return false;
  if (prev.onWaypointDragEnd !== next.onWaypointDragEnd) return false;
  if (prev.onDoubleClick !== next.onDoubleClick) return false;
  return true;
}

export const ConnectionLine = React.memo(function ConnectionLine({
  connection,
  fromObj,
  toObj,
  zoomScale,
  isSelected,
  onSelect,
  onWaypointDrag,
  onWaypointDragEnd,
  onDoubleClick,
}: ConnectionLineProps) {
  const from = getAnchorWorldPoint(fromObj, connection.fromAnchor);
  const to = getAnchorWorldPoint(toObj, connection.toAnchor);

  // Scale arrow props so they look consistent on screen
  const sw = 2 / zoomScale;
  const ptrLen = 10 / zoomScale;
  const ptrW = 8 / zoomScale;

  // Only hide when the larger node is too small on screen
  const fromPx = Math.max(fromObj.width * zoomScale, fromObj.height * zoomScale);
  const toPx = Math.max(toObj.width * zoomScale, toObj.height * zoomScale);
  const maxNodePx = Math.max(fromPx, toPx);
  if (maxNodePx < 10) return null;

  const destinationTiny = toPx < 14;

  const rawPoints = connection.points;
  const waypoints =
    Array.isArray(rawPoints) && rawPoints.length >= 2 ? rawPoints : [];

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
        stroke={isSelected ? '#4a7c59' : (connection.color ?? CONNECTION_DEFAULT_COLOR)}
        fill={isSelected ? '#4a7c59' : (connection.color ?? CONNECTION_DEFAULT_COLOR)}
        strokeWidth={sw}
        pointerLength={destinationTiny ? 0 : ptrLen}
        pointerWidth={destinationTiny ? 0 : ptrW}
        hitStrokeWidth={12 / zoomScale}
        onClick={handleClick}
        onTap={handleClick}
        onDblClick={handleDblClick}
        onDblTap={handleDblClick}
      />
      {waypointCircles}
    </Group>
  );
}, areEqual);
