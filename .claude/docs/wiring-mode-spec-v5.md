# Feature: Wiring Mode

## Summary

**Replace** the existing connection/arrow system with **Wiring Mode** — a new interaction mode where objects on the canvas are wired together as data pipelines. Every object becomes prompt-aware. Connections aren't decorative arrows anymore — they're numbered data wires. Prompts use **natural language references** wrapped in curly braces that become interactive inline pills with node assignments.

This replaces: the current connector tool, `ConnectionLine` rendering, and the freeform arrow system. Wiring Mode is the single way objects connect to each other.

---

## Core Concepts

### Every object has 8 numbered nodes (1–8)

These are the existing anchor points, repurposed. Each node on an object can be either:
- **Data In** — receives data from another object's Data Out node
- **Data Out** — sends data to another object's Data In node

A wire connects one object's node to another object's node. The wire has a direction: FROM a Data Out node TO a Data In node.

### Natural language pill syntax

When editing any object, you type natural language and **wrap data references in curly braces**. The system auto-converts them into interactive pills:

**What the user types:**
```
Show me the {weather} for {location} and recommend {outfit}
```

**What it becomes (in the editor):**
```
Show me the [☁️ weather :1 ▾] for [📍 location :2 ▾] and recommend [👕 outfit :3 ▾]
```

Each `{word}` becomes:
1. An **inline pill** — a colored, rounded chip displayed inline in the text
2. **Auto-assigned to the next available node** — first pill gets node 1, second gets node 2, etc.
3. **A dropdown** — clicking the pill (or the `▾`) opens a small dropdown where you can:
   - **Change the node number** (1–8)
   - **Set direction**: Input (data comes IN from a wired object) or Output (data goes OUT to a wired object)
   - **See what's connected**: if a wire exists on this node, shows a preview of the connected object

By default:
- Pills are assigned as **Inputs** (the prompt needs this data to run)
- The user can flip any pill to **Output** via the dropdown (the prompt produces this data and sends it out)

**Example with mixed in/out:**
```
Look up the current price of [📈 ticker :1 ▾ IN] and write a 
[📝 summary :3 ▾ OUT] with a [💡 recommendation :5 ▾ OUT]
```

Here, `ticker` on node 1 is an input (pulled from a wired source), while `summary` on node 3 and `recommendation` on node 5 are outputs (pushed to wired targets).

### Any object can be a prompt

No special object type needed. ANY existing object (sticky note, text element, frame) becomes a prompt node the moment its text contains `{curly brace}` references. A sticky note that says "Meeting Notes" is static. A sticky note that says `Summarize the {article}` is a prompt node.

### Wiring Mode is a tool mode

Just like Select mode, Sticky Note mode, Shape mode — **Wiring Mode** is a canvas interaction mode (hotkey `W`). When active, nodes become interactive and you click node-to-node to create wires.

---

## Pill Syntax Deep Dive

### Creation flow

1. User is editing an object's text (double-click to enter edit mode).
2. User types `{weather}` — the moment they close the curly brace, the text transforms into an inline pill.
3. The pill displays: the label ("weather"), the auto-assigned node number, a direction indicator (IN/OUT), and a dropdown arrow.
4. User can click the pill to open the dropdown and change settings.

### Pill dropdown menu

When you click a pill, a small popover/dropdown appears:

```
┌──────────────────────────────┐
│  "weather"                   │
│                              │
│  Node:  [1] [2] [3] [4]     │  ← click to reassign node number
│         [5] [6] [7] [8]     │    (occupied nodes greyed out)
│                              │
│  Direction:                  │
│    ● Input (receives data)   │  ← radio toggle
│    ○ Output (sends data)     │
│                              │
│  Connected to:               │
│    → "Weather API sticky"    │  ← shows wired object (if any)
│      (click to select)       │    or "Not wired" with a hint
│                              │
│  [Rename] [Remove]           │  ← rename the label, or delete pill
└──────────────────────────────┘
```

