# CollabBoard – AI-Assisted Performance Review

**Review date:** Applied after pre-research (performance profiling approach).  
**Goals:** Improve rendering performance, reduce unnecessary computations, optimize state management, enhance readability.

---

## 1. Performance Profiling – Findings

### 1.1 Re-render drivers (high impact)

| Source | What happens | When |
|--------|----------------------|------|
| **Viewport (Zustand)** | `setViewport({ x, y, scale })` | Every wheel event; every mouse move while panning |
| **useBoardSync** | `setObjects(raw)` / `setConnections(raw)` | Every Firebase `onValue` (any object/connection change) |
| **useCursorSync** | `setCursors(...)` | Every cursor update from Firebase |
| **useBoardStore** | `setSelection`, `setToolMode`, `setViewport` | Clicks, tool change, pan/zoom |

**Effect:** BoardView and BoardCanvas subscribe to store + sync. Any of the above causes full tree re-renders.

### 1.2 Expensive work on each re-render

- **BoardCanvas**
  - `allObjects = Object.values(objects)` → new array every time
  - `backObjects` / `frontObjects` → new arrays and filters every time
  - `selectionBounds` → inline IIFE over selected objects when `isMultiSelect`
  - Two large `.map()` loops (back + front) creating new `<Group>` and handlers every time
  - Inline handlers: `onMouseEnter={() => setHoveredObjectId(obj.id)}` etc. → new function refs every render
- **GridLayer**
  - `useGridLines()` builds ~320 line descriptors every time the component renders (no memoization)
- **No memoization**
  - No `React.memo` on BoardObject, StickyNote, TextElement, Rectangle, Circle, ImageObject, ConnectionLine
  - Every parent re-render re-renders all children

### 1.3 Event handling

- **Pan:** `handleStageMouseMove` calls `setViewport({ x: viewport.x + dx, y: viewport.y + dy })` on every mouse move → store update → full re-render every frame while dragging.
- **Wheel:** Same for zoom: every wheel event updates viewport and re-renders the whole tree.
- Callbacks are wrapped in `useCallback` but depend on `viewport`, so they are recreated when viewport changes (expected). The main cost is the re-renders triggered by viewport updates, not the callback identity.

### 1.4 Firebase subscription strategy

- **useBoardSync:** Single `onValue` on `objects` and `connections`. Any change replaces entire `objects` / `connections` state.
- **useCursorSync:** Single `onValue` on `cursors`; cursor updates can be frequent.
- No per-object or shallow comparison; any write from any client triggers full state replace and full re-render of all consumers.

---

## 2. Code Structure Analysis

### 2.1 Dependency chains

```
BoardView
  ├── useBoardSync(objects, connections) ──► any Firebase write re-renders
  ├── useBoardStore(viewport, selectedIds, toolMode) ──► any store change re-renders
  ├── useCursorSync(cursors) ──► cursor updates re-render
  └── BoardCanvas (same deps + selectionRect, hoveredObjectId, etc.)
        └── backObjects.map / frontObjects.map
              └── BoardObject (no memo) ──► StickyNote | TextElement | etc.
```

### 2.2 Opportunities

- **Component memoization:** BoardObject and each object type (StickyNote, TextElement, etc.) only need to re-render when their `obj`, `isSelected`, `showSelectionBorder`, `remoteSelectedBy`, `zoomScale` change. Wrapping in `React.memo` with a custom comparator (e.g. by `obj.id` and relevant fields) avoids re-renders when a sibling or unrelated state changes.
- **Stable lists:** `useMemo` for `allObjects`, `backObjects`, `frontObjects` (deps: `objects`). Prevents new array references when only viewport or selection changed.
- **Stable callbacks for map:** Either a small wrapper component per object that receives `obj` and uses stable handlers from context/refs, or pass a single handler that reads `obj.id` from event/ref to avoid creating one function per object per render.
- **GridLayer:** Memoize the result of `useGridLines()` (e.g. `useMemo` with empty deps) so the 320-line array is built once.
- **Viewport during pan/zoom:** Throttle or batch updates (e.g. `requestAnimationFrame`, or update a ref during pan and only call `setViewport` on mouseup / on a raf throttle) to reduce re-renders during continuous pan/scroll.

### 2.3 Potential anti-patterns

- Inline object creation in render: `obj={{ ...obj, x: 0, y: 0 }}` creates a new object every time; with memo, parent still re-renders and may pass new props. Memoizing the transformed `obj` per id (e.g. in parent with useMemo) or having the child accept `obj` and `offset` separately can help.
- Store subscriptions: BoardCanvas uses `useBoardStore()` for multiple values; any change to any of them re-renders. Selective subscriptions (e.g. separate selectors) could reduce re-renders if we split store or use selectors.

