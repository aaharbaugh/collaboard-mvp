import * as admin from 'firebase-admin';
import * as agentTools from './agentTools';
import type OpenAI from 'openai';

// ---------------------------------------------------------------------------
// firebase-admin mock
// ---------------------------------------------------------------------------
const mockOnce = jest.fn();
const mockRef = jest.fn().mockReturnValue({ once: mockOnce });
const mockDb = { ref: mockRef };

jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  database: jest.fn(),
}));

// ---------------------------------------------------------------------------
// OpenAI mock
// ---------------------------------------------------------------------------
const mockCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

// ---------------------------------------------------------------------------
// LangFuse mock
// ---------------------------------------------------------------------------
const mockGenerationEnd = jest.fn();
const mockGenerationFn = jest.fn().mockReturnValue({ end: mockGenerationEnd });
const mockTraceFn = jest.fn().mockReturnValue({ generation: mockGenerationFn });
const mockFlushAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('langfuse', () => ({
  Langfuse: jest.fn().mockImplementation(() => ({
    trace: mockTraceFn,
    flushAsync: mockFlushAsync,
  })),
}));

// ---------------------------------------------------------------------------
// agentTools mock
// ---------------------------------------------------------------------------
jest.mock('./agentTools', () => ({
  createStickyNote: jest.fn().mockResolvedValue('sticky-id'),
  createShape: jest.fn().mockResolvedValue('shape-id'),
  createFrame: jest.fn().mockResolvedValue('frame-id'),
  createConnector: jest.fn().mockResolvedValue('conn-id'),
  createMultiPointConnector: jest.fn().mockResolvedValue(['conn-id']),
  connectInSequence: jest.fn().mockResolvedValue(['conn-id']),
  moveObject: jest.fn().mockResolvedValue(undefined),
  resizeObject: jest.fn().mockResolvedValue(undefined),
  updateText: jest.fn().mockResolvedValue(undefined),
  changeColor: jest.fn().mockResolvedValue(undefined),
  getBoardState: jest.fn().mockResolvedValue({ objects: {}, connections: {} }),
}));

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeToolCallResponse(
  toolCalls: { name: string; args: Record<string, unknown> }[]
): OpenAI.ChatCompletion {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: toolCalls.map((tc, i) => ({
            id: `call_${i}`,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
          refusal: null,
        },
        finish_reason: 'tool_calls',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 } },
  } as unknown as OpenAI.ChatCompletion;
}

function makeStopResponse(): OpenAI.ChatCompletion {
  return {
    id: 'chatcmpl-2',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Done!', tool_calls: undefined, refusal: null },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 } },
  } as unknown as OpenAI.ChatCompletion;
}

const BASE_PARAMS = {
  boardId: 'board1',
  command: 'Add a yellow sticky note',
  userId: 'user1',
  userName: 'Alice',
};

// ---------------------------------------------------------------------------
// Import the function under test AFTER mocks are defined
// ---------------------------------------------------------------------------
let runAgentCommand: (params: typeof BASE_PARAMS) => Promise<{ success: boolean; message: string }>;

beforeAll(async () => {
  // Dynamic import ensures all mocks above are installed first
  const mod = await import('./agent');
  runAgentCommand = mod.runAgentCommand;
});

beforeEach(() => {
  jest.clearAllMocks();
  (admin.database as unknown as jest.Mock).mockReturnValue(mockDb);
  // Default: board exists
  mockOnce.mockResolvedValue({ exists: () => true });
});

// ---------------------------------------------------------------------------
// Board validation
// ---------------------------------------------------------------------------
describe('runAgentCommand – board validation', () => {
  it('throws when board does not exist', async () => {
    mockOnce.mockResolvedValue({ exists: () => false });
    await expect(runAgentCommand(BASE_PARAMS)).rejects.toThrow('Board not found');
  });
});