### Pill visual states

| State | Appearance |
|---|---|
| Input pill (idle) | Blue-ish background, label + `:N` + `▾`, solid border |
| Input pill (wired) | Blue-ish background, slightly brighter, small dot indicator showing it's connected |
| Output pill (idle) | Orange-ish background, label + `:N` + `▾`, solid border |
| Output pill (wired) | Orange-ish background, slightly brighter, connected dot |
| Input pill (data received) | Brief green flash/pulse when data arrives |
| Output pill (data sent) | Brief green flash/pulse when data is dispatched |
| Pill (node conflict) | Red border — two pills assigned to the same node number |

### Pill rendering in display mode vs edit mode

**Edit mode (double-click):**
- Pills are fully interactive — show label, node number, dropdown arrow
- Clicking opens the dropdown
- You can type new `{words}` to create more pills
- Full node map and settings visible below

**Display mode (normal canvas view):**
- Pills are NOT shown. The object displays the **prompt output** (LLM result) as clean text.
- A subtle ⚡ icon and schedule badge in the footer indicate it's a prompt node.
- The raw prompt template with pills is only visible in edit mode.

---

## Data Model

### Pill storage format

In the object's data, pills are stored as part of the `promptTemplate` string using a simple token format, plus a separate metadata array:

```typescript
interface PillRef {
  id: string;               // unique pill ID (for stable references)
  label: string;            // user-visible name ("weather", "ticker", etc.)
  node: number;             // 1–8, which anchor node this maps to
  direction: 'in' | 'out';  // input or output
}

// Example object data:
{
  promptTemplate: "Show me the {pill:p1} for {pill:p2} and recommend {pill:p3}",
  pills: [
    { id: "p1", label: "weather", node: 1, direction: "in" },
    { id: "p2", label: "location", node: 2, direction: "in" },
    { id: "p3", label: "outfit", node: 3, direction: "out" }
  ]
}
```

The `{pill:ID}` tokens in `promptTemplate` are placeholders that the editor renders as interactive pills. At LLM execution time, input pills get replaced with the actual data from wired objects, and output pills tell the system where to route results.

### Wire (replaces Connection)

```typescript
interface Wire {
  id: string;
  fromObjectId: string;       // source object
  fromNode: number;           // 1–8
  toObjectId: string;         // target object
  toNode: number;             // 1–8
  color?: string;
  createdBy: string;
  createdAt: number;
}
```

### Updated BaseObject

```typescript
interface BaseObject {
  // ... existing fields (id, type, x, y, width, height, text, color, etc.)
  
  // Prompt fields
  promptTemplate?: string;      // text with {pill:ID} tokens
  pills?: PillRef[];            // pill metadata
  promptOutput?: string;        // last LLM result (shown in display mode)
  schedule?: '15min' | '1hr' | '6hr' | 'daily' | 'onLogin' | null;
  enabled?: boolean;
  lastRunAt?: number | null;
  lastRunStatus?: 'success' | 'error' | 'running' | null;
  lastRunError?: string | null;
}
```

### Firebase paths

- `boards/${boardId}/wires/${wireId}` — replaces `connections`
- `boards/${boardId}/objects/${objectId}` — same path, new optional fields
- `automationSchedules/${boardId}/${objectId}` — scheduler index

---

## Visual Design

### Display Mode (normal canvas view)

**Static objects**: Unchanged from today.

**Prompt nodes** (objects with pills): Show the `promptOutput` as main content. Subtle footer:
```
┌─────────────────────────────┐
│  Partly cloudy, 72°F.       │  ← promptOutput
│  Light jacket recommended.  │
│                             │
│  ⚡ ⏱ 1hr     ran 12m ago  │  ← footer
└─────────────────────────────┘
```