---

## 3. Optimization Recommendations (prioritized)

1. **Memoize object components**  
   Wrap `BoardObject`, `StickyNote`, `TextElement`, `Rectangle`, `Circle`, `ImageObject`, `ConnectionLine` in `React.memo`. Use a custom compare for `BoardObject` that compares `obj.id`, `obj` (or key fields), `isSelected`, `showSelectionBorder`, `remoteSelectedBy`, `zoomScale` so objects that didn’t change don’t re-render when viewport or another object changes.

2. **Stabilize derived lists in BoardCanvas**  
   `useMemo` for `allObjects`, `backObjects`, `frontObjects` (deps: `objects`). Optionally `useMemo` for `selectionBounds` (deps: `selectedIds`, `objects`).

3. **Memoize GridLayer lines**  
   In `GridLayer`, compute the lines array in `useMemo(() => { ... }, [])` so it’s not recreated on every render.

4. **Throttle viewport updates during pan**  
   In `useBoardViewport`, during `handleStageMouseMove`, update a ref with the latest position and apply to the store at most once per frame (e.g. `requestAnimationFrame`) or apply only on pan end. Reduces re-renders from dozens per second to a capped rate or a single update at the end.

5. **Optional: throttle or batch wheel (zoom)**  
   Similarly, consider raf-throttling `setViewport` in `handleWheel` so rapid scroll doesn’t trigger a re-render per wheel event.

6. **Optional: Firebase / cursor**  
   For cursors, consider throttling or batching `setCursors` on the client (e.g. merge updates in a ref and flush on raf). For objects/connections, moving to more granular updates (e.g. per-object listeners or shallow merge) is a larger change; memoization and stable lists already limit who re-renders when `objects` is replaced.

---

## 4. Refactoring Suggestions (code quality)

- **Readability:** Keep a single responsibility per component; BoardCanvas is large — consider extracting “object layer” (back + front maps) into a component that receives `objects`, `selectedIds`, and stable callbacks.
- **Declarative handlers:** Prefer named handlers (e.g. `handleObjectClick`) over inline lambdas in JSX where it improves clarity; useCallback already used in many places.
- **React + Konva:** Keep Konva nodes in a single Layer where possible; avoid unnecessary Layer nesting. Already using one main Layer for objects.
- **Firebase + React:** Keep `onValue` at the board/connections level; ensure unsubscribe in useEffect cleanup (already done). For future, consider one listener per object only if board scale demands it.

---

## 5. Continuous Improvement Cycle

- **Profile:** Use Chrome DevTools Performance (and the 7s scroll recording) to confirm JS heap and long tasks decrease after memoization and viewport throttling.
- **Analyze:** After each change, re-profile and compare flame charts and heap.
- **Refactor:** Apply one recommendation at a time (e.g. memo first, then lists, then viewport).
- **Validate:** Re-run tests and manual checks (selection, pan, zoom, multi-user, Firebase updates).

---

## 6. Applied Optimizations (Summary)

- **BoardObject:** Wrapped in `React.memo` with custom `areEqual` comparing `obj.id`, selection-related props, and shape/content fields (including `selectedBy` / `selectedByName` for remote selection). Reduces re-renders of object components when only viewport or unrelated state changes.
- **Derived lists in BoardCanvas:** `allObjects`, `backObjects`, `frontObjects`, and `selectionBounds` are now computed in `useMemo` with appropriate dependencies (`objects`, `selectedIds`). Avoids new array/object references on every render when only viewport or hover changes.
- **GridLayer:** Grid line array is computed once at module load (`GRID_LINES` constant) instead of on every render. Removes repeated allocation of ~320 line descriptors during pan/zoom.
- **Viewport during pan:** `handleStageMouseMove` in `useBoardViewport` batches viewport updates with `requestAnimationFrame` and accumulates deltas in a ref. At most one `setViewport` per frame while panning; pending update is flushed on mouseup. Reduces re-renders from every mouse move to at most ~60/sec and avoids redundant updates.

---

## 7. Recommendation Philosophy

- Prioritize **readability** and **maintainability**; avoid over-optimizing with complex caching unless profiling shows a need.
- **Balance** performance with clarity: e.g. `React.memo` and `useMemo` are low-cost and high-impact; per-object Firebase listeners are higher complexity.
- Use this doc as a **living checklist** and update “Applied” notes as recommendations are implemented.
