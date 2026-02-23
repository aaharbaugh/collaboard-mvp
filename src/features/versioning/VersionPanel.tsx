import { useEffect, useState, useCallback } from 'react';
import { ref, onValue } from 'firebase/database';
import { database, auth } from '../../lib/firebase';

interface ObjectVersion {
  versionId: string;
  timestamp: number;
  text: string | null;
  promptOutput: string | null;
  source: 'user_edit' | 'prompt_run' | 'api_run' | 'wire_update';
  userId: string;
}

interface VersionPanelProps {
  boardId: string;
  objectId: string;
  onClose: () => void;
  userId: string;
}

const SOURCE_BADGES: Record<string, { label: string; color: string }> = {
  user_edit: { label: 'Edit', color: '#6b8e9b' },
  prompt_run: { label: 'Prompt', color: '#8b6b9b' },
  api_run: { label: 'API', color: '#4a7c59' },
  wire_update: { label: 'Wire', color: '#9b8b6b' },
};

export function VersionPanel({ boardId, objectId, onClose, userId }: VersionPanelProps) {
  const [versions, setVersions] = useState<ObjectVersion[]>([]);
  const [restoring, setRestoring] = useState<string | null>(null);

  // Listen to versions subcollection in real-time
  useEffect(() => {
    const versionsRef = ref(database, `boards/${boardId}/objects/${objectId}/versions`);
    const unsub = onValue(versionsRef, (snap) => {
      if (!snap.exists()) {
        setVersions([]);
        return;
      }
      const raw = snap.val() as Record<string, ObjectVersion>;
      const list = Object.values(raw).sort((a, b) => b.timestamp - a.timestamp);
      setVersions(list);
    });
    return unsub;
  }, [boardId, objectId]);

  const handleRestore = useCallback(async (versionId: string) => {
    setRestoring(versionId);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/restore-version', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-User-Token': token } : {}),
        },
        body: JSON.stringify({ boardId, objectId, versionId, userId }),
      });
      if (!res.ok) {
        console.error('Restore failed:', res.status);
      }
    } catch (err) {
      console.error('Restore error:', err);
    } finally {
      setRestoring(null);
    }
  }, [boardId, objectId, userId]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
        background: '#1e1e1e',
        borderLeft: '1px solid #333',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '"Courier New", Courier, monospace',
        color: '#ccc',
        pointerEvents: 'auto',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid #333',
      }}>
        <span style={{ fontWeight: 'bold', fontSize: 14 }}>Version History</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: 18,
            padding: '0 4px',
          }}
        >
          x
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {versions.length === 0 && (
          <div style={{ padding: '16px', color: '#666', textAlign: 'center', fontSize: 12 }}>
            No version history yet
          </div>
        )}
        {versions.map((v) => {
          const badge = SOURCE_BADGES[v.source] ?? { label: v.source, color: '#666' };
          const preview = v.promptOutput || v.text || '(empty)';
          return (
            <div
              key={v.versionId}
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid #2a2a2a',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  fontSize: 10,
                  background: badge.color,
                  color: '#fff',
                  padding: '1px 6px',
                  borderRadius: 3,
                }}>
                  {badge.label}
                </span>
                <span style={{ fontSize: 11, color: '#888' }}>{formatTime(v.timestamp)}</span>
              </div>
              <div style={{
                fontSize: 11,
                color: '#aaa',
                maxHeight: 40,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'pre-wrap',
                marginBottom: 6,
              }}>
                {preview.slice(0, 120)}
              </div>
              <button
                onClick={() => handleRestore(v.versionId)}
                disabled={restoring === v.versionId}
                style={{
                  background: '#4a7c59',
                  border: '1px solid #5a9a6a',
                  color: '#fff',
                  cursor: restoring === v.versionId ? 'wait' : 'pointer',
                  fontSize: 10,
                  padding: '2px 10px',
                  borderRadius: 3,
                }}
              >
                {restoring === v.versionId ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
