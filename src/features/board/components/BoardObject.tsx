import type { BoardObject as BoardObjectType } from '../../../types/board';
import { StickyNote } from './objects/StickyNote';
import { Rectangle } from './objects/Rectangle';
import { Circle } from './objects/Circle';
import { ImageObject } from './objects/ImageObject';

interface BoardObjectProps {
  obj: BoardObjectType;
  isSelected: boolean;
  remoteSelectedBy?: string;
  zoomScale?: number;
}

export function BoardObject({ obj, isSelected, remoteSelectedBy, zoomScale }: BoardObjectProps) {
  if (obj.type === 'stickyNote') {
    return <StickyNote obj={obj} isSelected={isSelected} remoteSelectedBy={remoteSelectedBy} zoomScale={zoomScale} />;
  }
  if (obj.type === 'rectangle') {
    return <Rectangle obj={obj} isSelected={isSelected} remoteSelectedBy={remoteSelectedBy} zoomScale={zoomScale} />;
  }
  if (obj.type === 'circle') {
    return <Circle obj={obj} isSelected={isSelected} remoteSelectedBy={remoteSelectedBy} zoomScale={zoomScale} />;
  }
  if (obj.type === 'image') {
    return <ImageObject obj={obj} isSelected={isSelected} remoteSelectedBy={remoteSelectedBy} zoomScale={zoomScale} />;
  }
  return null;
}
