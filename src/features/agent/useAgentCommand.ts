import { useState } from 'react';
import { auth } from '../../lib/firebase';

export function useAgentCommand(boardId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCommand = async (command: string): Promise<unknown> => {
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken() ?? '';
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: {
          'X-User-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          boardId,
          command,
          userId: auth.currentUser?.uid ?? '',
          userName: auth.currentUser?.displayName ?? 'Anonymous',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      setLoading(false);
      return data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setLoading(false);
      throw err;
    }
  };

  return { runCommand, loading, error };
}
