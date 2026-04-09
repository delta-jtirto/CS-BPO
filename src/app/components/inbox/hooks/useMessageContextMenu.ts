import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

interface ContextMenuState {
  x: number;
  y: number;
  msgId: number;
  msgText: string;
  senderType: string;
}

export function useMessageContextMenu(
  activeTicketId: string | undefined,
  deleteMessageFromTicket: (ticketId: string, msgId: number) => void,
) {
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set());
  const deleteTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const scheduleDelete = useCallback((ticketId: string, msgId: number, senderLabel: string) => {
    setPendingDeletes(prev => new Set(prev).add(msgId));
    toast(`Deleted ${senderLabel}`, {
      description: 'Message will be removed permanently',
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(deleteTimersRef.current[msgId]);
          delete deleteTimersRef.current[msgId];
          setPendingDeletes(prev => {
            const next = new Set(prev);
            next.delete(msgId);
            return next;
          });
          toast.success('Message restored');
        },
      },
    });
    deleteTimersRef.current[msgId] = setTimeout(() => {
      deleteMessageFromTicket(ticketId, msgId);
      setPendingDeletes(prev => {
        const next = new Set(prev);
        next.delete(msgId);
        return next;
      });
      delete deleteTimersRef.current[msgId];
    }, 5000);
  }, [deleteMessageFromTicket]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(deleteTimersRef.current).forEach(clearTimeout);
    };
  }, []);

  // Close context menu on click outside / scroll / escape
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const handleClickOutside = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('scroll', close, true);
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [ctxMenu]);

  // Reset on ticket change
  useEffect(() => { setCtxMenu(null); }, [activeTicketId]);

  const handleMsgContextMenu = useCallback((e: React.MouseEvent, msgId: number, msgText: string, senderType: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, msgId, msgText, senderType });
  }, []);

  return {
    ctxMenu, setCtxMenu, ctxMenuRef,
    pendingDeletes,
    scheduleDelete,
    handleMsgContextMenu,
  };
}
