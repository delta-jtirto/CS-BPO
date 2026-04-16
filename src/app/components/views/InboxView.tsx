import { detectInquiries, scoreKBForInquiry, type DetectedInquiry } from '../inbox/InquiryDetector';
import type { InquiryResolutionMap, InquiryResolutionState } from '../../data/types';
import {
  detectAgentCoverage,
  detectReopenedInquiries,
  reconstructResolutionState,
} from '../inbox/inquiryResolutionUtils';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  Clock, Send, User, Search,
  Sparkles, CheckCircle, ChevronRight, ChevronDown, Briefcase,
  Building, Key, Bot, Users, Globe2, Tag, UserCircle, Home,
  Plus, X, Trash2, Copy, FileEdit, Info, ShieldAlert, ArrowRightLeft,
  Loader2, Square, PauseCircle, SkipForward, Zap, AlertCircle,
  ArrowLeft, PanelRightOpen, PanelRightClose, PanelLeftOpen, PanelLeftClose, ChevronsLeft, ChevronsRight,
  ArrowDown, MessageSquare as MessageSquareIcon, MoreVertical, Share2, FileText, Settings, Lock, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useAppContext } from '../../context/AppContext';
import { MOCK_HOSTS, MOCK_PROPERTIES } from '../../data/mock-data';
import { parseThreadStatus, type Message } from '../../data/types';
import { SmartReplyPanel, type SmartReplyCache } from '../inbox/SmartReplyPanel';
import { useIsMobile } from '../ui/use-mobile';
import { useFirestoreMessages } from '@/hooks/use-firestore-messages';
import { useProxyMessages } from '@/hooks/use-proxy-conversations';
import { mapProxyMessageToMessage } from '@/lib/proxy-mappers';
import { supabase as supabaseClient } from '@/lib/supabase-client';
import { ConnectionStatusBar } from '../ConnectionStatusBar';
import { SLABadge, getSLAStatus } from '../inbox/SLABadge';
import { computeTags, getLastGuestMessageAt } from '@/lib/compute-ticket-state';
import { useInboxPanels } from '../inbox/hooks/useInboxPanels';
import { useInboxSearch } from '../inbox/hooks/useInboxSearch';
import { useMessageContextMenu } from '../inbox/hooks/useMessageContextMenu';
import { useBookingDetails } from '../inbox/hooks/useBookingDetails';
import { ContextSidebarPane } from '../inbox/ContextSidebarPane';
import { InboxDialogs } from '../inbox/InboxDialogs';

/** Linkify plain-text email bodies: converts <URL> and bare https:// to anchor tags,
 *  preserving the rest as plain text. Returns React nodes (no dangerouslySetInnerHTML). */
function linkifyEmailText(text: string): React.ReactNode[] {
  const urlPattern = /(<https?:\/\/[^>]+>|https?:\/\/[^\s<>]+)/g;
  const parts = text.split(urlPattern);
  return parts.map((part, i) => {
    const angleMatch = part.match(/^<(https?:\/\/[^>]+)>$/);
    if (angleMatch) {
      const url = angleMatch[1];
      const display = url.length > 55 ? url.slice(0, 55) + '…' : url;
      return <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="underline opacity-50 hover:opacity-80 text-[11px] break-all transition-opacity">{display}</a>;
    }
    if (/^https?:\/\//.test(part)) {
      const display = part.length > 55 ? part.slice(0, 55) + '…' : part;
      return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline opacity-50 hover:opacity-80 text-[11px] break-all transition-opacity">{display}</a>;
    }
    return part;
  });
}

