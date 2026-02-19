import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Frame } from './Frame';
import type { BoardObject } from '../../../../types/board';

vi.mock('react-konva', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Rect: () => <div data-testid="frame-rect" />,
  Text: ({ text }: { text?: string }) => <div data-testid="konva-text">{text}</div>,
}));

const baseObj: BoardObject = {
  id: 'frame1',
  type: 'frame',
  x: 100,
  y: 100,
  width: 320,
  height: 220,
  createdBy: 'u1',
  createdAt: 0,
};

describe('Frame', () => {
  it('renders the frame rect without crashing', () => {
    render(<Frame obj={baseObj} isSelected={false} />);
    expect(screen.getByTestId('frame-rect')).toBeInTheDocument();
  });

  it('renders title when obj.text is provided', () => {
    render(<Frame obj={{ ...baseObj, text: 'Sprint Planning' }} isSelected={false} />);
    expect(screen.getByText('Sprint Planning')).toBeInTheDocument();
  });

  it('does not render a title element when obj.text is undefined', () => {
    render(<Frame obj={{ ...baseObj, text: undefined }} isSelected={false} />);
    // The remoteSelectedBy Text is absent too, so no konva-text elements
    expect(screen.queryByText('Sprint Planning')).not.toBeInTheDocument();
  });

  it('does not render a title element when obj.text is empty string', () => {
    render(<Frame obj={{ ...baseObj, text: '' }} isSelected={false} />);
    const texts = screen.queryAllByTestId('konva-text');
    // An empty string is falsy, so no Text element should be rendered for title
    const withContent = texts.filter((el) => el.textContent !== '');
    expect(withContent).toHaveLength(0);
  });

  it('renders the remote user label when remoteSelectedBy is provided', () => {
    render(
      <Frame obj={baseObj} isSelected={false} remoteSelectedBy="Alice" />
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders both title and remote user label when both are provided', () => {
    render(
      <Frame
        obj={{ ...baseObj, text: 'My Frame' }}
        isSelected={false}
        remoteSelectedBy="Bob"
      />
    );
    expect(screen.getByText('My Frame')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
});
