import { useRouteError, useNavigate } from 'react-router';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';

/**
 * Error fallback rendered INSIDE the layout (inside AppProvider).
 * Prevents React Router's default error boundary from unmounting the entire tree.
 */
export function RouteErrorFallback() {
  const error = useRouteError() as Error | { statusText?: string; message?: string };
  const navigate = useNavigate();

  const message =
    error instanceof Error
      ? error.message
      : (error as any)?.statusText || (error as any)?.message || 'An unexpected error occurred';

  const stack = error instanceof Error ? error.stack : undefined;

  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-slate-50">
      <div className="max-w-lg w-full text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-6">
          <AlertTriangle size={32} className="text-red-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Something went wrong</h2>
        <p className="text-sm text-slate-500 mb-6">
          This view encountered an error while loading. The rest of the app is still working.
        </p>

        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-left">
          <p className="text-xs font-bold text-red-700 uppercase tracking-wider mb-1">Error</p>
          <p className="text-sm text-red-800 font-mono break-words">{message}</p>
          {stack && (
            <details className="mt-2">
              <summary className="text-[10px] text-red-500 cursor-pointer hover:text-red-700">
                Show stack trace
              </summary>
              <pre className="mt-1 text-[9px] text-red-600 whitespace-pre-wrap break-words max-h-40 overflow-y-auto font-mono">
                {stack}
              </pre>
            </details>
          )}
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 text-sm font-medium bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2"
          >
            <ArrowLeft size={14} /> Go Back
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <RefreshCw size={14} /> Reload Page
          </button>
        </div>
      </div>
    </div>
  );
}
