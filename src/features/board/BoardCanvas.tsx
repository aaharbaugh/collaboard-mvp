import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Stage, Layer, Group, Rect, Transformer, Shape } from 'react-konva';
import { useContainerSize } from '../../hooks/useContainerSize';
import { useCursorSync } from '../sync/useCursorSync';
import { useBoardViewport } from './useBoardViewport';
import { useBoardStore } from '../../lib/store';
import { WireLine } from '../wiring/WireLine';
import { TimerPopover } from '../wiring/TimerPopover';
import { ModelPopover } from '../wiring/ModelPopover';
import { NODE_TO_ANCHOR, ANCHOR_TO_NODE } from '../wiring/constants';
import { MemoizedObjectGroup } from './components/MemoizedObjectGroup';
import type { MemoizedObjectGroupHandlers } from './components/MemoizedObjectGroup';
import {
  STICKY_NOTE_DEFAULTS,
  TEXT_DEFAULTS,
  SHAPE_DEFAULTS,
  FRAME_DEFAULTS,
  DEFAULT_OBJECT_COLORS,
} from '../../lib/constants';
import type { BoardObject as BoardObjectType, AnchorPosition, Wire } from '../../types/board';
import { getAnchorWorldPoint, getPillWorldPoint } from './utils/anchorPoint';

interface BoardCanvasProps {
  boardId: string;
  userId: string;
  userName: string;
  onStickyNoteDoubleClick?: (id: string) => void;
  onRunPrompt?: (objectId: string) => void;
  /** Shared board state — passed from BoardView so both share the same optimistic state */
  objects: Record<string, BoardObjectType>;
  updateObject: (id: string, updates: Partial<BoardObjectType>) => void;
  createObject: (obj: BoardObjectType) => void;
  deleteObject: (id: string) => void;
  wires: Record<string, Wire>;
  createWire: (wire: Wire) => void;
  updateWire: (id: string, updates: Partial<Wire>) => void;
  deleteWire: (id: string) => void;
  deleteWiresForObject: (objectId: string) => void;
}

