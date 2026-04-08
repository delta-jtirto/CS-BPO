import { useState, useEffect, useCallback, useRef } from 'react';
import { type Firestore } from 'firebase/firestore';
import {
  authenticateHost, disconnectHost, validateToken, maskToken,
  AuthError, type ConnectionHealth, type AuthenticatedHost,
} from '@/lib/unibox-auth';
import type { Host } from '@/app/data/types';

export interface InboxConnection {
  hostId: string;
  companyName: string;
  host: Host;
  maskedToken: string;
  status: ConnectionHealth;
  statusMessage?: string;
  userId?: string;
  db?: Firestore;
}

export interface SavedConnection {
  hostId: string;
  companyName: string;
  host: Host;
  accessToken: string; // full token — only stored in Supabase KV, never displayed
  maskedToken: string;
}

interface UseFirestoreConnectionsResult {
  connections: InboxConnection[];
  isInitializing: boolean;
  /** Add a new inbox connection (validates + authenticates) */
  addConnection: (accessToken: string, host: Host) => Promise<void>;
  /** Remove a connection by hostId */
  removeConnection: (hostId: string) => Promise<void>;
  /** Re-authenticate an expired connection with a new token */
  reconnect: (hostId: string, newToken: string) => Promise<void>;
  /** Test a connection's token validity */
  testConnection: (hostId: string) => Promise<boolean>;
  /** Callback for saving connections externally (to Supabase KV) */
  savedConnections: SavedConnection[];
}

/**
 * Manages the lifecycle of all Firestore company connections.
 * Progressive auth on mount — no blocking gate.
 *
 * @param initialSaved - connections loaded from Supabase KV on app start
 * @param onHealthChange - called when any connection's health changes (for toasts)
 * @param onSave - called when the saved connections list changes (for Supabase KV persistence)
 */
