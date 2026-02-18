import { memo } from 'react';
import type { BoardObject as BoardObjectType } from '../../../types/board';
import { StickyNote } from './objects/StickyNote';
import { TextElement } from './objects/TextElement';
import { Rectangle } from './objects/Rectangle';
import { Circle } from './objects/Circle';
import { Star } from './objects/Star';
import { ImageObject } from './objects/ImageObject';
import { Frame } from './objects/Frame';

interface BoardObjectProps {
  obj: BoardObjectType;
  isSelected: boolean;
  /** When false (e.g. multi-select), no per-object selection border is drawn */
  showSelectionBorder?: boolean;
  remoteSelectedBy?: string;
  zoomScale?: number;
}

function areEqual(prev: BoardObjectProps, next: BoardObjectProps): boolean {
  if (prev.obj.id !== next.obj.id) return false;
  if (
    prev.isSelected !== next.isSelected ||
    prev.showSelectionBorder !== next.showSelectionBorder ||
    prev.remoteSelectedBy !== next.remoteSelectedBy ||
    prev.zoomScale !== next.zoomScale
  )
    return false;
  const a = prev.obj;
  const b = next.obj;
  if (a.type !== b.type) return false;
  if (a.width !== b.width || a.height !== b.height || a.text !== b.text || a.color !== b.color) return false;
  if ((a.rotation ?? 0) !== (b.rotation ?? 0)) return false;
  if (a.sentToBack !== b.sentToBack) return false;
  if (a.selectedBy !== b.selectedBy || a.selectedByName !== b.selectedByName) return false;
  if (a.type === 'image' && (a as { imageData?: string }).imageData !== (b as { imageData?: string }).imageData) return false;
  if ((a as { frameId?: string }).frameId !== (b as { frameId?: string }).frameId) return false;
  return true;
}

function BoardObjectInner({ obj, isSelected, showSelectionBorder = true, remoteSelectedBy, zoomScale }: BoardObjectProps) {
  if (obj.type === 'stickyNote') {
    return <StickyNote obj={obj} isSelected={isSelected} showSelectionBorder={showSelectionBorder} remoteSelectedBy={remoteSelectedBy} zoomScale={zoomScale} />;
  }
  if (obj.type === 'text') {
    return <TextElement obj={obj} isSelected={isSelected} showSelectionBorder={showSelectionBorder} remoteSelectedBy={remoteSelectedBy} zoomScale={zoomScale} />;
  }
  if (obj.type === 'rectangle') {
    return <Rectangle obj={obj} isSelected={isSelected} showSelectionBorder={showSelectionBorder} remoteSelectedBy={remoteSelectedBy} zoomScale={zoomScale} />;
  }
  if (obj.type === 'circle') {
    return <Circle obj={obj} isSelected={isSelected} showSelectionBorder={showSelectionBorder} remoteSelectedBy={remoteSelectedBy} zoomScale={zoomScale} />;
  }
  if (obj.type === 'star') {
    return <Star obj={obj} isSelected={isSelected} showSelectionBorder={showSelectionBorder} remoteSelectedBy={remoteSelectedBy} zoomScale={zoomScale} />;
  }
  if (obj.type === 'image') {
    return <ImageObject obj={obj} isSelected={isSelected} showSelectionBorder={showSelectionBorder} remoteSelectedBy={remoteSelectedBy} zoomScale={zoomScale} />;
  }
  if (obj.type === 'frame') {
    return <Frame obj={obj} isSelected={isSelected} showSelectionBorder={showSelectionBorder} remoteSelectedBy={remoteSelectedBy} zoomScale={zoomScale} />;
  }
  return null;
}

export const BoardObject = memo(BoardObjectInner, areEqual);
