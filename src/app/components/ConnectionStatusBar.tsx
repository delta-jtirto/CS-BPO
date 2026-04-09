import { Wifi, WifiOff, AlertTriangle, RefreshCw } from 'lucide-react';
import type { InboxConnection } from '@/hooks/use-firestore-connections';

interface ConnectionStatusBarProps {
  connections: InboxConnection[];
  isInitializing: boolean;
  onReconnectClick: (hostId: string) => void;
}

/**
 * Slim bar that shows connection health for all connected inboxes.
 * Only visible when initializing or when any connection is unhealthy.
 */
export function ConnectionStatusBar({
  connections,
  isInitializing,
  onReconnectClick,
}: ConnectionStatusBarProps) {
  const unhealthy = connections.filter((c) => c.status !== 'connected');
  const allHealthy = !isInitializing && unhealthy.length === 0;

  // Hide when everything is fine
  if (allHealthy && connections.length > 0) return null;

  // Initializing state
  if (isInitializing) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
        <RefreshCw size={12} className="animate-spin" />
        <span>Connecting inboxes...</span>
        {connections.map((c) => (
          <span
            key={c.hostId}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
              c.status === 'connected'
                ? 'bg-emerald-50 text-emerald-600'
                : c.status === 'disconnected'
                  ? 'bg-slate-100 text-slate-400'
                  : 'bg-amber-50 text-amber-600'
            }`}
          >
            {c.companyName}
          </span>
        ))}
      </div>
    );
  }

  // No connections at all — handled by InboxView empty state, not here
  if (connections.length === 0) return null;

  // Some connections unhealthy
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-xs">
      <AlertTriangle size={12} className="text-amber-500 shrink-0" />
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {connections.map((c) => {
          if (c.status === 'connected') {
            return (
              <span
                key={c.hostId}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-medium"
              >
                <Wifi size={10} />
                {c.companyName}
              </span>
            );
          }

          const isExpired = c.status === 'expired';
          return (
            <span
              key={c.hostId}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                isExpired
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-red-50 text-red-600'
              }`}
            >
              <WifiOff size={10} />
              {c.companyName}
              <button
                onClick={() => onReconnectClick(c.hostId)}
                className="ml-1 underline hover:no-underline font-medium"
              >
                Reconnect
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
