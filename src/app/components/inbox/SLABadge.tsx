import { useState, useEffect, memo } from 'react';
import { computeSLA, formatSLARelative, type EscalationOverride, type SLAResult } from '@/lib/compute-ticket-state';
import type { HostSettings } from '@/app/context/AppContext';

interface SLABadgeProps {
  lastGuestMessageAt: number | null;
  hostSettings?: HostSettings | null;
  resolvedAt?: number | null;
  escalationOverride?: EscalationOverride | null;
  /** Tick interval in ms. 1000 for detail view, 30000 for list. */
  tickInterval: number;
  className?: string;
}

/**
 * Isolated SLA display component that owns its own tick interval.
 * Prevents re-rendering the entire parent (message list, composer, etc.) on each tick.
 */
export const SLABadge = memo(function SLABadge({
  lastGuestMessageAt,
  hostSettings,
  resolvedAt,
  escalationOverride,
  tickInterval,
  className = '',
}: SLABadgeProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), tickInterval);
    return () => clearInterval(timer);
  }, [tickInterval]);

  const result = computeSLA(lastGuestMessageAt, hostSettings, resolvedAt, escalationOverride);

  if (result.resolved) {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-400 ${className}`}>
        Resolved
      </span>
    );
  }

  const statusStyles: Record<string, string> = {
    normal: 'text-slate-400',
    warning: 'text-amber-500',
    urgent: 'text-red-500',
    stale: 'text-red-700',
  };

  return (
    <span className={`text-[11px] font-mono font-medium tabular-nums ${statusStyles[result.status] || 'text-slate-400'} ${className}`}>
      {formatSLARelative(result.sla)}
    </span>
  );
});

/**
 * Get the SLA status for styling purposes (border color, avatar color).
 * Uses the same computation as SLABadge but without the tick — for static style decisions.
 */
export function getSLAStatus(
  lastGuestMessageAt: number | null,
  resolvedAt?: number | null,
  escalationOverride?: EscalationOverride | null,
): SLAResult {
  return computeSLA(lastGuestMessageAt, null, resolvedAt, escalationOverride);
}
