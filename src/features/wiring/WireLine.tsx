import React from 'react';
import { Shape, Circle, Group } from 'react-konva';
import type Konva from 'konva';
import type { Wire, BoardObject } from '../../types/board';
import { NODE_TO_ANCHOR, WIRE_COLORS, WIRE_DEFAULT_COLOR } from './constants';
import { getAnchorWorldPoint, getPillWorldPoint } from '../board/utils/anchorPoint';

interface WireLineProps {
  wire: Wire;
  fromObj: BoardObject;
  toObj: BoardObject;
  zoomScale: number;
  isSelected?: boolean;
  onSelect?: (wireId: string) => void;
  onUpdatePoints?: (wireId: string, points: number[]) => void;
}

function areEqual(prev: WireLineProps, next: WireLineProps): boolean {
  if (prev.zoomScale !== next.zoomScale) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.wire.id !== next.wire.id) return false;
  if (prev.wire.color !== next.wire.color) return false;
  if (prev.wire.fromNode !== next.wire.fromNode) return false;
  if (prev.wire.toNode !== next.wire.toNode) return false;
  if (prev.wire.outputMode !== next.wire.outputMode) return false;
  // Compare waypoints
  const pp = prev.wire.points, np = next.wire.points;
  if (pp !== np) {
    if (!pp || !np || pp.length !== np.length) return false;
    for (let i = 0; i < pp.length; i++) if (pp[i] !== np[i]) return false;
  }
  const pf = prev.fromObj, nf = next.fromObj;
  if (pf.x !== nf.x || pf.y !== nf.y || pf.width !== nf.width || pf.height !== nf.height || (pf.rotation ?? 0) !== (nf.rotation ?? 0)) return false;
  if (pf.pills !== nf.pills) return false;
  const pt = prev.toObj, nt = next.toObj;
  if (pt.x !== nt.x || pt.y !== nt.y || pt.width !== nt.width || pt.height !== nt.height || (pt.rotation ?? 0) !== (nt.rotation ?? 0)) return false;
  if (pt.pills !== nt.pills) return false;
  return true;
}

