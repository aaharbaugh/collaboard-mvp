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
// LangSmith mock — tracing is fire-and-forget; errors are swallowed by agent
// ---------------------------------------------------------------------------
jest.mock('langsmith', () => ({
  Client: jest.fn().mockImplementation(() => ({
    createFeedback: jest.fn().mockResolvedValue(undefined),
  })),
  RunTree: jest.fn().mockImplementation(() => ({
    postRun: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(undefined),
    patchRun: jest.fn().mockResolvedValue(undefined),
    createChild: jest.fn().mockReturnValue({
      postRun: jest.fn().mockResolvedValue(undefined),
      end: jest.fn().mockResolvedValue(undefined),
      patchRun: jest.fn().mockResolvedValue(undefined),
    }),
    id: 'run-id-1',
  })),
}));

// ---------------------------------------------------------------------------
// agentTools mock
// ---------------------------------------------------------------------------
jest.mock('./agentTools', () => ({
  executePlan: jest.fn().mockResolvedValue({ idMap: { s1: 'actual-id-1' }, connectionIds: ['conn-id-1'] }),
  // Individual creation functions still exist in agentTools but are not exposed as tools
  createStickyNote: jest.fn().mockResolvedValue('sticky-id'),
  createShape: jest.fn().mockResolvedValue('shape-id'),
  createFrame: jest.fn().mockResolvedValue('frame-id'),
  createText: jest.fn().mockResolvedValue('text-id'),
  createConnector: jest.fn().mockResolvedValue('conn-id'),
  createMultiPointConnector: jest.fn().mockResolvedValue(['conn-id']),
  connectInSequence: jest.fn().mockResolvedValue(['conn-id']),
  createBatch: jest.fn().mockResolvedValue([{ tempId: 't1', actualId: 'batch-id' }]),
  connectBatch: jest.fn().mockResolvedValue(['conn-id']),
  moveObject: jest.fn().mockResolvedValue(undefined),
  resizeObject: jest.fn().mockResolvedValue(undefined),
  updateText: jest.fn().mockResolvedValue(undefined),
  changeColor: jest.fn().mockResolvedValue(undefined),
  addToFrame: jest.fn().mockResolvedValue(undefined),
  setLayer: jest.fn().mockResolvedValue(undefined),
  rotateObject: jest.fn().mockResolvedValue(undefined),
  deleteObjects: jest.fn().mockResolvedValue({ deleted: 1, connectionsRemoved: 0 }),
  writeAgentStatus: jest.fn().mockResolvedValue(undefined),
  clearAgentStatus: jest.fn().mockResolvedValue(undefined),
  getBoardState: jest.fn().mockResolvedValue({ objects: {}, connections: {} }),
  getBoardContext: jest.fn().mockResolvedValue({ objects: {}, connections: {} }),
  BOARD_PALETTE_HEX: ['#f5e6ab', '#d4e4bc', '#c5d5e8', '#e8c5c5', '#d4c5e8', '#c5e8d4', '#e8d4c5', '#e0e0d0'],
  PALETTE: {
    yellow: '#f5e6ab', green: '#d4e4bc', blue: '#c5d5e8', rose: '#e8c5c5',
    lavender: '#d4c5e8', mint: '#c5e8d4', peach: '#e8d4c5', grey: '#e0e0d0',
  },
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

function makeJsonResponse(data: Record<string, unknown>): OpenAI.ChatCompletion {
  return {
    id: 'chatcmpl-json',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(data), tool_calls: undefined, refusal: null },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 20, total_tokens: 25, prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 } },
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
  it('calls executePlan when AI returns that tool call', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([{
          name: 'executePlan',
          args: {
            objects: [
              { tempId: 's1', action: 'createStickyNote', params: { text: 'A', x: 0, y: 0, color: 'yellow' } },
              { tempId: 's2', action: 'createStickyNote', params: { text: 'B', x: 300, y: 0, color: 'green' } },
            ],
            connections: [{ fromId: 's1', toId: 's2' }],
          },
        }])
      )
      .mockResolvedValueOnce(makeStopResponse());

    await runAgentCommand(BASE_PARAMS);
    expect(agentTools.executePlan).toHaveBeenCalledWith(
      'board1',
      expect.arrayContaining([expect.objectContaining({ tempId: 's1' })]),
      expect.arrayContaining([expect.objectContaining({ fromId: 's1', toId: 's2' })]),
      'user1',
      expect.any(Map)
    );
  });

  it('calls addToFrame for addToFrame tool calls', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([
          { name: 'addToFrame', args: { objectIds: ['obj1', 'obj2'], frameId: 'frame1' } },
        ])
      )
      .mockResolvedValueOnce(makeStopResponse());

    await runAgentCommand(BASE_PARAMS);
    expect(agentTools.addToFrame).toHaveBeenCalledWith('board1', ['obj1', 'obj2'], 'frame1');
  });

  it('calls setLayer for setLayer tool calls', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([
          { name: 'setLayer', args: { objectId: 'obj1', sentToBack: true } },
        ])
      )
      .mockResolvedValueOnce(makeStopResponse());

    await runAgentCommand(BASE_PARAMS);
    expect(agentTools.setLayer).toHaveBeenCalledWith('board1', 'obj1', true);
  });

  it('calls rotateObject for rotateObject tool calls', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([
          { name: 'rotateObject', args: { objectId: 'obj1', rotation: 90 } },
        ])
      )
      .mockResolvedValueOnce(makeStopResponse());

    await runAgentCommand(BASE_PARAMS);
    expect(agentTools.rotateObject).toHaveBeenCalledWith('board1', 'obj1', 90);
  });

  it('calls deleteObjects for deleteObjects tool calls', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([
          { name: 'deleteObjects', args: { objectIds: ['obj1', 'obj2'] } },
        ])
      )
      .mockResolvedValueOnce(makeStopResponse());

    await runAgentCommand(BASE_PARAMS);
    expect(agentTools.deleteObjects).toHaveBeenCalledWith('board1', ['obj1', 'obj2']);
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
        makeToolCallResponse([{
          name: 'executePlan',
          args: {
            objects: [{ tempId: 's1', action: 'createStickyNote', params: { text: 'A', x: 0, y: 0, color: 'yellow' } }],
            connections: [],
          },
        }])
      )
      // Second call: post-processing (e.g. setLayer)
      .mockResolvedValueOnce(
        makeToolCallResponse([
          { name: 'setLayer', args: { objectId: 'actual-id-1', sentToBack: true } },
        ])
      )
      .mockResolvedValueOnce(makeStopResponse());

    await runAgentCommand(BASE_PARAMS);
    expect(agentTools.executePlan).toHaveBeenCalledTimes(1);
    expect(agentTools.setLayer).toHaveBeenCalledTimes(1);
    // 2 iterations: iter-0 (executePlan) + iter-1 (setLayer); loop stops at maxIterations=2
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('stops after max iterations (2) even if AI keeps calling tools', async () => {
    // Always return tool calls to force iteration limit
    mockCreate.mockResolvedValue(
      makeToolCallResponse([{
        name: 'executePlan',
        args: { objects: [{ tempId: 's1', action: 'createStickyNote', params: { text: 'X', x: 0, y: 0, color: 'yellow' } }], connections: [] },
      }])
    );

    const result = await runAgentCommand(BASE_PARAMS);
    // Simple command → maxIterations=2, so OpenAI called at most twice
    expect(mockCreate.mock.calls.length).toBeLessThanOrEqual(2);
    expect(result.success).toBe(true);
  });

  it('writes agent status before each iteration and clears on finish', async () => {
    mockCreate.mockResolvedValueOnce(makeStopResponse());

    await runAgentCommand(BASE_PARAMS);

    expect(agentTools.writeAgentStatus).toHaveBeenCalledWith(
      'board1',
      expect.objectContaining({ phase: 'thinking' })
    );
    expect(agentTools.clearAgentStatus).toHaveBeenCalledWith('board1');
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

  it('clears agent status even when an error is thrown', async () => {
    const err = new Error('fail');
    mockCreate.mockRejectedValue(err);
    await expect(runAgentCommand(BASE_PARAMS)).rejects.toThrow('fail');
    expect(agentTools.clearAgentStatus).toHaveBeenCalledWith('board1');
  });
});