Visual cues:
- ⚡ icon (bottom-left) — this is a prompt node
- Schedule badge: `⏱ 1hr` (if scheduled)
- Last run: `ran 12m ago` (faint text)
- Left-edge accent stripe or dashed border to differentiate from static objects
- Status dot: green (success), red (error), grey (never run), pulsing blue (running)
- Connected nodes show as slightly larger/filled dots on the object edges

### Edit Mode (double-click)

```
┌─────────────────────────────────────────────────────┐
│  ✏️ EDIT                                             │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ Show me the [☁️ weather :1 ▾] for              │  │
│  │ [📍 location :2 ▾] and recommend               │  │
│  │ [👕 outfit :3 ▾]                               │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Tip: Type {word} to create a data reference         │
│                                                      │
│  ── Wiring ────────────────────────────────────────  │
│                                                      │
│  IN:                                                 │
│   :1 weather   ← "NYC" (Sticky #a3f)                │
│   :2 location  ← (not wired)                        │
│                                                      │
│  OUT:                                                │
│   :3 outfit    → "Outfit Card" (Sticky #d2e)         │
│                                                      │
│  ── Schedule ──────────────────────────────────────  │
│                                                      │
│  [None] [15m] [1hr] [6hr] [Daily] [On Login]        │
│  Enabled: [✓]                                        │
│  ┌──────────┐                                        │
│  │ ▶ Run Now │  Last: 12m ago ✓                      │
│  └──────────┘                                        │
│                                                      │
│  ── Last Output ─────────────────────── [collapse ▾] │
│  "Partly cloudy, 72°F. Light jacket recommended."    │
│                                                      │
└─────────────────────────────────────────────────────┘
```

Key features:
1. **Inline pills** in the textarea — rendered as colored chips. Typing `{` starts pill creation; closing `}` completes it and auto-assigns the next free node.
2. **Pill dropdown** — click any pill to change node, direction, rename, or remove.
3. **Wiring summary** — grouped by IN/OUT, shows each pill's label, node number, and what's connected.
4. **Schedule controls** — segmented control, enabled toggle, Run Now, last status.
5. **Last Output** — collapsible preview of `promptOutput`.
6. **Hint text** — "Type {word} to create a data reference" shown when the template has no pills yet.

### Wiring Mode (hotkey `W`)

When active, all objects show their 8 nodes with floating labels:

- **Nodes with pills**: Show the pill label + node number. E.g., `weather :1` in blue (input), `outfit :3` in orange (output).
- **Nodes with wires but no pill on THIS object**: Show just the node number + direction based on the wire.
- **Unused nodes**: Small grey dots with just the number.

Interaction:
1. Press `W` → all nodes appear with labels
2. Click a node (source/out) → wire starts following cursor
3. Click a node on another object (target/in) → wire created
4. Wires render as smooth colored bezier curves with directional arrowheads

### Wire visuals

- Auto-assigned colors from a palette (8–10 muted distinct colors)
- Smooth bezier curves, arrowhead at target
- Hover highlight, click to select for deletion
- **Running animation**: traveling dots along the wire when data flows
- **On update**: target object briefly flashes when its text updates

### Prompt node visual differentiation

| State | Border | Footer | Nodes |
|---|---|---|---|
| Static object | Normal solid | None | Dots on hover only |
| Prompt node (idle) | Dashed or left-accent | ⚡ + schedule + last run | Connected nodes visible |
| Prompt node (running) | Pulsing glow | Spinner + "running..." | Active nodes pulse |
| Prompt node (error) | Red accent | ⚡ + red dot + error | Normal |
| Any object (Wiring Mode) | Normal | Normal | All 8 with labels |

---

## Prompt Resolution Logic

When an object is triggered (manually, by schedule, or by receiving data from a wire):

### 1. Detect if it's a prompt node
- Check if `pills` array exists and has entries, or if `promptTemplate` contains `{pill:}` tokens.
- If not a prompt node and it receives data via wire → just update its `text`/`promptOutput` with the raw incoming data.

