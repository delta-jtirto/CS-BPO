import { Bot, Copy, Trash2, PauseCircle, SkipForward } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import type { Ticket, Message } from '../../data/types';

interface InboxDialogsProps {
  activeTicket: Ticket;
  messageCount: number;
  filteredTickets: Ticket[];
  isMobile: boolean;
  agentName: string;
  // Resolve dialog
  showResolveConfirm: boolean;
  setShowResolveConfirm: (v: boolean) => void;
  onResolve: () => void;
  // Delete dialog
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (v: boolean) => void;
  onDeleteThread: (deletedId: string) => void;
  // Cancel AI menu
  showCancelMenu: boolean;
  setShowCancelMenu: (v: boolean) => void;
  toggleAutoReplyPause: (id: string) => void;
  // Context menu
  ctxMenu: { x: number; y: number; msgId: number; msgText: string; senderType: string } | null;
  setCtxMenu: (v: null) => void;
  ctxMenuRef: React.RefObject<HTMLDivElement | null>;
  scheduleDelete: (ticketId: string, msgId: number, senderLabel: string) => void;
}

export function InboxDialogs({
  activeTicket,
  messageCount,
  filteredTickets,
  isMobile,
  agentName,
  showResolveConfirm, setShowResolveConfirm, onResolve,
  showDeleteConfirm, setShowDeleteConfirm, onDeleteThread,
  showCancelMenu, setShowCancelMenu, toggleAutoReplyPause,
  ctxMenu, setCtxMenu, ctxMenuRef, scheduleDelete,
}: InboxDialogsProps) {
  return (
    <>
      <ConfirmDialog
        open={showResolveConfirm}
        title="Resolve this ticket?"
        description={`This will close ${activeTicket.guestName}'s ticket (${activeTicket.id}) and remove it from the active queue. This action cannot be undone.`}
        confirmLabel="Resolve Ticket"
        cancelLabel="Keep Open"
        variant="warning"
        onConfirm={() => { setShowResolveConfirm(false); onResolve(); }}
        onCancel={() => setShowResolveConfirm(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this thread?"
        description={`This will permanently remove ${activeTicket.guestName}'s entire conversation (${messageCount} messages). This action cannot be undone.`}
        confirmLabel="Delete Thread"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          setShowDeleteConfirm(false);
          onDeleteThread(activeTicket.id);
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Cancel AI menu — pause or skip */}
      <AnimatePresence>
        {showCancelMenu && (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/20" onClick={() => setShowCancelMenu(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-xl shadow-2xl border border-slate-200 p-5 w-[340px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="bg-violet-100 p-2 rounded-lg">
                  <Bot size={16} className="text-violet-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">AI reply stopped</h3>
                  <p className="text-[11px] text-slate-500">What would you like to do?</p>
                </div>
              </div>

              <div className="space-y-2">
                <button
                  onClick={() => {
                    setShowCancelMenu(false);
                    toast.info('Skipped this time', { description: 'AI will still review the next guest message in this thread.' });
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <SkipForward size={14} className="text-slate-400 group-hover:text-indigo-500 transition-colors" />
                    <div>
                      <span className="text-sm font-medium text-slate-700">Skip this time only</span>
                      <p className="text-[10px] text-slate-400">AI will review the next guest message normally</p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    toggleAutoReplyPause(activeTicket.id);
                    setShowCancelMenu(false);
                    toast.warning('AI paused for this thread', {
                      description: `Auto-reply paused for ${activeTicket.guestName}. Click the status chip to re-enable.`,
                      duration: 6000,
                      action: {
                        label: 'Resume',
                        onClick: () => toggleAutoReplyPause(activeTicket.id),
                      },
                    });
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-amber-200 bg-amber-50/50 hover:bg-amber-50 transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <PauseCircle size={14} className="text-amber-500" />
                    <div>
                      <span className="text-sm font-medium text-amber-800">Pause AI for this thread</span>
                      <p className="text-[10px] text-amber-600">No AI replies until you re-enable from the status chip</p>
                    </div>
                  </div>
                </button>
              </div>

              <button
                onClick={() => setShowCancelMenu(false)}
                className="mt-3 w-full text-center text-[11px] text-slate-400 hover:text-slate-600 transition-colors py-1"
              >
                Dismiss
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Message context menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-[9999] animate-in fade-in zoom-in-95 duration-100"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[180px] overflow-hidden">
            <div className="px-3 py-1.5 border-b border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {ctxMenu.senderType === 'guest' ? activeTicket.guestName
                  : ctxMenu.senderType === 'bot' ? 'AI Auto-Reply'
                  : ctxMenu.senderType === 'host' ? activeTicket.host.name
                  : agentName}
              </span>
            </div>

            <button
              onClick={() => {
                navigator.clipboard.writeText(ctxMenu.msgText);
                toast.success('Copied to clipboard');
                setCtxMenu(null);
              }}
              className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
            >
              <Copy size={14} className="text-slate-400" />
              Copy text
            </button>

            <button
              onClick={() => {
                const senderLabel = ctxMenu.senderType === 'bot' ? 'AI auto-reply'
                  : ctxMenu.senderType === 'guest' ? 'guest message'
                  : ctxMenu.senderType === 'host' ? 'host message'
                  : 'agent message';
                scheduleDelete(activeTicket.id, ctxMenu.msgId, senderLabel);
                setCtxMenu(null);
              }}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2.5 transition-colors"
            >
              <Trash2 size={14} />
              Delete message
            </button>
          </div>
        </div>
      )}
    </>
  );
}