export const WireLine = React.memo(function WireLine({
  wire,
  fromObj,
  toObj,
  zoomScale,
  isSelected,
  onSelect,
  onUpdatePoints,
}: WireLineProps) {
  const fromAnchor = NODE_TO_ANCHOR[wire.fromNode];
  const toAnchor = NODE_TO_ANCHOR[wire.toNode];
  if (!fromAnchor || !toAnchor) return null;

  // Use pill-aware positioning when pills exist, otherwise fall back to legacy anchors
  const from = fromObj.pills?.length
    ? getPillWorldPoint(fromObj, fromObj.pills, wire.fromNode)
    : getAnchorWorldPoint(fromObj, fromAnchor);
  const to = toObj.pills?.length
    ? getPillWorldPoint(toObj, toObj.pills, wire.toNode)
    : getAnchorWorldPoint(toObj, toAnchor);

  const color = isSelected
    ? '#4a7c59'
    : wire.color ?? WIRE_COLORS[(wire.fromNode - 1) % WIRE_COLORS.length] ?? WIRE_DEFAULT_COLOR;

  const sw = (isSelected ? 3 : 2) / zoomScale;
  const arrowSize = 8 / zoomScale;
  const hitWidth = 16 / zoomScale;
  const waypointR = (isSelected ? 5 : 3) / zoomScale;
  const waypointHitR = 10 / zoomScale;

  // Build waypoints array from flat points
  const waypoints: { x: number; y: number }[] = [];
  if (wire.points && wire.points.length >= 2) {
    for (let i = 0; i < wire.points.length; i += 2) {
      waypoints.push({ x: wire.points[i], y: wire.points[i + 1] });
    }
  }

  const hasWaypoints = waypoints.length > 0;

  const handleWaypointDragEnd = (waypointIndex: number, e: Konva.KonvaEventObject<DragEvent>) => {
    if (!onUpdatePoints || !wire.points) return;
    const newPoints = [...wire.points];
    newPoints[waypointIndex * 2] = e.target.x();
    newPoints[waypointIndex * 2 + 1] = e.target.y();
    onUpdatePoints(wire.id, newPoints);
  };

  const handleWaypointRightClick = (waypointIndex: number, e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    e.cancelBubble = true;
    if (!onUpdatePoints || !wire.points) return;
    const newPoints = [...wire.points];
    // Remove the x,y pair for this waypoint
    newPoints.splice(waypointIndex * 2, 2);
    onUpdatePoints(wire.id, newPoints.length >= 2 ? newPoints : []);
  };

  if (hasWaypoints) {
    // ── Polyline rendering (straight segments through waypoints) ──
    const allPts = [from, ...waypoints, to];
    // Arrowhead: tangent of last segment
    const lastSeg = { x: allPts[allPts.length - 1].x - allPts[allPts.length - 2].x, y: allPts[allPts.length - 1].y - allPts[allPts.length - 2].y };
    const lastLen = Math.sqrt(lastSeg.x * lastSeg.x + lastSeg.y * lastSeg.y) || 1;
    const arrowAngle = Math.atan2(lastSeg.y / lastLen, lastSeg.x / lastLen);

    return (
      <Group>
        <Shape
          stroke={color}
          strokeWidth={hitWidth}
          fill={color}
          sceneFunc={(context) => {
            // Draw polyline
            context.beginPath();
            context.moveTo(allPts[0].x, allPts[0].y);
            for (let i = 1; i < allPts.length; i++) {
              context.lineTo(allPts[i].x, allPts[i].y);
            }
            context.strokeStyle = color;
            context.lineWidth = sw;
            context.stroke();

            // Arrowhead
            context.beginPath();
            context.save();
            context.translate(to.x, to.y);
            context.rotate(arrowAngle);
            context.moveTo(0, 0);
            context.lineTo(-arrowSize, -arrowSize * 0.5);
            context.lineTo(-arrowSize, arrowSize * 0.5);
            context.closePath();
            context.fillStyle = color;
            context.fill();
            context.restore();
          }}
          hitFunc={(context, shape) => {
            context.beginPath();
            context.moveTo(allPts[0].x, allPts[0].y);
            for (let i = 1; i < allPts.length; i++) {
              context.lineTo(allPts[i].x, allPts[i].y);
            }
            context.fillStrokeShape(shape);
          }}
          listening={true}
          onClick={(e) => { e.cancelBubble = true; onSelect?.(wire.id); }}
          onTap={(e) => { e.cancelBubble = true; onSelect?.(wire.id); }}
        />
        {/* Draggable waypoint handles */}
        {waypoints.map((wp, i) => (
          <Circle
            key={i}
            x={wp.x}
            y={wp.y}
            radius={waypointR}
            fill={color}
            stroke={isSelected ? '#fff' : undefined}
            strokeWidth={isSelected ? 1.5 / zoomScale : 0}
            hitStrokeWidth={waypointHitR}
            draggable={!!onUpdatePoints}
            onDragEnd={(e) => handleWaypointDragEnd(i, e)}
            onClick={(e) => { e.cancelBubble = true; onSelect?.(wire.id); }}
            onTap={(e) => { e.cancelBubble = true; onSelect?.(wire.id); }}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'grab';
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = '';
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'grabbing';
            }}
            onContextMenu={(e) => handleWaypointRightClick(i, e)}
          />
        ))}
      </Group>
    );
  }

  // ── Bezier rendering (no waypoints) ──
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const offset = Math.max(40 / zoomScale, dist * 0.3);

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

  const tangentX = to.x - cp2x;
  const tangentY = to.y - cp2y;
  const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY) || 1;
  const arrowAngle = Math.atan2(tangentY / tangentLen, tangentX / tangentLen);

  return (
    <Shape
      stroke={color}
      strokeWidth={hitWidth}
      fill={color}
      sceneFunc={(context) => {
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, to.x, to.y);
        context.strokeStyle = color;
        context.lineWidth = sw;
        context.stroke();

        context.beginPath();
        context.save();
        context.translate(to.x, to.y);
        context.rotate(arrowAngle);
        context.moveTo(0, 0);
        context.lineTo(-arrowSize, -arrowSize * 0.5);
        context.lineTo(-arrowSize, arrowSize * 0.5);
        context.closePath();
        context.fillStyle = color;
        context.fill();
        context.restore();
      }}
      hitFunc={(context, shape) => {
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, to.x, to.y);
        context.moveTo(to.x, to.y);
        context.save();
        context.translate(to.x, to.y);
        context.rotate(arrowAngle);
        context.moveTo(0, 0);
        context.lineTo(-arrowSize * 1.5, -arrowSize);
        context.lineTo(-arrowSize * 1.5, arrowSize);
        context.closePath();
        context.restore();
        context.fillStrokeShape(shape);
      }}
      listening={true}
      onClick={(e) => { e.cancelBubble = true; onSelect?.(wire.id); }}
      onTap={(e) => { e.cancelBubble = true; onSelect?.(wire.id); }}
    />
  );
}, areEqual);

/** Returns the outward unit direction for a node number (1-8, clockwise from top). */
function anchorOutwardDirection(node: number): { dx: number; dy: number } {
  const s = Math.SQRT1_2; // ~0.707
  switch (node) {
    case 1: return { dx: 0, dy: -1 };     // top
    case 2: return { dx: s, dy: -s };      // top-right
    case 3: return { dx: 1, dy: 0 };       // right
    case 4: return { dx: s, dy: s };        // bottom-right
    case 5: return { dx: 0, dy: 1 };       // bottom
    case 6: return { dx: -s, dy: s };       // bottom-left
    case 7: return { dx: -1, dy: 0 };      // left
    case 8: return { dx: -s, dy: -s };      // top-left
    default: return { dx: 0, dy: -1 };
  }
}