### 2. Resolve inputs
- For each pill with `direction === 'in'`:
  - Find wire where `toObjectId === thisObject.id` AND `toNode === pill.node`
  - Load the source object's `promptOutput` (if prompt node) or `text` (if static)
  - Replace `{pill:ID}` in the template with the resolved data

### 3. Build the LLM prompt
- Take the resolved template (all input pills replaced with actual data)
- Strip out `{pill:ID}` tokens for output pills — instead, append instructions telling the LLM how to structure its response for multiple outputs:
  ```
  [If 1 output pill]: Respond with the content for "{label}".
  [If 2+ output pills]: Structure your response as:
  ---{label1}---
  (content for {label1})
  ---{label2}---
  (content for {label2})
  ```

### 4. Call LLM (cheap model)
- Model priority:
  1. Groq `llama-3.1-8b-instant`
  2. Groq `llama-3.3-70b-versatile`
  3. OpenAI `gpt-4o-mini`
- System prompt:
  ```
  You are a data processing node on a collaborative whiteboard.
  Execute the instruction exactly. Be concise — output is displayed on whiteboard objects.
  No preamble or explanation unless asked.
  ```

### 5. Route outputs
- Parse LLM response by `---{label}---` delimiters (if multiple outputs)
- For each output pill:
  - Find wire where `fromObjectId === thisObject.id` AND `fromNode === pill.node`
  - Write the corresponding output section to the target object's `promptOutput` (or `text` if static)
  - If target is also a prompt node → trigger it (cascade, depth limit 10, cycle detection)
- If no output pills: store entire response as this object's `promptOutput`

### 6. Update metadata
- `lastRunAt`, `lastRunStatus`, `promptOutput`, clear `lastRunError` on success

---

## Frontend Implementation

### 1. Pill Editor Component

Create `src/features/board/components/PillEditor.tsx` — a rich text input that:
- Detects `{` keypress → enters "pill creation mode"
- On `}` keypress → creates a pill from the text between braces
- Renders pills as inline `<span>` chips (not raw text)
- Each pill chip is clickable → opens the dropdown popover
- Supports: backspace to delete a pill, arrow keys to navigate around pills, typing between pills
- This is the most complex new UI component. Consider using a contenteditable div with custom rendering, or a library like Slate.js / TipTap for rich inline elements.

### 2. Pill Dropdown Component

Create `src/features/board/components/PillDropdown.tsx` — the popover that opens when clicking a pill:
- Node selector (1–8 grid, occupied nodes greyed out)
- Direction toggle (Input / Output)
- Connected object preview
- Rename / Remove actions

### 3. Wiring Mode tool

- Replace `connector` with `wiring` in `ToolMode` in Zustand store
- Hotkey `W`
- When active: render `NodeLabels` on all objects, enable node click interactions

### 4. `WireLine.tsx` — replaces `ConnectionLine.tsx`

- Bezier curves, color-coded, directional arrows
- Hover highlight, selection for deletion
- Data flow animation

### 5. `NodeLabels.tsx`

- Floating labels on each object's anchor points
- Shows pill label + node number for occupied nodes
- Blue (in) / orange (out) / grey (unused) coloring
- Visible in Wiring Mode and when object is in edit mode

### 6. Object component updates

All object renderers (`StickyNote.tsx`, `TextElement.tsx`, `Frame.tsx`, etc.):
- Display `promptOutput` when present (display mode)
- Show ⚡ footer with schedule/status (display mode)
- Left-accent stripe or dashed border for prompt nodes
- Status dot

### 7. `TextEditingOverlay.tsx` updates

- Replace simple textarea with `PillEditor` when the object has pills or when user types `{`
- Add Wiring summary section
- Add Schedule controls section
- Add Last Output collapsible section

---

## Backend Changes

### 1. `functions/src/promptRunner.ts`

