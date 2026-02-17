import type { Cursor } from '../types/board';

interface PresenceListProps {
  cursors: Record<string, Cursor>;
}

export function PresenceList({ cursors }: PresenceListProps) {
  const users = Object.values(cursors);

  if (users.length === 0) {
    return (
      <div className="presence-list">
        <span className="presence-label">Online</span>
        <span className="presence-empty">Just you</span>
      </div>
    );
  }

  return (
    <div className="presence-list">
      <span className="presence-label">Online</span>
      <div className="presence-avatars">
        {users.map((cursor) => (
          <div
            key={cursor.userId}
            className="presence-avatar"
            title={cursor.name}
            style={{
              backgroundColor: cursor.color,
              borderColor: cursor.color,
            }}
          >
            {cursor.name.charAt(0).toUpperCase()}
          </div>
        ))}
      </div>
    </div>
  );
}