export function useFirestoreConnections(
  initialSaved: SavedConnection[],
  onHealthChange?: (hostId: string, companyName: string, health: ConnectionHealth, message: string) => void,
  onSave?: (connections: SavedConnection[]) => void,
): UseFirestoreConnectionsResult {
  const [connections, setConnections] = useState<InboxConnection[]>([]);
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>(initialSaved);
  const [isInitializing, setIsInitializing] = useState(true);
  const authRefs = useRef<Map<string, AuthenticatedHost>>(new Map());

  // Ref to current connections — avoids dependency cycle in callbacks
  const connectionsRef = useRef<InboxConnection[]>([]);
  connectionsRef.current = connections;

  // Update a single connection's state
  const updateConnection = useCallback((hostId: string, updates: Partial<InboxConnection>) => {
    setConnections((prev) =>
      prev.map((c) => (c.hostId === hostId ? { ...c, ...updates } : c)),
    );
  }, []);

  // Auth state change handler (passed to authenticateHost)
  // Uses ref to avoid re-creating on every connections change
  const handleHealthChange = useCallback(
    (hostId: string, health: ConnectionHealth) => {
      const conn = connectionsRef.current.find((c) => c.hostId === hostId);
      const message =
        health === 'expired'
          ? 'Token expired — paste a new token to reconnect'
          : health === 'permission-denied'
            ? 'Access denied — check your Unified Inbox permissions'
            : 'Connection lost — check your network';

      updateConnection(hostId, { status: health, statusMessage: message, db: undefined, userId: undefined });
      onHealthChange?.(hostId, conn?.companyName || hostId, health, message);
    },
    [updateConnection, onHealthChange],
  );

  // Authenticate a single connection
  const authSingle = useCallback(
    async (saved: SavedConnection): Promise<InboxConnection> => {
      try {
        const result = await authenticateHost(saved.accessToken, saved.hostId, handleHealthChange);
        authRefs.current.set(saved.hostId, result);
        return {
          hostId: saved.hostId,
          companyName: result.companyName || saved.companyName,
          host: saved.host,
          maskedToken: saved.maskedToken,
          status: 'connected',
          userId: result.userId,
          db: result.db,
        };
      } catch (err) {
        const authErr = err instanceof AuthError ? err : new AuthError('network-error', String(err));
        return {
          hostId: saved.hostId,
          companyName: saved.companyName,
          host: saved.host,
          maskedToken: saved.maskedToken,
          status: authErr.health,
          statusMessage: authErr.message,
        };
      }
    },
    [handleHealthChange],
  );

  // Progressive initialization — authenticate each saved connection without blocking
  useEffect(() => {
    if (initialSaved.length === 0) {
      setIsInitializing(false);
      return;
    }

    // Set all connections as "connecting" initially
    setConnections(
      initialSaved.map((s) => ({
        hostId: s.hostId,
        companyName: s.companyName,
        host: s.host,
        maskedToken: s.maskedToken,
        status: 'disconnected' as ConnectionHealth,
        statusMessage: 'Connecting...',
      })),
    );

    let cancelled = false;

    // Authenticate each in parallel — no gate
    Promise.allSettled(initialSaved.map(authSingle)).then((results) => {
      if (cancelled) return;
      const authenticated: InboxConnection[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') authenticated.push(r.value);
      }
      setConnections(authenticated);
      setIsInitializing(false);
    });

    return () => {
      cancelled = true;
    };
  // Only run on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist saved connections when they change
  useEffect(() => {
    onSave?.(savedConnections);
  }, [savedConnections, onSave]);

  // ─── Public API ──────────────────────────────────

  const addConnection = useCallback(
    async (accessToken: string, host: Host) => {
      // Validate first
      const user = await validateToken(accessToken);

      const saved: SavedConnection = {
        hostId: host.id,
        companyName: user.name,
        host,
        accessToken,
        maskedToken: maskToken(accessToken),
      };

      // Add to saved list
      setSavedConnections((prev) => [...prev.filter((c) => c.hostId !== host.id), saved]);

      // Authenticate
      const conn = await authSingle(saved);
      setConnections((prev) => [...prev.filter((c) => c.hostId !== host.id), conn]);
    },
    [authSingle],
  );

  const removeConnection = useCallback(
    async (hostId: string) => {
      // Clean up Firebase app
      const authRef = authRefs.current.get(hostId);
      if (authRef) {
        authRef.unsubAuthListener();
        authRefs.current.delete(hostId);
      }
      await disconnectHost(hostId);

      setConnections((prev) => prev.filter((c) => c.hostId !== hostId));
      setSavedConnections((prev) => prev.filter((c) => c.hostId !== hostId));
    },
    [],
  );

  // Ref to current saved connections — avoids dependency cycle
  const savedConnectionsRef = useRef<SavedConnection[]>([]);
  savedConnectionsRef.current = savedConnections;

  const reconnect = useCallback(
    async (hostId: string, newToken: string) => {
      const oldRef = authRefs.current.get(hostId);
      if (oldRef) {
        oldRef.unsubAuthListener();
        authRefs.current.delete(hostId);
      }
      await disconnectHost(hostId);

      const saved = savedConnectionsRef.current.find((c) => c.hostId === hostId);
      if (!saved) throw new Error(`No saved connection for ${hostId}`);

      const updatedSaved: SavedConnection = {
        ...saved,
        accessToken: newToken,
        maskedToken: maskToken(newToken),
      };

      setSavedConnections((prev) =>
        prev.map((c) => (c.hostId === hostId ? updatedSaved : c)),
      );

      const conn = await authSingle(updatedSaved);
      setConnections((prev) => prev.map((c) => (c.hostId === hostId ? conn : c)));
    },
    [authSingle],
  );

  const testConnection = useCallback(
    async (hostId: string): Promise<boolean> => {
      const saved = savedConnectionsRef.current.find((c) => c.hostId === hostId);
      if (!saved) return false;
      try {
        await validateToken(saved.accessToken);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const [, ref] of authRefs.current) {
        ref.unsubAuthListener();
      }
    };
  }, []);

  return {
    connections,
    isInitializing,
    addConnection,
    removeConnection,
    reconnect,
    testConnection,
    savedConnections,
  };
}
