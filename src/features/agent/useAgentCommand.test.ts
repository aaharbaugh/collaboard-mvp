import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock firebase/database BEFORE importing the hook
const mockOff = vi.fn();
const mockUnsubscribe = vi.fn();
const mockOnValue = vi.fn((_ref, cb) => { cb({ val: () => null }); return mockUnsubscribe; });
const mockRef = vi.fn(() => ({}));

vi.mock('firebase/database', () => ({
  ref: mockRef,
  onValue: mockOnValue,
  off: mockOff,
}));

// Mock the firebase module (auth + database)
vi.mock('../../lib/firebase', () => ({
  auth: { currentUser: { uid: 'user1', displayName: 'Alice', getIdToken: vi.fn(async () => 'token123') } },
  database: {},
}));

// Import AFTER mocks
const { useAgentCommand } = await import('./useAgentCommand');

function makeFetchResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOnValue.mockImplementation((_ref, cb) => { cb({ val: () => null }); return mockUnsubscribe; });
  vi.stubGlobal('fetch', vi.fn(() => makeFetchResponse({ success: true, message: 'Executed 1 operations' })));
});

describe('useAgentCommand', () => {
  it('starts with loading=false and error=null', () => {
    const { result } = renderHook(() => useAgentCommand('board1'));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets loading=true while executing and resets to false after', async () => {
    let resolveFetch: ((v: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => { resolveFetch = res; })));

    const { result } = renderHook(() => useAgentCommand('board1'));

    let promise!: Promise<unknown>;
    // Start the command (async — don't await yet so we can observe loading state)
    act(() => { promise = result.current.runCommand('Add a sticky note'); });

    // Flush the getIdToken microtask so fetch() actually gets called
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveFetch!({ ok: true, status: 200, json: async () => ({ success: true, message: 'ok' }) } as Response);
      await promise;
    });
    expect(result.current.loading).toBe(false);
  });

  it('calls fetch with the correct boardId and command', async () => {
    const { result } = renderHook(() => useAgentCommand('board-42'));

    await act(async () => {
      await result.current.runCommand('Create a flowchart');
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/agent',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body).toMatchObject({ boardId: 'board-42', command: 'Create a flowchart', userId: 'user1', userName: 'Alice' });
  });

  it('sets error state when the call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeFetchResponse({ error: 'Function error' }, false, 500)));
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
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => makeFetchResponse({ error: 'First error' }, false, 500))
      .mockImplementation(() => makeFetchResponse({ success: true, message: 'ok' }))
    );
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

  it('returns the data from fetch on success', async () => {
    const { result } = renderHook(() => useAgentCommand('board1'));
    let returnedData: unknown;

    await act(async () => {
      returnedData = await result.current.runCommand('hello');
    });

    expect(returnedData).toEqual({ success: true, message: 'Executed 1 operations' });
  });

  it('subscribes to agentStatus during command and cleans up after', async () => {
    const { result } = renderHook(() => useAgentCommand('board1'));

    await act(async () => {
      await result.current.runCommand('hello');
    });

    expect(mockRef).toHaveBeenCalledWith(expect.anything(), 'boards/board1/agentStatus');
    expect(mockOnValue).toHaveBeenCalled();
    expect(mockOff).toHaveBeenCalled();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
