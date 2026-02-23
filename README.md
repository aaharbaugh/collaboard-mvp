# LiveWire

**Draft. Wire. Run.**

A collaborative visual workspace where sticky notes become executable. Build data flows by wiring objects together on an infinite canvas — live API calls, text transforms, and AI generation run right where you design them.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript, Vite 8 |
| **Canvas** | Konva.js / react-konva |
| **State** | Zustand 5 |
| **Auth** | Firebase Authentication (Google + Anonymous) |
| **Database** | Firebase Realtime Database |
| **Hosting** | Firebase Hosting |
| **Backend** | Firebase Cloud Functions v7 (Node 22, TypeScript) |
| **AI (agent)** | OpenAI `gpt-4o` (or Groq `llama-3.3-70b-versatile` if `GROQ_API_KEY` is set) |
| **AI (prompt engine)** | OpenAI `gpt-4o-mini` (or Groq `llama-3.3-70b-versatile` if `GROQ_API_KEY` is set) |
| **Observability** | LangSmith (optional) |
| **Testing** | Vitest (frontend), Jest + ts-jest (functions) |

---

## Features

### Authentication
- Animated sign-in screen with rain and lightning effects
- **Sign-in options:** Google OAuth or Anonymous (Firebase Auth)
- Quick-start shortcuts reference on the sign-in page

### Board Management
- Users can own and switch between **multiple boards**.
- **UserBoardsPanel** (top-left) supports: create new board (with a name), rename, duplicate, and delete boards.
- Share a board by copying its URL; collaborators join via the URL.

### Board Data Model (Firebase Realtime Database)
Each board at `boards/${boardId}` has:
- **`metadata`** — owner, name, createdAt
- **`collaborators`** — map of userId → true
- **`objects`** — map of objectId → BoardObject
- **`connections`** — map of connectionId → Connection
- **`cursors`** — map of userId → Cursor

**Object types:** `stickyNote`, `rectangle`, `circle`, `star`, `text`, `frame`, `image`

Each object has: id, type, x, y, width, height, optional color/text/rotation/imageData/headingLevel/frameId/sentToBack, createdBy, createdAt, and optional selection fields (selectedBy, selectedByName). Prompt nodes additionally have: `promptTemplate`, `pills` (input/output anchors), `promptOutput`, and optional `apiConfig`.

**Wires:** fromObjectId, fromNode, toObjectId, toNode, optional outputMode (`update`/`append`/`create`). Wires connect pill anchors between objects to form data-processing pipelines.

**Connections:** fromId, toId, fromAnchor, toAnchor, optional waypoints (flat `[x1,y1,x2,y2,...]`), color, createdBy, createdAt. Rendered as arrows with optional bent/polyline paths.

### Canvas & Tools

| Hotkey | Tool |
|--------|------|
| `1` | Pointer — cycle Select ↔ Move (pan) |
| `2` | Sticky note |
| `3` | Shape — cycle Star → Circle → Rectangle |
| `4` | Text |
| `5` | Frame |
| `6` | Toggle AI panel |
| `W` | Wire mode |

- **Select mode:** Click to select; drag empty space for multi-select. Selected objects show resize/rotation handles, a ColorPicker, and order buttons (send to back / bring to front). Delete/Backspace removes selected objects or a selected connection. Ctrl+C / Ctrl+V copies and pastes.
- **Drawing:** Click on the canvas to place an object in the current tool mode.
- **Connector tool:** Click an anchor on one object, optionally click waypoints, then click an anchor on another object to create a connection.
- **Text editing:** Double-click a sticky note or text element to edit inline. The editor shows hints for pill and API syntax.
- **Frames:** Group objects into frames; children move and resize with the frame.

### Wiring & Pills

Pills are named data ports on any sticky note. Type `{name}` inside a sticky to create one. Pills can be inputs or outputs and are visualized as colored chips on the text.

- Press `W` to enter wire mode — connect output pills to input pills across objects with bezier-curved wires
- Wires support output modes: `update` (overwrite), `append`, or `create` (spawn new stickies)

### API Lookup

Type `>>` inside a sticky note editor to open the API lookup dropdown. APIs are organized into tabs:

| Category | APIs |
|-----------|------|
| **Data** | Weather, Crypto, Currency Exchange, Timezone, IP Geolocation |
| **Reference** | Dictionary, Wikipedia, Country Info |
| **Transform** | Regex, JSON Path, Math, Case Conversion, List Operations, Split/Join, Template |
| **AI** | DALL-E 3 Image Generation |

Double-click an API heading on a sticky to swap it for a different API.

### Execution Engine

