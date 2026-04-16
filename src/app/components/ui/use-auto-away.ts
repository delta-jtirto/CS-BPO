import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

interface UseAutoAwayOptions {
  agentPresence: 'online' | 'away';
  setAgentPresence: (presence: 'online' | 'away') => void;
  /** Minutes of inactivity before auto-away triggers. 0 = disabled. */
  autoAwayMinutes: number;
}

/**
 * Automatically transitions the agent to 'away' after a period of inactivity.
 * Resets the timer on any mouse/keyboard/touch event.
 * Shows a dismissible toast when auto-away fires.
 */
export function useAutoAway({ agentPresence, setAgentPresence, autoAwayMinutes }: UseAutoAwayOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceRef = useRef(agentPresence);
  presenceRef.current = agentPresence;

  useEffect(() => {
    if (autoAwayMinutes <= 0) return; // disabled

    const delayMs = autoAwayMinutes * 60_000;

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      // Only start the countdown when the agent is online
      if (presenceRef.current !== 'online') return;
      timerRef.current = setTimeout(() => {
        setAgentPresence('away');
        toast('AI is now handling guests', {
          description: `You were inactive for ${autoAwayMinutes} min.`,
          action: {
            label: "I'm back",
            onClick: () => setAgentPresence('online'),
          },
          duration: 10_000,
        });
      }, delayMs);
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer(); // start on mount

    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [autoAwayMinutes, setAgentPresence]);

  // When agent manually goes online, reset the inactivity timer
  useEffect(() => {
    if (agentPresence === 'online' && autoAwayMinutes > 0) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setAgentPresence('away');
        toast('AI is now handling guests', {
          description: `You were inactive for ${autoAwayMinutes} min.`,
          action: {
            label: "I'm back",
            onClick: () => setAgentPresence('online'),
          },
          duration: 10_000,
        });
      }, autoAwayMinutes * 60_000);
    }
  }, [agentPresence, autoAwayMinutes, setAgentPresence]);
}
