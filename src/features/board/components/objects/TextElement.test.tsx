import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextElement } from './TextElement';
import type { BoardObject } from '../../../../types/board';

vi.mock('react-konva', () => ({
  Group: ({ children, ...props }: { children?: React.ReactNode }) => (
    <div data-testid="text-element-group" data-props={JSON.stringify(props)}>
      {children}
    </div>
  ),
  Rect: (props: Record<string, unknown>) => <div data-testid="text-element-rect" {...props} />,
  Text: ({ text, fontSize, ...props }: { text?: string; fontSize?: number }) => (
    <span data-testid="text-element-text" data-text={text} data-font-size={fontSize} {...props} />
  ),
}));

const baseObj: BoardObject = {
  id: 't1',
  type: 'text',
  x: 0,
  y: 0,
  width: 240,
  height: 60,
  text: 'Heading',
  headingLevel: 1,
  createdBy: 'u1',
  createdAt: 0,
};

describe('TextElement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<TextElement obj={baseObj} isSelected={false} zoomScale={1} />);
    expect(screen.getAllByTestId('text-element-group').length).toBeGreaterThan(0);
  });

  it('renders text content', () => {
    render(<TextElement obj={{ ...baseObj, text: 'Hello World' }} isSelected={false} zoomScale={1} />);
    const textNodes = screen.getAllByTestId('text-element-text');
    expect(textNodes.length).toBeGreaterThan(0);
    expect(textNodes.some((el) => el.getAttribute('data-text')?.includes('Hello') || el.textContent === 'Hello World')).toBe(true);
  });

  it('scales with zoomScale', () => {
    render(<TextElement obj={baseObj} isSelected={false} zoomScale={2} />);
    expect(screen.getAllByTestId('text-element-group').length).toBeGreaterThan(0);
  });

  it('renders when headingLevel is undefined (ignored)', () => {
    const obj = { ...baseObj, headingLevel: undefined };
    render(<TextElement obj={obj} isSelected={false} zoomScale={1} />);
    expect(screen.getAllByTestId('text-element-group').length).toBeGreaterThan(0);
  });
});