When you run a node, LiveWire:
1. Traces upstream dependencies via wires
2. Builds a directed acyclic graph of runnable nodes
3. Executes nodes in topological order, parallelizing independent nodes at the same depth
4. Routes results downstream through wires to target objects

### Real-time Collaboration
- **useBoardSync:** Subscribes to `boards/${boardId}/objects` and `.../connections` via Firebase `onValue`. Field-level diffing limits re-renders to objects that actually changed.
- **useCursorSync:** Subscribes to `.../cursors`; updates the current user's cursor (throttled) and cleans stale cursors. Other users' cursors appear as named overlays via **CursorOverlay**. **PresenceList** shows who is currently on the board.
- Selection and viewport state are local only (Zustand), never synced to Firebase.

### AI Agent
- **AgentPanel** (hotkey `6`): Type a natural-language command, e.g. `"Create a SWOT analysis"` or `"Draw a flowchart: Start → Process → Decision → End"`.
- Context passed to the agent: current **selection** (selectedIds) and/or **viewport** (x, y, scale).
- **Backend — `executeAgentCommand`** (Firebase Function, `/api/agent`):
  1. Validates the board exists.
  2. Loads **board context** via `getBoardContext`: selected objects, objects in the visible viewport, or the full board. Context is compressed (only the fields needed for layout decisions).
  3. Builds a system prompt with coordinate rules and the board's color palette.
  4. Runs an **agentic loop** (up to 5 iterations) calling OpenAI (or Groq) with tools. Tool calls are dispatched via `agentTools.ts` and results appended until the model finishes.
  5. **Template engine** (`templateEngine.ts`): For common diagram types (SWOT, flowchart, mind map, etc.) the agent can invoke structured templates that build layouts deterministically.
  6. **LangSmith** tracing (optional): traces each command, including the board context and total tool calls.
- **Agent tools:** `createStickyNote`, `createShape`, `createFrame`, `createConnector`, `createMultiPointConnector`, `connectInSequence`, `moveObject`, `resizeObject`, `updateText`, `changeColor`, `getBoardState`.

---

## Project Structure

```
collaboard-mvp/
├── src/
│   ├── App.tsx                     # AuthGate → BoardView
│   ├── features/
│   │   ├── auth/                   # AuthGate (animated sign-in), useAuth
│   │   ├── board/                  # BoardView, BoardCanvas, Toolbar
│   │   │   ├── components/         # BoardObject, ConnectionLine, UserBoardsPanel, ...
│   │   │   │   └── objects/        # StickyNote, Rectangle, Circle, Star, Frame, Text, Image
│   │   │   ├── hooks/              # useBoardId, useUserBoards
│   │   │   └── utils/              # boardActions, boardCache, anchorPoint
│   │   ├── agent/                  # AgentPanel, useAgentCommand
│   │   ├── apiLookup/              # ApiLookupDropdown, apiRegistry (API definitions)
│   │   ├── wiring/                 # Prompt engine UI — pills, wires, prompt runner
│   │   │   ├── PillOverlays.tsx    # Render pill chips and API blocks on prompt nodes
│   │   │   ├── PillEditor.tsx      # Configure pill properties (with syntax hints)
│   │   │   ├── PillDropdown.tsx    # Pill selection dropdown
│   │   │   ├── WireLine.tsx        # Render wire connections on canvas
│   │   │   ├── WireModePopover.tsx # Output mode picker for wires
│   │   │   ├── usePromptRunner.ts  # Hook to execute prompt nodes
│   │   │   ├── wireUtils.ts        # Wire routing helpers
│   │   │   ├── wireGraph.ts        # Dependency graph traversal (topological sort)
│   │   │   └── constants.ts        # Wiring constants (anchor mappings, pill positions)
│   │   └── sync/                   # useBoardSync, useCursorSync
│   ├── lib/                        # firebase.ts, store.ts (Zustand), constants.ts
│   ├── types/                      # board.ts (BoardObject, Connection, Cursor, Board)
│   └── components/                 # CursorOverlay, PresenceList, TextEditingOverlay
├── functions/
│   └── src/
│       ├── index.ts                # Exports executeAgentCommand + executePromptNode
│       ├── agent.ts                # Agent loop, system prompt, tool definitions
│       ├── agentTools.ts           # Tool implementations (Firebase reads/writes)
│       ├── templateEngine.ts       # Structured diagram templates (SWOT, flowchart, etc.)
│       ├── promptRunner.ts         # Prompt engine — LLM execution, fan-out, output routing
│       └── apiRegistry.ts          # External API executors (weather, crypto, time, etc.)
├── firebase.json                   # Hosting rewrites, emulators config
├── database.rules.json             # Realtime Database security rules
└── vite.config.ts                  # Dev server + proxy for /api/agent
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1` | Pointer tool |
| `2` | Sticky note |
| `3` | Shapes (cycle Star → Circle → Rectangle) |
| `4` | Text |
| `5` | Frame |
| `6` | AI mode |
| `W` | Wire mode |
| `>>` | API lookup (inside editor) |
| `{name}` | Create pill (inside editor) |
| `Ctrl+Z` | Undo |
| `Ctrl+C` / `Ctrl+V` | Copy / Paste |
| `Del` | Delete selected |
| `Dbl-click` | Edit object |

