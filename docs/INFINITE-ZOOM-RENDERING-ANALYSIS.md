# Infinite Zoom Rendering — Analysis & Strategy

**Scope:** React + Konva collaborative board; viewport-relative scaling, text visibility, performance after refactor.

---

## 1. Current Zoom Scaling Mechanism

### 1.1 Viewport Model

- **Store (Zustand):** `viewport: { x, y, scale }`. No min/max on `scale`; effectively infinite zoom in/out.
- **Stage (Konva):**
  ```tsx
  <Stage
    scaleX={viewport.scale}
    scaleY={viewport.scale}
    x={viewport.x}
    y={viewport.y}
  />
  ```
  All children are in **world coordinates**. The stage applies a uniform scale and translation; canvas pixels = `(world * scale) + (x, y)`.

### 1.2 Zoom Input (Wheel)

- **Location:** `useBoardViewport.ts` → `handleWheel`.
- **Formula:** Linear multiplicative:
  ```ts
  scaleBy = 1 + |deltaY| * ZOOM_SENSITIVITY  // 0.001
  newScale = deltaY > 0 ? viewport.scale / scaleBy : viewport.scale * scaleBy
  ```
- **Zoom-to-cursor:** Mouse point is preserved in world space (correct).
- **No throttling:** Every wheel event calls `setViewport` → full tree re-render (mitigated by RAF-batched pan but not wheel).

### 1.3 Pan

- **Batched:** Deltas accumulated in a ref; `requestAnimationFrame` applies at most one `setViewport` per frame. Prevents re-render storm while dragging.

---

## 2. Text Rendering Strategy (Current)

### 2.1 Pipeline

1. **World-space fit:** `computeAutoFitFontSize(text, obj.width, obj.height)` returns `fontSize` and `padding` in world units so that wrapped text fits the box.
2. **Minimum screen clamp (StickyNote / TextElement):**
   ```ts
   minWorldFont = MIN_READABLE_TEXT_SCREEN_PX / zoomScale   // 8 / scale
   displayFontSize = Math.max(fontSize, minWorldFont)
   ```
   So when the stage scales by `zoomScale`, the rendered text is at least 8 px on screen when zoomed out.
3. **Wrapping & layout:** `getWrappedLines(displayText, availW, displayFontSize)`; then `visibleLines = wrappedLines.slice(0, maxLinesThatFit)` with line height from `displayFontSize`.
4. **Render:** Konva `<Text>` with `fontSize={displayFontSize}` in world units; the Stage scale then converts to screen.

### 2.2 Implications

- **Zoomed in:** Layout is stable (world-space fit); text fits the box.
- **Zoomed out:** Text never goes below 8 px (readable) but can overflow the box (fewer lines shown; clip hides overflow).
- **Constraint:** `MIN_READABLE_TEXT_SCREEN_PX` is a hard minimum; removing it would allow text to scale down with zoom (readable only when zoomed in).

---

## 3. Performance Impact of Scaling Logic

### 3.1 Re-renders

- **Wheel:** Each event updates `viewport.scale` (and x/y). Every subscribed component re-renders (BoardCanvas, BoardView, etc.).
- **BoardObject memo:** `areEqual` includes `zoomScale`. So when scale changes, **every** object is considered changed → all StickyNotes/TextElements re-render. Intentional so that `displayFontSize = max(fontSize, 8/scale)` updates.
- **Cost:** With N objects, each zoom step does O(N) text components re-rendering (layout + Konva draw). No virtualization; all objects are in the tree.

### 3.2 Work Per Object (StickyNote / TextElement)

- `computeAutoFitFontSize`: iterative (up to 15 steps), each step calls `getWrappedLines`. Proportional to text length and box size.
- Then one `getWrappedLines` for `displayFontSize`.
- No caching; recomputed every time the component renders (when scale or content changes).

### 3.3 After Recent Refactor

- **Pan:** RAF batching greatly reduces re-renders during drag.
- **Lists:** `allObjects`, `backObjects`, `frontObjects`, `selectionBounds` are memoized; no unnecessary new references when only viewport changes.
- **GridLayer:** Lines are a constant; no per-render allocation.
- **Remaining hotspot:** Wheel still triggers one full tree update per event; object count and text layout cost dominate.

---

## 4. Viewport Interaction with Object Sizes

### 4.1 Object Dimensions

- All object dimensions are in **world units** (from Firebase: `width`, `height`, `x`, `y`).
- No viewport-relative sizing for the shapes themselves; only text uses viewport (via `zoomScale`) for the minimum readable clamp.

### 4.2 Resize Handles

- **Minimum size:** `minSize = 20 / viewport.scale` (world units). So in screen space the smallest dimension is 20 px. This avoids invisible or unusable tiny shapes when zoomed in.
- **Removal:** If you “eliminate minimum size constraints,” you could use `minSize = 0` or a very small constant in world units; then objects can be resized arbitrarily small (may disappear when zoomed out).

