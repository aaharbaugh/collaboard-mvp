# Collaboard MVP

A real-time collaborative whiteboard with an AI agent. Built with React, Konva, and Firebase.

---

## Major functionality

### Authentication

- **AuthGate** wraps the app: users must sign in before they see the board.
- **Sign-in options:** Google or Anonymous (Firebase Auth).
- Loading state is shown until auth is resolved; unauthenticated users see a sign-in card.

### Board model

- **One board per user (MVP):** On load, the app resolves a single board ID (e.g. shared demo board or a personal board created for the user). All collaboration happens on that board.
- **Firebase Realtime Database** stores, per board:
  - **`metadata`** — owner, name, createdAt.
  - **`collaborators`** — map of userId → true.
  - **`objects`** — map of object id → BoardObject.
  - **`connections`** — map of connection id → Connection.
  - **`cursors`** — map of userId → Cursor (position, name, color, lastUpdate).

**Object types:** stickyNote, rectangle, circle, star, text, frame, image. Each has id, type, x, y, width, height, optional color/text/rotation/frameId/sentToBack, createdBy, createdAt, and optional selection fields (selectedBy, selectedByName).

**Connections:** fromId, toId, fromAnchor, toAnchor, optional points (waypoints as flat [x,y,...]), color, createdBy, createdAt. Rendered as arrows; waypoints allow bent or polyline paths.

### Canvas and tools

- **React-Konva** canvas: pannable and zoomable (viewport: x, y, scale). Origin top-left; x right, y down.
- **Toolbar** (and hotkeys):
  - **1** — Pointer: cycle Select ↔ Move (pan).
  - **2** — Sticky note.
  - **4** — Text.
  - **5** — Cycle shape: Star → Circle → Rectangle (and Frame via toolbar).
  - **6** — Toggle AI panel.
- **Select mode:** Click object to select; drag on empty space for multi-select. Selected objects show resize/rotation handles; ColorPicker and order buttons (send to back / bring to front) appear. Delete/Backspace removes selected objects or the selected connection. Copy/paste (Ctrl+C / Ctrl+V) duplicates objects.
- **Drawing:** In sticky/shape/text/frame mode, click on the canvas to create an object. Connector tool: click an object’s anchor to start, then click waypoints (optional) and another object’s anchor to finish. Double-click sticky or text to edit content in an overlay.
- **Connections:** Arrows between objects; optional waypoints for bent lines. When a connection is selected, waypoints can be dragged or double-click can add a new waypoint.

### Real-time sync

- **useBoardSync(boardId):** Subscribes to `boards/${boardId}/objects` and `.../connections` with Firebase `onValue`. Local state (objects, connections) is always the live DB state. Create/update/delete object and connection helpers write directly to the DB.
- **useCursorSync(boardId, userId, userName):** Subscribes to `boards/${boardId}/cursors`. Updates the current user’s cursor (throttled) and cleans stale cursors. Other users’ cursors are shown in **CursorOverlay**; **PresenceList** lists who’s on the board.
- **Selection and viewport** are local only (Zustand store), not synced to Firebase.

### AI agent

- **AgentPanel** (Ask AI): User types a natural-language command (e.g. “Create a SWOT analysis”, “Draw a flowchart”). The panel sends the command plus optional **context**: current **selection** (selectedIds) and **viewport** (x, y, scale).
- **Backend:** HTTP endpoint `/api/agent` is implemented by Firebase Function **executeAgentCommand** (see `functions/src/index.ts`). It receives `AgentCommandRequest`: boardId, command, userId, userName, optional selectedIds, optional viewport.
- **runAgentCommand** (in `functions/src/agent.ts`):
  1. Validates board exists.
  2. Loads **board context** via `getBoardContext(boardId, { selectedIds, viewport })`: either the selection + related connections, or objects in the visible viewport, or the full board. Context is **compressed** (only id, type, x, y, width, height, text, color for objects; id, fromId, toId, anchors, color, points for connections).
  3. Builds a short **system prompt** with that context, coordinate rules, and allowed colors (board palette). Sends the user command as the user message.
  4. Runs an **agent loop** (up to 5 iterations): calls OpenAI `gpt-4o-mini` with tools; for each response that contains tool_calls, runs the tools (createStickyNote, createShape, createFrame, createConnector, createMultiPointConnector, connectInSequence, moveObject, resizeObject, updateText, changeColor, getBoardState) via **dispatchTool** and appends results to the conversation until the model stops with a final message.
  5. **Langfuse:** Creates a trace, sets trace input (boardId, command, context summary) and output (success/message/totalToolCalls or error), and flushes before returning.