// ---------------------------------------------------------------------------
// Template engine (fast path)
// ---------------------------------------------------------------------------
describe('runAgentCommand – template engine', () => {
  it('uses template engine for swot — executePlan called, agentic loop skipped', async () => {
    mockCreate.mockResolvedValueOnce(makeJsonResponse({
      strengths: ['S1', 'S2', 'S3'],
      weaknesses: ['W1', 'W2'],
      opportunities: ['O1', 'O2'],
      threats: ['T1'],
    }));

    const result = await runAgentCommand({
      ...BASE_PARAMS,
      command: 'Create a SWOT analysis for my startup',
    });

    expect(result.success).toBe(true);
    expect(agentTools.executePlan).toHaveBeenCalledTimes(1);
    // extractContent is the only LLM call — no full agentic loop
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(agentTools.clearAgentStatus).toHaveBeenCalledWith('board1');
  });

  it('uses template engine for flowchart with arrow syntax — no LLM call needed', async () => {
    const result = await runAgentCommand({
      ...BASE_PARAMS,
      command: 'Draw a flowchart: Start → Process → Decision → End',
    });

    expect(result.success).toBe(true);
    expect(agentTools.executePlan).toHaveBeenCalledTimes(1);
    // Arrow chain parsed directly — no LLM call
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('falls back to agentic loop when template engine returns null (unsupported pattern)', async () => {
    // orgchart is detected but has no template → falls through to agentic loop
    mockCreate.mockResolvedValueOnce(makeStopResponse());

    const result = await runAgentCommand({
      ...BASE_PARAMS,
      command: 'Create an org chart for my team',
    });

    expect(result.success).toBe(true);
    // Agentic loop ran (at least one OpenAI call)
    expect(mockCreate).toHaveBeenCalled();
  });

  it('clears agent status even after template engine succeeds', async () => {
    mockCreate.mockResolvedValueOnce(makeJsonResponse({
      columns: [
        { name: 'To Do', items: ['Task 1'] },
        { name: 'In Progress', items: ['Task 2'] },
        { name: 'Done', items: ['Task 3'] },
      ],
    }));

    await runAgentCommand({
      ...BASE_PARAMS,
      command: 'Create a kanban board for my project',
    });

    expect(agentTools.clearAgentStatus).toHaveBeenCalledWith('board1');
  });
});