### 4.3 TextEditingOverlay

- Overlay uses **screen space:** `screenW = obj.width * scale`, `screenH = obj.height * scale`. Font and textarea are sized to fit that screen rect.
- **Close condition:** If `sw < 1 || sh < 1` (object smaller than 1 screen px), overlay closes. So at extreme zoom-out, editing closes; no minimum object size for editing.

---

## 5. Minimum Size Constraint Removal

### 5.1 Current Constraints

| Location | Constraint | Purpose |
|----------|------------|--------|
| `MIN_READABLE_TEXT_SCREEN_PX` (8) | Minimum text size in screen px | Readability when zoomed out |
| `computeAutoFitFontSize` | `minFont = minDim * 0.04` | Avoid zero font in world units |
| Resize (BoardCanvas) | `minSize = 20 / viewport.scale` | 20 px minimum in screen space |
| TextEditingOverlay | Close if `sw < 1 || sh < 1` | Don’t edit when object is sub-pixel |
| StickyNote/TextElement | `showText` when `w >= 1 && h >= 1` | Don’t draw text for degenerate box |

### 5.2 Removing or Softening Them

- **Text minimum (viewport-relative):** Set `MIN_READABLE_TEXT_SCREEN_PX = 0` to allow text to scale with zoom (no floor). Text can become unreadable when zoomed out; zoom in to read.
- **Resize minimum:** Use `minSize = 0` or a tiny world-unit constant so objects can be resized to any size.
- **Fit minimum:** Keep a small `minFont` in `computeAutoFitFontSize` to avoid numerical issues (e.g. `minDim * 0.04` or `Math.max(minFont, 0.5)`); this is for stability, not UX.
- **Overlay close:** Keeping `sw < 1 || sh < 1` is reasonable so the overlay doesn’t open for invisible objects.

---

## 6. Recommended Approach

### 6.1 Viewport-Relative Scaling (Text)

**Goal:** Text readable across zoom levels without a hard pixel floor; optional soft minimum.

**Option A — No minimum (pure world-space):**  
Use only the world-space fit: `displayFontSize = fontSize` (remove the `max(fontSize, minWorldFont)`). Text scales exactly with the stage; disappears when zoomed out.

**Option B — Configurable minimum (current, tunable):**  
Keep `displayFontSize = Math.max(fontSize, MIN_READABLE_TEXT_SCREEN_PX / scale)` but allow `MIN_READABLE_TEXT_SCREEN_PX = 0` to disable the floor.

**Option C — Logarithmic soft minimum:**  
Use a soft curve so that at very low zoom text doesn’t collapse to zero but doesn’t stay at a hard 8 px either:

```ts
// Example: soft minimum that tapers with scale
const worldFontFromFit = fontSize;
const minScreenPx = 4; // soft target
const minWorld = minScreenPx / scale;
// Blend: at scale 0.1 use ~minWorld, at scale 1 use worldFontFromFit
const logScale = Math.log1p(scale);
const displayFontSize = Math.max(
  worldFontFromFit,
  minWorld * Math.min(1, 1 - logScale / Math.log1p(1))
);
```

Simpler variant: keep current formula but reduce `MIN_READABLE_TEXT_SCREEN_PX` (e.g. 4) so text can shrink more when zoomed out while still staying slightly visible.

### 6.2 Logarithmic Zoom (Optional)

**Goal:** Smoother feel at very high and very low scale; fewer huge jumps per wheel tick.

**Idea:** Store scale in a “zoom level” and derive scale from it, e.g. `scale = base ** level` (exponential) so equal wheel deltas produce equal multiplicative steps.

```ts
// useBoardViewport or store
const ZOOM_BASE = 1.2;
const MIN_LEVEL = -20;
const MAX_LEVEL = 40;

// Store zoomLevel instead of raw scale, or derive scale from level:
const scale = Math.pow(ZOOM_BASE, zoomLevel);
// On wheel: zoomLevel += deltaY > 0 ? -1 : 1; clamp to [MIN_LEVEL, MAX_LEVEL]
```

You can still preserve zoom-to-cursor by converting the current viewport to a level, adjusting the level, then recomputing scale and the new x/y so the same world point stays under the cursor.

### 6.3 Adaptive Padding and Sizing

- **Padding:** Already adaptive in `computeAutoFitFontSize`: `padding = f(minDim)` (between 2% and 6% of min dimension, cap 50%). No change needed unless you want padding to also depend on zoom (e.g. slightly more padding when zoomed out for touch targets).
- **Stroke / hit areas:** Already viewport-relative: `strokeWidth = 2 / zoomScale`, `cornerRadius = 2 / zoomScale`. Good for infinite zoom.

### 6.4 Efficient Zoom Event Handling