- **agentTools** (`functions/src/agentTools.ts`): All tool implementations read/write Firebase (same `boards/${boardId}/objects` and `.../connections`). Colors are constrained to the board palette. Connectors support optional waypoints and optional relative waypoints (first point absolute, rest as dx/dy).

### Deployment and dev

- **Hosting:** Firebase Hosting serves the built SPA from `dist`. Rewrite: `/api/agent` → Cloud Function `executeAgentCommand` (us-central1). All other routes → `index.html`.
- **Local dev:** `npm run dev` runs Vite (e.g. port 5174). Vite proxy forwards `/api/agent` to the Firebase Functions emulator at `http://127.0.0.1:5001/<projectId>/us-central1/executeAgentCommand`. Run `firebase emulators:start --only functions` in another terminal so the agent works locally.

---

## Features summary

| Area | Features |
|------|----------|
| **Tools** | Select/Move (1), Sticky (2), Text (4), Shapes + Frame (5), AI panel (6). Hotkeys and toolbar. |
| **Objects** | Sticky notes, rectangle/circle/star, text, frame, image. Move, resize, rotate, color, send to back/front. |
| **Connections** | Arrows between objects with optional waypoints; select, drag waypoints, delete. |
| **Selection** | Single/multi-select; copy/paste; delete. |
| **Collaboration** | Real-time board and cursor sync; presence list; auth required (Google or anonymous). |
| **Viewport** | Pan and zoom; grid background. |
| **AI** | Natural-language commands; context = selection or viewport or full board; tools create/edit board content; Langfuse tracing. |

---

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, react-konva, Zustand.
- **Backend:** Firebase (Auth, Realtime Database, Hosting, Cloud Functions).
- **Agent:** OpenAI API (gpt-4o-mini), Langfuse for observability.

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests (watch) |
| `npm run test:run` | Run tests once |
| `npm run deploy` | Build and deploy to Firebase |

**Functions (in `functions/`):**

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm test` | Run Jest tests for agent and agentTools |

---

## Setup

1. Clone and install: `npm install` (root) and `npm install` in `functions/` if you will run or deploy functions.
2. **Environment:** Copy or create `.env.local` with Firebase config (e.g. `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_API_KEY`, etc.). For the agent, set `OPENAI_API_KEY` and optional Langfuse keys in `functions/.env` or Firebase config.
3. **Run locally:** `npm run dev`. For AI commands, also run `firebase emulators:start --only functions`.
4. **Deploy:** `npm run deploy` builds the app and deploys hosting + functions. Ensure Firebase project and Realtime Database rules are configured (e.g. `database.rules.json` allows read/write for authenticated users on their boards).

---

## Project structure (high level)

```
collaboard-mvp/
├── src/
│   ├── App.tsx                 # AuthGate → BoardView
│   ├── features/
│   │   ├── auth/               # AuthGate, useAuth
│   │   ├── board/              # BoardView, BoardCanvas, Toolbar, object/connection components
│   │   ├── agent/              # AgentPanel, useAgentCommand
│   │   └── sync/               # useBoardSync, useCursorSync
│   ├── lib/                    # firebase, store (Zustand), constants
│   ├── types/                  # board.ts (BoardObject, Connection, Cursor, etc.)
│   └── components/            # CursorOverlay, PresenceList, TextEditingOverlay
├── functions/
│   └── src/
│       ├── index.ts            # HTTP function executeAgentCommand
│       ├── agent.ts            # runAgentCommand, system prompt, tool definitions, dispatch
│       └── agentTools.ts       # Board context, create/update tools, Firebase writes
├── firebase.json               # Hosting rewrites, emulators
├── database.rules.json         # Realtime Database security
└── vite.config.ts              # Dev proxy for /api/agent
```
