import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Used in the fallback heading and the console log. */
  label: string;
  /** Optional resetKey: when it changes, the boundary clears its
   *  errored state. Pass the active ticket id to recover automatically
   *  when the user navigates to a different thread. */
  resetKey?: string | number | null;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Soft error boundary for sidebar / composer panels. A render-time
 * throw inside `<AssistantPanel>` or `<SmartReplyPanel>` would
 * otherwise unmount the entire InboxView and lose the agent's draft.
 * This contains the failure to the panel, shows a recoverable error
 * state, and lets navigation to another thread reset it.
 */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[PanelErrorBoundary:${this.props.label}] render failed:`,
      error,
      info.componentStack,
    );
  }

  override componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        role="alert"
        className="m-3 p-4 rounded border border-dashed border-amber-300 bg-amber-50 text-amber-900"
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
          <span>{this.props.label} couldn't load</span>
        </div>
        <p className="mt-1 text-xs text-amber-800/80">
          {this.state.error?.message || 'An unexpected error occurred while rendering this panel.'}
        </p>
        <button
          type="button"
          onClick={this.handleRetry}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-900 hover:underline"
        >
          <RotateCcw size={11} /> Retry
        </button>
      </div>
    );
  }
}
