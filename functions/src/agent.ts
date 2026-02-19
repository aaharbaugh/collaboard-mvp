import * as admin from 'firebase-admin';
import OpenAI from 'openai';
import { Langfuse } from 'langfuse';
import * as agentTools from './agentTools.js';

// Initialize Admin SDK once per cold start
if (!admin.apps.length) {
  admin.initializeApp();
}

// Lazily initialized to avoid crashing during Firebase deploy analysis (env vars not set at load time)
let _openai: OpenAI | null = null;
let _langfuse: Langfuse | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function getLangfuse(): Langfuse {
  if (!_langfuse) {
    _langfuse = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
      secretKey: process.env.LANGFUSE_SECRET_KEY ?? '',
      baseUrl: process.env.LANGFUSE_HOST,
    });
  }
  return _langfuse;
}

const MAX_ITERATIONS = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentCommandRequest {
  boardId: string;
  command: string;
  userId: string;
  userName: string;
  /** When set, only these objects (and their connections) are sent as context. */
  selectedIds?: string[];
  /** When set (and no selection), only objects in visible viewport are sent. */
  viewport?: { x: number; y: number; scale: number };
}

// ---------------------------------------------------------------------------
// Retry helper (retry once on any error)
// ---------------------------------------------------------------------------

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

// ---------------------------------------------------------------------------
// Exported business logic (also testable without the callable wrapper)
// ---------------------------------------------------------------------------

export async function runAgentCommand(
  params: AgentCommandRequest
): Promise<{ success: boolean; message: string }> {
  const { boardId, command, userId, userName, selectedIds, viewport } = params;

  // Validate board exists
  const boardSnap = await admin.database().ref(`boards/${boardId}`).once('value');
  if (!boardSnap.exists()) {
    throw new Error('Board not found');
  }

  // Get compressed board context (selection, viewport, or full)
  const boardState = await agentTools.getBoardContext(boardId, {
    selectedIds: selectedIds?.length ? selectedIds : undefined,
    viewport: viewport ?? undefined,
  });

  // LangFuse observability
  const trace = getLangfuse().trace({
    name: 'agent-command',
    userId,
    metadata: { boardId, userName },
  });
  trace.update({
    input: {
      boardId,
      command,
      userId,
      userName,
      ...(selectedIds?.length && { selectedIds }),
      ...(viewport && { viewport }),
    },
  });

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(boardState) },
    { role: 'user', content: command },
  ];

  let totalToolCalls = 0;

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const generation = trace.generation({
        name: `openai-iter-${iter}`,
        model: 'gpt-4o-mini',
        input: { messages },
      });

      let response: OpenAI.ChatCompletion;
      try {
        response = await callWithRetry(() =>
          getOpenAI().chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            tools: getToolDefinitions(),
            tool_choice: 'auto',
          })
        );
      } catch (err: unknown) {
        generation.end({ output: { error: String(err) } });
        throw err;
      }

      generation.end({
        output: response.choices[0].message,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
      });

      const choice = response.choices[0];
      messages.push(choice.message as OpenAI.ChatCompletionMessageParam);

      if (choice.finish_reason !== 'tool_calls') break;

      const toolCalls = choice.message.tool_calls ?? [];
      totalToolCalls += toolCalls.length;

      const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];
      for (const tc of toolCalls) {
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        let result: unknown;
        try {
          result = await dispatchTool(tc.function.name, args, boardId, userId);
        } catch (err: unknown) {
          result = { error: String(err) };
        }
        toolResults.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result ?? null),
        });
      }
      messages.push(...toolResults);
    }

    const result = { success: true, message: `Executed ${totalToolCalls} operations` };
    trace.update({ output: { success: true, message: result.message, totalToolCalls } });
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    trace.update({ output: { success: false, error: message } });
    throw err;
  } finally {
    await getLangfuse().flushAsync();
  }
}

// ---------------------------------------------------------------------------
// Firebase Callable export
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------