```typescript
export async function runPromptNode(
  boardId: string,
  objectId: string,
  depth: number = 0,
  visited: Set<string> = new Set()
): Promise<void> {
  if (depth > 10) throw new Error('Max cascade depth exceeded');
  if (visited.has(objectId)) throw new Error('Cycle detected');
  visited.add(objectId);

  // 1. Load object + its pills
  // 2. Load all wires for this object
  // 3. For each input pill: resolve data from wired source
  // 4. Build resolved prompt (replace input pill tokens with data)
  // 5. Append output routing instructions if multiple output pills
  // 6. Call cheap LLM
  // 7. Parse response, route to output pill targets
  // 8. Cascade: if target is prompt node, call runPromptNode(target, depth+1, visited)
  // 9. Update metadata
}
```

### 2. `POST /api/prompt/run` endpoint

### 3. `functions/src/promptScheduler.ts` — cron every 15 min

### 4. Model selection (cheapest available)

```typescript
function getCheapModel(): { provider: 'groq' | 'openai'; model: string } {
  if (process.env.GROQ_API_KEY) {
    return { provider: 'groq', model: 'llama-3.1-8b-instant' };
  }
  return { provider: 'openai', model: 'gpt-4o-mini' };
}
```

---

## File Checklist

### Delete:
- `src/features/board/components/ConnectionLine.tsx`
- Connector tool code in Toolbar

### New files:
- `src/features/board/components/PillEditor.tsx` — rich text input with inline pills
- `src/features/board/components/PillDropdown.tsx` — pill config popover
- `src/features/board/components/WireLine.tsx` — wire rendering
- `src/features/board/components/NodeLabels.tsx` — floating node labels
- `functions/src/promptRunner.ts` — prompt execution
- `functions/src/promptScheduler.ts` — cron scheduler

### Modified files:
- `src/types/board.ts` — remove `Connection`, add `Wire`, `PillRef`, prompt fields on `BaseObject`
- `src/features/board/BoardCanvas.tsx` — render WireLine, NodeLabels
- `src/features/board/components/BoardObject.tsx` — prompt indicators, display promptOutput
- `src/features/board/components/objects/StickyNote.tsx` — promptOutput display, footer
- `src/features/board/components/objects/TextElement.tsx` — same
- `src/features/board/components/objects/Frame.tsx` — same
- `src/features/board/Toolbar.tsx` — replace connector with Wiring Mode
- `src/lib/store.ts` — replace `connector` with `wiring`
- `src/features/board/utils/boardActions.ts` — wire CRUD, remove connection CRUD
- `src/features/board/utils/anchorPoint.ts` — node label positions
- `src/features/sync/useBoardSync.ts` — sync `wires` instead of `connections`
- `src/components/TextEditingOverlay.tsx` — integrate PillEditor, add wiring/schedule/output sections
- `src/App.tsx` — on-login trigger
- `functions/src/index.ts` — export new functions
- `database.rules.json` — rules for `wires/`, `automationSchedules/`

### Implementation order:
1. **Types** — `Wire`, `PillRef`, prompt fields on `BaseObject`
2. **PillEditor** — the rich text input with inline pill creation (most complex UI piece)
3. **PillDropdown** — node assignment, direction toggle, connected preview
4. **Wire data model** — replace connections with wires in Firebase + sync
5. **WireLine rendering** — bezier curves, colors, arrows
6. **Wiring Mode** — toolbar, node interactions
7. **NodeLabels** — floating labels in Wiring Mode
8. **Prompt template storage** — save pills + template to Firebase
9. **Display mode** — show promptOutput, footer indicators, accent border
10. **Edit mode integration** — PillEditor in TextEditingOverlay, wiring summary, schedule controls
11. **Backend prompt runner** — `promptRunner.ts`, HTTP endpoint
12. **Manual Run** — Run Now / Ctrl+Enter / right-click
13. **Cascade execution** — output triggers downstream nodes
14. **Scheduler** — `promptScheduler.ts`
15. **On-login trigger**
16. **Data flow animation** — wire pulse, object flash
17. **Migration** — old connections → wires
18. **Tests**
