export interface BoardObject {
  id: string;
  type: 'stickyNote' | 'rectangle' | 'circle' | 'image' | 'text' | 'frame';
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
}

export type AnchorPosition = 'top' | 'bottom' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

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
}
