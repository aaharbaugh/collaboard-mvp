import type { Cursor } from '../types/board';

interface CursorOverlayProps {
  cursors: Record<string, Cursor>;
  viewport: { x: number; y: number; scale: number };
  excludeUserId?: string;
}

export function CursorOverlay({
  cursors,
  viewport,
  excludeUserId,
}: CursorOverlayProps) {
  const entries = Object.entries(cursors).filter(
    ([uid]) => uid !== excludeUserId
  );

  return (
    <div className="cursor-overlay">
      {entries.map(([userId, cursor]) => {
        const screenX = cursor.x * viewport.scale + viewport.x;
        const screenY = cursor.y * viewport.scale + viewport.y;

        return (
          <div
            key={userId}
            className="cursor-item"
            style={{
              left: screenX,
              top: screenY,
              transform: 'translate(-2px, -2px)',
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.36Z"
                fill={cursor.color}
              />
            </svg>
            <div
              className="cursor-label"
              style={{
                backgroundColor: cursor.color,
              }}
            >
              {cursor.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