async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>,
  boardId: string,
  userId: string
): Promise<unknown> {
  switch (toolName) {
    case 'createStickyNote':
      return agentTools.createStickyNote(
        boardId,
        args['text'] as string,
        args['x'] as number,
        args['y'] as number,
        args['color'] as string,
        userId
      );
    case 'createShape':
      return agentTools.createShape(
        boardId,
        args['type'] as agentTools.ShapeType,
        args['x'] as number,
        args['y'] as number,
        args['width'] as number,
        args['height'] as number,
        args['color'] as string,
        userId
      );
    case 'createFrame':
      return agentTools.createFrame(
        boardId,
        args['title'] as string,
        args['x'] as number,
        args['y'] as number,
        args['width'] as number,
        args['height'] as number,
        userId
      );
    case 'createConnector':
      return agentTools.createConnector(
        boardId,
        args['fromId'] as string,
        args['toId'] as string,
        (args['options'] as agentTools.ConnectorOptions) ?? {},
        userId
      );
    case 'createMultiPointConnector':
      return agentTools.createMultiPointConnector(
        boardId,
        args['objectIds'] as string[],
        (args['options'] as agentTools.MultiPointOptions) ?? {},
        userId
      );
    case 'connectInSequence':
      return agentTools.connectInSequence(
        boardId,
        args['objectIds'] as string[],
        (args['options'] as agentTools.SequenceOptions) ?? {},
        userId
      );
    case 'moveObject':
      return agentTools.moveObject(
        boardId,
        args['objectId'] as string,
        args['x'] as number,
        args['y'] as number
      );
    case 'resizeObject':
      return agentTools.resizeObject(
        boardId,
        args['objectId'] as string,
        args['width'] as number,
        args['height'] as number
      );
    case 'updateText':
      return agentTools.updateText(
        boardId,
        args['objectId'] as string,
        args['newText'] as string
      );
    case 'changeColor':
      return agentTools.changeColor(
        boardId,
        args['objectId'] as string,
        args['color'] as string
      );
    case 'getBoardState':
      return agentTools.getBoardState(boardId);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(boardState: { objects: Record<string, unknown>; connections: Record<string, unknown> }): string {
  const objCount = Object.keys(boardState.objects).length;
  const connCount = Object.keys(boardState.connections).length;
  const stateJson = JSON.stringify(boardState);

  return `You are an AI agent for a collaborative whiteboard. Use only tool calls.

Board context (${objCount} objects, ${connCount} connections):
${stateJson}

Rules: x right, y down; origin top-left. Spacing ≥50px. Place in (0,0)–(2000,2000).
Colors: use only these hex values: ${agentTools.BOARD_PALETTE_HEX.join(', ')}.

Tools: createStickyNote, createShape, createFrame, createConnector (use options.points for bent/multi-waypoint arrows), createMultiPointConnector, connectInSequence, moveObject, resizeObject, updateText, changeColor, getBoardState (call only if you need full board).
Create objects first to get IDs; use returned IDs for connections. Tool results contain the new ID as JSON.`;
}

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI schema)
// ---------------------------------------------------------------------------

function getToolDefinitions(): OpenAI.Chat.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'createStickyNote',
        description: 'Create a sticky note with text (160x120px)',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text content' },
            x: { type: 'number', description: 'X position' },
            y: { type: 'number', description: 'Y position' },
            color: { type: 'string', description: 'yellow, pink, blue, green, orange, purple, or hex' },
          },
          required: ['text', 'x', 'y', 'color'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createShape',
        description: 'Create a shape (rectangle, circle, or star)',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['rectangle', 'circle', 'star'] },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            color: { type: 'string' },
          },
          required: ['type', 'x', 'y', 'width', 'height', 'color'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createFrame',
        description: 'Create a frame/container with a visible title',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          required: ['title', 'x', 'y', 'width', 'height'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createConnector',
        description: 'Connect two objects with an arrow. Use options.points with multiple {x,y} waypoints for bent lines or polyline paths (e.g. face outline between two notes). Returns the connection ID.',
        parameters: {
          type: 'object',
          properties: {
            fromId: { type: 'string', description: 'Source object ID' },
            toId: { type: 'string', description: 'Target object ID' },
            options: {
              type: 'object',
              properties: {
                fromAnchor: {
                  type: 'string',
                  enum: ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'star-0', 'star-1', 'star-2', 'star-3', 'star-4'],
                },
                toAnchor: {
                  type: 'string',
                  enum: ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'star-0', 'star-1', 'star-2', 'star-3', 'star-4'],
                },
                color: { type: 'string', description: 'Board palette hex only' },
                points: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { x: { type: 'number' }, y: { type: 'number' } },
                    required: ['x', 'y'],
                  },
                  description: 'Waypoints between from and to. Multiple points create a polyline. Use for bent or complex paths.',
                },
                pointsRelative: {
                  type: 'boolean',
                  description: 'If true, points[0] is absolute {x,y}; points[1+] are {dx,dy} relative to previous. Reduces payload size.',
                },
              },
            },
          },
          required: ['fromId', 'toId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createMultiPointConnector',
        description: 'Connect multiple objects with curved lines. Returns array of connection IDs.',
        parameters: {
          type: 'object',
          properties: {
            objectIds: { type: 'array', items: { type: 'string' } },
            options: {
              type: 'object',
              properties: {
                color: { type: 'string' },
                curved: { type: 'boolean' },
              },
            },
          },
          required: ['objectIds'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connectInSequence',
        description: 'Connect objects in order A→B→C. Returns array of connection IDs.',
        parameters: {
          type: 'object',
          properties: {
            objectIds: { type: 'array', items: { type: 'string' } },
            options: {
              type: 'object',
              properties: {
                color: { type: 'string' },
                direction: { type: 'string', enum: ['forward', 'bidirectional'] },
              },
            },
          },
          required: ['objectIds'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'moveObject',
        description: 'Move an object to a new position',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['objectId', 'x', 'y'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'resizeObject',
        description: 'Resize an object',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          required: ['objectId', 'width', 'height'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'updateText',
        description: 'Update text content of an object',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            newText: { type: 'string' },
          },
          required: ['objectId', 'newText'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'changeColor',
        description: 'Change the color of an object',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            color: { type: 'string' },
          },
          required: ['objectId', 'color'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getBoardState',
        description: 'Get current board objects and connections for context',
        parameters: { type: 'object', properties: {} },
      },
    },
  ];
}
