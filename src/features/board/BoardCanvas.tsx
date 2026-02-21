import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Stage, Layer, Group, Arrow, Rect, Transformer } from 'react-konva';
import { useContainerSize } from '../../hooks/useContainerSize';
import { useBoardSync } from '../sync/useBoardSync';
import { useCursorSync } from '../sync/useCursorSync';
import { useBoardViewport } from './useBoardViewport';
import { useBoardStore } from '../../lib/store';
import { ConnectionLine } from './components/ConnectionLine';
import { MemoizedObjectGroup } from './components/MemoizedObjectGroup';
import type { MemoizedObjectGroupHandlers } from './components/MemoizedObjectGroup';
import {
  STICKY_NOTE_DEFAULTS,
  TEXT_DEFAULTS,
  SHAPE_DEFAULTS,
  FRAME_DEFAULTS,
  DEFAULT_OBJECT_COLORS,
} from '../../lib/constants';
import type { BoardObject as BoardObjectType, AnchorPosition } from '../../types/board';
import { getAnchorWorldPoint } from './utils/anchorPoint';

interface BoardCanvasProps {
  boardId: string;
  userId: string;
  userName: string;
  onStickyNoteDoubleClick?: (id: string) => void;
}

export function BoardCanvas({
  boardId,
  userId,
  userName,
  onStickyNoteDoubleClick,
}: BoardCanvasProps) {
  const { ref: containerRef, width, height } = useContainerSize();
  const {
    objects,
    connections,
    createObject,
    updateObject,
    deleteObject,
    createConnection,
    updateConnection,
    deleteConnection,
    deleteConnectionsForObject,
  } = useBoardSync(boardId);
  const { updateCursor } = useCursorSync(boardId, userId, userName);

  const toolMode    = useBoardStore((s) => s.toolMode);
  const selectedIds = useBoardStore((s) => s.selectedIds);
  const setSelection = useBoardStore((s) => s.setSelection);
  const pushUndo    = useBoardStore((s) => s.pushUndo);

  // Must be declared before useBoardViewport so the ref is in scope when passed
  const stageRef = useRef<Konva.Stage>(null);

  const {
    viewport,
    handleWheel,
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    getPointerPosition,
    didPan,
  } = useBoardViewport(containerRef, toolMode, stageRef);

  const [selectionRect, setSelectionRect] = useState<{
    startX: number; startY: number; endX: number; endY: number;
  } | null>(null);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [drawingConnection, setDrawingConnection] = useState<{
    fromId: string;
    fromAnchor: AnchorPosition;
    waypoints: number[];
    currentPoint: { x: number; y: number };
  } | null>(null);

  const drawingConnectionRef = useRef(drawingConnection);
  drawingConnectionRef.current = drawingConnection;

  const clipboardRef = useRef<BoardObjectType[]>([]);
  const didAreaSelect = useRef(false);
  const groupDragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const frameDragFrameIdRef = useRef<string | null>(null);
  const frameDragRAFRef = useRef<number | null>(null);
  const frameDragDeltasRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [frameDragPositions, setFrameDragPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  const objectNodeRefs = useRef<Map<string, Konva.Group>>(new Map());
  const resizeStart = useRef<{ objId: string; x: number; y: number; w: number; h: number } | null>(null);
  /** When resizing a frame, snapshot of children x,y,width,height at resize start */
  const resizeFrameChildrenStart = useRef<Map<string, { x: number; y: number; width: number; height: number }>>(new Map());
  const connectionJustCompleted = useRef(false);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [transformVersion, setTransformVersion] = useState(0);
  const transformRAFRef = useRef<number | null>(null);

  const allObjects = useMemo(() => Object.values(objects), [objects]);
  const backObjects = useMemo(() => allObjects.filter((obj) => obj.sentToBack === true), [allObjects]);
  const frontObjects = useMemo(() => allObjects.filter((obj) => obj.sentToBack !== true), [allObjects]);
  const connectionList = useMemo(() => Object.values(connections), [connections]);

  // O(1) selection lookup — replaces O(n) selectedIds.includes() in render maps
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const isMultiSelect = selectedIds.length > 1;
  /**
   * Bounding box for the multi-select highlight rect.
   *
   * Strategy: compute the AABB from STORED (Firebase) object positions so the
   * box center matches the Transformer's pivot point. Then read the live rotation
   * DELTA from one representative Konva node (all selected nodes rotate by the
   * same delta during a Transformer gesture) and apply only that delta as the
   * box rotation. This makes the dashed rect visually rotate in lock-step with
   * the Transformer, around the same center, without any double-rotation artifact.
   */
  const selectionBox = useMemo(() => {
    if (!isMultiSelect) return null;
    const selected = selectedIds.map((id) => objects[id]).filter(Boolean) as BoardObjectType[];
    if (selected.length === 0) return null;

    // AABB from stored positions/rotations (the "initial" box before any live delta)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of selected) {
      const w = obj.width;
      const h = obj.height;
      const cx = obj.x + w / 2;
      const cy = obj.y + h / 2;
      const rot = obj.rotation ?? 0;
      const rad = (rot * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      for (const p of [
        { x: -w / 2, y: -h / 2 },
        { x: w / 2, y: -h / 2 },
        { x: w / 2, y: h / 2 },
        { x: -w / 2, y: h / 2 },
      ]) {
        const wx = cx + p.x * c - p.y * s;
        const wy = cy + p.x * s + p.y * c;
        minX = Math.min(minX, wx);
        minY = Math.min(minY, wy);
        maxX = Math.max(maxX, wx);
        maxY = Math.max(maxY, wy);
      }
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const x = minX;
    const y = minY;

    // Live rotation delta: all objects rotate by the same angle during a single
    // Transformer gesture, so use the first selected object as representative.
    const firstObj = selected[0];
    const firstNode = objectNodeRefs.current.get(firstObj.id);
    const storedRot = firstObj.rotation ?? 0;
    const liveRot = firstNode ? firstNode.rotation() : storedRot;
    const rotation = liveRot - storedRot;

    return { x, y, width, height, rotation };
  }, [isMultiSelect, selectedIds, objects, transformVersion]);

  /**
   * Objects with live positions/rotations, limited to connection endpoints and the
   * active drawing source. Only these need real-time Konva node positions — rebuilding
   * ALL objects on every rotation RAF tick was wasteful.
   */
  const drawingFromId = drawingConnection?.fromId ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveObjects = useMemo(() => {
    // Collect only the IDs we actually need live data for
    const endpointIds = new Set<string>();
    for (const conn of connectionList) {
      endpointIds.add(conn.fromId);
      endpointIds.add(conn.toId);
    }
    if (drawingFromId) endpointIds.add(drawingFromId);

    const result: Record<string, BoardObjectType> = {};
    for (const id of endpointIds) {
      const obj = objects[id];
      if (!obj) continue;
      const node = objectNodeRefs.current.get(id);
      if (node) {
        result[id] = {
          ...obj,
          x: node.x() - obj.width / 2,
          y: node.y() - obj.height / 2,
          rotation: node.rotation(),
        };
      } else {
        result[id] = obj;
      }
    }
    return result;
  // objectNodeRefs.current is a mutable ref read intentionally for live Konva node state
  }, [objects, connectionList, drawingFromId, transformVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearSelection = useCallback(() => {
    const ids = useBoardStore.getState().selectedIds;
    ids.forEach((id) => {
      updateObject(id, { selectedBy: null, selectedByName: null });
    });
    setSelection([]);
    setSelectedConnectionId(null);
    if (transformRAFRef.current != null) {
      cancelAnimationFrame(transformRAFRef.current);
      transformRAFRef.current = null;
    }
    setTransformVersion(0);
  }, [updateObject, setSelection]);

  // Drop selector/transform state when no longer multi-select (deselect or single selection)
  useEffect(() => {
    if (selectedIds.length <= 1) {
      if (transformRAFRef.current != null) {
        cancelAnimationFrame(transformRAFRef.current);
        transformRAFRef.current = null;
      }
      setTransformVersion(0);
    }
  }, [selectedIds.length]);

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (didPan.current) {
        didPan.current = false;
        return;
      }
      if (didAreaSelect.current) {
        didAreaSelect.current = false;
        return;
      }

      if (e.target === e.target.getStage()) {
        // If drawing a connection, clicking empty stage adds a waypoint
        if (drawingConnection) {
          const pos = getPointerPosition(e);
          if (!pos) return;
          setDrawingConnection((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              waypoints: [...prev.waypoints, pos.x, pos.y],
            };
          });
          return;
        }

        clearSelection();

        if (toolMode === 'select' || toolMode === 'move') return;

        const pos = getPointerPosition(e);
        if (!pos) return;

        const scale = viewport.scale;
        const id = crypto.randomUUID();
        const base = {
          id,
          x: pos.x,
          y: pos.y,
          createdBy: userId,
          createdAt: Date.now(),
        };

        if (toolMode === 'stickyNote') {
          const obj = {
            ...base,
            type: 'stickyNote' as const,
            width: STICKY_NOTE_DEFAULTS.width / scale,
            height: STICKY_NOTE_DEFAULTS.height / scale,
            color: DEFAULT_OBJECT_COLORS.stickyNote,
            text: 'New note',
          };
          createObject(obj);
          pushUndo({ description: 'Create sticky note', undo: () => deleteObject(obj.id) });
        } else if (toolMode === 'text') {
          const obj = {
            ...base,
            type: 'text' as const,
            width: TEXT_DEFAULTS.width / scale,
            height: TEXT_DEFAULTS.height / scale,
            color: DEFAULT_OBJECT_COLORS.text,
            text: 'Text',
            headingLevel: 1,
          };
          createObject(obj);
          pushUndo({ description: 'Create text', undo: () => deleteObject(obj.id) });
        } else if (toolMode === 'rectangle') {
          const obj = {
            ...base,
            type: 'rectangle' as const,
            width: SHAPE_DEFAULTS.width / scale,
            height: SHAPE_DEFAULTS.height / scale,
            color: DEFAULT_OBJECT_COLORS.rectangle,
          };
          createObject(obj);
          pushUndo({ description: 'Create rectangle', undo: () => deleteObject(obj.id) });
        } else if (toolMode === 'circle') {
          const obj = {
            ...base,
            type: 'circle' as const,
            width: SHAPE_DEFAULTS.width / scale,
            height: SHAPE_DEFAULTS.height / scale,
            color: DEFAULT_OBJECT_COLORS.circle,
          };
          createObject(obj);
          pushUndo({ description: 'Create circle', undo: () => deleteObject(obj.id) });
        } else if (toolMode === 'star') {
          const obj = {
            ...base,
            type: 'star' as const,
            width: SHAPE_DEFAULTS.width / scale,
            height: SHAPE_DEFAULTS.height / scale,
            color: DEFAULT_OBJECT_COLORS.star,
          };
          createObject(obj);
          pushUndo({ description: 'Create star', undo: () => deleteObject(obj.id) });
        } else if (toolMode === 'frame') {
          const obj = {
            ...base,
            type: 'frame' as const,
            width: FRAME_DEFAULTS.width / scale,
            height: FRAME_DEFAULTS.height / scale,
            text: 'Frame',
          };
          createObject(obj);
          pushUndo({ description: 'Create frame', undo: () => deleteObject(obj.id) });
        }
        updateObject(id, { selectedBy: userId, selectedByName: userName });
        setSelection([id]);
        useBoardStore.getState().setToolMode('select');
      }
    },
    [toolMode, createObject, deleteObject, pushUndo, userId, userName, getPointerPosition, setSelection, clearSelection, updateObject, viewport.scale, didPan, drawingConnection]
  );

  const handleObjectClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, id: string) => {
      e.cancelBubble = true;
      if (drawingConnection) return;
      if (toolMode === 'move') return;
      if (didPan.current) return;
      const prevIds = useBoardStore.getState().selectedIds;
      const nativeEvent = e.evt as MouseEvent;
      if (nativeEvent.shiftKey) {
        // Toggle object in/out of selection
        if (prevIds.includes(id)) {
          updateObject(id, { selectedBy: null, selectedByName: null });
          setSelection(prevIds.filter((pid) => pid !== id));
        } else {
          updateObject(id, { selectedBy: userId, selectedByName: userName });
          setSelection([...prevIds, id]);
        }
      } else {
        prevIds.forEach((prevId) => {
          if (prevId !== id) {
            updateObject(prevId, { selectedBy: null, selectedByName: null });
          }
        });
        updateObject(id, { selectedBy: userId, selectedByName: userName });
        setSelection([id]);
      }
      setSelectedConnectionId(null);
    },
    [setSelection, updateObject, userId, userName, drawingConnection, toolMode, didPan]
  );

  const handleObjectDoubleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, obj: BoardObjectType) => {
      e.cancelBubble = true;
      if (obj.type === 'stickyNote' || obj.type === 'text' || obj.type === 'frame') {
        onStickyNoteDoubleClick?.(obj.id);
      }
    },
    [onStickyNoteDoubleClick]
  );

  const handleObjectDragStart = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, id: string) => {
      const currentSelectedIds = useBoardStore.getState().selectedIds;
      const isSelected = currentSelectedIds.includes(id);
      const draggedObj = objects[id];
      // Snapshot start center positions (groups use center for position when rotating).
      // Always record at least the dragged object so the undo entry is never empty,
      // even when the object wasn't selected before the drag began.
      const positions = new Map<string, { x: number; y: number }>();
      if (isSelected) {
        currentSelectedIds.forEach((sid) => {
          const obj = objects[sid];
          if (obj) positions.set(sid, { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 });
        });
        if (draggedObj?.type === 'frame') {
          allObjects.forEach((obj) => {
            if (obj.frameId === id && !positions.has(obj.id)) {
              positions.set(obj.id, { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 });
            }
          });
        }
      }
      // Override with the Konva node's actual position (most accurate start point)
      positions.set(id, { x: e.target.x(), y: e.target.y() });
      // Use actual node positions when refs exist so we stay in sync with what's on screen (avoids store/Firebase lag)
      positions.forEach((_pos, sid) => {
        const node = objectNodeRefs.current.get(sid);
        if (node) positions.set(sid, { x: node.x(), y: node.y() });
      });
      groupDragStartPositions.current = positions;
      // Frame-drag visual tracking only applies when the frame itself is selected
      if (!isSelected) return;
      const isFrameDrag = draggedObj?.type === 'frame';
      frameDragFrameIdRef.current = isFrameDrag ? id : null;
      if (isFrameDrag) {
        setFrameDragPositions(new Map(positions));
      } else {
        setFrameDragPositions(null);
      }
    },
    [objects, allObjects]
  );

  const handleObjectDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, id: string) => {
      const startPositions = groupDragStartPositions.current;
      if (startPositions.size <= 1) return;
      const startPos = startPositions.get(id);
      if (!startPos) return;
      const dx = e.target.x() - startPos.x;
      const dy = e.target.y() - startPos.y;

      startPositions.forEach((pos, sid) => {
        if (sid === id) return;
        const node = objectNodeRefs.current.get(sid);
        if (node) {
          node.x(pos.x + dx);
          node.y(pos.y + dy);
        }
      });

      if (frameDragFrameIdRef.current) {
        frameDragDeltasRef.current = { dx, dy };
        if (frameDragRAFRef.current == null) {
          frameDragRAFRef.current = requestAnimationFrame(() => {
            frameDragRAFRef.current = null;
            const { dx: ddx, dy: ddy } = frameDragDeltasRef.current;
            const next = new Map<string, { x: number; y: number }>();
            startPositions.forEach((pos, sid) => {
              next.set(sid, { x: pos.x + ddx, y: pos.y + ddy });
            });
            setFrameDragPositions(next);
          });
        }
      }
    },
    []
  );

  const handleObjectDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, id: string) => {
      const startPositions = groupDragStartPositions.current;
      // In a multi-select drag, Konva fires dragend for every selected draggable node,
      // not just the one the user grabbed. The first dragend (the grabbed object) handles
      // all objects and clears the map. Subsequent dragends for sibling objects find
      // their id absent from the map — bail out to avoid duplicate Firebase writes and
      // no-op undo entries being stacked on top of the real one.
      if (!startPositions.has(id)) return;
      // Snapshot start positions before they're cleared (center coords)
      const posSnapshot = new Map(startPositions);

      const dx = startPositions.get(id)
        ? e.target.x() - startPositions.get(id)!.x
        : 0;
      const dy = startPositions.get(id)
        ? e.target.y() - startPositions.get(id)!.y
        : 0;

      if (startPositions.size > 1) {
        const draggedObj = objects[id];
        const isFrameDrag = draggedObj?.type === 'frame';

        startPositions.forEach((pos, sid) => {
          const newCenterX = pos.x + dx;
          const newCenterY = pos.y + dy;
          const obj = objects[sid];
          if (!obj) return;
          const newX = newCenterX - obj.width / 2;
          const newY = newCenterY - obj.height / 2;
          let patch: { x: number; y: number; frameId?: string } = { x: newX, y: newY };

          if (isFrameDrag) {
            if (obj.type === 'frame') {
              // Frame itself: only position
            } else if (obj.frameId === id) {
              patch.frameId = id;
            }
          } else if (obj.type !== 'frame') {
            const objRight = newX + obj.width;
            const objBottom = newY + obj.height;
            const overlapsFrame = (o: BoardObjectType) =>
              o.type === 'frame' &&
              o.id !== sid &&
              newX < o.x + o.width &&
              objRight > o.x &&
              newY < o.y + o.height &&
              objBottom > o.y;
            const overlappingFrames = allObjects.filter(overlapsFrame);
            const stillInCurrentFrame = obj.frameId && overlappingFrames.some((f) => f.id === obj.frameId);
            if (stillInCurrentFrame) {
              patch.frameId = obj.frameId;
            } else if (obj.frameId && !overlappingFrames.some((f) => f.id === obj.frameId)) {
              patch.frameId = undefined;
            } else if (overlappingFrames.length > 0) {
              patch.frameId = overlappingFrames[0].id;
            } else {
              patch.frameId = undefined;
            }
          }
          updateObject(sid, patch);
        });
      } else {
        const newCenterX = e.target.x();
        const newCenterY = e.target.y();
        const obj = objects[id];
        if (!obj) return;
        const newX = newCenterX - obj.width / 2;
        const newY = newCenterY - obj.height / 2;
        if (obj.type !== 'frame') {
          const objRight = newX + obj.width;
          const objBottom = newY + obj.height;
          const overlapsFrame = (o: BoardObjectType) =>
            o.type === 'frame' &&
            o.id !== id &&
            newX < o.x + o.width &&
            objRight > o.x &&
            newY < o.y + o.height &&
            objBottom > o.y;
          const overlappingFrames = allObjects.filter(overlapsFrame);
          const stillInCurrentFrame = obj.frameId && overlappingFrames.some((f) => f.id === obj.frameId);
          const patch: { x: number; y: number; frameId?: string } = { x: newX, y: newY };
          if (stillInCurrentFrame) {
            patch.frameId = obj.frameId;
          } else if (obj.frameId && !overlappingFrames.some((f) => f.id === obj.frameId)) {
            patch.frameId = undefined;
          } else if (overlappingFrames.length > 0) {
            patch.frameId = overlappingFrames[0].id;
          } else {
            patch.frameId = undefined;
          }
          updateObject(id, patch);
        } else {
          updateObject(id, { x: newX, y: newY });
        }
      }
      // Push undo entry: restore all objects to their pre-drag positions and frame membership.
      // posSnapshot holds center coords; convert to top-left for updateObject.
      // frozenObjects captures the Firebase state before the drag (updateObject is async).
      const frozenObjects = objects;
      pushUndo({
        description: 'Move objects',
        undo: () => {
          posSnapshot.forEach((startPos, sid) => {
            const obj = frozenObjects[sid];
            if (!obj) return;
            updateObject(sid, {
              x: startPos.x - obj.width / 2,
              y: startPos.y - obj.height / 2,
              frameId: obj.frameId,
            });
          });
        },
      });

      groupDragStartPositions.current = new Map();
      frameDragFrameIdRef.current = null;
      if (frameDragRAFRef.current != null) {
        cancelAnimationFrame(frameDragRAFRef.current);
        frameDragRAFRef.current = null;
      }
      setFrameDragPositions(null);
    },
    [updateObject, pushUndo, objects, allObjects]
  );

  const handleResizeStart = useCallback(
    (objId: string, _corner: string) => {
      const obj = objects[objId];
      if (!obj) return;
      const frameNode = objectNodeRefs.current.get(objId);
      const frameX = frameNode ? frameNode.x() - obj.width / 2 : obj.x;
      const frameY = frameNode ? frameNode.y() - obj.height / 2 : obj.y;
      resizeStart.current = { objId, x: frameX, y: frameY, w: obj.width, h: obj.height };
      if (obj.type === 'frame') {
        const children = new Map<string, { x: number; y: number; width: number; height: number }>();
        allObjects.forEach((o) => {
          if (o.frameId === objId) {
            const node = objectNodeRefs.current.get(o.id);
            const x = node ? node.x() - o.width / 2 : o.x;
            const y = node ? node.y() - o.height / 2 : o.y;
            children.set(o.id, { x, y, width: o.width, height: o.height });
          }
        });
        resizeFrameChildrenStart.current = children;
      } else {
        resizeFrameChildrenStart.current = new Map();
      }
    },
    [objects, allObjects]
  );

  const handleResizeMove = useCallback(
    (objId: string, corner: string, e: Konva.KonvaEventObject<DragEvent>) => {
      const start = resizeStart.current;
      if (!start || start.objId !== objId) return;

      // Use absolute world position of the pointer to avoid feedback loops
      const stage = e.target.getStage();
      if (!stage) return;
      const pointerPos = stage.getPointerPosition();
      if (!pointerPos) return;
      const transform = stage.getAbsoluteTransform().copy().invert();
      const worldPos = transform.point(pointerPos);

      let newX = start.x;
      let newY = start.y;
      let newW = start.w;
      let newH = start.h;
      const minSize = 20 / viewport.scale;

      if (corner === 'bottom-right') {
        newW = Math.max(minSize, worldPos.x - start.x);
        newH = Math.max(minSize, worldPos.y - start.y);
      } else if (corner === 'bottom-left') {
        newW = Math.max(minSize, start.x + start.w - worldPos.x);
        newH = Math.max(minSize, worldPos.y - start.y);
        newX = start.x + start.w - newW;
      } else if (corner === 'top-right') {
        newW = Math.max(minSize, worldPos.x - start.x);
        newH = Math.max(minSize, start.y + start.h - worldPos.y);
        newY = start.y + start.h - newH;
      } else if (corner === 'top-left') {
        newW = Math.max(minSize, start.x + start.w - worldPos.x);
        newH = Math.max(minSize, start.y + start.h - worldPos.y);
        newX = start.x + start.w - newW;
        newY = start.y + start.h - newH;
      }

      // Reset the handle node position to prevent Konva from accumulating drag offset
      const half = (8 / viewport.scale) / 2;
      const node = e.target;
      if (corner === 'bottom-right') { node.x(newW - half); node.y(newH - half); }
      else if (corner === 'bottom-left') { node.x(-half); node.y(newH - half); }
      else if (corner === 'top-right') { node.x(newW - half); node.y(-half); }
      else if (corner === 'top-left') { node.x(-half); node.y(-half); }

      updateObject(objId, { x: newX, y: newY, width: newW, height: newH });

      // When resizing a frame, scale children so they move and resize with the frame
      const obj = objects[objId];
      if (obj?.type === 'frame' && start.w > 0 && start.h > 0) {
        resizeFrameChildrenStart.current.forEach((childStart, childId) => {
          const relX = (childStart.x - start.x) / start.w;
          const relY = (childStart.y - start.y) / start.h;
          const relW = childStart.width / start.w;
          const relH = childStart.height / start.h;
          updateObject(childId, {
            x: newX + relX * newW,
            y: newY + relY * newH,
            width: relW * newW,
            height: relH * newH,
          });
        });
      }
    },
    [updateObject, viewport.scale, objects]
  );

  const handleResizeEnd = useCallback(
    (objId: string, corner: string, e: Konva.KonvaEventObject<DragEvent>) => {
      // Capture before-state before clearing refs
      const startSnap = resizeStart.current;
      const childrenSnap = new Map(resizeFrameChildrenStart.current);

      handleResizeMove(objId, corner, e);
      resizeStart.current = null;

      if (startSnap) {
        pushUndo({
          description: 'Resize',
          undo: () => {
            updateObject(startSnap.objId, {
              x: startSnap.x,
              y: startSnap.y,
              width: startSnap.w,
              height: startSnap.h,
            });
            childrenSnap.forEach((c, cid) =>
              updateObject(cid, { x: c.x, y: c.y, width: c.width, height: c.height })
            );
          },
        });
      }
    },
    [handleResizeMove, pushUndo, updateObject]
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const pos = getPointerPosition(e);
      if (pos) {
        updateCursor(pos.x, pos.y);
        if (drawingConnection) {
          setDrawingConnection((prev) => prev ? { ...prev, currentPoint: pos } : null);
        }
        if (selectionRect) {
          setSelectionRect((prev) => prev ? { ...prev, endX: pos.x, endY: pos.y } : null);
        }
      }
    },
    [getPointerPosition, updateCursor, drawingConnection, selectionRect]
  );

  // Attach Konva Transformer to selected node(s) for rotation (defer so refs are set after paint)
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const raf = requestAnimationFrame(() => {
      const nodes = selectedIds
        .map((id) => objectNodeRefs.current.get(id))
        .filter((n): n is Konva.Group => n != null);
      tr.nodes(nodes);
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedIds]);

  const handleTransformerTransform = useCallback(() => {
    if (transformRAFRef.current != null) return;
    transformRAFRef.current = requestAnimationFrame(() => {
      setTransformVersion((v) => v + 1);
      transformRAFRef.current = null;
    });
  }, []);

  const handleTransformerTransformEnd = useCallback(
    (_e: Konva.KonvaEventObject<Event>) => {
      const tr = transformerRef.current;
      if (!tr) return;
      const nodes = tr.nodes();

      // Capture before-state for undo
      const prevState = new Map<string, { x: number; y: number; rotation: number }>();
      nodes.forEach((node) => {
        const id = selectedIds.find((sid) => objectNodeRefs.current.get(sid) === node);
        if (!id) return;
        const obj = objects[id];
        if (!obj) return;
        prevState.set(id, { x: obj.x, y: obj.y, rotation: obj.rotation ?? 0 });
      });

      nodes.forEach((node) => {
        const id = selectedIds.find((sid) => objectNodeRefs.current.get(sid) === node);
        if (!id) return;
        const obj = objects[id];
        if (!obj) return;
        const cx = node.x();
        const cy = node.y();
        updateObject(id, {
          x: cx - obj.width / 2,
          y: cy - obj.height / 2,
          rotation: node.rotation(),
        });
      });

      pushUndo({
        description: 'Rotate',
        undo: () => {
          prevState.forEach(({ x, y, rotation }, id) => {
            updateObject(id, { x, y, rotation });
          });
        },
      });

      setTransformVersion((v) => v + 1);
    },
    [selectedIds, objects, updateObject, pushUndo]
  );

  const handleAnchorMouseDown = useCallback(
    (_objectId: string, _anchor: AnchorPosition) => {
      // No longer start drawing on mousedown; we start on click (mouseup) so user can click start, then click waypoints/destination
    },
    []
  );

  const handleAnchorMouseUp = useCallback(
    (objectId: string, anchor: AnchorPosition) => {
      const dc = drawingConnectionRef.current;
      const obj = objects[objectId];
      if (!obj) return;

      if (dc) {
        // Already drawing: complete connection to this anchor (or cancel if same anchor as start)
        if (dc.fromId === objectId && dc.fromAnchor === anchor) {
          setDrawingConnection(null);
          drawingConnectionRef.current = null;
          return;
        }
        connectionJustCompleted.current = true;
        drawingConnectionRef.current = null;
        const newConn = {
          id: crypto.randomUUID(),
          fromId: dc.fromId,
          fromAnchor: dc.fromAnchor,
          toId: objectId,
          toAnchor: anchor,
          points: dc.waypoints.length > 0 ? dc.waypoints : [],
          createdBy: userId,
          createdAt: Date.now(),
        };
        createConnection(newConn);
        pushUndo({ description: 'Create connection', undo: () => deleteConnection(newConn.id) });
        setDrawingConnection(null);
      } else {
        // Not drawing: this click starts a new connection from this anchor
        const point = getAnchorWorldPoint(obj, anchor);
        const newDC = { fromId: objectId, fromAnchor: anchor, waypoints: [], currentPoint: point };
        drawingConnectionRef.current = newDC;
        setDrawingConnection(newDC);
      }
    },
    [objects, userId, createConnection, deleteConnection, pushUndo]
  );

  const handleStageMouseUpWithConnection = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      handleStageMouseUp();

      // Complete connection if pointer is over an object
      const dc = drawingConnectionRef.current;
      if (dc && !connectionJustCompleted.current) {
        const stage = e.target.getStage();
        if (stage) {
          const pointerPos = stage.getPointerPosition();
          if (pointerPos) {
            const transform = stage.getAbsoluteTransform().copy().invert();
            const worldPos = transform.point(pointerPos);
            // Hit test: find object under pointer
            for (const obj of allObjects) {
              if (worldPos.x >= obj.x && worldPos.x <= obj.x + obj.width &&
                  worldPos.y >= obj.y && worldPos.y <= obj.y + obj.height) {
                // Find nearest anchor (star has 5 points; circle 4; rect 8)
                const anchorPositions: AnchorPosition[] =
                  obj.type === 'star'
                    ? ['star-0', 'star-1', 'star-2', 'star-3', 'star-4']
                    : obj.type === 'circle'
                      ? ['top', 'bottom', 'left', 'right']
                      : ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
                let bestAnchor: AnchorPosition = anchorPositions[0];
                let bestDist = Infinity;
                for (const anchor of anchorPositions) {
                  const pt = getAnchorWorldPoint(obj, anchor);
                  const d = (pt.x - worldPos.x) ** 2 + (pt.y - worldPos.y) ** 2;
                  if (d < bestDist) { bestDist = d; bestAnchor = anchor; }
                }
                const droppedConn = {
                  id: crypto.randomUUID(),
                  fromId: dc.fromId,
                  fromAnchor: dc.fromAnchor,
                  toId: obj.id,
                  toAnchor: bestAnchor,
                  points: dc.waypoints.length > 0 ? dc.waypoints : [],
                  createdBy: userId,
                  createdAt: Date.now(),
                };
                createConnection(droppedConn);
                pushUndo({ description: 'Create connection', undo: () => deleteConnection(droppedConn.id) });
                setDrawingConnection(null);
                connectionJustCompleted.current = true;
                break;
              }
            }
          }
        }
      }

      // Finalize area selection
      if (selectionRect) {
        const rect = selectionRect;
        const minX = Math.min(rect.startX, rect.endX);
        const maxX = Math.max(rect.startX, rect.endX);
        const minY = Math.min(rect.startY, rect.endY);
        const maxY = Math.max(rect.startY, rect.endY);

        const dragDist = Math.abs(rect.endX - rect.startX) + Math.abs(rect.endY - rect.startY);
        if (dragDist > 5 / viewport.scale) {
          didAreaSelect.current = true;
          const hitIds = allObjects
            .filter((obj) => {
              const objRight = obj.x + obj.width;
              const objBottom = obj.y + obj.height;
              return obj.x < maxX && objRight > minX && obj.y < maxY && objBottom > minY;
            })
            .map((obj) => obj.id);

          hitIds.forEach((id) => {
            updateObject(id, { selectedBy: userId, selectedByName: userName });
          });
          setSelection(hitIds);
        }
        setSelectionRect(null);
      }
    },
    [handleStageMouseUp, selectionRect, allObjects, updateObject, userId, userName, setSelection, viewport.scale, createConnection, deleteConnection, pushUndo]
  );

  // Connection selection handlers
  const handleConnectionSelect = useCallback(
    (connId: string) => {
      clearSelection();
      setSelectedConnectionId(connId);
    },
    [clearSelection]
  );

  const handleConnectionWaypointDrag = useCallback(
    (connId: string, waypointIndex: number, x: number, y: number) => {
      const conn = connections[connId];
      if (!conn || !conn.points) return;
      const newPoints = [...conn.points];
      newPoints[waypointIndex] = x;
      newPoints[waypointIndex + 1] = y;
      // Local update for responsiveness — will sync on drag end
      updateConnection(connId, { points: newPoints });
    },
    [connections, updateConnection]
  );

  const handleConnectionWaypointDragEnd = useCallback(
    (connId: string, points: number[]) => {
      updateConnection(connId, { points });
    },
    [updateConnection]
  );

  const handleConnectionDoubleClick = useCallback(
    (connId: string, x: number, y: number) => {
      const conn = connections[connId];
      if (!conn) return;
      // Insert a new waypoint at the clicked position
      const currentPoints = conn.points ?? [];
      const newPoints = [...currentPoints, x, y];
      updateConnection(connId, { points: newPoints });
      setSelectedConnectionId(connId);
    },
    [connections, updateConnection]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape or right-click cancels drawing
      if (e.key === 'Escape' && drawingConnection) {
        setDrawingConnection(null);
        return;
      }

      // Ctrl+Z / Cmd+Z: undo last action
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        const active = document.activeElement?.tagName;
        if (active === 'INPUT' || active === 'TEXTAREA') return;
        e.preventDefault();
        const entry = useBoardStore.getState().popUndo();
        if (entry) void entry.undo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = document.activeElement?.tagName;
        if (active === 'INPUT' || active === 'TEXTAREA') return;

        // Delete selected connection — capture for undo first
        if (selectedConnectionId) {
          const conn = connections[selectedConnectionId];
          deleteConnection(selectedConnectionId);
          setSelectedConnectionId(null);
          if (conn) {
            pushUndo({ description: 'Delete connection', undo: () => createConnection(conn) });
          }
          return;
        }

        // Capture before-state for objects being deleted
        const deletedObjects = selectedIds
          .map((id) => objects[id])
          .filter((o): o is NonNullable<typeof o> => o != null);
        const deletedConns = Object.values(connections).filter(
          (c) => selectedIds.includes(c.fromId) || selectedIds.includes(c.toId)
        );
        // Track frame→child assignments that will be unlinked
        const frameUnlinks: Array<{ id: string; frameId: string }> = [];
        selectedIds.forEach((id) => {
          if (objects[id]?.type === 'frame') {
            allObjects.forEach((o) => {
              if (o.frameId === id) frameUnlinks.push({ id: o.id, frameId: id });
            });
          }
        });

        selectedIds.forEach((id) => {
          const obj = objects[id];
          if (obj?.type === 'frame') {
            allObjects.forEach((o) => {
              if (o.frameId === id) updateObject(o.id, { frameId: undefined });
            });
          }
          deleteConnectionsForObject(id);
          deleteObject(id);
        });
        setSelection([]);

        if (deletedObjects.length > 0 || deletedConns.length > 0) {
          pushUndo({
            description: 'Delete objects',
            undo: () => {
              deletedObjects.forEach((obj) => createObject(obj));
              deletedConns.forEach((conn) => createConnection(conn));
              frameUnlinks.forEach(({ id, frameId }) => updateObject(id, { frameId }));
            },
          });
        }
      }

      // Ctrl+C: copy selected objects (only objects we selected; store snapshot so clipboard isn't affected by others' edits)
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedIds.length === 0) return;
        clipboardRef.current = selectedIds
          .filter((id) => {
            const obj = objects[id];
            return obj && obj.selectedBy === userId;
          })
          .map((id) => ({ ...objects[id]! }));
      }

      // Ctrl+V: paste copied objects
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboardRef.current.length === 0) return;
        const active = document.activeElement?.tagName;
        if (active === 'INPUT' || active === 'TEXTAREA') return;

        // Clear current selection
        selectedIds.forEach((id) => {
          updateObject(id, { selectedBy: null, selectedByName: null });
        });

        const newIds: string[] = [];
        clipboardRef.current.forEach((obj) => {
          const newId = crypto.randomUUID();
          const { frameId: _f, ...rest } = obj;
          createObject({
            ...rest,
            id: newId,
            x: obj.x + 20,
            y: obj.y + 20,
            createdBy: userId,
            createdAt: Date.now(),
            selectedBy: userId,
            selectedByName: userName,
          });
          newIds.push(newId);
        });
        // Update clipboard to point at the new copies (for repeated paste)
        clipboardRef.current = clipboardRef.current.map((obj) => ({
          ...obj,
          x: obj.x + 20,
          y: obj.y + 20,
        }));
        const pastedIds = [...newIds];
        pushUndo({ description: 'Paste objects', undo: () => pastedIds.forEach((pid) => deleteObject(pid)) });
        setSelection(newIds);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, deleteObject, deleteConnectionsForObject, setSelection, drawingConnection, selectedConnectionId, deleteConnection, createConnection, objects, connections, allObjects, createObject, updateObject, userId, userName, pushUndo]);

  // Cancel drawing on right-click
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (drawingConnection) {
        e.preventDefault();
        setDrawingConnection(null);
      }
    };
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, [drawingConnection]);

  // Paste image from clipboard
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const img = new window.Image();
            img.onload = () => {
              const scale = viewport.scale;
              const cx = (-viewport.x + (width || window.innerWidth) / 2) / scale;
              const cy = (-viewport.y + (height || window.innerHeight) / 2) / scale;
              const id = crypto.randomUUID();
              createObject({
                id,
                type: 'image',
                x: cx - img.width / 2,
                y: cy - img.height / 2,
                width: img.width,
                height: img.height,
                imageData: dataUrl,
                createdBy: userId,
                createdAt: Date.now(),
              });
              useBoardStore.getState().pushUndo({ description: 'Paste image', undo: () => deleteObject(id) });
              setSelection([id]);
            };
            img.src = dataUrl;
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [createObject, deleteObject, userId, viewport, width, height, setSelection]);

  // ---------------------------------------------------------------------------
  // Stable handler refs — updated every render so the wrappers below never go stale,
  // but the wrapper references themselves NEVER change (created once via useRef).
  // This lets MemoizedObjectGroup skip re-renders even when handler deps change.
  // ---------------------------------------------------------------------------
  const _latestH = useRef({
    handleObjectClick,
    handleObjectDoubleClick,
    handleObjectDragStart,
    handleObjectDragMove,
    handleObjectDragEnd,
    handleAnchorMouseDown,
    handleAnchorMouseUp,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
    setHoveredObjectId,
  });
  _latestH.current = {
    handleObjectClick,
    handleObjectDoubleClick,
    handleObjectDragStart,
    handleObjectDragMove,
    handleObjectDragEnd,
    handleAnchorMouseDown,
    handleAnchorMouseUp,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
    setHoveredObjectId,
  };

  // Stable wrappers — created once, call through _latestH.current
  const stableHandlers = useRef<MemoizedObjectGroupHandlers | null>(null);
  if (!stableHandlers.current) {
    stableHandlers.current = {
      onObjectClick:       (e, id)         => _latestH.current.handleObjectClick(e, id),
      onObjectDoubleClick: (e, obj)        => _latestH.current.handleObjectDoubleClick(e, obj),
      onDragStart:         (e, id)         => _latestH.current.handleObjectDragStart(e, id),
      onDragMove:          (e, id)         => _latestH.current.handleObjectDragMove(e, id),
      onDragEnd:           (e, id)         => _latestH.current.handleObjectDragEnd(e, id),
      onMouseEnter:        (id)            => _latestH.current.setHoveredObjectId(id),
      onMouseLeave:        (id)            => _latestH.current.setHoveredObjectId((prev) => prev === id ? null : prev),
      onAnchorMouseDown:   (id, anchor)    => _latestH.current.handleAnchorMouseDown(id, anchor),
      onAnchorMouseUp:     (id, anchor)    => _latestH.current.handleAnchorMouseUp(id, anchor),
      onResizeStart:       (id, corner)    => _latestH.current.handleResizeStart(id, corner),
      onResizeMove:        (id, corner, e) => _latestH.current.handleResizeMove(id, corner, e),
      onResizeEnd:         (id, corner, e) => _latestH.current.handleResizeEnd(id, corner, e),
      onRef: (id, node) => {
        if (node) objectNodeRefs.current.set(id, node);
        else objectNodeRefs.current.delete(id);
      },
    };
  }
  const sh = stableHandlers.current;

  // Compute the in-progress arrow points (use liveObjects so the start anchor
  // stays glued to the object edge even while that object is being rotated)
  let drawingArrowPoints: number[] | null = null;
  if (drawingConnection) {
    const fromObj = liveObjects[drawingConnection.fromId];
    if (fromObj) {
      const from = getAnchorWorldPoint(fromObj, drawingConnection.fromAnchor);
      drawingArrowPoints = [
        from.x, from.y,
        ...drawingConnection.waypoints,
        drawingConnection.currentPoint.x, drawingConnection.currentPoint.y,
      ];
    }
  }

  return (
    <div ref={containerRef} className="board-container">
      <Stage
        ref={stageRef}
        width={width || window.innerWidth}
        height={height || window.innerHeight}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        x={viewport.x}
        y={viewport.y}
        hitOnDragOnly
        onWheel={handleWheel}
        onMouseDown={(e) => {
          connectionJustCompleted.current = false;
          handleStageMouseDown(e);
          // Start area selection in select mode
          if (toolMode === 'select' && e.target === e.target.getStage() && !drawingConnection) {
            const pos = getPointerPosition(e);
            if (pos) {
              setSelectionRect({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y });
            }
          }
        }}
        onMouseMove={(e) => {
          handleStageMouseMove(e);
          handleMouseMove(e);
        }}
        onMouseUp={handleStageMouseUpWithConnection}
        onMouseLeave={handleStageMouseUpWithConnection}
        onClick={handleStageClick}
        onTap={handleStageClick}
        style={{
          cursor: drawingConnection ? 'crosshair' : toolMode === 'move' ? 'grab' : toolMode === 'select' ? 'default' : 'crosshair',
          willChange: 'transform', // GPU layer for smooth zoom/pan
        }}
      >
        <Layer>
          {/* Objects sent to back (behind arrows) */}
          {backObjects.map((obj) => {
            const isSelected = selectedSet.has(obj.id);
            const showAnchors = (hoveredObjectId === obj.id || isSelected) && !isMultiSelect;
            return (
              <MemoizedObjectGroup
                key={obj.id}
                obj={obj}
                isSelected={isSelected}
                showAnchors={showAnchors}
                showSelectionBorder={isSelected && !isMultiSelect}
                dragPos={frameDragPositions?.get(obj.id)}
                toolMode={toolMode}
                hasDrawingConnection={!!drawingConnection}
                zoomScale={viewport.scale}
                userId={userId}
                isMultiSelect={isMultiSelect}
                handlers={sh}
              />
            );
          })}

          {/* Connections (arrows) — fromObj/toObj passed directly so ConnectionLine's
              React.memo can compare endpoint geometry without touching the full liveObjects map */}
          {connectionList.map((conn) => {
            const fromObj = liveObjects[conn.fromId];
            const toObj = liveObjects[conn.toId];
            if (!fromObj || !toObj) return null;
            return (
              <ConnectionLine
                key={conn.id}
                connection={conn}
                fromObj={fromObj}
                toObj={toObj}
                zoomScale={viewport.scale}
                isSelected={selectedConnectionId === conn.id}
                onSelect={handleConnectionSelect}
                onWaypointDrag={handleConnectionWaypointDrag}
                onWaypointDragEnd={handleConnectionWaypointDragEnd}
                onDoubleClick={handleConnectionDoubleClick}
              />
            );
          })}

          {/* In-progress drawing arrow */}
          {drawingArrowPoints && (
            <Arrow
              points={drawingArrowPoints}
              tension={0}
              stroke="#4a7c59"
              fill="#4a7c59"
              strokeWidth={2 / viewport.scale}
              pointerLength={10 / viewport.scale}
              pointerWidth={8 / viewport.scale}
              dash={[6 / viewport.scale, 3 / viewport.scale]}
              listening={false}
            />
          )}

          {/* Objects in front (above arrows) */}
          {frontObjects.map((obj) => {
            const isSelected = selectedSet.has(obj.id);
            const showAnchors = (hoveredObjectId === obj.id || isSelected) && !isMultiSelect;
            return (
              <MemoizedObjectGroup
                key={obj.id}
                obj={obj}
                isSelected={isSelected}
                showAnchors={showAnchors}
                showSelectionBorder={isSelected && !isMultiSelect}
                dragPos={frameDragPositions?.get(obj.id)}
                toolMode={toolMode}
                hasDrawingConnection={!!drawingConnection}
                zoomScale={viewport.scale}
                userId={userId}
                isMultiSelect={isMultiSelect}
                handlers={sh}
              />
            );
          })}

          {/* Rotation handle: fixed screen pixels so it stays same size at any zoom (Transformer uses screen space for anchors) */}
          {selectedIds.length > 0 && (
            <Transformer
              ref={transformerRef}
              resizeEnabled={false}
              rotateEnabled={true}
              rotateAnchorCursor="grab"
              rotateLineVisible={false}
              rotateAnchorOffset={8}
              borderStrokeWidth={0}
              anchorSize={10}
              anchorStroke="#fff"
              anchorFill="#4a7c59"
              anchorStrokeWidth={1}
              onTransform={handleTransformerTransform}
              onTransformEnd={handleTransformerTransformEnd}
            />
          )}

          {/* Multi-select: temporary “selector” object – same Group/offset/rotation as real objects so it’s centered and rotates */}
          {selectionBox && (
            <Group
              x={selectionBox.x + selectionBox.width / 2}
              y={selectionBox.y + selectionBox.height / 2}
              offsetX={selectionBox.width / 2}
              offsetY={selectionBox.height / 2}
              rotation={selectionBox.rotation}
              listening={false}
            >
              <Rect
                x={0}
                y={0}
                width={selectionBox.width}
                height={selectionBox.height}
                fill="rgba(74, 124, 89, 0.06)"
                stroke="#4a7c59"
                strokeWidth={2 / viewport.scale}
                dash={[6 / viewport.scale, 3 / viewport.scale]}
                listening={false}
              />
            </Group>
          )}

          {/* Area selection rectangle */}
          {selectionRect && (
            <Rect
              x={Math.min(selectionRect.startX, selectionRect.endX)}
              y={Math.min(selectionRect.startY, selectionRect.endY)}
              width={Math.abs(selectionRect.endX - selectionRect.startX)}
              height={Math.abs(selectionRect.endY - selectionRect.startY)}
              fill="rgba(74, 124, 89, 0.1)"
              stroke="#4a7c59"
              strokeWidth={1 / viewport.scale}
              dash={[4 / viewport.scale, 4 / viewport.scale]}
              listening={false}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
