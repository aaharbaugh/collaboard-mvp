import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockGetIdToken = vi.fn().mockResolvedValue('mock-token');

vi.mock('../../lib/firebase', () => {
  return {
    auth: {
      get currentUser() {
        return (globalThis as Record<string, unknown>).__mockCurrentUser ?? null;
      },
    },
  };
});

import { usePromptRunner } from './usePromptRunner';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function setCurrentUser(user: unknown) {
  (globalThis as Record<string, unknown>).__mockCurrentUser = user;
}

beforeEach(() => {
  vi.clearAllMocks();
  setCurrentUser({ uid: 'user-1', getIdToken: mockGetIdToken });
});

describe('usePromptRunner', () => {
  it('starts with isRunning = false', () => {
    const { result } = renderHook(() => usePromptRunner('board-1'));
    expect(result.current.isRunning).toBe(false);
  });

  it('returns { success: false } when boardId is null', async () => {
    const { result } = renderHook(() => usePromptRunner(null));

    let response: { success: boolean };
    await act(async () => {
      response = await result.current.runPrompt('obj-1');
    });

    expect(response!.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns { success: false } when there is no authenticated user', async () => {
    setCurrentUser(null);

    const { result } = renderHook(() => usePromptRunner('board-1'));

    let response: { success: boolean };
    await act(async () => {
      response = await result.current.runPrompt('obj-1');
    });

    expect(response!.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls fetch with the correct URL, method, headers, and body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const { result } = renderHook(() => usePromptRunner('board-1'));

    await act(async () => {
      await result.current.runPrompt('obj-42');
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/prompt');
    expect(options.method).toBe('POST');
    expect(options.headers['X-User-Token']).toBe('mock-token');
    expect(options.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(options.body);
    expect(body).toEqual({
      boardId: 'board-1',
      objectId: 'obj-42',
      userId: 'user-1',
    });
  });

  it('returns { success: true } on a successful response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const { result } = renderHook(() => usePromptRunner('board-1'));

    let response: { success: boolean };
    await act(async () => {
      response = await result.current.runPrompt('obj-1');
    });

    expect(response!.success).toBe(true);
  });

  it('returns { success: false } on an HTTP error (res.ok = false)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '{"error":"Internal Server Error"}',
    });

    const { result } = renderHook(() => usePromptRunner('board-1'));

    let response: { success: boolean };
    await act(async () => {
      response = await result.current.runPrompt('obj-1');
    });

    expect(response!.success).toBe(false);
  });

  it('returns { success: false } on a network error (fetch throws)', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => usePromptRunner('board-1'));

    let response: { success: boolean };
    await act(async () => {
      response = await result.current.runPrompt('obj-1');
    });

    expect(response!.success).toBe(false);
  });

  it('resets isRunning to false after completion (both success and error)', async () => {
    // Test success path
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const { result } = renderHook(() => usePromptRunner('board-1'));

    await act(async () => {
      await result.current.runPrompt('obj-1');
    });
    expect(result.current.isRunning).toBe(false);

    // Test error path
    mockFetch.mockRejectedValue(new Error('Network failure'));

    await act(async () => {
      await result.current.runPrompt('obj-1');
    });
    expect(result.current.isRunning).toBe(false);
  });
});
