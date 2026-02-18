# Collaboard MVP

A real-time collaborative whiteboard built with React, Konva, and Firebase.

## Features

- **Tools** — Select (1), Pan (2), Sticky note (3), Rectangle (4), Circle (5), Text (6). Number keys switch tools.
- **Objects** — Add sticky notes, shapes, text, and images (paste from clipboard). Move, resize, change color; double-click sticky/text to edit content.
- **Connections** — Draw arrows between objects from anchor points (with waypoints). Select and delete connections.
- **Selection** — Click to select; drag on empty space for area (multi-) select. Delete/Backspace removes selected objects or the selected connection. Ctrl+C / Ctrl+V copy and paste objects.
- **Collaboration** — Real-time board and cursor sync via Firebase. Presence list and live cursors show who’s on the board. Sign in required.
- **Viewport** — Pan (Move tool or middle mouse) and zoom (scroll). Grid background.

## Tech

- **React 19** + **TypeScript** + **Vite**
- **react-konva** for canvas/whiteboard
- **Zustand** for state
- **Firebase** for real-time sync and deployment

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests (watch) |
| `npm run test:run` | Run tests once |
| `npm run deploy` | Build and deploy to Firebase |

## Setup

1. Clone and install: `npm install`
2. Configure Firebase (e.g. `.env` / Firebase config) if needed for sync and deploy
3. Run `npm run dev` and open the URL shown in the terminal

## Docs

See `docs/` for details (e.g. performance review and recommendations).
