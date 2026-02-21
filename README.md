# Collaboard MVP

A real-time collaborative whiteboard with an AI agent. Built with React, Konva, and Firebase.

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
| **AI (planning)** | OpenAI `gpt-4o` (or Groq `llama-3.3-70b-versatile` if `GROQ_API_KEY` is set) |
| **Observability** | LangSmith (optional) |
| **Testing** | Vitest (frontend), Jest + ts-jest (functions) |

---

## Features

### Authentication
- **AuthGate** wraps the app — users must sign in before accessing any board.
- **Sign-in options:** Google OAuth or Anonymous (Firebase Auth).
- Loading state shown until auth resolves; unauthenticated users see a sign-in card.

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

Each object has: id, type, x, y, width, height, optional color/text/rotation/imageData/headingLevel/frameId/sentToBack, createdBy, createdAt, and optional selection fields (selectedBy, selectedByName).

**Connections:** fromId, toId, fromAnchor, toAnchor, optional waypoints (flat `[x1,y1,x2,y2,...]`), color, createdBy, createdAt. Rendered as arrows with optional bent/polyline paths.

### Canvas & Tools
- **React-Konva** canvas: pannable and zoomable (viewport: x, y, scale). Origin top-left; x right, y down.

| Hotkey | Tool |
|--------|------|
| `1` | Pointer — cycle Select ↔ Move (pan) |
| `2` | Sticky note |
| `3` | Shape — cycle Star → Circle → Rectangle |
| `4` | Text |
| `5` | Frame |
| `6` | Toggle AI panel |

- **Select mode:** Click to select; drag empty space for multi-select. Selected objects show resize/rotation handles, a ColorPicker, and order buttons (send to back / bring to front). Delete/Backspace removes selected objects or a selected connection. Ctrl+C / Ctrl+V copies and pastes.
- **Drawing:** Click on the canvas to place an object in the current tool mode.
- **Connector tool:** Click an anchor on one object, optionally click waypoints, then click an anchor on another object to create a connection.
- **Text editing:** Double-click a sticky note or text element to edit inline.
- **Frames:** Group objects into frames; children move and resize with the frame.

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
│   │   ├── auth/                   # AuthGate, useAuth
│   │   ├── board/                  # BoardView, BoardCanvas, Toolbar
│   │   │   ├── components/         # BoardObject, ConnectionLine, UserBoardsPanel, ...
│   │   │   │   └── objects/        # StickyNote, Rectangle, Circle, Star, Frame, Text, Image
│   │   │   ├── hooks/              # useBoardId, useUserBoards
│   │   │   └── utils/              # boardActions, boardCache, anchorPoint
│   │   ├── agent/                  # AgentPanel, useAgentCommand
│   │   └── sync/                   # useBoardSync, useCursorSync
│   ├── lib/                        # firebase.ts, store.ts (Zustand), constants.ts
│   ├── types/                      # board.ts (BoardObject, Connection, Cursor, Board)
│   └── components/                 # CursorOverlay, PresenceList, TextEditingOverlay
├── functions/
│   └── src/
│       ├── index.ts                # Exports executeAgentCommand HTTP function
│       ├── agent.ts                # Agent loop, system prompt, tool definitions
│       ├── agentTools.ts           # Tool implementations (Firebase reads/writes)
│       └── templateEngine.ts       # Structured diagram templates (SWOT, flowchart, etc.)
├── firebase.json                   # Hosting rewrites, emulators config
├── database.rules.json             # Realtime Database security rules
└── vite.config.ts                  # Dev server + proxy for /api/agent
```

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

## Emulator ports (default)

| Service | Port |
|---------|------|
| Hosting | 5000 |
| Functions | 5001 |
| Auth | 9099 |
| Realtime Database | 9000 |
| Emulator UI | 4000 |
