import { useState, useCallback } from 'react';
import { auth } from '../../lib/firebase';

export function usePromptRunner(boardId: string | null) {
  const [isRunning, setIsRunning] = useState(false);

  const runPrompt = useCallback(
    async (objectId: string): Promise<{ success: boolean }> => {
      if (!boardId) return { success: false };
      const user = auth.currentUser;
      if (!user) {
        console.error('Prompt run: no authenticated user');
        return { success: false };
      }

      setIsRunning(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/prompt', {
          method: 'POST',
          headers: {
            'X-User-Token': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            boardId,
            objectId,
            userId: user.uid,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          let errorMsg: string;
          try {
            const data = JSON.parse(text);
            errorMsg = data.error ?? `HTTP ${res.status}`;
          } catch {
            errorMsg = `HTTP ${res.status}: ${text.slice(0, 200)}`;
          }
          console.error('Prompt run failed:', errorMsg);
          return { success: false };
        }

        const data = await res.json();
        if (!data.success) {
          console.error('Prompt returned error:', data.error);
          return { success: false };
        }
        return { success: true };
      } catch (err) {
        console.error('Prompt run network error:', err);
        return { success: false };
      } finally {
        setIsRunning(false);
      }
    },
    [boardId]
  );

  return { runPrompt, isRunning };
}
