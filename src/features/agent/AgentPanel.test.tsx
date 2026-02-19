import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockRunCommand = vi.fn();
const mockUseAgentCommand = vi.fn();

vi.mock('./useAgentCommand', () => ({
  useAgentCommand: mockUseAgentCommand,
}));

const { AgentPanel } = await import('./AgentPanel');

function defaultHookState(overrides: Partial<{ loading: boolean; error: string | null }> = {}) {
  return {
    runCommand: mockRunCommand,
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
  };
}

const defaultProps = { boardId: 'b1', isOpen: true, onClose: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockRunCommand.mockResolvedValue({ success: true });
  mockUseAgentCommand.mockReturnValue(defaultHookState());
});

describe('AgentPanel', () => {
  it('renders nothing when isOpen is false', () => {
    render(<AgentPanel boardId="b1" isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog when isOpen is true', () => {
    render(<AgentPanel {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders the input and ask button', () => {
    render(<AgentPanel {...defaultProps} />);
    expect(screen.getByRole('textbox', { name: /ai command/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ask$/i })).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AgentPanel boardId="b1" isOpen={true} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AgentPanel boardId="b1" isOpen={true} onClose={onClose} />);
    // backdrop has aria-hidden so we query it another way
    const backdrop = document.querySelector('.agent-backdrop') as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AgentPanel boardId="b1" isOpen={true} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls runCommand with the input value on submit', async () => {
    const user = userEvent.setup();
    render(<AgentPanel {...defaultProps} />);
    const input = screen.getByRole('textbox', { name: /ai command/i });
    await user.type(input, 'Create a SWOT analysis');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(mockRunCommand).toHaveBeenCalledWith('Create a SWOT analysis');
  });

  it('clears the input after a successful command', async () => {
    const user = userEvent.setup();
    render(<AgentPanel {...defaultProps} />);
    const input = screen.getByRole('textbox', { name: /ai command/i });
    await user.type(input, 'Add a sticky note');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
  });

  it('disables input and button while loading', () => {
    mockUseAgentCommand.mockReturnValue(defaultHookState({ loading: true }));
    render(<AgentPanel {...defaultProps} />);
    expect(screen.getByRole('textbox', { name: /ai command/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /working/i })).toBeDisabled();
  });

  it('displays error message when error state is set', () => {
    mockUseAgentCommand.mockReturnValue(defaultHookState({ error: 'Something went wrong' }));
    render(<AgentPanel {...defaultProps} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('clicking an example command populates the input', async () => {
    const user = userEvent.setup();
    render(<AgentPanel {...defaultProps} />);
    const exampleBtns = screen.getAllByRole('button', { name: /swot|flowchart|mind map|connect/i });
    await user.click(exampleBtns[0]);
    const input = screen.getByRole('textbox', { name: /ai command/i });
    expect((input as HTMLInputElement).value).not.toBe('');
  });

  it('does not submit when input is empty', async () => {
    const user = userEvent.setup();
    render(<AgentPanel {...defaultProps} />);
    const button = screen.getByRole('button', { name: /^ask$/i });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it('passes the correct boardId to useAgentCommand', () => {
    render(<AgentPanel boardId="my-board-42" isOpen={true} onClose={vi.fn()} />);
    expect(mockUseAgentCommand).toHaveBeenCalledWith('my-board-42');
  });
});
