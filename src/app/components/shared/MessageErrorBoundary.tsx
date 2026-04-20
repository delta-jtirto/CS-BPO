import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Message id, surfaced in the fallback for support diagnostics. */
  messageId?: number | string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Per-message row error boundary. Scoped tight — a single malformed or
 * malformed-at-render message can't tear down the entire thread. Surrounding
 * messages remain readable and the agent can still scroll, react, and reply.
 *
 * Typical triggers this catches:
 *   - Firestore / Supabase snapshot payload drift (missing fields, wrong types)
 *   - A render-time throw from an unexpected attachment shape
 *   - Any future per-row feature that bubbles up during render
 *
 * Note: error boundaries don't catch errors in event handlers or in async
 * work triggered from a render — those still route to toasts / console. This
 * is specifically about render-time failures of a single <div>.
 */
export class MessageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      '[MessageErrorBoundary] Failed to render message %s:',
      this.props.messageId,
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.hasError) {
      return <MalformedMessageFallback messageId={this.props.messageId} />;
    }
    return this.props.children;
  }
}

interface FallbackProps {
  messageId?: number | string;
}

/**
 * Placeholder for a message that couldn't be rendered. Designed to look like
 * a thin inline notice — not a scary error dialog — so agents can scan past
 * it without losing their place in the thread.
 */
export function MalformedMessageFallback({ messageId }: FallbackProps) {
  return (
    <div
      className="self-center w-full max-w-[560px] my-1"
      role="alert"
      aria-label="Message could not be displayed"
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/40 border border-dashed border-muted-foreground/30 rounded px-3 py-1.5">
        <AlertTriangle size={12} className="shrink-0 text-amber-500" />
        <span className="min-w-0 truncate">
          Message could not be displayed{messageId !== undefined ? ` — id: ${messageId}` : ''}
        </span>
      </div>
    </div>
  );
}
