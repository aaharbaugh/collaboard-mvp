export interface BoardObject {
  id: string;
  type: 'stickyNote' | 'rectangle' | 'circle' | 'star' | 'image' | 'text' | 'frame';
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  /** For type 'text': heading level 1–6 (1 = largest). Default 1. */
  headingLevel?: number;
  imageData?: string;
  rotation?: number;
  createdBy: string;
  createdAt: number;
  selectedBy?: string | null;
  selectedByName?: string | null;
  /** When true, object is drawn behind connection arrows */
  sentToBack?: boolean;
  /** When set, this object belongs to the frame with this id; it moves/resizes with the frame */
  frameId?: string;
  /** Prompt template with {pill:ID} tokens for wiring mode */
  promptTemplate?: string;
  /** Pill references for wiring mode */
  pills?: PillRef[];
  /** LLM output from last prompt run */
  promptOutput?: string;
  /** Whether this prompt node is enabled for execution */
  enabled?: boolean;
  /** Timestamp of last prompt run */
  lastRunAt?: number;
  /** Status of last prompt run */
  lastRunStatus?: 'success' | 'error' | 'running';
  /** Error message from last prompt run */
  lastRunError?: string;
  /** API lookup config — marks this sticky as an API node */
  apiConfig?: { apiId: string };
  /** Accumulator/Merge node config — collects outputs from multiple upstream wires */
  accumulatorConfig?: {
    mergeMode: 'concatenate' | 'json_array' | 'numbered_list';
    runPromptAfterMerge?: boolean;
  };
  /** Denormalized version count for quick UI display (historical versioning) */
  versionCount?: number;
}

export interface PillRef {
  id: string;
  label: string;
  /** Node position 1-8 on object edges (clockwise from top) */
  node: number;
  direction: 'in' | 'out';
  /** For output pills: how output is routed to wired targets */
  outputMode?: WireOutputMode;
  /** For output pills: max characters the LLM should condense output to */
  maxChars?: number;
  /** For input pills: 'list' = fan-out per line, 'whole' = pass all text as one block */
  parseMode?: 'list' | 'whole';
  /** API group id — marks this pill as part of an API block (e.g., 'weather') */
  apiGroup?: string;
}

export type WireOutputMode = 'update' | 'append' | 'create';

export interface Wire {
  id: string;
  fromObjectId: string;
  fromNode: number;
  toObjectId: string;
  toNode: number;
  color?: string;
  /** How output is routed to the target: overwrite, append, or create new sticky */
  outputMode?: WireOutputMode;
  /** Intermediate waypoints as flat [x1,y1, x2,y2, ...] world coordinates */
  points?: number[];
  createdBy: string;
  createdAt: number;
}

export type AnchorPosition = 'top' | 'bottom' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  | 'star-0' | 'star-1' | 'star-2' | 'star-3' | 'star-4';

export interface Connection {
  id: string;
  fromId: string;
  fromAnchor: AnchorPosition;
  toId: string;
  toAnchor: AnchorPosition;
  points?: number[];   // waypoint world-coordinates as [x1,y1, x2,y2, ...]
  color?: string;
  createdBy: string;
  createdAt: number;
}

export interface Cursor {
  userId: string;
  name: string;
  x: number;
  y: number;
  color: string;
  lastUpdate: number;
}

export interface Board {
  metadata: {
    owner: string;
    name: string;
    createdAt: number;
  };
  collaborators: Record<string, boolean>;
  objects: Record<string, BoardObject>;
  cursors: Record<string, Cursor>;
  connections: Record<string, Connection>;
  wires: Record<string, Wire>;
}
