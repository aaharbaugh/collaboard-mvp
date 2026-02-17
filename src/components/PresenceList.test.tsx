import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PresenceList } from './PresenceList';
import type { Cursor } from '../types/board';

describe('PresenceList', () => {
  it('shows "Just you" when no other cursors', () => {
    render(<PresenceList cursors={{}} />);
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Just you')).toBeInTheDocument();
  });

  it('renders avatar for each cursor with initial and name in title', () => {
    const cursors: Record<string, Cursor> = {
      u1: { userId: 'u1', name: 'Alice', x: 0, y: 0, color: '#ff0000', lastUpdate: 0 },
      u2: { userId: 'u2', name: 'Bob', x: 10, y: 10, color: '#00ff00', lastUpdate: 0 },
    };
    const { container } = render(<PresenceList cursors={cursors} />);
    expect(screen.getByText('Online')).toBeInTheDocument();
    const avatars = container.querySelectorAll('.presence-avatar');
    expect(avatars).toHaveLength(2);
    expect(avatars[0]).toHaveAttribute('title', 'Alice');
    expect(avatars[0]).toHaveTextContent('A');
    expect(avatars[1]).toHaveAttribute('title', 'Bob');
    expect(avatars[1]).toHaveTextContent('B');
  });
});
