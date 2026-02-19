import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock firebase modules before importing the hook
vi.mock('../../lib/firebase', () => ({
  auth: { currentUser: { uid: 'user1', displayName: 'Alice' } },
  functions: {},
}));

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockCallable),
}));

// Import AFTER mocks
const { useAgentCommand } = await import('./useAgentCommand');

beforeEach(() => {
  vi.clearAllMocks();
  mockCallable.mockResolvedValue({ data: { success: true, message: 'Executed 1 operations' } });
});

describe('useAgentCommand', () => {
  it('starts with loading=false and error=null', () => {
    const { result } = renderHook(() => useAgentCommand('board1'));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets loading=true while executing and resets to false after', async () => {
    let resolveCallable!: (v: { data: unknown }) => void;
    mockCallable.mockReturnValue(
      new Promise<{ data: unknown }>((res) => { resolveCallable = res; })
    );

    const { result } = renderHook(() => useAgentCommand('board1'));

    let promise: Promise<unknown>;
    act(() => {
      promise = result.current.runCommand('Add a sticky note');
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveCallable({ data: { success: true, message: 'ok' } });
      await promise;
    });
    expect(result.current.loading).toBe(false);
  });

  it('calls httpsCallable with the correct boardId and command', async () => {
    const { httpsCallable } = await import('firebase/functions');
    const { result } = renderHook(() => useAgentCommand('board-42'));

    await act(async () => {
      await result.current.runCommand('Create a flowchart');
    });

    // httpsCallable was set up for 'executeAgentCommand'
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'executeAgentCommand');
    expect(mockCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: 'board-42',
        command: 'Create a flowchart',
        userId: 'user1',
        userName: 'Alice',
      })
    );
  });

  it('sets error state when the call fails', async () => {
    mockCallable.mockRejectedValue(new Error('Function error'));
    const { result } = renderHook(() => useAgentCommand('board1'));

    await act(async () => {
      try {
        await result.current.runCommand('Do something');
      } catch { /* expected */ }
    });

    expect(result.current.error).toBe('Function error');
    expect(result.current.loading).toBe(false);
  });

  it('clears error on a new successful command', async () => {
    mockCallable.mockRejectedValueOnce(new Error('First error'));
    const { result } = renderHook(() => useAgentCommand('board1'));

    // First call fails
    await act(async () => {
      try { await result.current.runCommand('bad'); } catch { /* expected */ }
    });
    expect(result.current.error).toBe('First error');

    // Second call succeeds
    await act(async () => {
      await result.current.runCommand('good');
    });
    expect(result.current.error).toBeNull();
  });

  it('returns the data from the callable on success', async () => {
    const { result } = renderHook(() => useAgentCommand('board1'));
    let returnedData: unknown;

    await act(async () => {
      returnedData = await result.current.runCommand('hello');
    });

    expect(returnedData).toEqual({ success: true, message: 'Executed 1 operations' });
  });
});
