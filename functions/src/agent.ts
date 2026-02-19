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
  const { boardId, command, userId, userName } = params;

  // Validate board exists
  const boardSnap = await admin.database().ref(`boards/${boardId}`).once('value');
  if (!boardSnap.exists()) {
    throw new Error('Board not found');
  }

  // Get current board state for context
  const boardState = await agentTools.getBoardState(boardId);

  // LangFuse observability
  const trace = getLangfuse().trace({
    name: 'agent-command',
    userId,
    metadata: { boardId, command, userName },
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

    return { success: true, message: `Executed ${totalToolCalls} operations` };
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
  return `You are an AI agent controlling a collaborative whiteboard.

Current board state:
${JSON.stringify(boardState, null, 2)}

TOOLS AVAILABLE:
- createStickyNote(text, x, y, color): Creates a sticky note (160x120px)
- createShape(type, x, y, width, height, color): Creates rectangle, circle, or star
- createFrame(title, x, y, width, height): Creates a labeled frame/container (default 320x220px)
- createConnector(fromId, toId, options?): Connects two objects with an arrow
  - options.fromAnchor: 'top'|'bottom'|'left'|'right'|'top-left'|'top-right'|'bottom-left'|'bottom-right'|'star-0'...'star-4'
  - options.toAnchor: same options as fromAnchor
  - options.color: line color (default '#00d4ff')
  - options.points: [{x,y}] waypoints for curved/bent lines
- createMultiPointConnector(objectIds, options?): Connects multiple objects with curved lines
- connectInSequence(objectIds, options?): Connects objects A→B→C→D in order
- moveObject(objectId, x, y): Moves object to new position
- resizeObject(objectId, width, height): Resizes object
- updateText(objectId, newText): Updates text content
- changeColor(objectId, color): Changes object color
- getBoardState(): Returns current objects and connections

COORDINATE SYSTEM: x increases right, y increases down. Origin (0,0) top-left.
SPACING: 50px minimum between objects. Use 150px for flowchart steps.
BOARD AREA: Place content in (0,0) to (2000,2000) range.

OBJECT TYPES: stickyNote, rectangle, circle, star, text, frame
COLOR NAMES: yellow, pink, blue, green, orange, purple (or hex codes)

ANCHOR SYSTEM:
- Rectangles/Frames/Sticky Notes: top, bottom, left, right, top-left, top-right, bottom-left, bottom-right
- Circles: top, bottom, left, right
- Stars: star-0 (top), star-1, star-2, star-3, star-4 (clockwise)

IMPORTANT WORKFLOW:
1. Call getBoardState first to understand the current board
2. Create objects first to get their IDs
3. Use returned IDs to create connections in subsequent calls
4. The tool result content contains the created object ID (as a JSON string)

PATTERNS:
- Flowchart: createShape(circle) → createShape(rectangle) → ... → connectInSequence([id1,id2,...])
- Mind map: createShape(circle, center) → createStickyNote(branches...) → createConnector(center,branch) x N
- Org chart: createShape(rectangle, top) → createShape(rectangle, children...) → connectInSequence
- SWOT: createFrame("Strengths",...) × 4, arrange in 2×2 grid

Always use tool calls. Never return plain text responses.`;
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
        description: 'Connect two objects with an arrow. Returns the connection ID.',
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
                color: { type: 'string' },
                points: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { x: { type: 'number' }, y: { type: 'number' } },
                    required: ['x', 'y'],
                  },
                  description: 'Waypoints for curved/bent paths',
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
