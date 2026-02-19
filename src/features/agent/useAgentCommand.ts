import { useState } from 'react';
import { auth } from '../../lib/firebase';

export interface AgentCommandContext {
  selectedIds?: string[];
  viewport?: { x: number; y: number; scale: number };
}

export function useAgentCommand(boardId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCommand = async (command: string, context?: AgentCommandContext): Promise<unknown> => {
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken() ?? '';
      const body: Record<string, unknown> = {
        boardId,
        command,
        userId: auth.currentUser?.uid ?? '',
        userName: auth.currentUser?.displayName ?? 'Anonymous',
      };
      if (context?.selectedIds?.length) body.selectedIds = context.selectedIds;
      if (context?.viewport) body.viewport = context.viewport;
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: {
          'X-User-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
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
