import { useState } from 'react';
import { ref, onValue, off } from 'firebase/database';
import { auth, database } from '../../lib/firebase';

export interface AgentCommandContext {
  selectedIds?: string[];
  /** width/height are the actual canvas pixel dimensions so the agent places objects accurately. */
  viewport?: { x: number; y: number; scale: number; width?: number; height?: number };
}

export interface AgentStatus {
  phase: 'thinking' | 'calling_tools';
  iteration?: number;
  maxIterations?: number;
  tools?: string[];
}

export interface ChatEntry {
  role: 'user' | 'agent';
  text: string;
  /** Clickable option buttons shown below this message. */
  options?: string[];
}

export interface AgentUndoInfo {
  createdObjectIds: string[];
  createdConnectionIds: string[];
}

export function getStatusMessage(status: AgentStatus | null): string {
  if (!status) return 'Working...';
  if (status.phase === 'thinking') {
    if (!status.iteration || status.iteration <= 1) return 'Planning layout...';
    return `Refining (step ${status.iteration})...`;
  }
  if (status.phase === 'calling_tools' && status.tools?.length) {
    const tools = status.tools;
    if (tools.some((t) => t === 'createBatch' || t === 'createStickyNote' || t === 'createShape' || t === 'createFrame' || t === 'createText' || t === 'createMany')) {
      return 'Creating objects...';
    }
    if (tools.some((t) => t === 'connectBatch' || t === 'connectInSequence' || t === 'createConnector' || t === 'createMultiPointConnector')) {
      return 'Connecting elements...';
    }
    if (tools.some((t) => t === 'addToFrame')) return 'Grouping into frames...';
    if (tools.some((t) => t === 'deleteObjects')) return 'Removing objects...';
    if (tools.some((t) => t === 'setLayer')) return 'Adjusting layers...';
    if (tools.some((t) => t === 'moveBatch' || t === 'arrangeWithin')) return 'Arranging objects...';
  }
  return 'Working...';
}

export function useAgentCommand(boardId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [lastUndoInfo, setLastUndoInfo] = useState<AgentUndoInfo | null>(null);
  const clearHistory = () => { setHistory([]); setError(null); setLastUndoInfo(null); };

  const runCommand = async (command: string, context?: AgentCommandContext): Promise<unknown> => {
    setLoading(true);
    setError(null);
    setAgentStatus(null);
    setLastUndoInfo(null);

    // Add user message to history immediately
    setHistory(prev => [...prev, { role: 'user', text: command }]);

    // Start listening to live agent status from Firebase
    const statusRef = ref(database, `boards/${boardId}/agentStatus`);
    const unsubscribe = onValue(statusRef, (snap) => {
      setAgentStatus(snap.val() as AgentStatus | null);
    });

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

      // Add agent response to history (with optional clickable options)
      if (data.message) {
        setHistory(prev => [...prev, { role: 'agent', text: data.message, options: data.options }]);
      }

      // Store undo info if the command created any objects/connections
      if (data.undoInfo) {
        setLastUndoInfo(data.undoInfo as AgentUndoInfo);
      }

      setLoading(false);
      return data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setLoading(false);
      throw err;
    } finally {
      off(statusRef);
      unsubscribe();
      setAgentStatus(null);
    }
  };

  return { runCommand, loading, error, agentStatus, history, clearHistory, lastUndoInfo };
}