export function BoardCanvas({
  boardId,
  userId,
  userName,
  onStickyNoteDoubleClick,
  onRunPrompt,
  objects,
  updateObject,
  createObject,
  deleteObject,
  wires,
  createWire,
  updateWire,
  deleteWire,
  deleteWiresForObject,
}: BoardCanvasProps) {
  const { ref: containerRef, width, height } = useContainerSize();
  const { updateCursor } = useCursorSync(boardId, userId, userName);

  const toolMode    = useBoardStore((s) => s.toolMode);
  const selectedIds = useBoardStore((s) => s.selectedIds);
  const setSelection = useBoardStore((s) => s.setSelection);
  const pushUndo    = useBoardStore((s) => s.pushUndo);
  const drawingWire = useBoardStore((s) => s.drawingWire);
  const setDrawingWire = useBoardStore((s) => s.setDrawingWire);
  const chainRunningIds = useBoardStore((s) => s.chainRunningIds);
  const chainCurrentId = useBoardStore((s) => s.chainCurrentId);

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
  const transformerRef = useRef<Konva.Transformer>(null);
  const [transformVersion, setTransformVersion] = useState(0);
  const transformRAFRef = useRef<number | null>(null);

  const allObjects = useMemo(() => Object.values(objects), [objects]);
  const backObjects = useMemo(() => allObjects.filter((obj) => obj.sentToBack === true), [allObjects]);
  const frontObjects = useMemo(() => allObjects.filter((obj) => obj.sentToBack !== true), [allObjects]);
  const wireList = useMemo(() => Object.values(wires), [wires]);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [timerPopover, setTimerPopover] = useState<{ x: number; y: number } | null>(null);
  const [modelPopover, setModelPopover] = useState<{ x: number; y: number } | null>(null);

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
  const drawingFromId = drawingWire?.fromObjectId ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveObjects = useMemo(() => {
    // Collect only the IDs we actually need live data for
    const endpointIds = new Set<string>();
    for (const w of wireList) {
      endpointIds.add(w.fromObjectId);
      endpointIds.add(w.toObjectId);
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
  }, [objects, wireList, drawingFromId, transformVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearSelection = useCallback(() => {
    const ids = useBoardStore.getState().selectedIds;
    ids.forEach((id) => {
      updateObject(id, { selectedBy: null, selectedByName: null });
    });
    setSelection([]);
    setSelectedWireId(null);
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

      // Wire drawing: clicking on empty canvas adds a waypoint
      if (drawingWire && toolMode === 'wire' && e.target === e.target.getStage()) {
        const pos = getPointerPosition(e);
        if (!pos) return;
        setDrawingWire({
          ...drawingWire,
          waypoints: [...(drawingWire.waypoints ?? []), pos],
          currentPoint: pos,
        });
        return;
      }

      if (e.target === e.target.getStage()) {
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
            sentToBack: true,
          };
          createObject(obj);
          pushUndo({ description: 'Create frame', undo: () => deleteObject(obj.id) });
        }
        updateObject(id, { selectedBy: userId, selectedByName: userName });
        setSelection([id]);
        useBoardStore.getState().setToolMode('select');
      }
    },
    [toolMode, createObject, deleteObject, pushUndo, userId, userName, getPointerPosition, setSelection, clearSelection, updateObject, viewport.scale, didPan, drawingWire, setDrawingWire]
  );

  const handleObjectClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, id: string) => {
      e.cancelBubble = true;
      if (drawingWire) return;
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
    },
    [setSelection, updateObject, userId, userName, drawingWire, toolMode, didPan]
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
      // Shift wire waypoints for all wires connected to moved objects
      const movedIds = new Set(posSnapshot.keys());
      const wirePointSnapshots = new Map<string, number[] | undefined>();
      for (const [wireId, wire] of Object.entries(wires)) {
        if (!wire.points || wire.points.length < 2) continue;
        const fromMoved = movedIds.has(wire.fromObjectId);
        const toMoved = movedIds.has(wire.toObjectId);
        if (!fromMoved && !toMoved) continue;
        // Snapshot original points for undo
        wirePointSnapshots.set(wireId, [...wire.points]);
        // Shift all waypoints by the drag delta
        const newPoints = wire.points.map((v, i) => v + (i % 2 === 0 ? dx : dy));
        updateWire(wireId, { points: newPoints });
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
          // Restore wire waypoints
          wirePointSnapshots.forEach((origPoints, wireId) => {
            updateWire(wireId, { points: origPoints });
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
    [updateObject, updateWire, pushUndo, objects, wires, allObjects]
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
        if (drawingWire) {
          setDrawingWire({ ...drawingWire, currentPoint: pos });
        }
        if (selectionRect) {
          setSelectionRect((prev) => prev ? { ...prev, endX: pos.x, endY: pos.y } : null);
        }
      }
    },
    [getPointerPosition, updateCursor, drawingWire, setDrawingWire, selectionRect]
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
      // Wire mode: start/complete a wire
      if (toolMode === 'wire') {
        const node = ANCHOR_TO_NODE[anchor];
        if (!node) return;
        const obj = objects[objectId];
        if (!obj) return;
        const dw = useBoardStore.getState().drawingWire;
        if (dw) {
          // Complete wire (cancel if same object+node)
          if (dw.fromObjectId === objectId && dw.fromNode === node) {
            setDrawingWire(null);
            return;
          }
          // Don't wire to same object
          if (dw.fromObjectId === objectId) {
            setDrawingWire(null);
            return;
          }
          const newWire: Wire = {
            id: crypto.randomUUID(),
            fromObjectId: dw.fromObjectId,
            fromNode: dw.fromNode,
            toObjectId: objectId,
            toNode: node,
            ...(dw.waypoints.length > 0
              ? { points: dw.waypoints.flatMap((p) => [p.x, p.y]) }
              : {}),
            createdBy: userId,
            createdAt: Date.now(),
          };
          createWire(newWire);
          pushUndo({ description: 'Create wire', undo: () => deleteWire(newWire.id) });
          setDrawingWire(null);
        } else {
          // Start drawing wire
          const point = getAnchorWorldPoint(obj, anchor);
          setDrawingWire({ fromObjectId: objectId, fromNode: node, currentPoint: point, waypoints: [] });
        }
        return;
      }
    },
    [objects, userId, toolMode, createWire, deleteWire, pushUndo, setDrawingWire]
  );

  const handleStageMouseUpWithAreaSelect = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      handleStageMouseUp();

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
    [handleStageMouseUp, selectionRect, allObjects, updateObject, userId, userName, setSelection, viewport.scale]
  );

  useEffect(() => {
    /** True when focus is inside a text input, textarea, or contentEditable element. */
    const isEditingText = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape cancels drawing
      if (e.key === 'Escape') {
        if (drawingWire) {
          setDrawingWire(null);
          return;
        }
      }

      // Ctrl+Z / Cmd+Z: undo last action
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (isEditingText()) return;
        e.preventDefault();
        const entry = useBoardStore.getState().popUndo();
        if (entry) void entry.undo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isEditingText()) return;

        // Delete selected wire
        if (selectedWireId) {
          const w = wires[selectedWireId];
          deleteWire(selectedWireId);
          setSelectedWireId(null);
          if (w) {
            pushUndo({ description: 'Delete wire', undo: () => createWire(w) });
          }
          return;
        }

        // Capture before-state for objects being deleted
        const deletedObjects = selectedIds
          .map((id) => objects[id])
          .filter((o): o is NonNullable<typeof o> => o != null);
        const deletedWires = Object.values(wires).filter(
          (w) => selectedIds.includes(w.fromObjectId) || selectedIds.includes(w.toObjectId)
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
          deleteWiresForObject(id);
          deleteObject(id);
        });
        setSelection([]);

        if (deletedObjects.length > 0 || deletedWires.length > 0) {
          pushUndo({
            description: 'Delete objects',
            undo: () => {
              deletedObjects.forEach((obj) => createObject(obj));
              deletedWires.forEach((w) => createWire(w));
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
        if (isEditingText()) return;

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
  }, [selectedIds, deleteObject, deleteWiresForObject, setSelection, drawingWire, setDrawingWire, selectedWireId, deleteWire, createWire, objects, wires, allObjects, createObject, updateObject, userId, userName, pushUndo]);

  // Cancel drawing on right-click
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (drawingWire) {
        e.preventDefault();
        setDrawingWire(null);
      }
    };
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, [drawingWire, setDrawingWire]);

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
          handleStageMouseDown(e);
          // Start area selection in select mode
          if (toolMode === 'select' && e.target === e.target.getStage() && !drawingWire) {
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
        onMouseUp={handleStageMouseUpWithAreaSelect}
        onMouseLeave={handleStageMouseUpWithAreaSelect}
        onClick={handleStageClick}
        onTap={handleStageClick}
        style={{
          cursor: drawingWire ? 'crosshair' : toolMode === 'move' ? 'grab' : toolMode === 'select' ? 'default' : toolMode === 'wire' ? 'crosshair' : 'crosshair',
          willChange: 'transform', // GPU layer for smooth zoom/pan
        }}
      >
        <Layer>
          {/* Objects sent to back (behind arrows) */}
          {backObjects.map((obj) => {
            const isSelected = selectedSet.has(obj.id);
            const showAnchors = (hoveredObjectId === obj.id || isSelected) && !isMultiSelect;
            const cs = chainRunningIds.has(obj.id)
              ? (chainCurrentId === obj.id ? 'running' as const : 'queued' as const)
              : null;
            return (
              <MemoizedObjectGroup
                key={obj.id}
                obj={obj}
                isSelected={isSelected}
                showAnchors={showAnchors}
                showSelectionBorder={isSelected && !isMultiSelect}
                dragPos={frameDragPositions?.get(obj.id)}
                toolMode={toolMode}
                hasDrawingConnection={!!drawingWire}
                zoomScale={viewport.scale}
                userId={userId}
                isMultiSelect={isMultiSelect}
                chainStatus={cs}
                handlers={sh}
              />
            );
          })}

          {/* Wires (bezier curves) */}
          {wireList.map((w) => {
            const fromObj = liveObjects[w.fromObjectId];
            const toObj = liveObjects[w.toObjectId];
            if (!fromObj || !toObj) return null;
            return (
              <WireLine
                key={w.id}
                wire={w}
                fromObj={fromObj}
                toObj={toObj}
                zoomScale={viewport.scale}
                isSelected={selectedWireId === w.id}
                onSelect={(wireId) => {
                  clearSelection();
                  setSelectedWireId(wireId);
                }}
                onUpdatePoints={(wireId, points) => {
                  updateWire(wireId, { points });
                }}
              />
            );
          })}

          {/* In-progress wire preview */}
          {drawingWire && (() => {
            const fromObj = liveObjects[drawingWire.fromObjectId] ?? objects[drawingWire.fromObjectId];
            if (!fromObj) return null;
            const fromAnchor = NODE_TO_ANCHOR[drawingWire.fromNode];
            if (!fromAnchor) return null;
            const from = fromObj.pills?.length
              ? getPillWorldPoint(fromObj, fromObj.pills, drawingWire.fromNode)
              : getAnchorWorldPoint(fromObj, fromAnchor);
            const to = drawingWire.currentPoint;
            const wps = drawingWire.waypoints ?? [];
            const previewColor = '#6b8e9b';
            const lineW = 2 / viewport.scale;
            const dashOn = 6 / viewport.scale;
            const dashOff = 3 / viewport.scale;
            const wpR = 3 / viewport.scale;

            if (wps.length > 0) {
              // Polyline preview: anchor → waypoints → cursor
              const allPts = [from, ...wps, to];
              return (
                <Shape
                  sceneFunc={(context) => {
                    context.beginPath();
                    context.moveTo(allPts[0].x, allPts[0].y);
                    for (let i = 1; i < allPts.length; i++) {
                      context.lineTo(allPts[i].x, allPts[i].y);
                    }
                    context.strokeStyle = previewColor;
                    context.lineWidth = lineW;
                    context.setLineDash([dashOn, dashOff]);
                    context.stroke();

                    // Waypoint dots
                    context.setLineDash([]);
                    for (const wp of wps) {
                      context.beginPath();
                      context.arc(wp.x, wp.y, wpR, 0, Math.PI * 2);
                      context.fillStyle = previewColor;
                      context.fill();
                      context.strokeStyle = '#fff';
                      context.lineWidth = 1 / viewport.scale;
                      context.stroke();
                    }
                  }}
                  listening={false}
                />
              );
            }

            // Bezier preview (no waypoints yet)
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const offset = Math.max(40 / viewport.scale, dist * 0.3);
            const fromPill = fromObj.pills?.find((p) => p.node === drawingWire.fromNode);
            const dirs: Record<number, { dx: number; dy: number }> = {
              1: { dx: 0, dy: -1 }, 2: { dx: 0.707, dy: -0.707 }, 3: { dx: 1, dy: 0 }, 4: { dx: 0.707, dy: 0.707 },
              5: { dx: 0, dy: 1 }, 6: { dx: -0.707, dy: 0.707 }, 7: { dx: -1, dy: 0 }, 8: { dx: -0.707, dy: -0.707 },
            };
            const dir = fromPill
              ? { dx: fromPill.direction === 'in' ? -1 : 1, dy: 0 }
              : dirs[drawingWire.fromNode] ?? { dx: 0, dy: -1 };
            const cp1x = from.x + dir.dx * offset;
            const cp1y = from.y + dir.dy * offset;
            return (
              <Shape
                sceneFunc={(context) => {
                  context.beginPath();
                  context.moveTo(from.x, from.y);
                  context.bezierCurveTo(cp1x, cp1y, to.x, to.y, to.x, to.y);
                  context.strokeStyle = previewColor;
                  context.lineWidth = lineW;
                  context.setLineDash([dashOn, dashOff]);
                  context.stroke();
                }}
                listening={false}
              />
            );
          })()}

          {/* Objects in front (above arrows) */}
          {frontObjects.map((obj) => {
            const isSelected = selectedSet.has(obj.id);
            const showAnchors = (hoveredObjectId === obj.id || isSelected) && !isMultiSelect;
            const cs = chainRunningIds.has(obj.id)
              ? (chainCurrentId === obj.id ? 'running' as const : 'queued' as const)
              : null;
            return (
              <MemoizedObjectGroup
                key={obj.id}
                obj={obj}
                isSelected={isSelected}
                showAnchors={showAnchors}
                showSelectionBorder={isSelected && !isMultiSelect}
                dragPos={frameDragPositions?.get(obj.id)}
                toolMode={toolMode}
                hasDrawingConnection={!!drawingWire}
                zoomScale={viewport.scale}
                userId={userId}
                isMultiSelect={isMultiSelect}
                chainStatus={cs}
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

      {/* Run + Timer button overlay for selected smart stickies */}
      {onRunPrompt && selectedIds.length === 1 && (() => {
        const obj = objects[selectedIds[0]];
        if (!obj) return null;
        const hasOutputPill = (obj.pills ?? []).some((p) => p.direction === 'out');
        if (!hasOutputPill) return null;
        const isRunning = obj.lastRunStatus === 'running';
        const isChainRunning = chainRunningIds.size > 0;
        const screenX = obj.x * viewport.scale + viewport.x + obj.width * viewport.scale;
        const screenY = obj.y * viewport.scale + viewport.y + obj.height * viewport.scale;
        const chainArr = isChainRunning ? [...chainRunningIds] : [];
        const chainIdx = isChainRunning && chainCurrentId ? chainArr.indexOf(chainCurrentId) : -1;
        return (
          <>
            <button
              className={`smart-sticky-run-btn${isRunning || isChainRunning ? ' smart-sticky-run-btn--running' : ''}`}
              style={{
                position: 'absolute',
                left: screenX + 4,
                top: screenY - 34,
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!isRunning && !isChainRunning) onRunPrompt(obj.id);
              }}
              title={isChainRunning ? `Chain: Step ${chainIdx + 1}/${chainArr.length}` : isRunning ? 'Running...' : 'Run prompt'}
            >
              {isRunning || isChainRunning ? (
                <span className="smart-sticky-run-spinner" />
              ) : (
                <span className="smart-sticky-run-icon">{'\u25B6'}</span>
              )}
            </button>
            {isChainRunning && chainIdx >= 0 && (
              <span
                className="chain-progress-label"
                style={{
                  position: 'absolute',
                  left: screenX + 40,
                  top: screenY - 26,
                }}
              >
                Step {chainIdx + 1}/{chainArr.length}
              </span>
            )}
            <button
              className="smart-sticky-timer-btn"
              style={{
                position: 'absolute',
                left: screenX + 6,
                top: screenY - 70,
              }}
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setTimerPopover({ x: rect.left, y: rect.top });
              }}
              title="Auto-run timer"
            >
              <span className="smart-sticky-timer-icon">{'\u23F1'}</span>
            </button>
            <button
              className="smart-sticky-model-btn"
              style={{
                position: 'absolute',
                left: screenX + 6,
                top: screenY - 106,
              }}
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setModelPopover({ x: rect.left, y: rect.top });
              }}
              title="Model: GPT-4o Mini"
            >
              <span className="smart-sticky-model-icon">{'\u2726'}</span>
            </button>
          </>
        );
      })()}

      {timerPopover && (
        <TimerPopover
          position={{ x: timerPopover.x, y: timerPopover.y - 8 }}
          onClose={() => setTimerPopover(null)}
        />
      )}

      {modelPopover && (
        <ModelPopover
          position={{ x: modelPopover.x, y: modelPopover.y - 8 }}
          onClose={() => setModelPopover(null)}
        />
      )}

    </div>
  );
}
