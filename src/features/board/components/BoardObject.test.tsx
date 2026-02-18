import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BoardObject } from './BoardObject';
import type { BoardObject as BoardObjectType } from '../../../types/board';

const baseObj: BoardObjectType = {
  id: 'obj1',
  type: 'stickyNote',
  x: 0,
  y: 0,
  width: 120,
  height: 80,
  color: '#f5e6ab',
  text: 'Hello',
  createdBy: 'u1',
  createdAt: 0,
};

vi.mock('./objects/StickyNote', () => ({
  StickyNote: () => <div data-testid="sticky-note">StickyNote</div>,
}));
vi.mock('./objects/Rectangle', () => ({
  Rectangle: () => <div data-testid="rectangle">Rectangle</div>,
}));
vi.mock('./objects/Circle', () => ({
  Circle: () => <div data-testid="circle">Circle</div>,
}));
vi.mock('./objects/Star', () => ({
  Star: () => <div data-testid="star">Star</div>,
}));
vi.mock('./objects/ImageObject', () => ({
  ImageObject: () => <div data-testid="image-object">Image</div>,
}));
vi.mock('./objects/TextElement', () => ({
  TextElement: () => <div data-testid="text-element">TextElement</div>,
}));
vi.mock('./objects/Frame', () => ({
  Frame: () => <div data-testid="frame">Frame</div>,
}));

describe('BoardObject', () => {
  it('renders StickyNote for type stickyNote', () => {
    render(<BoardObject obj={baseObj} isSelected={false} />);
    expect(screen.getByTestId('sticky-note')).toBeInTheDocument();
  });

  it('renders Rectangle for type rectangle', () => {
    render(<BoardObject obj={{ ...baseObj, type: 'rectangle' }} isSelected={false} />);
    expect(screen.getByTestId('rectangle')).toBeInTheDocument();
  });

  it('renders Circle for type circle', () => {
    render(<BoardObject obj={{ ...baseObj, type: 'circle' }} isSelected={false} />);
    expect(screen.getByTestId('circle')).toBeInTheDocument();
  });

  it('renders ImageObject for type image', () => {
    render(<BoardObject obj={{ ...baseObj, type: 'image' }} isSelected={false} />);
    expect(screen.getByTestId('image-object')).toBeInTheDocument();
  });

  it('renders TextElement for type text', () => {
    render(<BoardObject obj={{ ...baseObj, type: 'text' }} isSelected={false} />);
    expect(screen.getByTestId('text-element')).toBeInTheDocument();
  });

  it('renders Frame for type frame', () => {
    render(<BoardObject obj={{ ...baseObj, type: 'frame' }} isSelected={false} />);
    expect(screen.getByTestId('frame')).toBeInTheDocument();
  });

  it('renders Star for type star', () => {
    render(<BoardObject obj={{ ...baseObj, type: 'star' }} isSelected={false} />);
    expect(screen.getByTestId('star')).toBeInTheDocument();
  });

  it('renders nothing for unknown type', () => {
    render(
      <BoardObject obj={{ ...baseObj, type: 'unknown' as 'stickyNote' }} isSelected={false} />
    );
    expect(screen.queryByTestId('sticky-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rectangle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('circle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('image-object')).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-element')).not.toBeInTheDocument();
    expect(screen.queryByTestId('frame')).not.toBeInTheDocument();
    expect(screen.queryByTestId('star')).not.toBeInTheDocument();
  });
});