- **Throttle wheel:** Schedule at most one viewport update per frame during wheel (e.g. ref + `requestAnimationFrame`), similar to pan. Accumulate the “target” scale and position from the latest wheel event and apply once per frame.
- **Optional:** Debounce or throttle rapid wheel so that after wheel stops you do one final “snap” update. Reduces re-renders during a long scroll.

---

## 7. Implementable Code Snippets

### 7.1 Configurable Minimum Text Size (Remove or Tune)

**File:** `src/lib/constants.ts`

```ts
/** Minimum text size in screen pixels (0 = no minimum, text scales with zoom). */
export const MIN_READABLE_TEXT_SCREEN_PX = 8;
```

**File:** `StickyNote.tsx` / `TextElement.tsx`

```tsx
const displayFontSize =
  MIN_READABLE_TEXT_SCREEN_PX <= 0
    ? fontSize
    : Math.max(fontSize, MIN_READABLE_TEXT_SCREEN_PX / scale);
```

So setting the constant to `0` removes the minimum.

### 7.2 Throttle Wheel Updates (RAF)

**File:** `useBoardViewport.ts`

```ts
const pendingWheel = useRef<{ newScale: number; newPos: { x: number; y: number } } | null>(null);
const wheelRafId = useRef<number | null>(null);

const flushWheelUpdate = useCallback(() => {
  wheelRafId.current = null;
  const p = pendingWheel.current;
  if (!p) return;
  pendingWheel.current = null;
  setViewport({ x: p.newPos.x, y: p.newPos.y, scale: p.newScale });
}, [setViewport]);

const handleWheel = useCallback(
  (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const scaleBy = 1 + Math.abs(e.evt.deltaY) * ZOOM_SENSITIVITY;
    const newScale = e.evt.deltaY > 0 ? viewport.scale / scaleBy : viewport.scale * scaleBy;
    const mousePointTo = {
      x: (e.evt.clientX - rect.left - viewport.x) / viewport.scale,
      y: (e.evt.clientY - rect.top - viewport.y) / viewport.scale,
    };
    const newPos = {
      x: e.evt.clientX - rect.left - mousePointTo.x * newScale,
      y: e.evt.clientY - rect.top - mousePointTo.y * newScale,
    };
    pendingWheel.current = { newScale, newPos };
    if (wheelRafId.current === null) {
      wheelRafId.current = requestAnimationFrame(flushWheelUpdate);
    }
  },
  [viewport, setViewport, containerRef, flushWheelUpdate]
);
```

(And clear `wheelRafId` on unmount / cancel in flush if needed.)

### 7.3 Resize: Remove Minimum Size (Optional)

**File:** `BoardCanvas.tsx` (in `handleResizeMove`)

```ts
// const minSize = 20 / viewport.scale;
const minSize = 0; // or a small world-unit constant, e.g. 1
```

---

## 8. Performance Benchmarking Insights

- **Measure:** Chrome DevTools Performance; record while zooming (wheel) and while panning. Compare:
  - Scripting time per frame
  - Layout/Paint time
  - JS heap (avoid growth over many zoom cycles)
- **What to expect:**
  - Wheel throttling (RAF) should reduce re-renders per second during continuous scroll.
  - With memo, only viewport-related props change on zoom; all objects still re-render because `zoomScale` changes. To avoid that you’d need to not pass `zoomScale` into memoized props and instead read scale from a ref or context that doesn’t trigger re-render—but then text wouldn’t update the minimum size. So some re-render on zoom is required for current behavior.
- **If object count is very high:** Consider virtualizing by viewport (only render objects whose world rect intersects the visible viewport). That’s a larger change and not required for “infinite zoom” itself.

---

## 9. Zoom Interaction Improvement Summary

| Area | Current | Recommendation |
|------|---------|-----------------|
| Text visibility | Min 8 px screen floor | Make configurable (0 = no floor) or use soft/log curve |
| Minimum size constraints | Resize 20 px, text 8 px | Optional: set resize min to 0; keep or reduce text min |
| Zoom input | Linear, no throttle | RAF-throttle wheel like pan |
| Scale curve | Linear multiplicative | Optional: logarithmic (zoom level) for smoother extremes |
| Performance | Memo + batched pan | Add wheel throttle; keep memo and list memoization |
| Viewport-relative | Stroke, corners, text min | Already in place; extend only if you add more UI in world space |

---

## 10. Compatibility

- **Firebase:** No change; all dimensions remain in world units in the database.
- **React:** Throttling and optional logarithmic scale are in the viewport hook and store; component props stay the same.
- **Konva:** Stage still receives `scaleX`, `scaleY`, `x`, `y`; no API change.

Applying the configurable text minimum (and optionally wheel throttle and resize min removal) gives you a clear path to “no minimum constraints” and better zoom performance while keeping the rest of the stack unchanged.