---

## Commands

### Frontend (root)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check + production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Vitest in watch mode |
| `npm run test:run` | Run Vitest once |
| `npm run deploy` | Build and deploy hosting + functions |

### Functions (`functions/`)

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run build:watch` | Compile in watch mode |
| `npm test` | Run Jest tests |
| `npm run serve` | Build + start Functions emulator |
| `npm run deploy` | Deploy functions only |

---

## Setup

### 1. Install dependencies

```bash
npm install
cd functions && npm install
```

### 2. Configure environment

**Frontend** — create `.env.local` in the project root:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_DATABASE_URL=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

**Functions** — create `functions/.env`:

```env
OPENAI_API_KEY=...

# Optional: use Groq (llama-3.3-70b-versatile) for faster/cheaper content extraction
GROQ_API_KEY=...

# Optional: LangSmith tracing
LANGSMITH_API_KEY=...
```

### 3. Run locally

```bash
# Terminal 1: start Vite dev server
npm run dev

# Terminal 2: start Firebase Functions emulator (needed for AI commands)
firebase emulators:start --only functions
```

Vite proxies `/api/agent` to the local Functions emulator automatically.

### 4. Deploy

```bash
npm run deploy
```

This builds the frontend and deploys both Firebase Hosting and Cloud Functions. Ensure your Firebase project has Realtime Database enabled and `database.rules.json` is configured for your auth requirements.

---

## Testing

The project has two separate test suites — one for the frontend (Vitest) and one for the Cloud Functions (Jest).

### Frontend — Vitest

**Run:**
```bash
npm run test        # watch mode
npm run test:run    # run once
```

**Setup:** `src/test/setup.ts` imports `@testing-library/jest-dom/vitest` to extend Vitest's `expect` with DOM matchers. The environment is `jsdom`.

**What's tested:**

| File | What it covers |
|------|---------------|
| `src/App.test.tsx` | App renders AuthGate |
| `src/features/auth/AuthGate.test.tsx` | Loading state, sign-in UI, renders children when authenticated |
| `src/features/board/Toolbar.test.tsx` | Tool button rendering, hotkey dispatch |
| `src/features/board/components/BoardObject.test.tsx` | Object rendering by type |
| `src/features/board/components/ColorPicker.test.tsx` | Color swatch rendering and selection |
| `src/features/board/components/objects/Frame.test.tsx` | Frame rendering via react-konva |
| `src/features/board/components/objects/TextElement.test.tsx` | Text rendering, heading levels |
| `src/features/agent/AgentPanel.test.tsx` | Dialog open/close, input, submit, loading state, example commands |
| `src/features/agent/useAgentCommand.test.ts` | Hook — calls Firebase callable, handles errors |
| `src/components/PresenceList.test.tsx` | Cursor/presence list rendering |
| `src/features/wiring/usePromptRunner.test.ts` | Prompt runner hook — calls executePromptNode, handles loading/error state |
| `src/lib/store.test.ts` | Zustand store — toolMode, selection, viewport |

### Functions — Jest + ts-jest

**Run (from `functions/`):**
```bash
npm test
```

**What's tested:**

| File | What it covers |
|------|---------------|
| `functions/src/agentTools.test.ts` | All tool functions — createStickyNote, createShape, createFrame, createConnector, moveObject, resizeObject, updateText, changeColor, getBoardState |
| `functions/src/agent.test.ts` | `runAgentCommand` — board validation, context loading, OpenAI tool-call loop, error handling |
| `functions/src/promptRunner.test.ts` | `runPromptNode` — parseSections, parseItemBlocks, findFreePosition, updateRunStatus, routeOutputToTarget, resolveTemplate, end-to-end LLM/API flows |
| `functions/src/apiRegistry.test.ts` | External API executors — weather, crypto, exchange, time, dictionary, etc. |

---

## Emulator Ports (default)

| Service | Port |
|---------|------|
| Hosting | 5000 |
| Functions | 5001 |
| Auth | 9099 |
| Realtime Database | 9000 |
| Emulator UI | 4000 |

---

## Created By

[Aaron Harbaugh](https://www.linkedin.com/in/aaharbaugh/)