// ---------------------------------------------------------------------------
// Tool call execution
// ---------------------------------------------------------------------------
describe('runAgentCommand – tool execution', () => {
  it('calls createStickyNote when AI returns that tool call', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([
          { name: 'createStickyNote', args: { text: 'Hi', x: 0, y: 0, color: 'yellow' } },
        ])
      )
      .mockResolvedValueOnce(makeStopResponse());

    await runAgentCommand(BASE_PARAMS);
    expect(agentTools.createStickyNote).toHaveBeenCalledWith(
      'board1', 'Hi', 0, 0, 'yellow', 'user1'
    );
  });

  it('calls createShape for shape tool calls', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([
          {
            name: 'createShape',
            args: { type: 'rectangle', x: 100, y: 100, width: 120, height: 80, color: 'blue' },
          },
        ])
      )
      .mockResolvedValueOnce(makeStopResponse());

    await runAgentCommand(BASE_PARAMS);
    expect(agentTools.createShape).toHaveBeenCalledWith(
      'board1', 'rectangle', 100, 100, 120, 80, 'blue', 'user1'
    );
  });

  it('calls createConnector for connector tool calls', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([
          { name: 'createConnector', args: { fromId: 'a', toId: 'b', options: { color: 'pink' } } },
        ])
      )
      .mockResolvedValueOnce(makeStopResponse());

    await runAgentCommand(BASE_PARAMS);
    expect(agentTools.createConnector).toHaveBeenCalledWith(
      'board1', 'a', 'b', { color: 'pink' }, 'user1'
    );
  });

  it('calls connectInSequence for sequence tool calls', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([
          { name: 'connectInSequence', args: { objectIds: ['a', 'b', 'c'], options: {} } },
        ])
      )
      .mockResolvedValueOnce(makeStopResponse());

    await runAgentCommand(BASE_PARAMS);
    expect(agentTools.connectInSequence).toHaveBeenCalledWith('board1', ['a', 'b', 'c'], {}, 'user1');
  });

  it('returns success with tool call count', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([
          { name: 'createStickyNote', args: { text: 'A', x: 0, y: 0, color: 'yellow' } },
          { name: 'createStickyNote', args: { text: 'B', x: 200, y: 0, color: 'pink' } },
        ])
      )
      .mockResolvedValueOnce(makeStopResponse());

    const result = await runAgentCommand(BASE_PARAMS);
    expect(result.success).toBe(true);
    expect(result.message).toContain('2');
  });
});

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------
describe('runAgentCommand – agentic loop', () => {
  it('runs a second iteration when first response has tool calls', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([
          { name: 'createStickyNote', args: { text: 'A', x: 0, y: 0, color: 'yellow' } },
        ])
      )
      // Second call: AI creates connection using returned ID
      .mockResolvedValueOnce(
        makeToolCallResponse([
          { name: 'createConnector', args: { fromId: 'sticky-id', toId: 'other', options: {} } },
        ])
      )
      .mockResolvedValueOnce(makeStopResponse());

    await runAgentCommand(BASE_PARAMS);
    // Both createStickyNote and createConnector should be called
    expect(agentTools.createStickyNote).toHaveBeenCalledTimes(1);
    expect(agentTools.createConnector).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('stops after max iterations even if AI keeps calling tools', async () => {
    // Always return tool calls to force max iterations
    mockCreate.mockResolvedValue(
      makeToolCallResponse([
        { name: 'createStickyNote', args: { text: 'X', x: 0, y: 0, color: 'yellow' } },
      ])
    );

    const result = await runAgentCommand(BASE_PARAMS);
    // Should stop after MAX_ITERATIONS, not loop infinitely
    expect(mockCreate.mock.calls.length).toBeLessThanOrEqual(5);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Retry on error
// ---------------------------------------------------------------------------
describe('runAgentCommand – retry on error', () => {
  it('retries OpenAI call once on error and succeeds', async () => {
    const networkError = new Error('Network timeout');
    mockCreate
      .mockRejectedValueOnce(networkError) // first attempt fails
      .mockResolvedValueOnce(makeStopResponse()); // retry succeeds

    const result = await runAgentCommand(BASE_PARAMS);
    expect(result.success).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('throws when both OpenAI attempts fail', async () => {
    const networkError = new Error('Service unavailable');
    mockCreate.mockRejectedValue(networkError);

    await expect(runAgentCommand(BASE_PARAMS)).rejects.toThrow('Service unavailable');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// LangFuse observability
// ---------------------------------------------------------------------------
describe('runAgentCommand – LangFuse', () => {
  it('creates a LangFuse trace for each command', async () => {
    mockCreate.mockResolvedValueOnce(makeStopResponse());
    await runAgentCommand(BASE_PARAMS);
    expect(mockTraceFn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user1' })
    );
  });

  it('calls flushAsync after execution', async () => {
    mockCreate.mockResolvedValueOnce(makeStopResponse());
    await runAgentCommand(BASE_PARAMS);
    expect(mockFlushAsync).toHaveBeenCalled();
  });

  it('flushes LangFuse even when an error is thrown', async () => {
    const err = new Error('fail');
    mockCreate.mockRejectedValue(err);
    await expect(runAgentCommand(BASE_PARAMS)).rejects.toThrow('fail');
    expect(mockFlushAsync).toHaveBeenCalled();
  });
});
