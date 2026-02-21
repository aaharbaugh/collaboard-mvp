/**
 * MemoizedObjectGroup — a memoized wrapper around the Group + BoardObject + AnchorPoints +
 * ResizeHandles for a single board object.
 *
 * KEY DESIGN: areEqual only checks visual/geometric props (position, size, color, text,
 * selection state, zoom). Event handlers are NOT compared — they are always stable
 * references supplied by BoardCanvas via the "latest-ref" pattern, so stale-closure
 * bugs are impossible while the memo still fires correctly.
 *
 * Result: during pan/zoom, objects whose data hasn't changed produce ZERO React
 * reconciliation work and ZERO Konva node updates.
 */
import React from 'react';
import { Group } from 'react-konva';
import type Konva from 'konva';
import type { BoardObject as BoardObjectType, AnchorPosition } from '../../../types/board';
import { BoardObject } from './BoardObject';
import { AnchorPoints } from './objects/AnchorPoints';
import { ResizeHandles } from './objects/ResizeHandles';

export interface MemoizedObjectGroupHandlers {
  onObjectClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, id: string) => void;
  onObjectDoubleClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, obj: BoardObjectType) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>, id: string) => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>, id: string) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>, id: string) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: (id: string) => void;
  onAnchorMouseDown: (id: string, anchor: AnchorPosition) => void;
  onAnchorMouseUp: (id: string, anchor: AnchorPosition) => void;
  onResizeStart: (id: string, corner: string) => void;
  onResizeMove: (id: string, corner: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  onResizeEnd: (id: string, corner: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  onRef: (id: string, node: Konva.Group | null) => void;
}

interface MemoizedObjectGroupProps {
  obj: BoardObjectType;
  isSelected: boolean;
  showAnchors: boolean;
  showSelectionBorder: boolean;
  /** Center position override during frame drag (world-space center x/y). */
  dragPos: { x: number; y: number } | undefined;
  toolMode: string;
  /** Whether a connection is currently being drawn — disables drag on all objects. */
  hasDrawingConnection: boolean;
  zoomScale: number;
  userId: string;
  isMultiSelect: boolean;
  /** Stable handler refs — never change reference, so NOT included in areEqual. */
  handlers: MemoizedObjectGroupHandlers;
}

function areEqual(prev: MemoizedObjectGroupProps, next: MemoizedObjectGroupProps): boolean {
  // Fast path: same object ref and same selection/hover → skip full compare (avoids re-render on other objects’ click)
  if (
    prev.obj === next.obj &&
    prev.isSelected === next.isSelected &&
    prev.showAnchors === next.showAnchors &&
    prev.showSelectionBorder === next.showSelectionBorder &&
    prev.dragPos === next.dragPos &&
    prev.toolMode === next.toolMode &&
    prev.hasDrawingConnection === next.hasDrawingConnection &&
    prev.isMultiSelect === next.isMultiSelect &&
    prev.zoomScale === next.zoomScale
  ) {
    return true;
  }
  // Geometry & content (when ref changed or selection/ui state changed)
  const a = prev.obj,
    b = next.obj;
  if (a.x !== b.x || a.y !== b.y) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  if ((a.rotation ?? 0) !== (b.rotation ?? 0)) return false;
  if (a.color !== b.color) return false;
  if (a.text !== b.text) return false;
  if (a.type !== b.type) return false;
  if (a.selectedBy !== b.selectedBy) return false;
  if (a.frameId !== b.frameId) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.showAnchors !== next.showAnchors) return false;
  if (prev.showSelectionBorder !== next.showSelectionBorder) return false;
  if (prev.dragPos !== next.dragPos) return false;
  if (prev.toolMode !== next.toolMode) return false;
  if (prev.hasDrawingConnection !== next.hasDrawingConnection) return false;
  if (prev.isMultiSelect !== next.isMultiSelect) return false;
  if (prev.zoomScale !== next.zoomScale) return false;
  return true;
}

export const MemoizedObjectGroup = React.memo(function MemoizedObjectGroup({
  obj,
  isSelected,
  showAnchors,
  showSelectionBorder,
  dragPos,
  toolMode,
  hasDrawingConnection,
  zoomScale,
  userId,
  isMultiSelect,
  handlers,
}: MemoizedObjectGroupProps) {
  const w  = obj.width  ?? 0;
  const h  = obj.height ?? 0;
  const ox = obj.x ?? 0;
  const oy = obj.y ?? 0;
  const cx = dragPos ? dragPos.x : ox + w / 2;
  const cy = dragPos ? dragPos.y : oy + h / 2;

  return (
    <Group
      ref={(node) => handlers.onRef(obj.id, node)}
      x={cx}
      y={cy}
      offsetX={w / 2}
      offsetY={h / 2}
      rotation={obj.rotation ?? 0}
      draggable={toolMode === 'select' && isSelected && !hasDrawingConnection}
      onClick={(e) => handlers.onObjectClick(e, obj.id)}
      onTap={(e) => handlers.onObjectClick(e, obj.id)}
      onDblClick={(e) => handlers.onObjectDoubleClick(e, obj)}
      onDblTap={(e) => handlers.onObjectDoubleClick(e, obj)}
      onDragStart={(e) => handlers.onDragStart(e, obj.id)}
      onDragMove={(e) => handlers.onDragMove(e, obj.id)}
      onDragEnd={(e) => handlers.onDragEnd(e, obj.id)}
      onMouseEnter={() => handlers.onMouseEnter(obj.id)}
      onMouseLeave={() => handlers.onMouseLeave(obj.id)}
    >
      <BoardObject
        obj={{ ...obj, x: 0, y: 0 }}
        isSelected={isSelected}
        showSelectionBorder={showSelectionBorder}
        remoteSelectedBy={obj.selectedBy && obj.selectedBy !== userId ? (obj.selectedByName ?? undefined) : undefined}
        zoomScale={zoomScale}
      />
      <AnchorPoints
        width={obj.width}
        height={obj.height}
        visible={showAnchors}
        zoomScale={zoomScale}
        objectType={obj.type}
        onAnchorMouseDown={(anchor) => handlers.onAnchorMouseDown(obj.id, anchor)}
        onAnchorMouseUp={(anchor) => handlers.onAnchorMouseUp(obj.id, anchor)}
      />
      {isSelected && !isMultiSelect && (
        <ResizeHandles
          width={obj.width}
          height={obj.height}
          zoomScale={zoomScale}
          objectType={obj.type}
          onResizeStart={(corner) => handlers.onResizeStart(obj.id, corner)}
          onResizeMove={(corner, e) => handlers.onResizeMove(obj.id, corner, e)}
          onResizeEnd={(corner, e) => handlers.onResizeEnd(obj.id, corner, e)}
        />
      )}
    </Group>
  );
}, areEqual);