/** Renders an HTML email body in a sandboxed iframe that auto-sizes to its content. */
function EmailHtmlFrame({ html, dark }: { html: string; dark?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.5; color: ${dark ? '#e2e8f0' : '#1e293b'}; background: transparent; word-break: break-word; }
    img { max-width: 100%; height: auto; display: block; }
    a { color: #6366f1; }
    table { max-width: 100%; border-collapse: collapse; }
    td, th { padding: 4px 8px; }
  </style></head><body>${html}</body></html>`;

  return (
    <iframe
      ref={ref}
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups"
      onLoad={() => {
        const iframe = ref.current;
        if (iframe?.contentDocument?.body) {
          iframe.style.height = `${iframe.contentDocument.body.scrollHeight + 16}px`;
        }
      }}
      className="w-full border-0"
      style={{ minHeight: 60, display: 'block' }}
      title="Email"
    />
  );
}

export function InboxView() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const {
    tickets, setTickets, setProxyTicketProperty, resolveTicket, addMessageToTicket, injectGuestMessage,
    pendingProxyMessages, retryPendingProxyMessage, deletePendingProxyMessage,
    activeHostFilter, agentName, devMode, resetToDemo, createTestTicket,
    deleteMessageFromTicket, kbEntries, properties,
    draftReplies, clearDraftReply, addBotMessage, addSystemMessage,
    deleteThread, deescalateTicket,
    autoReplyProcessing, cancelAutoReply, autoReplyPausedTickets, toggleAutoReplyPause, setTicketAiEnabled,
    autoReplyHandedOff, setAutoReplyHandedOff,
    resumeAllAI, threadAiLocks, toggleThreadAiLock,
    hostSettings, notificationPrefs, updateHostSettings,
    ticketNotes, updateTicketNotes,
    activeMessages, setActiveMessages,
    firestoreConnections, firestoreInitializing,
  } = useAppContext();

  const filteredTickets = activeHostFilter === 'all' ? tickets : tickets.filter(t => t.host.id === activeHostFilter);

  // ─── Search + Filters ─────────────────────────────────────
  const {
    searchQuery, setSearchQuery, deferredQuery,
    searchInputRef,
    filterCompany, setFilterCompany,
    filterChannel, setFilterChannel,
    showFilters, setShowFilters,
    searchedTickets,
    isSearchActive,
    uniqueCompanies, uniqueChannels,
  } = useInboxSearch(filteredTickets);

  const activeTicket = (ticketId ? searchedTickets.find(t => t.id === ticketId) : searchedTickets[0]) || searchedTickets[0];

  // Resolved guest name: ticket-level name → contactEmail → first guest message senderName → 'Unknown'
  const resolvedGuestName = useMemo(() => {
    if (!activeTicket) return 'Unknown';
    if (activeTicket.guestName && activeTicket.guestName !== 'Unknown') return activeTicket.guestName;
    if (activeTicket.contactEmail) return activeTicket.contactEmail;
    const firstGuestMsg = activeMessages.find(m => m.sender === 'guest' && m.senderName);
    if (firstGuestMsg?.senderName) return firstGuestMsg.senderName;
    return 'Unknown';
  }, [activeTicket, activeMessages]);

  // ─── Firestore messages: subscribe to active ticket's thread ───
  // Find the Firestore db instance for the active ticket's company
  const activeTicketDb = useMemo(() => {
    if (!activeTicket?.firestoreHostId) return null;
    const conn = firestoreConnections.find(c => c.hostId === activeTicket.firestoreHostId && c.status === 'connected');
    return conn?.db || null;
  }, [activeTicket?.firestoreHostId, firestoreConnections]);

  const { messages: firestoreMessages, isLoading: messagesLoading } = useFirestoreMessages(
    activeTicket?.firestoreThreadId || null,
    activeTicketDb,
    activeTicket?.firestoreGuestUserId,
  );

  // Proxy message subscription (WhatsApp, Instagram, LINE, Email)
  const isProxyTicket = !!activeTicket?.proxyConversationId;
  const { messages: rawProxyMessages, isLoading: proxyMessagesLoading } = useProxyMessages(
    isProxyTicket ? supabaseClient : null!,
    isProxyTicket ? activeTicket!.proxyConversationId! : null,
  );
  const proxyMessages = useMemo(
    () => rawProxyMessages.map(m => mapProxyMessageToMessage(m)),
    [rawProxyMessages],
  );

  // Sync messages into context — branch on source
  useEffect(() => {
    if (isProxyTicket) {
      // Proxy ticket: use Supabase messages
      if (proxyMessages.length > 0) {
        setActiveMessages(proxyMessages);
      } else {
        setActiveMessages([]);
      }
    } else if (firestoreMessages.length > 0) {
      // Firestore ticket
      setActiveMessages(firestoreMessages);
    } else if (!activeTicket?.firestoreThreadId) {
      // Non-Firestore, non-proxy ticket — clear
      setActiveMessages([]);
    }
  }, [isProxyTicket, proxyMessages, firestoreMessages, activeTicket?.firestoreThreadId, setActiveMessages]);

  // Sync Firestore messages into ticket.messages so AI consumers (useAutoReply,
  // useSmartReply, AssistantPanel) can see the full conversation.
  // Merge strategy: Firestore supplies guest/host/agent messages; local state
  // supplies bot/system messages added by auto-reply. Sender types don't overlap.
  useEffect(() => {
    if (!activeTicket?.firestoreThreadId || firestoreMessages.length === 0) return;

    setTickets(prev => prev.map(t => {
      if (t.id !== activeTicket.id) return t;

      // Keep locally-created bot/system messages — they aren't in Firestore
      const localMessages = (t.messages || []).filter(
        m => m.sender === 'bot' || m.sender === 'system'
      );

      const merged = [...firestoreMessages, ...localMessages]
        .sort((a, b) => a.createdAt - b.createdAt);

      // Skip update if nothing actually changed (avoid unnecessary re-renders)
      const existing = t.messages || [];
      if (existing.length === merged.length) {
        const last = existing[existing.length - 1];
        const lastM = merged[merged.length - 1];
        if (last?.text === lastM?.text && last?.createdAt === lastM?.createdAt) return t;
      }

      return { ...t, messages: merged };
    }));
  }, [firestoreMessages, activeTicket?.id, activeTicket?.firestoreThreadId, setTickets]);

  // Helper: get messages for a ticket — from Firestore or Supabase (activeMessages)
  // for the active ticket, or from embedded messages (mock/devMode).
  // For proxy tickets, optimistic pending messages (sending/failed/just-sent) are
  // merged in so the user sees their reply immediately with a delivery indicator.
  const mergePending = useCallback((ticketId: string, base: Message[]): Message[] => {
    const pending = pendingProxyMessages[ticketId];
    if (!pending || pending.length === 0) return base;
    // Hide pending 'sent' entries whose real counterpart has already arrived
    // via Supabase Realtime (matched by text + approximate createdAt window).
    const sixtySecs = 60_000;
    const visiblePending = pending.filter(p => {
      if (p.deliveryStatus !== 'sent') return true;
      // Match against agent OR bot — auto-reply pending uses sender='bot' but
      // the real message arrives via Realtime as sender='agent'.
      return !base.some(b =>
        (b.sender === 'agent' || b.sender === 'bot') &&
        b.text === p.text &&
        Math.abs((b.createdAt ?? 0) - p.createdAt) < sixtySecs,
      );
    });
    if (visiblePending.length === 0) return base;
    return [...base, ...visiblePending].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }, [pendingProxyMessages]);

  const getMessages = useCallback((ticket: typeof activeTicket) => {
    if (!ticket) return [];
    // Active ticket sourced from Firestore OR proxy (Supabase): use activeMessages
    if ((ticket.firestoreThreadId || ticket.proxyConversationId) && ticket.id === activeTicket?.id && activeMessages.length > 0) {
      return ticket.proxyConversationId ? mergePending(ticket.id, activeMessages) : activeMessages;
    }
    const base = ticket.messages || [];
    return ticket.proxyConversationId ? mergePending(ticket.id, base) : base;
  }, [activeTicket?.id, activeMessages, mergePending]);

  // Dedup: once a real outbound message matching a 'sent' pending entry arrives
  // via Realtime, drop the pending copy so the rendered list shows only one bubble.
  useEffect(() => {
    if (!activeTicket?.proxyConversationId) return;
    const pending = pendingProxyMessages[activeTicket.id];
    if (!pending || pending.length === 0) return;
    const sixtySecs = 60_000;
    const toRemove = pending.filter(p => {
      if (p.deliveryStatus !== 'sent') return false;
      return activeMessages.some(m =>
        (m.sender === 'agent' || m.sender === 'bot') &&
        m.text === p.text &&
        Math.abs((m.createdAt ?? 0) - p.createdAt) < sixtySecs,
      );
    });
    if (toRemove.length > 0) {
      for (const m of toRemove) deletePendingProxyMessage(activeTicket.id, m.id);
    }
  }, [activeMessages, activeTicket?.id, activeTicket?.proxyConversationId, pendingProxyMessages, deletePendingProxyMessage]);

  // Check if the active ticket's connection is stale (expired/disconnected)
  const isActiveTicketStale = useMemo(() => {
    if (!activeTicket?.firestoreHostId) return false;
    const conn = firestoreConnections.find(c => c.hostId === activeTicket.firestoreHostId);
    return conn ? conn.status !== 'connected' : false;
  }, [activeTicket?.firestoreHostId, firestoreConnections]);

  // ─── 30s SLA tick for thread list ──────────────────────────
  const [, setSlaListTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSlaListTick(t => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // ─── PMS booking details (lazy fetch on active ticket) ────
  const { bookingDetails, bookingLoading } = useBookingDetails(activeTicket?.bookingId, activeTicket?.firestoreHostId);

  // ─── Computed tags for active ticket (detail view only) ───
  const activeTags = useMemo(() => {
    if (!activeTicket) return activeTicket?.tags || [];
    const msgs = getMessages(activeTicket);
    if (msgs.length === 0) return activeTicket.tags || [];
    // For Firestore threads: compute tags from messages
    if (activeTicket.firestoreThreadId) {
      return computeTags(activeTicket.id, msgs);
    }
    return activeTicket.tags || [];
  }, [activeTicket?.id, activeMessages.length, getMessages, activeTicket]);

  // BPO Step 3 — escalation guidance: map detected inquiry types to host contact strategy
  const escalationGuidance = useMemo(() => {
    if (!activeTicket) return null;
    const guestMsgs = getMessages(activeTicket).filter(m => m.sender === 'guest').map(m => m.text);
    const inquiries = detectInquiries(guestMsgs, activeTicket.tags, activeTicket.summary);
    const types = inquiries.map(i => i.type);
    if (types.some(t => ['maintenance', 'safety', 'billing'].includes(t))) return 'immediate' as const;
    if (types.some(t => ['checkin', 'wifi', 'amenities', 'directions'].includes(t))) return 'handle-first' as const;
    return null;
  }, [activeTicket]);

  // Count paused/handed-off threads for bulk resume button
  const pausedOrHandedOffCount = filteredTickets.filter(t => {
    if (autoReplyPausedTickets[t.id]) return true;
    if (autoReplyHandedOff[t.id] === true) return true;
    // Check system message for handed-off status (not explicitly resumed)
    if (autoReplyHandedOff[t.id] !== false) {
      const lastSys = [...(t.messages || [])].reverse().find(m => m.sender === 'system');
      if (lastSys?.text.toLowerCase().startsWith('routed to team') || lastSys?.text.toLowerCase().startsWith('silently routed')) return true;
    }
    return false;
  }).length;

  // Draft reply for the active ticket (if any)
  const activeDraft = activeTicket ? draftReplies[activeTicket.id] : undefined;

  // ─── Active ticket AI status (for thread header chip) ──────────
  const activeIsPaused = activeTicket ? autoReplyPausedTickets[activeTicket.id] : false;
  const activeLastSysMsg = activeTicket ? [...getMessages(activeTicket)].reverse().find(m => m.sender === 'system') : null;
  // #23: Use structured status parser instead of brittle string prefix matching
  const activeSystemStatus = activeLastSysMsg ? parseThreadStatus(activeLastSysMsg.text) : null;
  const activeIsHandedOff = activeTicket ? (
    autoReplyHandedOff[activeTicket.id] === true
    || (autoReplyHandedOff[activeTicket.id] !== false && activeSystemStatus === 'handed-off')
  ) : false;

  const [replyText, setReplyText] = useState('');
  const [showResolveConfirm, setShowResolveConfirm] = useState(false);
  const [rightTab, setRightTab] = useState<'assistant' | 'details'>('assistant');
  const [headerPropertyOpen, setHeaderPropertyOpen] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [showSmartReply, setShowSmartReply] = useState(false);
  const [classifiedInquiries, setClassifiedInquiries] = useState<DetectedInquiry[]>([]);
  const [inquiryResolutions, setInquiryResolutions] = useState<InquiryResolutionMap>({});
  const [summaryCollapsed, setSummaryCollapsed] = useState(true);
  const [viewedTickets, setViewedTickets] = useState<Record<string, number>>({});
  const [cardMenuOpen, setCardMenuOpen] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  useEffect(() => {
    if (!cardMenuOpen && !headerMenuOpen) return;
    const close = () => { setCardMenuOpen(null); setHeaderMenuOpen(false); };
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', close); };
  }, [cardMenuOpen, headerMenuOpen]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  /** Ref to the main reply compose textarea — used for cursor-position insertion */
  const composeTextareaRef = useRef<HTMLTextAreaElement>(null);
  /** Tracks whether a highlight flash animation is active on the compose box */
  const [composeHighlight, setComposeHighlight] = useState(false);
  const isMobile = useIsMobile();
  // Mobile panel: 'list' = inbox sidebar, 'thread' = chat, 'details' = right panel
  const [mobilePanel, setMobilePanel] = useState<'list' | 'thread' | 'details'>(ticketId ? 'thread' : 'list');
  const [showMobileDetails, setShowMobileDetails] = useState(false);

  const smartReplyCacheRef = useRef<Record<string, SmartReplyCache>>({});

  // ─── Resizable panel state (desktop only) ──────────────────────
  const {
    containerRef,
    leftWidth, setLeftWidth,
    rightWidth, setRightWidth,
    resizing, setResizing,
    leftCollapsed, setLeftCollapsed,
    rightCollapsed, setRightCollapsed,
    rightOverlayOpen, setRightOverlayOpen,
    leftOverlayOpen, setLeftOverlayOpen,
    displayLeftWidth, displayRightWidth,
    shouldAutoCollapseLeft, shouldAutoCollapseRight,
    MIN_CENTER, LEFT_MIN, RIGHT_MIN,
  } = useInboxPanels(isMobile);

  // ─── Context menu + message delete ─────────────────────────────
  const {
    ctxMenu, setCtxMenu, ctxMenuRef,
    pendingDeletes,
    scheduleDelete,
    handleMsgContextMenu,
  } = useMessageContextMenu(activeTicket?.id, deleteMessageFromTicket);

  const [showNewThread, setShowNewThread] = useState(false);
  const [ntHostId, setNtHostId] = useState(MOCK_HOSTS[0].id);
  const [ntPropName, setNtPropName] = useState('');
  const [ntGuestName, setNtGuestName] = useState('');
  const [ntMessage, setNtMessage] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCancelMenu, setShowCancelMenu] = useState(false);

  const ntProps = MOCK_PROPERTIES.filter(p => p.hostId === ntHostId);
  useEffect(() => {
    const props = MOCK_PROPERTIES.filter(p => p.hostId === ntHostId);
    setNtPropName(props[0]?.name || '');
  }, [ntHostId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    // Also watch the lazy-loaded stores used by Firestore / proxy tickets so
    // the thread auto-scrolls on new inbound messages, not only when the
    // ticket's in-memory `messages` array grows.
  }, [
    activeTicket?.messages?.length,
    activeMessages.length,
    activeTicket?.id ? pendingProxyMessages[activeTicket.id]?.length : 0,
  ]);

  // When ticket changes, switch mobile to thread view if a ticketId is in the URL
  useEffect(() => {
    if (isMobile && ticketId) {
      setMobilePanel('thread');
    }
  }, [ticketId, isMobile]);

  useEffect(() => {
    if (!activeTicket) return;
    setRightTab('assistant');
    setHeaderPropertyOpen(false);
    setShowSmartReply(false);
    setGuestMode(false);
    setViewedTickets(prev => ({ ...prev, [activeTicket.id]: getMessages(activeTicket).length }));
    // Reset inquiry resolution state on ticket switch
    setInquiryResolutions({});
  }, [activeTicket?.id]);

  // Reconstruct resolution state from system messages once inquiries are classified
  const prevReconstructKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeTicket || classifiedInquiries.length === 0) return;
    const key = `${activeTicket.id}:${classifiedInquiries.length}`;
    if (prevReconstructKeyRef.current === key) return;
    prevReconstructKeyRef.current = key;
    const msgs = getMessages(activeTicket);
    const types = classifiedInquiries.map(inq => inq.type);
    const reconstructed = reconstructResolutionState(msgs, types);
    if (Object.keys(reconstructed).length > 0) {
      setInquiryResolutions(reconstructed);
    }
  }, [activeTicket?.id, classifiedInquiries]);

  // Layer 1: Listen for auto-reply resolution events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { ticketId: string; handledTypes: string[] };
      if (detail.ticketId !== activeTicket?.id) return;
      setInquiryResolutions(prev => {
        const next = { ...prev };
        for (const type of detail.handledTypes) {
          next[type] = { handled: true, source: 'ai', updatedAt: Date.now() };
        }
        return next;
      });
    };
    window.addEventListener('inquiry-resolution', handler);
    return () => window.removeEventListener('inquiry-resolution', handler);
  }, [activeTicket?.id]);

  // Re-open detection: watch for new guest messages that match handled inquiries
  const prevGuestMsgCountRef = useRef<number>(0);
  useEffect(() => {
    if (!activeTicket) return;
    const msgs = getMessages(activeTicket);
    const guestMsgs = msgs.filter(m => m.sender === 'guest');
    if (guestMsgs.length <= prevGuestMsgCountRef.current) {
      prevGuestMsgCountRef.current = guestMsgs.length;
      return;
    }
    prevGuestMsgCountRef.current = guestMsgs.length;

    // Check the newest guest message(s) against handled inquiries
    const handledTypes = Object.entries(inquiryResolutions)
      .filter(([, state]) => state.handled)
      .map(([type]) => type);
    if (handledTypes.length === 0) return;

    const inquiriesByType: Record<string, DetectedInquiry> = {};
    for (const inq of classifiedInquiries) inquiriesByType[inq.type] = inq;

    const lastGuestMsg = guestMsgs[guestMsgs.length - 1];
    const reopened = detectReopenedInquiries(lastGuestMsg.text, handledTypes, inquiriesByType);
    if (reopened.length > 0) {
      setInquiryResolutions(prev => {
        const next = { ...prev };
        for (const type of reopened) {
          next[type] = { handled: false, source: prev[type]?.source ?? 'ai', updatedAt: Date.now(), reopened: true };
        }
        return next;
      });
    }
  }, [activeTicket?.messages?.length, classifiedInquiries, inquiryResolutions]);

  // Resolution change callbacks for AssistantPanel
  const handleResolutionChange = useCallback((type: string, state: InquiryResolutionState) => {
    setInquiryResolutions(prev => ({ ...prev, [type]: state }));
  }, []);

  const handleBulkResolution = useCallback((handled: boolean) => {
    setInquiryResolutions(prev => {
      const next = { ...prev };
      for (const inq of classifiedInquiries) {
        next[inq.type] = { handled, source: 'manual', updatedAt: Date.now() };
      }
      return next;
    });
  }, [classifiedInquiries]);

  useEffect(() => {
    if (!activeTicket) return;
    setViewedTickets(prev => ({ ...prev, [activeTicket.id]: getMessages(activeTicket).length }));
  }, [activeTicket?.messages?.length]);

  // #10: Toast notification for new guest messages on non-active threads
  const prevTicketCountsRef = useRef<Record<string, number>>({});
  useEffect(() => {
    for (const t of filteredTickets) {
      const prevCount = prevTicketCountsRef.current[t.id];
      const msgs = t.messages || [];
      if (prevCount !== undefined && msgs.length > prevCount) {
        const newMsgs = msgs.slice(prevCount);
        const newGuestMsgs = newMsgs.filter(m => m.sender === 'guest' && !m.isGuestMode);
        if (newGuestMsgs.length > 0 && t.id !== activeTicket?.id && notificationPrefs.soundAlerts) {
          toast(`New message from ${t.guestName}`, {
            description: newGuestMsgs[0].text.slice(0, 80) + (newGuestMsgs[0].text.length > 80 ? '…' : ''),
            duration: 5000,
            action: {
              label: 'View',
              onClick: () => navigate(`/inbox/${t.id}`),
            },
          });
        }
      }
      prevTicketCountsRef.current[t.id] = msgs.length;
    }
  }, [filteredTickets, activeTicket?.id, notificationPrefs.soundAlerts, navigate]);

  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      setShowSmartReply(prev => !prev);
      setGuestMode(false);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
      e.preventDefault();
      if (activeTicket) setShowResolveConfirm(true);
      return;
    }
  }, [activeTicket]);

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  // When no ticket is selected, show empty state
  if (!activeTicket) {
    return (
      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 shrink-0 bg-white border-r border-slate-200 flex flex-col">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h2 className="text-lg font-bold text-slate-800 flex items-center justify-between">
              Inbox
              <button
                onClick={async () => {
                  try {
                    const { getAccessToken, COMPANY_ID } = await import('@/lib/supabase-client');
                    const token = await getAccessToken();
                    const PROXY_URL = import.meta.env.VITE_CHANNEL_PROXY_URL || '';
                    if (!token || !PROXY_URL) return;
                    const res = await fetch(`${PROXY_URL}/api/proxy/email/fetch`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ company_id: COMPANY_ID }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      if (data.stored > 0) toast.success(`${data.stored} new email(s) fetched`);
                      else toast('No new emails');
                    }
                  } catch { toast.error('Failed to fetch emails'); }
                }}
                className="w-6 h-6 rounded-md flex items-center justify-center bg-slate-200 text-slate-500 hover:bg-indigo-100 hover:text-indigo-600 transition-colors"
                title="Check for new emails"
              >
                <RefreshCw size={12} />
              </button>
            </h2>
          </div>
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="space-y-2">
              <Bot size={32} className="mx-auto text-slate-300" />
              <p className="text-sm font-medium text-slate-500">No tickets yet</p>
              <p className="text-xs text-slate-400">Click <RefreshCw size={10} className="inline" /> to check for new emails, or connect channels in Settings.</p>
            </div>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center bg-slate-50">
          <div className="text-center space-y-2 text-slate-400">
            <MessageSquareIcon size={40} className="mx-auto text-slate-200" />
            <p className="text-sm">Select a conversation to view messages</p>
          </div>
        </div>
      </div>
    );
  }

  const hasUnread = (tid: string, msgCount: number) => {
    const viewed = viewedTickets[tid];
    return viewed !== undefined ? msgCount > viewed : false;
  };

  const handleSendMessage = () => {
    if (!replyText.trim()) {
      toast.error('Cannot send empty message');
      return;
    }
    if (guestMode) {
      injectGuestMessage(activeTicket.id, replyText.trim(), true);
      setReplyText('');
      toast.success('Guest message injected (test)', { description: `Sent as ${activeTicket.guestName}. AI will respond if enabled.` });
    } else {
      // #18: If sending a draft as-is, add audit trail system message
      if (activeDraft && replyText.trim() === activeDraft.trim()) {
        addSystemMessage(activeTicket.id, `Draft sent as-is — Agent sent the AI-drafted reply without edits.`);
      }
      // Auto-clear Follow-up badge when agent replies after a partial status
      const lastSys = [...getMessages(activeTicket)].reverse().find(m => m.sender === 'system');
      if (lastSys && parseThreadStatus(lastSys.text) === 'partial') {
        addSystemMessage(activeTicket.id, `AI handled — Agent followed up.`);
      }
      addMessageToTicket(activeTicket.id, replyText.trim());

      // Layer 2: Detect which active inquiries the agent's reply covers
      const activeInquiries = classifiedInquiries.filter(
        inq => !inquiryResolutions[inq.type]?.handled
      );
      if (activeInquiries.length > 0) {
        const coveredTypes = detectAgentCoverage(replyText.trim(), activeInquiries);
        if (coveredTypes.length > 0) {
          setInquiryResolutions(prev => {
            const next = { ...prev };
            for (const type of coveredTypes) {
              // Don't downgrade AI-handled to heuristic
              if (!next[type]?.handled || next[type]?.source !== 'ai') {
                next[type] = { handled: true, source: 'heuristic', updatedAt: Date.now() };
              }
            }
            return next;
          });
          // Undo toast for heuristic-detected resolutions
          const coveredLabels = coveredTypes
            .map(type => classifiedInquiries.find(inq => inq.type === type)?.label)
            .filter(Boolean);
          if (coveredLabels.length > 0) {
            toast(`Marked ${coveredLabels.join(', ')} as handled`, {
              description: 'Based on your reply.',
              duration: 5000,
              action: {
                label: 'Undo',
                onClick: () => {
                  setInquiryResolutions(prev => {
                    const next = { ...prev };
                    for (const type of coveredTypes) {
                      next[type] = { handled: false, source: 'manual', updatedAt: Date.now() };
                    }
                    return next;
                  });
                },
              },
            });
          }
        }
      }

      setReplyText('');
      setShowSmartReply(false);
      if (activeDraft) clearDraftReply(activeTicket.id);
      // No eager toast here — for proxy channels the message bubble itself shows
      // sending/sent/failed state. For Firestore channels a success is implied by
      // the message appearing in the thread via onSnapshot.
    }
  };

  /** Core resolve logic — navigates away and shows KB nudge */
  const doResolve = () => {
    const guestMessages = getMessages(activeTicket).filter(m => m.sender === 'guest').map(m => m.text);
    const inquiries = detectInquiries(guestMessages, activeTicket.tags, activeTicket.summary);
    const activeProp = MOCK_PROPERTIES.find(p => p.name === activeTicket.property);
    const scopeKb = kbEntries.filter(kb =>
      kb.hostId === activeTicket.host.id &&
      (!kb.propId || kb.propId === activeProp?.id)
    );
    const uncoveredTopics = inquiries.filter(inq => {
      const matches = scoreKBForInquiry(inq, scopeKb);
      return matches.length === 0;
    }).map(inq => inq.label);

    const nextTicket = filteredTickets.find(t => t.id !== activeTicket.id);
    resolveTicket(activeTicket.id);
    toast.success('Ticket resolved', { description: `${activeTicket.guestName}'s ticket marked as resolved.` });

    if (uncoveredTopics.length > 0 && activeProp) {
      setTimeout(() => {
        toast(`Add to knowledge base: ${uncoveredTopics.join(', ')}`, {
          description: 'These topics weren\'t in the knowledge base. Adding them helps AI handle similar questions next time.',
          duration: 8000,
          action: {
            label: 'Add now',
            onClick: () => navigate(`/kb/${activeProp.id}`),
          },
        });
      }, 500);
    }

    if (nextTicket) {
      navigate(`/inbox/${nextTicket.id}`);
    } else {
      navigate('/inbox');
      if (isMobile) setMobilePanel('list');
    }
  };

  const handleResolve = () => {
    doResolve();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleComposeReply = (text: string) => {
    const el = composeTextareaRef.current;
    if (el) {
      // Insert at cursor position — never replace existing text or blindly append
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      const separator = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n') ? ' ' : '';
      const newValue = before + separator + text + after;
      setReplyText(newValue);
      // Restore cursor to after inserted text and refocus
      requestAnimationFrame(() => {
        el.focus();
        const newCursor = start + separator.length + text.length;
        el.setSelectionRange(newCursor, newCursor);
        // Auto-resize
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
      });
    } else {
      // Fallback if ref not available yet
      setReplyText((prev) => prev ? prev + ' ' + text : text);
    }
    // Brief highlight flash to draw eye to where text was inserted
    setComposeHighlight(true);
    setTimeout(() => setComposeHighlight(false), 400);
  };

  const handleSmartReplyInsert = (text: string) => {
    setReplyText(text);
    setShowSmartReply(false);
    toast.success('Reply inserted', { description: 'Review the message and send when ready.' });
  };

  const toggleSmartReply = () => {
    setShowSmartReply(prev => !prev);
    if (guestMode) setGuestMode(false);
  };

  // #22: Guest mode toggle (no confirmation needed — AI auto-reply handles guest messages)
  const toggleGuestMode = () => {
    if (!guestMode) {
      setGuestMode(true);
      setShowSmartReply(false);
    } else {
      setGuestMode(false);
    }
  };

  return (
    <div ref={containerRef} className={`flex h-full w-full overflow-hidden animate-in fade-in duration-200 relative ${resizing ? 'select-none' : ''}`}>

      {/* Left panel collapsed rail (desktop only) */}
      {!isMobile && leftCollapsed && (
        <div className="flex flex-col items-center w-10 shrink-0 bg-white border-r border-slate-200 py-3 gap-2">
          <button
            onClick={() => {
              if (shouldAutoCollapseLeft) {
                setLeftOverlayOpen(true);
              } else {
                setLeftCollapsed(false);
              }
            }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
            title="Show inbox list"
          >
            <PanelLeftOpen size={16} />
          </button>
          <span className="bg-slate-200 text-slate-600 text-[9px] px-1.5 py-0.5 rounded-full font-bold">{filteredTickets.length}</span>
        </div>
      )}

      {/* Left overlay backdrop (for narrow screens) */}
      {!isMobile && leftCollapsed && leftOverlayOpen && (
        <div
          className="absolute inset-0 z-40 bg-black/10"
          onClick={() => setLeftOverlayOpen(false)}
        />
      )}

      {/* Inbox List Pane */}
      <div
        className={`${
          isMobile
            ? (mobilePanel === 'list' ? 'flex w-full' : 'hidden')
            : leftCollapsed
              ? (leftOverlayOpen ? 'flex absolute left-10 top-0 bottom-0 z-50 shadow-2xl rounded-r-xl animate-in slide-in-from-left duration-200' : 'hidden')
              : 'flex shrink-0 overflow-hidden'
        } bg-white border-r border-slate-200 flex-col`}
        style={!isMobile ? { width: leftCollapsed && leftOverlayOpen ? Math.min(leftWidth, 360) : leftCollapsed ? 0 : displayLeftWidth, minWidth: leftCollapsed ? 0 : LEFT_MIN, transition: resizing ? 'none' : 'width 0.2s ease' } : undefined}
      >
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800">Inbox</h2>
            <span className="bg-slate-200 text-slate-600 text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums">
              {isSearchActive ? `${searchedTickets.length}/${filteredTickets.length}` : filteredTickets.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={async () => {
                try {
                  const { getAccessToken, COMPANY_ID } = await import('@/lib/supabase-client');
                  const token = await getAccessToken();
                  const PROXY_URL = import.meta.env.VITE_CHANNEL_PROXY_URL || '';
                  if (!token || !PROXY_URL) return;
                  const btn = document.getElementById('email-refresh-btn');
                  if (btn) btn.classList.add('animate-spin');
                  const res = await fetch(`${PROXY_URL}/api/proxy/email/fetch`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ company_id: COMPANY_ID }),
                  });
                  if (btn) btn.classList.remove('animate-spin');
                  if (res.ok) {
                    const data = await res.json();
                    if (data.stored > 0) {
                      const { toast } = await import('sonner');
                      toast.success(`${data.stored} new email(s) fetched`);
                    }
                  }
                } catch {}
              }}
              className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
              title="Check for new emails"
            >
              <RefreshCw id="email-refresh-btn" size={13} />
            </button>
            <button
              onClick={() => setShowNewThread(prev => !prev)}
              className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                showNewThread
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'
              }`}
              title="Start a new test conversation"
            >
              <Plus size={14} />
            </button>
            {!isMobile && (
              <button
                onClick={() => { setLeftCollapsed(true); setLeftOverlayOpen(false); }}
                className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                title="Collapse sidebar"
              >
                <ChevronsLeft size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Compact search bar */}
        <div className="px-3 py-1.5 border-b border-slate-100">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setSearchQuery(''); searchInputRef.current?.blur(); }
              }}
              placeholder="Search guests, bookings..."
              className="w-full text-[11px] pl-6 pr-12 py-1 rounded-md bg-slate-50 border-0 focus:ring-1 focus:ring-indigo-300 focus:bg-white outline-none placeholder:text-slate-300 transition-colors"
            />
            {searchQuery ? (
              <button
                onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 p-0.5"
              >
                <X size={11} />
              </button>
            ) : (
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-300 bg-slate-100 px-1 py-0.5 rounded font-mono">/</kbd>
            )}
          </div>
        </div>

        {showNewThread && (
          <div className="p-3 border-b border-indigo-200 bg-indigo-50/50 animate-in slide-in-from-top-2 duration-150 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider flex items-center gap-1">
                <UserCircle size={11} /> New test thread
              </span>
              <button onClick={() => setShowNewThread(false)} className="text-slate-400 hover:text-slate-600">
                <X size={12} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={ntHostId}
                onChange={(e) => setNtHostId(e.target.value)}
                className="text-[11px] px-2 py-1.5 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
              >
                {MOCK_HOSTS.map(h => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
              <select
                value={ntPropName}
                onChange={(e) => setNtPropName(e.target.value)}
                className="text-[11px] px-2 py-1.5 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
              >
                {ntProps.map(p => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <input
              type="text"
              value={ntGuestName}
              onChange={(e) => setNtGuestName(e.target.value)}
              placeholder="Guest name (e.g. Alex Kim)"
              className="w-full text-[11px] px-2 py-1.5 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300 placeholder:text-slate-400"
            />
            <input
              type="text"
              value={ntMessage}
              onChange={(e) => setNtMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ntMessage.trim() && ntGuestName.trim()) {
                  e.preventDefault();
                  const newId = createTestTicket({
                    hostId: ntHostId,
                    propertyName: ntPropName,
                    guestName: ntGuestName.trim(),
                    firstMessage: ntMessage.trim(),
                  });
                  toast.success('Test thread created', { description: `${ntGuestName.trim()} → ${ntPropName}` });
                  setNtGuestName('');
                  setNtMessage('');
                  setShowNewThread(false);
                  navigate(`/inbox/${newId}`);
                }
              }}
              placeholder="First guest message... (Enter to create)"
              className="w-full text-[11px] px-2 py-1.5 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300 placeholder:text-slate-400"
            />
            <button
              onClick={() => {
                if (!ntMessage.trim() || !ntGuestName.trim()) {
                  toast.error('Name and message required');
                  return;
                }
                const newId = createTestTicket({
                  hostId: ntHostId,
                  propertyName: ntPropName,
                  guestName: ntGuestName.trim(),
                  firstMessage: ntMessage.trim(),
                });
                toast.success('Test thread created', { description: `${ntGuestName.trim()} → ${ntPropName}` });
                setNtGuestName('');
                setNtMessage('');
                setShowNewThread(false);
                navigate(`/inbox/${newId}`);
              }}
              disabled={!ntMessage.trim() || !ntGuestName.trim()}
              className="w-full text-[11px] font-medium py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
            >
              <Plus size={12} /> Create thread
            </button>
          </div>
        )}

        {/* Connection status bar — visible when any connection is unhealthy */}
        <ConnectionStatusBar
          connections={firestoreConnections}
          isInitializing={firestoreInitializing}
          onReconnectClick={(hostId) => navigate('/settings/inboxes')}
        />

        <div className="overflow-y-auto flex-1">
          {/* Empty state when search/filter yields no results */}
          {searchedTickets.length === 0 && isSearchActive && (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <Search size={28} className="text-slate-200 mb-3" />
              <p className="text-sm font-medium text-slate-500 mb-1">
                No conversations found{deferredQuery ? ` for "${deferredQuery}"` : ''}
              </p>
              <p className="text-xs text-slate-400 mb-3">Try adjusting your search or filters</p>
              <button
                onClick={() => { setSearchQuery(''); setFilterCompany(''); setFilterChannel(''); }}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Clear all filters
              </button>
            </div>
          )}
          {searchedTickets.map(ticket => {
            const isActive = activeTicket.id === ticket.id;
            const unread = hasUnread(ticket.id, (ticket.messages || []).length);
            const isProcessing = autoReplyProcessing[ticket.id];
            const isPaused = autoReplyPausedTickets[ticket.id];
            const lastGuestMsg = [...(ticket.messages || [])].reverse().find(m => m.sender === 'guest');

            // ─── Smart preview: last message in thread (whoever sent it) ──
            const lastSystemMsg = [...(ticket.messages || [])].reverse().find(m => m.sender === 'system');
            const systemStatus = lastSystemMsg ? parseThreadStatus(lastSystemMsg.text) : null;

            // Last non-system message for the preview card
            const lastNonSystemMsg = [...(ticket.messages || [])].reverse().find(m => m.sender !== 'system');
            const previewSender = lastNonSystemMsg?.sender === 'guest' ? ticket.guestName.split(' ')[0]
              : lastNonSystemMsg?.sender === 'bot' ? 'AI'
              : lastNonSystemMsg?.sender === 'agent' ? 'You'
              : lastNonSystemMsg?.sender === 'host' ? 'Host'
              : '';
            const previewText = lastNonSystemMsg?.text || ticket.summary || ticket.aiHandoverReason || '';

            // #11/#25: Use createdAt epoch for accurate time-since calculation
            const guestMsgCount = (ticket.messages || []).filter(m => m.sender === 'guest').length;
            let timeSinceGuest = '';
            if (lastGuestMsg) {
              const ts = lastGuestMsg.createdAt;
              if (ts) {
                const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60000));
                if (diffMin < 1) timeSinceGuest = 'just now';
                else if (diffMin < 60) timeSinceGuest = `${diffMin}m ago`;
                else if (diffMin < 1440) timeSinceGuest = `${Math.floor(diffMin / 60)}h ago`;
                else timeSinceGuest = `${Math.floor(diffMin / 1440)}d ago`;
              } else {
                timeSinceGuest = lastGuestMsg.time;
              }
            }

            // Explicit false in autoReplyHandedOff overrides system message status (user clicked Resume AI)
            const isHandedOff = autoReplyHandedOff[ticket.id] === true
              || (autoReplyHandedOff[ticket.id] !== false && systemStatus === 'handed-off');

            // Stale ticket: Firestore connection expired/disconnected
            const ticketStale = ticket.firestoreHostId
              ? !firestoreConnections.some(c => c.hostId === ticket.firestoreHostId && c.status === 'connected')
              : false;

            return (
              <div
                key={ticket.id}
                onClick={() => { navigate(`/inbox/${ticket.id}`); setReplyText(''); if (isMobile) setMobilePanel('thread'); if (leftOverlayOpen) setLeftOverlayOpen(false); }}
                className={`group px-3 py-3 border-b border-slate-100 cursor-pointer relative overflow-hidden flex gap-2.5 ${
                  ticketStale ? 'opacity-50' : ''
                } ${
                  isActive
                    ? 'bg-indigo-50/80 border-l-[3px] border-l-indigo-500'
                    : `border-l-[3px] hover:bg-slate-50 ${
                        ticket.status === 'urgent' ? 'border-l-red-400'
                        : ticket.status === 'warning' ? 'border-l-amber-400'
                        : 'border-l-transparent'
                      }`
                }`}
              >


                {/* Avatar + Content shift together on hover */}
                <div className="flex gap-2.5 flex-1 min-w-0">

                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 mt-0.5 ${
                  ticket.status === 'urgent' ? 'bg-red-400' : ticket.status === 'warning' ? 'bg-amber-400' : 'bg-slate-300'
                }`}>
                  {ticket.guestName.charAt(0)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {/* Row 1: name + SLA */}
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {unread && !isActive && <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full shrink-0" />}
                      <span className={`text-sm truncate ${unread && !isActive ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>{ticket.guestName}</span>
                    </div>
                    <span className={`text-[11px] font-semibold tabular-nums pr-5 ${
                      ticket.status === 'urgent' ? 'text-red-500' : ticket.status === 'warning' ? 'text-amber-500' : 'text-slate-400'
                    }`}>{ticket.sla}</span>
                  </div>

                  {/* Row 2: badges inline */}
                  <div className="flex items-center gap-1 mb-1 flex-nowrap overflow-hidden">
                    {/* AI Toggle — per-ticket only, never changes host settings */}
                    {(() => {
                      const hostAutoReply = hostSettings.find(s => s.hostId === ticket.host.id)?.autoReply ?? false;
                      const isExplicitlyEnabled = autoReplyPausedTickets[ticket.id] === false;
                      const aiOff = autoReplyPausedTickets[ticket.id] === true || (!hostAutoReply && !isExplicitlyEnabled);
                      return (
                        <motion.button
                          key={aiOff ? 'off' : 'on'}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.15 }}
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            if (aiOff) {
                              setTicketAiEnabled(ticket.id, true);
                              if (isHandedOff) setAutoReplyHandedOff(ticket.id, false);
                              toast.success('AI enabled', { description: `Auto-reply active for ${ticket.guestName}.`, duration: 3000 });
                            } else {
                              setTicketAiEnabled(ticket.id, false);
                              toast('AI paused', { description: `You're handling ${ticket.guestName} manually.`, duration: 3000 });
                            }
                          }}
                          className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border transition-colors cursor-pointer shrink-0 ${
                            aiOff
                              ? 'bg-slate-100 text-slate-400 border-slate-200 hover:border-violet-300 hover:text-violet-500'
                              : 'bg-violet-50 text-violet-600 border-violet-200 hover:bg-slate-100 hover:text-slate-400'
                          }`}
                        >
                          {aiOff ? <><PauseCircle size={8} /> AI Off</> : <><Zap size={8} /> AI On</>}
                        </motion.button>
                      );
                    })()}
                    {/* Lock toggle — pins AI state for this thread */}
                    {(() => {
                      const isLocked = !!threadAiLocks[ticket.id];
                      return (
                        <button
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            toggleThreadAiLock(ticket.id);
                            toast(isLocked ? 'AI lock removed' : 'AI state locked', {
                              description: isLocked
                                ? `${ticket.guestName} will now follow global AI setting.`
                                : `AI state for ${ticket.guestName} is pinned — won't change with global toggle.`,
                              duration: 2500,
                            });
                          }}
                          title={isLocked ? 'Unlock AI state (follows global toggle)' : 'Lock AI state (ignore global toggle)'}
                          className={`inline-flex items-center justify-center w-4 h-4 rounded-full border transition-colors cursor-pointer shrink-0 ${
                            isLocked
                              ? 'bg-violet-100 text-violet-500 border-violet-300 hover:bg-slate-100 hover:text-slate-400 hover:border-slate-200'
                              : 'bg-transparent text-slate-300 border-slate-200 hover:bg-violet-50 hover:text-violet-400 hover:border-violet-200'
                          }`}
                        >
                          <Lock size={7} />
                        </button>
                      );
                    })()}

                    {/* Status badge */}
                    {(() => {
                      const agentClearedHandoff = autoReplyHandedOff[ticket.id] === false;
                      const effectiveStatus = isHandedOff
                        ? 'handed-off'
                        : (agentClearedHandoff && systemStatus === 'handed-off') ? null : systemStatus;
                      if (effectiveStatus === 'ai-handled') return null;
                      const statusLabel = effectiveStatus === 'handed-off' ? 'Your Turn'
                        : effectiveStatus === 'partial' ? 'Follow-up'
                        : effectiveStatus === 'safety' ? 'Safety Alert'
                        : null;
                      if (!statusLabel) return null;
                      const StatusIcon = effectiveStatus === 'handed-off' ? ArrowRightLeft : effectiveStatus === 'partial' ? AlertCircle : ShieldAlert;
                      const statusColor = effectiveStatus === 'safety' ? 'bg-red-50 text-red-500 border-red-200'
                        : effectiveStatus === 'partial' ? 'bg-sky-50 text-sky-500 border-sky-200'
                        : 'bg-amber-50 text-amber-500 border-amber-200';
                      return (
                        <motion.span key={effectiveStatus} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.15 }}
                          className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${statusColor}`}>
                          <StatusIcon size={8} /> {statusLabel}
                        </motion.span>
                      );
                    })()}

                    {/* Meta: property · company · time */}
                    <span className="text-[10px] text-slate-400 truncate ml-0.5 inline-flex items-center gap-1">
                      {!ticket.property && !ticket.bookingId && (
                        <AlertCircle size={9} className="text-amber-400 shrink-0" title="No property mapped" />
                      )}
                      {ticket.property || ticket.companyName || ticket.host.name}
                      {timeSinceGuest && ` · ${timeSinceGuest}`}
                    </span>
                  </div>

                  {/* Row 3: preview + chevron on hover */}
                  <div className="flex items-center gap-1">
                    <p className={`text-[11px] leading-snug line-clamp-1 flex-1 min-w-0 ${unread && !isActive ? 'text-slate-600' : 'text-slate-400'}`}>
                      {previewSender && (
                        <span className={`font-medium ${
                          lastNonSystemMsg?.sender === 'bot' ? 'text-violet-400' : 'text-slate-400'
                        }`}>{previewSender}: </span>
                      )}{previewText}
                    </p>
                    <div className="relative shrink-0 w-0 group-hover:w-5 overflow-visible transition-all duration-150">
                      <button
                        onClick={(e) => { e.stopPropagation(); setCardMenuOpen(cardMenuOpen === ticket.id ? null : ticket.id); }}
                        className="w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100 duration-150"
                      >
                        <ChevronDown size={13} />
                      </button>
                      {cardMenuOpen === ticket.id && (
                        <div className="absolute right-0 bottom-7 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-40 z-50">
                          <button
                            onClick={(e) => { e.stopPropagation(); setCardMenuOpen(null); setShowDeleteConfirm(true); navigate(`/inbox/${ticket.id}`); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={13} /> Delete thread
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* AI processing indicator */}
                  <AnimatePresence>
                    {isProcessing && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold text-violet-600 uppercase tracking-wider overflow-hidden"
                      >
                        <Loader2 size={10} className="animate-spin" />
                        <span>AI preparing reply…</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelAutoReply(ticket.id);
                            setShowCancelMenu(true);
                            navigate(`/inbox/${ticket.id}`);
                          }}
                          className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-violet-100 hover:bg-red-100 hover:text-red-600 transition-colors border border-violet-200"
                        >
                          Stop
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {draftReplies[ticket.id] && !isProcessing && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-violet-600 uppercase tracking-wider">
                      <FileEdit size={10} /> Draft pending
                    </div>
                  )}
                </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Left resize handle (desktop only, when not collapsed) */}
      {!isMobile && !leftCollapsed && (
        <div
          className={`w-px shrink-0 cursor-col-resize relative group z-20 transition-colors ${resizing === 'left' ? 'bg-indigo-400' : 'bg-slate-200 hover:bg-indigo-400'}`}
          onMouseDown={(e) => { e.preventDefault(); setResizing('left'); }}
          onDoubleClick={() => setLeftWidth(320)}
          title="Drag to resize • Double-click to reset"
        >
          <div className="absolute inset-y-0 -left-2 -right-2" />
        </div>
      )}

      {/* Chat Pane */}
      <div className={`${isMobile ? (mobilePanel === 'thread' ? 'flex w-full' : 'hidden') : 'flex flex-1'} flex-col bg-slate-50 min-w-0`}>
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-2 shrink-0 shadow-sm z-10 min-h-[52px]">
          {/* Mobile back */}
          {isMobile && (
            <button onClick={() => { setMobilePanel('list'); navigate('/inbox'); }} className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
              <ArrowLeft size={18} />
            </button>
          )}

          {/* Guest info — takes remaining space */}
          <div className="min-w-0 flex-1">
            {/* Eyebrow: property (or mapping chip) · channel */}
            <div className="flex items-center gap-1 truncate mb-0.5">
              {activeTicket.property ? (
                <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider truncate">
                  {activeTicket.property}
                </span>
              ) : headerPropertyOpen ? (
                <select
                  autoFocus
                  value=""
                  onChange={e => {
                    if (e.target.value) {
                      setProxyTicketProperty(activeTicket.id, e.target.value);
                      setHeaderPropertyOpen(false);
                      toast.success('Property mapped', { description: `Set to ${e.target.value}`, duration: 3000 });
                    }
                  }}
                  onBlur={() => setHeaderPropertyOpen(false)}
                  className="text-[10px] text-slate-700 bg-white border border-amber-300 rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-amber-400 max-w-[180px]"
                >
                  <option value="">Select property...</option>
                  {(() => {
                    const hostProps = properties.filter(p => p.hostId === activeTicket.host.id).sort((a, b) => a.name.localeCompare(b.name));
                    return hostProps.length > 0
                      ? hostProps.map(p => <option key={p.id} value={p.name}>{p.name}</option>)
                      : <option disabled>No properties available</option>;
                  })()}
                </select>
              ) : (
                <button
                  onClick={() => setHeaderPropertyOpen(true)}
                  className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border cursor-pointer bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100 transition-colors shrink-0"
                >
                  <AlertCircle size={8} /> No property
                </button>
              )}
              {activeTicket.channel && (
                <>
                  <span className="text-[9px] text-slate-300 shrink-0">·</span>
                  <span className="text-[9px] font-medium text-slate-400 uppercase tracking-wider shrink-0">{activeTicket.channel}</span>
                </>
              )}
            </div>
            {/* Primary: guest name */}
            <h1 className="text-sm font-bold truncate text-slate-800 leading-tight">{resolvedGuestName}</h1>
            {/* Subtitle: contact email or phone (not channel — already in eyebrow) */}
            {activeTicket.contactEmail && resolvedGuestName !== activeTicket.contactEmail
              && (activeTicket.contactEmail.includes('@') || activeTicket.contactEmail.startsWith('+')) && (
              <div className="text-[10px] text-slate-400 truncate">{activeTicket.contactEmail}</div>
            )}
          </div>

          {/* Actions — always visible */}
          {activeTicket && (() => {
            const hostAutoReply = hostSettings.find(s => s.hostId === activeTicket.host.id)?.autoReply ?? false;
            const isExplicitlyEnabled = autoReplyPausedTickets[activeTicket.id] === false;
            const aiOff = autoReplyPausedTickets[activeTicket.id] === true || (!hostAutoReply && !isExplicitlyEnabled);
            const isLocked = !!threadAiLocks[activeTicket.id];
            return (
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => {
                    if (aiOff) {
                      setTicketAiEnabled(activeTicket.id, true);
                      if (activeIsHandedOff) setAutoReplyHandedOff(activeTicket.id, false);
                      toast.success('AI enabled', { description: `Auto-reply active for ${activeTicket.guestName}.`, duration: 3000 });
                    } else {
                      setTicketAiEnabled(activeTicket.id, false);
                      toast('AI paused', { description: `You're handling ${activeTicket.guestName} manually.`, duration: 3000 });
                    }
                  }}
                  className={`flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-full border transition-colors whitespace-nowrap cursor-pointer ${
                    aiOff
                      ? 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-violet-50 hover:text-violet-600 hover:border-violet-300'
                      : 'bg-violet-50 text-violet-600 border-violet-200 hover:bg-slate-100 hover:text-slate-400 hover:border-slate-200'
                  }`}
                >
                  {aiOff ? <><PauseCircle size={9} /> AI Off</> : <><Zap size={9} /> AI On</>}
                </button>
                <button
                  onClick={() => {
                    toggleThreadAiLock(activeTicket.id);
                    toast(isLocked ? 'AI lock removed' : 'AI state locked', {
                      description: isLocked
                        ? `${activeTicket.guestName} will now follow global AI setting.`
                        : `AI state pinned — won't change with global toggle.`,
                      duration: 2500,
                    });
                  }}
                  title={isLocked ? 'Unlock AI state' : 'Lock AI state'}
                  className={`flex items-center justify-center w-5 h-5 rounded-full border transition-colors cursor-pointer ${
                    isLocked
                      ? 'bg-violet-100 text-violet-500 border-violet-300 hover:bg-slate-100 hover:text-slate-400 hover:border-slate-200'
                      : 'bg-transparent text-slate-300 border-slate-200 hover:bg-violet-50 hover:text-violet-400 hover:border-violet-200'
                  }`}
                >
                  <Lock size={9} />
                </button>
              </div>
            );
          })()}

          {/* Status badge — hidden on very narrow */}
          {(activeSystemStatus || activeIsHandedOff) && (() => {
            const eff = activeIsHandedOff ? 'handed-off' : activeSystemStatus;
            if (eff === 'ai-handled') return null;
            const statusLabel = eff === 'handed-off' ? 'Your Turn' : eff === 'partial' ? 'Follow-up' : eff === 'safety' ? 'Safety Alert' : null;
            if (!statusLabel) return null;
            const StatusIcon = eff === 'handed-off' ? ArrowRightLeft : eff === 'partial' ? AlertCircle : ShieldAlert;
            const statusColor = eff === 'safety' ? 'bg-red-50 text-red-500 border-red-200' : eff === 'partial' ? 'bg-sky-50 text-sky-500 border-sky-200' : 'bg-amber-50 text-amber-500 border-amber-200';
            return (
              <span className={`hidden sm:flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-full border whitespace-nowrap shrink-0 ${statusColor}`}>
                <StatusIcon size={9} /> {statusLabel}
              </span>
            );
          })()}

          {/* ⋮ More menu */}
          <div className="relative shrink-0">
            <button
              onClick={() => setHeaderMenuOpen(p => !p)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <MoreVertical size={15} />
            </button>
            {headerMenuOpen && (
              <div className="absolute right-0 top-9 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-52 z-50" onClick={e => e.stopPropagation()}>
                {/* Status badge on mobile */}
                {(activeSystemStatus || activeIsHandedOff) && (() => {
                  const eff = activeIsHandedOff ? 'handed-off' : activeSystemStatus;
                  if (!eff || eff === 'ai-handled') return null;
                  const statusLabel = eff === 'handed-off' ? 'Your Turn' : eff === 'partial' ? 'Follow-up' : eff === 'safety' ? 'Safety Alert' : null;
                  if (!statusLabel) return null;
                  const StatusIcon = eff === 'handed-off' ? ArrowRightLeft : eff === 'partial' ? AlertCircle : ShieldAlert;
                  return (
                    <div className="sm:hidden px-3 py-2 flex items-center gap-2 text-sm text-slate-600 border-b border-slate-100">
                      <StatusIcon size={13} /> {statusLabel}
                    </div>
                  );
                })()}
                {/* Channel */}
                <div className="px-3 py-2 flex items-center gap-2 text-xs text-slate-500 border-b border-slate-100">
                  <activeTicket.channelIcon size={12} /> {activeTicket.channel}
                  <span className="text-slate-300 mx-1">·</span>
                  <span className="truncate text-slate-400">{activeTicket.host.name}</span>
                </div>
                {/* AI toggle */}
                {(() => {
                  const hostConfig = activeTicket ? hostSettings.find(s => s.hostId === activeTicket.host.id) : null;
                  if (!hostConfig) return null;
                  const hostAutoReply = hostConfig.autoReply;
                  const isExplicitlyEnabled2 = autoReplyPausedTickets[activeTicket.id] === false;
                  const activeIsHandedOff2 = autoReplyHandedOff[activeTicket.id] === true;
                  const aiOff2 = autoReplyPausedTickets[activeTicket.id] === true || (!hostAutoReply && !isExplicitlyEnabled2);
                  const isLocked2 = !!threadAiLocks[activeTicket.id];
                  return (
                    <>
                      <button
                        onClick={() => {
                          setHeaderMenuOpen(false);
                          if (aiOff2) {
                            setTicketAiEnabled(activeTicket.id, true);
                            if (activeIsHandedOff2) setAutoReplyHandedOff(activeTicket.id, false);
                            toast.success('AI enabled', { description: `Auto-reply active for ${activeTicket.guestName}.`, duration: 3000 });
                          } else {
                            setTicketAiEnabled(activeTicket.id, false);
                            toast('AI paused', { description: `You're handling ${activeTicket.guestName} manually.`, duration: 3000 });
                          }
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        {aiOff2 ? <><PauseCircle size={13} /> Enable AI</> : <><Zap size={13} /> Pause AI</>}
                      </button>
                      <button
                        onClick={() => {
                          setHeaderMenuOpen(false);
                          toggleThreadAiLock(activeTicket.id);
                          toast(isLocked2 ? 'AI lock removed' : 'AI state locked', {
                            description: isLocked2
                              ? `${activeTicket.guestName} will now follow global AI setting.`
                              : `AI state pinned — won't change with global toggle.`,
                            duration: 2500,
                          });
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        <Lock size={13} /> {isLocked2 ? 'Unlock AI state' : 'Lock AI state'}
                      </button>
                    </>
                  );
                })()}
                {/* AI settings */}
                <button
                  onClick={() => { setHeaderMenuOpen(false); navigate('/settings?tab=ai'); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <Settings size={13} /> AI Settings
                </button>
                {/* Notify Host */}
                <button
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    const summary = [
                      `[Delta Support → Host]`,
                      `Guest: ${activeTicket.guestName} | ${activeTicket.property} · ${activeTicket.room}`,
                      `Issue: ${activeTicket.summary}`,
                      `Initial response sent. Please advise.`,
                      activeTicket.booking ? `Booking: ${activeTicket.booking.checkIn} – ${activeTicket.booking.checkOut}` : activeTicket.bookingId ? `Booking ID: #${activeTicket.bookingId}` : '',
                    ].join('\n');
                    navigator.clipboard.writeText(summary).catch(() => {});
                    toast.success('Copied — paste into LINE WORKS', { description: `Summary for ${activeTicket.guestName} ready to share.`, duration: 4000 });
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors border-b border-slate-100"
                >
                  <Share2 size={13} /> Notify Host
                </button>
                {/* Panel toggle */}
                {!isMobile && (
                  <button
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      if (rightCollapsed) {
                        if (shouldAutoCollapseRight) setRightOverlayOpen(p => !p);
                        else setRightCollapsed(false);
                      } else {
                        setRightCollapsed(true); setRightOverlayOpen(false);
                      }
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    {rightCollapsed ? <PanelRightOpen size={13} /> : <PanelRightClose size={13} />}
                    {rightCollapsed ? 'Show context panel' : 'Hide context panel'}
                  </button>
                )}
                {isMobile && (
                  <button
                    onClick={() => { setHeaderMenuOpen(false); setShowMobileDetails(p => !p); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <PanelRightOpen size={13} /> {showMobileDetails ? 'Hide details' : 'Show details'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* AI Context Summary Banner */}
        <button
          onClick={() => setSummaryCollapsed(!summaryCollapsed)}
          className="bg-indigo-50/50 border-b border-indigo-100 shrink-0 text-left w-full transition-all hover:bg-indigo-50/80"
        >
          {summaryCollapsed ? (
            <div className="px-3 md:px-4 py-2 flex items-center gap-2">
              <Sparkles size={12} className="text-indigo-500 shrink-0" />
              <p className="text-xs text-indigo-800 truncate flex-1">
                <span className="font-bold">AI:</span> {activeTicket.summary}
              </p>
              <div className="flex items-center gap-1.5 shrink-0">
                {activeTicket.tags.slice(0, 2).map(tag => (
                  <span key={tag} className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">{tag}</span>
                ))}
                {activeTicket.tags.length > 2 && (
                  <span className="text-[9px] text-indigo-400">+{activeTicket.tags.length - 2}</span>
                )}
              </div>
              <ChevronDown size={12} className="text-indigo-400 shrink-0" />
            </div>
          ) : (
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="bg-indigo-100 p-2 rounded-full text-indigo-600 mt-0.5"><Sparkles size={16} /></div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-indigo-800 uppercase tracking-wider mb-1">AI Context Summary</h3>
                    <ChevronDown size={12} className="text-indigo-400 rotate-180" />
                  </div>
                  <p className="text-sm text-indigo-900 leading-relaxed">{activeTicket.summary}</p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {activeTicket.tags.map(tag => (
                      <span key={tag} className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Tag size={8} /> {tag}
                      </span>
                    ))}
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Globe2 size={8} /> {activeTicket.language}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </button>

        {/* BPO escalation guidance — Step 3 of Trouble Response Flow */}
        {escalationGuidance && (
          <div className={`px-4 py-2 flex items-center gap-2 text-[11px] font-semibold border-b shrink-0 ${
            escalationGuidance === 'immediate'
              ? 'bg-red-50 text-red-600 border-red-200'
              : 'bg-amber-50 text-amber-600 border-amber-200'
          }`}>
            {escalationGuidance === 'immediate'
              ? <ShieldAlert size={12} />
              : <AlertCircle size={12} />}
            {escalationGuidance === 'immediate'
              ? 'Contact host now'
              : 'Handle first, notify host after'}
          </div>
        )}

        {/* Chat messages */}
        <div className={`flex-1 overflow-y-auto ${isMobile ? 'p-3 gap-3' : 'p-6 gap-4'} flex flex-col`}>
          {getMessages(activeTicket).map((msg) => (
            <div key={msg.id} className={`flex flex-col transition-all duration-300 ${
              pendingDeletes.has(msg.id) ? 'opacity-20 scale-95 pointer-events-none' : ''
            } ${
              msg.sender === 'guest' ? `self-start ${isMobile ? 'max-w-[90%]' : 'max-w-[80%]'}` :
              msg.sender === 'system' ? 'self-center w-full max-w-[560px] my-1' :
              `self-end ${isMobile ? 'max-w-[90%]' : 'max-w-[80%]'}`
            }`}
              onContextMenu={msg.sender !== 'system' && !pendingDeletes.has(msg.id) ? (e) => handleMsgContextMenu(e, msg.id, msg.text, msg.sender) : undefined}
            >
              {msg.sender === 'system' ? (
                (() => {
                  const t = msg.text.toLowerCase().trimStart();
                  // Action-required: colored boxes (agent must act) — new + legacy prefixes
                  const isSafety  = t.startsWith('safety alert') || t.startsWith('guest safety flag') || t.startsWith('urgent —');
                  const isHandoff = t.startsWith('routed to team') || t.startsWith('silently routed') || t.startsWith('handed to agent');
                  // Informational: thin centered dividers — new + legacy prefixes
                  const isPartial      = t.startsWith('follow-up needed') || t.startsWith('partially answered');
                  const isReEscalation = t.startsWith('no reply in');
                  const isAINote       = t.startsWith('ai note');

                  // Plain function (not a component) to render divider-style informational messages.
                  // Using a plain function avoids the React anti-pattern of defining components inside render.
                  const divider = (colorLine: string, textCls: string, Icon: any, text: string) => (
                    <div className={`flex items-center gap-2 text-[10px] ${textCls} w-full min-w-0`}>
                      <div className={`flex-1 h-px ${colorLine} shrink`} />
                      <span className={`flex items-center gap-1 min-w-0 truncate font-medium`}>
                        <Icon size={10} className="shrink-0" />{text}
                      </span>
                      <div className={`flex-1 h-px ${colorLine} shrink`} />
                    </div>
                  );

                  if (isSafety) {
                    return (
                      <div className="flex items-center justify-center gap-2 py-1">
                        <div className="flex items-center gap-1.5 bg-red-100 text-red-600 text-[10px] font-semibold px-2.5 py-1 rounded-full border border-red-200">
                          <ShieldAlert size={11} className="shrink-0" />
                          <span>{msg.text}</span>
                        </div>
                      </div>
                    );
                  }
                  if (isHandoff) {
                    return (
                      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 rounded-lg flex items-center gap-2 shadow-sm min-w-0">
                        <ArrowRightLeft size={13} className="text-amber-500 shrink-0" />
                        <span className="font-medium min-w-0 break-words">{msg.text}</span>
                      </div>
                    );
                  }
                  if (isPartial) {
                    // Trim long topic lists: "Follow-up needed — A, B, C" → "Follow-up needed — A +2"
                    const partialText = (() => {
                      const dashIdx = msg.text.indexOf('—');
                      if (dashIdx === -1) return msg.text;
                      const prefix = msg.text.slice(0, dashIdx + 1).trim();
                      const topics = msg.text.slice(dashIdx + 1).trim().split(',').map(s => s.trim()).filter(Boolean);
                      if (topics.length <= 1) return msg.text;
                      return `${prefix} ${topics[0]}${topics.length > 1 ? ` +${topics.length - 1}` : ''}`;
                    })();
                    return divider('bg-sky-200', 'text-sky-500', AlertCircle, partialText);
                  }
                  if (isReEscalation) return divider('bg-orange-200', 'text-orange-500', Clock,       msg.text);
                  if (isAINote)       return divider('bg-slate-200',  'text-slate-400 italic', Bot,   msg.text);
                  // Default
                  return divider('bg-slate-200', 'text-slate-400', Info, msg.text);
                })()
              ) : msg.sender === 'bot' ? (
                <>
                  <span className="text-[10px] text-slate-400 mb-1 px-1 text-right flex items-center gap-1 justify-end">
                    <Bot size={10} className="text-violet-500" />
                    {msg.deliveryStatus === 'sending' ? 'AI Sending…' : 'AI Auto-Reply'}
                    {' '}&bull; {msg.time}
                  </span>
                  <div className={`p-3 rounded-2xl shadow-sm text-sm bg-violet-100 border border-violet-200 text-slate-800 rounded-tr-sm${msg.deliveryStatus === 'sending' ? ' opacity-70' : ''}`}>
                    {msg.text}
                  </div>
                </>
              ) : msg.sender === 'host' ? (
                <>
                  <span className="text-[10px] text-slate-400 mb-1 px-1 text-right flex items-center gap-1 justify-end">
                    <Home size={10} className="text-amber-600" /> {activeTicket.host.name} &bull; {msg.time}
                  </span>
                  <div className="p-3 rounded-2xl shadow-sm text-sm bg-amber-50 border border-amber-200 text-slate-800 rounded-tr-sm">
                    {msg.text}
                  </div>
                </>
              ) : (
                <>
                  <span className={`text-[10px] text-slate-400 mb-1 px-1 ${msg.sender === 'guest' ? 'text-left' : 'text-right'}`}>
                    {msg.sender === 'guest' ? (activeTicket.guestName || msg.senderName) : agentName}
                    {/* #19: Visual flag for guest-mode test messages */}
                    {msg.isGuestMode && <span className="ml-1 text-[9px] font-bold text-amber-500">(TEST)</span>}
                    {' '}&bull; {msg.time}
                  </span>
                  <div className={`p-3 rounded-2xl shadow-sm text-sm transition-all w-fit ${
                    msg.sender === 'guest'
                      ? 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                      : msg.deliveryStatus === 'failed'
                        ? 'bg-red-50 border border-red-300 text-red-900 rounded-tr-sm'
                        : 'bg-indigo-600 text-white rounded-tr-sm'
                  } ${msg.deliveryStatus === 'sending' ? 'opacity-70' : ''} ${msg.sender !== 'guest' ? 'self-end' : ''}`}>
                    {msg.subject && (
                      <div className={`text-[11px] font-semibold mb-1.5 pb-1.5 border-b ${
                        msg.sender === 'guest'
                          ? 'border-slate-200 text-slate-500'
                          : msg.deliveryStatus === 'failed'
                            ? 'border-red-200 text-red-500'
                            : 'border-indigo-500 text-indigo-200'
                      }`}>{msg.subject}</div>
                    )}
                    {activeTicket.proxyChannel === 'email' ? (
                      msg.htmlBody
                        ? <EmailHtmlFrame html={msg.htmlBody} dark={msg.sender !== 'guest' && msg.deliveryStatus !== 'failed'} />
                        : <span className="whitespace-pre-wrap break-words leading-relaxed">{linkifyEmailText(msg.text)}</span>
                    ) : msg.text}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className={`mt-2 pt-2 flex flex-col gap-1.5 border-t ${
                        msg.sender === 'guest' ? 'border-slate-200' : 'border-indigo-500'
                      }`}>
                        {msg.attachments.map((att, i) => {
                          const isImage = att.mime_type?.startsWith('image/') || att.type === 'image';
                          return isImage ? (
                            <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className="block">
                              <img src={att.url} alt={att.filename || 'attachment'} className="rounded-lg max-h-40 object-cover border border-slate-200" />
                            </a>
                          ) : (
                            <a key={i} href={att.url} target="_blank" rel="noopener noreferrer"
                              className={`flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-lg ${
                                msg.sender === 'guest'
                                  ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                  : 'bg-indigo-500 text-indigo-100 hover:bg-indigo-400'
                              } transition-colors`}>
                              <FileText size={12} className="shrink-0" />
                              <span className="truncate">{att.filename || 'Attachment'}</span>
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* Delivery status footer — sending / sent / failed with retry/delete */}
                  {msg.sender !== 'guest' && msg.deliveryStatus && (
                    <div className="flex items-center gap-2 mt-1 px-1 text-[10px] justify-end min-w-0">
                      {msg.deliveryStatus === 'sending' && (
                        <span className="flex items-center gap-1 text-slate-400">
                          <Loader2 size={10} className="animate-spin" /> Sending…
                        </span>
                      )}
                      {msg.deliveryStatus === 'sent' && (
                        <span className="flex items-center gap-1 text-emerald-500">
                          <CheckCircle size={10} /> Sent
                        </span>
                      )}
                      {msg.deliveryStatus === 'failed' && (
                        <>
                          <span className="flex items-center gap-1 text-red-600 min-w-0">
                            <AlertCircle size={10} className="shrink-0" />
                            <span className="truncate" title={msg.deliveryError || 'Failed to send'}>
                              Failed{msg.deliveryError ? ` — ${msg.deliveryError}` : ''}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => retryPendingProxyMessage(activeTicket.id, msg.id)}
                            className="flex items-center gap-1 text-indigo-600 hover:text-indigo-700 hover:underline shrink-0"
                          >
                            <RefreshCw size={10} /> Retry
                          </button>
                          <button
                            type="button"
                            onClick={() => deletePendingProxyMessage(activeTicket.id, msg.id)}
                            className="flex items-center gap-1 text-slate-400 hover:text-slate-600 hover:underline shrink-0"
                          >
                            <Trash2 size={10} /> Delete
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          {/* AI processing typing indicator in chat */}
          <AnimatePresence>
            {autoReplyProcessing[activeTicket.id] && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="self-end flex flex-col items-end max-w-[80%]"
              >
                <span className="text-[10px] text-slate-400 mb-1 px-1 text-right flex items-center gap-1 justify-end">
                  <Bot size={10} className="text-violet-500" /> AI Auto-Reply
                </span>
                <div className="p-3 rounded-2xl shadow-sm text-sm bg-violet-50 border border-violet-200 rounded-tr-sm flex items-center gap-3">
                  <div className="flex gap-1">
                    <motion.span
                      className="w-2 h-2 bg-violet-400 rounded-full"
                      animate={{ y: [0, -6, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                    />
                    <motion.span
                      className="w-2 h-2 bg-violet-400 rounded-full"
                      animate={{ y: [0, -6, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0.15 }}
                    />
                    <motion.span
                      className="w-2 h-2 bg-violet-400 rounded-full"
                      animate={{ y: [0, -6, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0.3 }}
                    />
                  </div>
                  <span className="text-xs text-violet-600 font-medium">Preparing reply…</span>
                  <button
                    onClick={() => {
                      cancelAutoReply(activeTicket.id);
                      setShowCancelMenu(true);
                    }}
                    className="text-[10px] px-2 py-1 rounded-md bg-violet-100 hover:bg-red-100 text-violet-600 hover:text-red-600 transition-colors border border-violet-200 font-medium flex items-center gap-1"
                  >
                    <Square size={8} /> Stop
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={chatEndRef} />
        </div>

        {/* Smart Reply Panel */}
        {showSmartReply && !guestMode && (
          <SmartReplyPanel
            ticket={activeTicket}
            existingDraft={replyText}
            onInsert={handleSmartReplyInsert}
            onHide={() => setShowSmartReply(false)}
            cacheRef={smartReplyCacheRef}
            aiInquiries={classifiedInquiries}
          />
        )}

        {/* Reply area */}
        <div className={`px-3 py-2 md:px-4 md:py-3 border-t shrink-0 transition-colors ${
          guestMode ? 'bg-emerald-50/80 border-emerald-200' : 'bg-white border-slate-200'
        }`}>
          {activeDraft && !guestMode && (
            <div className="mb-3 bg-violet-50 border border-violet-200 rounded-xl p-3 animate-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center gap-2 mb-2">
                <FileEdit size={12} className="text-violet-600" />
                <span className="text-[10px] font-bold text-violet-700 uppercase tracking-wider">AI Draft — Review before sending</span>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed mb-3 bg-white rounded-lg p-2.5 border border-violet-100 max-h-[120px] overflow-y-auto">
                {activeDraft}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (activeTicket) {
                      addBotMessage(activeTicket.id, activeDraft);
                      clearDraftReply(activeTicket.id);
                      toast.success('Draft sent as AI Auto-Reply');
                    }
                  }}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors flex items-center gap-1"
                >
                  <Send size={11} /> Send as-is
                </button>
                <button
                  onClick={() => {
                    setReplyText(activeDraft);
                    if (activeTicket) clearDraftReply(activeTicket.id);
                    toast.info('Draft moved to compose box — edit and send when ready');
                  }}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg bg-white border border-violet-200 text-violet-700 hover:bg-violet-50 transition-colors flex items-center gap-1"
                >
                  <FileEdit size={11} /> Edit first
                </button>
                <button
                  onClick={() => {
                    if (activeTicket) clearDraftReply(activeTicket.id);
                    toast('Draft discarded');
                  }}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1"
                >
                  <X size={11} /> Discard
                </button>
              </div>
            </div>
          )}
          {/* Context switching protection: show which company/channel this reply goes to */}
          {activeTicket.companyName && !guestMode && (
            <div className="flex items-center gap-1.5 mb-1.5 text-[10px] text-slate-400">
              <span className="font-medium">Replying as</span>
              <span className="font-bold text-slate-600">{activeTicket.companyName}</span>
              <span>via</span>
              <span className="font-bold text-slate-600">{activeTicket.channel}</span>
            </div>
          )}
          {/* Stale ticket: disable composer when connection is lost */}
          {isActiveTicketStale && (
            <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              <AlertCircle size={14} className="shrink-0" />
              <span>Connection lost — <button onClick={() => navigate('/settings/inboxes')} className="underline font-medium hover:no-underline text-inherit p-0 leading-[inherit]">reconnect this inbox</button> to reply</span>
            </div>
          )}
          {guestMode && (
            <div className="flex items-center gap-2 mb-2 animate-in fade-in duration-150">
              <UserCircle size={12} className="text-emerald-600" />
              <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                Chatting as {activeTicket.guestName}
              </span>
              <span className="text-[10px] text-emerald-500">Messages appear as the guest</span>
            </div>
          )}
          <textarea
            ref={(el) => {
              (composeTextareaRef as { current: HTMLTextAreaElement | null }).current = el;
              if (el) {
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, isMobile ? 120 : 220)}px`;
              }
            }}
            value={replyText}
            onChange={(e) => {
              setReplyText(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, isMobile ? 120 : 220)}px`;
            }}
            onKeyDown={handleKeyDown}
            disabled={isActiveTicketStale}
            placeholder={
              isActiveTicketStale
                ? 'Connection lost — reconnect to reply'
                : guestMode
                  ? `Chat as ${resolvedGuestName.split(' ')[0]}...`
                  : `Reply to ${resolvedGuestName.split(' ')[0]}... (${navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter)`
            }
            className={`w-full rounded-xl ${isMobile ? 'p-2.5 text-[13px] min-h-[48px] max-h-[120px]' : 'p-3 text-sm min-h-[72px] max-h-[220px]'} focus:outline-none resize-none transition-all duration-300 ${
              composeHighlight
                ? 'ring-2 ring-indigo-300 bg-indigo-50/40 border-indigo-200'
                : guestMode
                  ? 'border-2 border-emerald-300 bg-white focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 placeholder:text-emerald-400'
                  : 'border border-slate-200 bg-slate-50/60 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-300 placeholder:text-slate-400'
            }`}
          />
          <div className="flex items-center justify-between mt-1.5 gap-2">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 min-w-0 overflow-hidden">
              {guestMode ? (
                <span className="flex items-center gap-1 bg-emerald-100 px-1.5 py-0.5 rounded shrink-0">
                  <UserCircle size={9} className="text-emerald-500 shrink-0" />
                  <span className="font-medium text-emerald-700 text-[9px]">{activeTicket.guestName.split(' ')[0]}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 bg-slate-100 px-1.5 py-0.5 rounded truncate">
                  <span className="font-medium text-slate-500 text-[9px] truncate">{activeTicket.host.name}</span>
                  {!isMobile && (
                    <span className="text-slate-400 text-[8px] shrink-0">{activeTicket.host.tone}</span>
                  )}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={toggleGuestMode}
                className={`text-[10px] font-medium px-2 py-1 rounded-md flex items-center gap-1 transition-colors border ${
                  guestMode
                    ? 'text-emerald-700 bg-emerald-100 border-emerald-300 hover:bg-emerald-200'
                    : 'text-slate-400 bg-white border-slate-200 hover:text-emerald-600 hover:bg-emerald-50 hover:border-emerald-200'
                }`}
                title="Toggle guest mode"
              >
                <UserCircle size={11} /> {!isMobile && 'Guest'}
              </button>

              {!guestMode && (
                <button
                  onClick={toggleSmartReply}
                  className={`text-[10px] font-medium px-2 py-1 rounded-md flex items-center gap-1 transition-colors border ${
                    showSmartReply
                      ? 'text-indigo-700 bg-indigo-100 border-indigo-300'
                      : 'text-indigo-600 bg-indigo-50 border-indigo-100 hover:bg-indigo-100'
                  }`}
                  title={`Smart Reply (${navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}+Shift+A)`}
                >
                  <Sparkles size={11} /> {!isMobile && 'Smart Reply'}
                </button>
              )}

              <button
                onClick={handleSendMessage}
                disabled={!replyText.trim()}
                className={`px-2.5 py-1 rounded-md shadow-sm transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 text-[10px] font-medium ${
                  guestMode
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                <Send size={11} /> Send
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right resize handle (desktop only, when not collapsed) */}
      {!isMobile && !rightCollapsed && (
        <div
          className={`w-px shrink-0 cursor-col-resize relative group z-20 transition-colors ${resizing === 'right' ? 'bg-indigo-400' : 'bg-slate-200 hover:bg-indigo-400'}`}
          onMouseDown={(e) => { e.preventDefault(); setResizing('right'); }}
          onDoubleClick={() => setRightWidth(320)}
          title="Drag to resize • Double-click to reset"
        >
          <div className="absolute inset-y-0 -left-2 -right-2" />
        </div>
      )}

      {/* Right overlay backdrop (for narrow screens) */}
      {!isMobile && rightCollapsed && rightOverlayOpen && (
        <div
          className="absolute inset-0 z-40 bg-black/10"
          onClick={() => setRightOverlayOpen(false)}
        />
      )}

      {/* Right Context Pane */}
      <ContextSidebarPane
        activeTicket={activeTicket}
        activeTags={activeTags}
        isMobile={isMobile}
        showMobileDetails={showMobileDetails}
        setShowMobileDetails={setShowMobileDetails}
        rightCollapsed={rightCollapsed}
        rightOverlayOpen={rightOverlayOpen}
        setRightOverlayOpen={setRightOverlayOpen}
        displayRightWidth={displayRightWidth}
        RIGHT_MIN={RIGHT_MIN}
        rightWidth={rightWidth}
        resizing={resizing}
        rightTab={rightTab}
        setRightTab={setRightTab}
        bookingDetails={bookingDetails}
        bookingLoading={bookingLoading}
        ticketNotes={ticketNotes[activeTicket.id] || ''}
        onUpdateNotes={(v) => updateTicketNotes(activeTicket.id, v)}
        onUpdateProperty={(property) => setProxyTicketProperty(activeTicket.id, property)}
        needsPropertyMapping={!activeTicket.property && !activeTicket.bookingId}
        deescalateTicket={deescalateTicket}
        onComposeReply={handleComposeReply}
        onNavigateToKB={(propId) => navigate(`/kb/${propId}`)}
        onInquiriesClassified={setClassifiedInquiries}
        inquiryResolutions={inquiryResolutions}
        onResolutionChange={handleResolutionChange}
        onBulkResolution={handleBulkResolution}
      />

      <InboxDialogs
        activeTicket={activeTicket}
        messageCount={getMessages(activeTicket).length}
        filteredTickets={filteredTickets}
        isMobile={isMobile}
        agentName={agentName}
        showResolveConfirm={showResolveConfirm}
        setShowResolveConfirm={setShowResolveConfirm}
        onResolve={handleResolve}
        showDeleteConfirm={showDeleteConfirm}
        setShowDeleteConfirm={setShowDeleteConfirm}
        onDeleteThread={(deletedId) => {
          const nextTicket = filteredTickets.find(t => t.id !== deletedId);
          cancelAutoReply(deletedId);
          setShowCancelMenu(false);
          deleteThread(deletedId);
          toast.success('Thread deleted', { description: `${activeTicket.guestName}'s conversation removed.` });
          if (nextTicket) {
            navigate(`/inbox/${nextTicket.id}`);
          } else {
            navigate('/inbox');
            if (isMobile) setMobilePanel('list');
          }
        }}
        showCancelMenu={showCancelMenu}
        setShowCancelMenu={setShowCancelMenu}
        toggleAutoReplyPause={toggleAutoReplyPause}
        ctxMenu={ctxMenu}
        setCtxMenu={setCtxMenu}
        ctxMenuRef={ctxMenuRef}
        scheduleDelete={scheduleDelete}
      />
    </div>
  );
}