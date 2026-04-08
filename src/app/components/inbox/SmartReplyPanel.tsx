import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Sparkles, Loader2, Settings2, X, Check, Minus, Pencil, Wand2, AlertTriangle, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { useAppContext } from '../../context/AppContext';
import { MOCK_PROPERTIES } from '../../data/mock-data';
import type { Ticket } from '../../data/types';
import {
  detectInquiries,
  scoreKBForInquiry,
  composeReply,
  type DetectedInquiry,
  type InquiryKBMatch,
  type InquiryDecision,
  type ContextItem,
} from './InquiryDetector';

/**
 * Serialise ContextItem[] from the Guest Needs Panel into a compact
 * plain-text block the compose/polish prompts can use as a focused briefing.
 * Returns an empty string when there are no items (callers skip appending).
 */
function buildGuestInsights(inquiries: DetectedInquiry[]): string {
  const allItems: ContextItem[] = inquiries.flatMap(inq => inq.context ?? []);
  if (allItems.length === 0) return '';

  const bySection: Record<string, ContextItem[]> = {};
  for (const item of allItems) {
    (bySection[item.section] ??= []).push(item);
  }

  return Object.entries(bySection)
    .map(([section, items]) => {
      const lines = items.map(i =>
        `  • [${i.source === 'kb' ? 'KB' : 'est.'}] ${i.text}`
      );
      return `${section}:\n${lines.join('\n')}`;
    })
    .join('\n\n');
}
import { composeReplyAI } from '../../ai/api-client';
import {
  COMPOSE_REPLY_USER,
  POLISH_DRAFT_USER,
  interpolate,
  resolvePrompt,
  resolveModel,
} from '../../ai/prompts';

/** Cache entry stored by InboxView, keyed by ticketId-messageCount */
export interface SmartReplyCache {
  composedMessage: string;
  decisions: Record<string, 'yes' | 'no'>;
  customTexts: Record<string, string>;
}

interface SmartReplyPanelProps {
  ticket: Ticket;
  existingDraft: string;
  onInsert: (text: string) => void;
  onHide: () => void;
  cacheRef: React.MutableRefObject<Record<string, SmartReplyCache>>;
  /** AI-classified inquiries with ContextItem[] from AssistantPanel — used to enrich compose/polish */
  aiInquiries?: DetectedInquiry[];
}

type Phase = 'draft-detected' | 'analyzing' | 'composing' | 'preview' | 'configure';

/** Turn a detected inquiry into a concise agent-facing Yes/No question. */
function formatQuestion(inq: DetectedInquiry): string {
  const d = inq.detail;
  switch (inq.type) {
    case 'checkin':
      if (/code|lock|key|access/i.test(d)) return 'Provide entry code / access instructions?';
      return 'Allow guest to check in early?';
    case 'checkout': {
      const m = d.match(/at\s+(\S+)/i);
      return m ? `Allow late checkout at ${m[1]}?` : 'Allow late checkout for guest?';
    }
    case 'maintenance': {
      const issue = d.replace(/\s*reported$/i, '').replace(/^General\s+/i, '');
      return `Dispatch maintenance for ${issue.toLowerCase()}?`;
    }
    case 'wifi':
      if (/instructions|password/i.test(d)) return 'Share Wi-Fi credentials with guest?';
      return 'Help guest with Wi-Fi connectivity?';
    case 'noise': return 'Address noise complaint?';
    case 'luggage':
      if (/drop/i.test(d)) return 'Allow early luggage drop-off?';
      if (/post|after/i.test(d)) return 'Offer post-checkout luggage storage?';
      return 'Accommodate luggage storage request?';
    case 'directions':
      if (/airport/i.test(d)) return 'Provide airport transfer information?';
      return 'Provide directions / transport info?';
    case 'billing':
      if (/refund/i.test(d)) return 'Process refund request?';
      return 'Address billing inquiry?';
    case 'amenities': return 'Confirm amenity availability?';
    case 'pet':
      if (/service|support|esa/i.test(d)) return 'Accommodate service / support animal?';
      if (/fee|deposit/i.test(d)) return 'Share pet fee / deposit info?';
      if (/dog|puppy/i.test(d)) return 'Allow guest to bring their dog?';
      if (/cat|kitten/i.test(d)) return 'Allow guest to bring their cat?';
      return 'Share pet policy with guest?';
    default: {
      // For general inquiries, derive a meaningful question from the detail
      const detail = inq.detail;
      if (detail && detail !== 'Guest message requires review') {
        // Trim to a short actionable question
        const short = detail.length > 60 ? detail.slice(0, 57) + '...' : detail;
        return `Respond to: "${short}"?`;
      }
      return 'Respond to guest inquiry?';
    }
  }
}

export function SmartReplyPanel({ ticket, existingDraft, onInsert, onHide, cacheRef, aiInquiries }: SmartReplyPanelProps) {
  const { kbEntries, agentName, hasApiKey, aiModel, promptOverrides } = useAppContext();

  // Cache key for this ticket + message state
  const cacheKey = `${ticket.id}-${(ticket.messages || []).length}`;
  const hasDraft = existingDraft.trim().length > 10;

  const [phase, setPhase] = useState<Phase>(() => {
    // Draft in textarea always takes priority — let agent choose polish vs fresh
    if (hasDraft) return 'draft-detected';
    const cached = cacheRef.current[cacheKey];
    if (cached) return 'preview';
    return 'analyzing';
  });
  const [decisions, setDecisions] = useState<Record<string, 'yes' | 'no'>>(() => {
    return cacheRef.current[cacheKey]?.decisions || {};
  });
  const [customTexts, setCustomTexts] = useState<Record<string, string>>(() => {
    return cacheRef.current[cacheKey]?.customTexts || {};
  });
  const [expandedCustom, setExpandedCustom] = useState<string | null>(null);
  const [composedMessage, setComposedMessage] = useState(() => {
    return cacheRef.current[cacheKey]?.composedMessage || '';
  });
  const composeTriggered = useRef(!!cacheRef.current[cacheKey]);

  const activeProp = MOCK_PROPERTIES.find(p => p.name === ticket.property);
  const ticketRoom = ticket.room.replace(/[^0-9]/g, '');

  const scopeFilteredKb = useMemo(() => {
    return kbEntries.filter(kb =>
      kb.hostId === ticket.host.id &&
      (!kb.propId || kb.propId === activeProp?.id)
    );
  }, [kbEntries, ticket.host.id, activeProp?.id]);

  const inquiries = useMemo(() => {
    const guestMessages = (ticket.messages || []).filter(m => m.sender === 'guest').map(m => m.text);
    return detectInquiries(guestMessages, ticket.tags, ticket.summary);
  }, [ticket]);

  const kbMatchesByInquiry = useMemo(() => {
    const result: Record<string, InquiryKBMatch[]> = {};
    for (const inq of inquiries) {
      const withRoomBoost = scopeFilteredKb.map(kb => {
        if (kb.roomId && ticketRoom && kb.roomId === ticketRoom) {
          return { ...kb, tags: [...(kb.tags || []), '__room_match__'] };
        }
        return kb;
      });
      const matches = scoreKBForInquiry(inq, withRoomBoost);
      result[inq.id] = matches
        .map(m => ({
          ...m,
          score: m.entry.roomId && ticketRoom && m.entry.roomId === ticketRoom
            ? m.score + 50 : m.score,
        }))
        .sort((a, b) => b.score - a.score);
    }
    return result;
  }, [inquiries, scopeFilteredKb, ticketRoom]);

  // ─── KB coverage analysis ────────────────────────────────────
  const { coveredCount, uncoveredCount, allUncovered, uncoveredLabels } = useMemo(() => {
    let covered = 0;
    let uncovered = 0;
    const labels: string[] = [];
    for (const inq of inquiries) {
      const matches = kbMatchesByInquiry[inq.id] || [];
      if (matches.length > 0) {
        covered++;
      } else {
        uncovered++;
        labels.push(inq.label);
      }
    }
    return {
      coveredCount: covered,
      uncoveredCount: uncovered,
      allUncovered: uncovered > 0 && covered === 0,
      uncoveredLabels: labels,
    };
  }, [inquiries, kbMatchesByInquiry]);

  // ─── Polish draft function ───────────────────────────────────
  const doPolish = useCallback(async (draft: string) => {
    setPhase('composing');

    if (!hasApiKey) {
      // Without API key, just pass through the draft
      setTimeout(() => {
        setComposedMessage(draft);
        setPhase('preview');
      }, 300);
      return;
    }

    try {
      const guestFacts: string[] = [];
      const internalFacts: string[] = [];
      for (const inq of inquiries) {
        for (const m of (kbMatchesByInquiry[inq.id] || [])) {
          const line = `[${m.entry.title}] ${m.entry.content}`;
          if (m.entry.internal) internalFacts.push(line);
          else guestFacts.push(line);
        }
      }

      const guestMessages = (ticket.messages || []).filter(m => m.sender === 'guest').map(m => m.text).join('\n');

      const insights = buildGuestInsights(aiInquiries ?? []);
      const userPrompt = interpolate(resolvePrompt('polish_draft', 'user', promptOverrides), {
        hostName: ticket.host.name,
        hostTone: ticket.host.tone,
        guestFirstName: ticket.guestName.split(' ')[0],
        agentName,
        language: ticket.language?.split('(')[0]?.trim() || 'English',
        guestMessages,
        agentDraft: draft,
        guestFacingFacts: guestFacts.length > 0 ? guestFacts.join('\n') : '(none available)',
        internalFacts: internalFacts.length > 0 ? internalFacts.join('\n') : '(none)',
      }) + (insights ? `\n\nPre-analyzed guest insights (use to verify and enrich the draft):\n${insights}` : '');

      const result = await composeReplyAI({
        systemPrompt: resolvePrompt('polish_draft', 'system', promptOverrides),
        userPrompt,
        model: resolveModel('polish_draft', promptOverrides),
        temperature: promptOverrides.polish_draft?.temperature,
        maxTokens: promptOverrides.polish_draft?.maxTokens,
      });

      setComposedMessage(result.text);
      setPhase('preview');
    } catch (err: any) {
      toast.error('Polish failed', { description: err.message });
      setComposedMessage(draft);
      setPhase('preview');
    }
  }, [inquiries, kbMatchesByInquiry, ticket, agentName, hasApiKey, aiModel]);

  // ─── Core compose function (takes decisions directly) ────────
  const doCompose = useCallback(async (inquiryDecisions: Record<string, InquiryDecision>) => {
    setPhase('composing');

    if (hasApiKey) {
      try {
        const inquiryDecisionsText = inquiries.map(inq => {
          const dec = inquiryDecisions[inq.id];
          if (!dec) return `- ${inq.label}: (no decision -- skip)`;
          const note = dec.decision === 'custom' && dec.customNote ? ` Agent note: "${dec.customNote}"` : '';
          return `- ${inq.label} (${inq.detail}): ${dec.decision.toUpperCase()}${note}`;
        }).join('\n');

        const guestFacts: string[] = [];
        const internalFacts: string[] = [];
        for (const inq of inquiries) {
          for (const m of (kbMatchesByInquiry[inq.id] || [])) {
            const line = `[${m.entry.title}] ${m.entry.content}`;
            if (m.entry.internal) internalFacts.push(line);
            else guestFacts.push(line);
          }
        }

        const guestMessages = (ticket.messages || []).filter(m => m.sender === 'guest').map(m => m.text).join('\n');

        // Include bot auto-replies so the AI knows what was already said to the guest
        const botMessages = (ticket.messages || []).filter(m => m.sender === 'bot').map(m => m.text);
        const priorBotContext = botMessages.length > 0
          ? `\n\nPrevious AI auto-replies already sent to guest (do NOT repeat this info):\n${botMessages.join('\n')}`
          : '';

        const insights = buildGuestInsights(aiInquiries ?? []);
        const userPrompt = interpolate(resolvePrompt('compose_reply', 'user', promptOverrides), {
          hostName: ticket.host.name,
          hostTone: ticket.host.tone,
          guestFirstName: ticket.guestName.split(' ')[0],
          agentName,
          language: ticket.language?.split('(')[0]?.trim() || 'English',
          guestMessages,
          inquiryDecisions: inquiryDecisionsText,
          guestFacingFacts: guestFacts.length > 0 ? guestFacts.join('\n') : '(none available)',
          internalFacts: internalFacts.length > 0 ? internalFacts.join('\n') : '(none)',
        }) + priorBotContext + (insights ? `\n\nPre-analyzed guest insights (prioritize these facts when composing):\n${insights}` : '');

        const result = await composeReplyAI({
          systemPrompt: resolvePrompt('compose_reply', 'system', promptOverrides),
          userPrompt,
          model: resolveModel('compose_reply', promptOverrides),
          temperature: promptOverrides.compose_reply?.temperature,
          maxTokens: promptOverrides.compose_reply?.maxTokens,
        });

        setComposedMessage(result.text);
        setPhase('preview');
      } catch (err: any) {
        toast.error('AI compose failed, using templates', { description: err.message });
        const reply = composeReply(
          ticket.guestName.split(' ')[0], ticket.host.tone,
          inquiries, inquiryDecisions, kbMatchesByInquiry, agentName,
        );
        setComposedMessage(reply);
        setPhase('preview');
      }
    } else {
      setTimeout(() => {
        const reply = composeReply(
          ticket.guestName.split(' ')[0], ticket.host.tone,
          inquiries, inquiryDecisions, kbMatchesByInquiry, agentName,
        );
        setComposedMessage(reply);
        setPhase('preview');
      }, 400);
    }
  }, [inquiries, kbMatchesByInquiry, ticket, agentName, hasApiKey, aiModel]);

  // ─── Auto-compose on mount (happy path: skip configure) ──────
  useEffect(() => {
    if (composeTriggered.current) return;
    if (hasDraft) return; // Don't auto-compose if agent has a draft — wait for their choice
    if (allUncovered) return; // Don't auto-compose when nothing in KB — show no-coverage state
    const timer = setTimeout(() => {
      composeTriggered.current = true;
      // Set all decisions to 'yes' and auto-compose
      const yesDecisions: Record<string, 'yes' | 'no'> = {};
      const autoInquiryDecisions: Record<string, InquiryDecision> = {};
      for (const inq of inquiries) {
        yesDecisions[inq.id] = 'yes';
        autoInquiryDecisions[inq.id] = { inquiryId: inq.id, decision: 'yes' };
      }
      setDecisions(yesDecisions);
      doCompose(autoInquiryDecisions);
    }, 200);
    return () => clearTimeout(timer);
  }, [inquiries, doCompose, hasDraft, allUncovered]);

  // ─── Write to cache whenever we have a composed message ──────
  useEffect(() => {
    if (composedMessage && (phase === 'preview' || phase === 'configure')) {
      cacheRef.current[cacheKey] = {
        composedMessage,
        decisions,
        customTexts,
      };
    }
  }, [composedMessage, decisions, customTexts, phase, cacheKey, cacheRef]);

  // ─── Manual recompose from configure phase ───────────────────
  const handleRecompose = useCallback(() => {
    const inquiryDecisions: Record<string, InquiryDecision> = {};
    for (const inq of inquiries) {
      const custom = customTexts[inq.id]?.trim();
      if (custom) {
        inquiryDecisions[inq.id] = { inquiryId: inq.id, decision: 'custom', customNote: custom };
      } else {
        const dec = decisions[inq.id];
        if (dec) inquiryDecisions[inq.id] = { inquiryId: inq.id, decision: dec };
      }
    }
    doCompose(inquiryDecisions);
  }, [inquiries, decisions, customTexts, doCompose]);

  // ─── Render: Draft detected ────────────────────────────────
  if (phase === 'draft-detected') {
    const truncatedDraft = existingDraft.length > 80
      ? existingDraft.slice(0, 80) + '...'
      : existingDraft;

    return (
      <div className="mx-3 mb-1 border border-indigo-200 rounded-xl bg-white shadow-sm overflow-hidden shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-indigo-600" />
            <span className="text-sm font-bold text-slate-800">Smart Reply</span>
          </div>
          <button onClick={onHide} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
            Hide
          </button>
        </div>

        <div className="px-4 pb-3">
          <div className="flex items-start gap-2 mb-3 p-2.5 bg-slate-50 rounded-lg border border-slate-100">
            <Pencil size={12} className="text-slate-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">Your draft</span>
              <p className="text-xs text-slate-600 leading-relaxed truncate">{truncatedDraft}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                composeTriggered.current = true;
                doPolish(existingDraft);
              }}
              className="flex-1 px-3 py-2.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
            >
              <Wand2 size={13} /> Polish my draft
            </button>
            <button
              onClick={() => {
                composeTriggered.current = true;
                const yesDecisions: Record<string, 'yes' | 'no'> = {};
                const autoInquiryDecisions: Record<string, InquiryDecision> = {};
                for (const inq of inquiries) {
                  yesDecisions[inq.id] = 'yes';
                  autoInquiryDecisions[inq.id] = { inquiryId: inq.id, decision: 'yes' };
                }
                setDecisions(yesDecisions);
                doCompose(autoInquiryDecisions);
              }}
              className="flex-1 px-3 py-2.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5"
            >
              <Sparkles size={13} /> Compose fresh
            </button>
          </div>
          {!hasApiKey && (
            <p className="text-[9px] text-amber-500 mt-1.5 text-center">Polish requires an API key — will use your draft as-is</p>
          )}
        </div>
      </div>
    );
  }

  // ─── Render: Analyzing / Composing ───────────────────────────
  if (phase === 'analyzing' && allUncovered) {
    // No KB coverage at all — show "manual mode" state
    return (
      <div className="mx-3 mb-1 border border-amber-200 rounded-xl bg-white shadow-sm overflow-hidden shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" />
            <span className="text-sm font-bold text-slate-800">Smart Reply</span>
            <span className="text-[8px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">No coverage</span>
          </div>
          <button onClick={onHide} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
            Hide
          </button>
        </div>

        <div className="px-4 pb-3">
          <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg mb-3">
            <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] font-semibold text-amber-800">
                Your knowledge base doesn't cover {uncoveredLabels.length === 1 ? `"${uncoveredLabels[0]}"` : 'what this guest is asking about'}
              </p>
              <p className="text-[10px] text-amber-600 mt-0.5 leading-relaxed">
                AI can't compose a reliable reply without knowledge base data. You can write your own response, provide the answers yourself, or send a holding message.
              </p>
            </div>
          </div>

          {/* Topic chips showing what's uncovered */}
          <div className="flex flex-wrap gap-1 mb-3">
            {uncoveredLabels.map((label, i) => (
              <span key={i} className="text-[9px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                <AlertTriangle size={7} /> {label}
              </span>
            ))}
          </div>

          {/* Action buttons */}
          <div className="space-y-1.5">
            <button
              onClick={() => {
                // Pre-compose a holding message
                const guestFirst = ticket.guestName.split(' ')[0];
                const holding = `Hi ${guestFirst},\n\nThank you for reaching out! I'm looking into this and will get back to you shortly.\n\nBest,\n${agentName}`;
                setComposedMessage(holding);
                composeTriggered.current = true;
                setPhase('preview');
              }}
              className="w-full px-3 py-2.5 bg-amber-500 text-white text-xs font-medium rounded-lg hover:bg-amber-600 shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
            >
              <MessageSquare size={13} /> Send a holding message
            </button>
            <button
              onClick={() => {
                // Open configure — agent provides custom notes for each inquiry
                composeTriggered.current = true;
                if (inquiries.length > 0) setExpandedCustom(inquiries[0].id);
                setPhase('configure');
              }}
              className="w-full px-3 py-2.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5"
            >
              <Pencil size={13} /> I know the answers — compose with my notes
            </button>
            <button
              onClick={onHide}
              className="w-full px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors flex items-center justify-center gap-1.5"
            >
              I'll write my own reply
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'analyzing' || phase === 'composing') {
    return (
      <div className="mx-3 mb-1 border border-indigo-200 rounded-xl bg-white shadow-sm overflow-hidden shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-indigo-600" />
            <span className="text-sm font-bold text-slate-800">Smart Reply</span>
          </div>
          <button onClick={onHide} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
            Hide
          </button>
        </div>
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 py-4 justify-center">
            <Loader2 size={16} className="animate-spin text-indigo-600" />
            <span className="text-sm text-slate-500">
              {phase === 'analyzing' ? 'Analyzing conversation...' : hasApiKey ? 'AI is composing...' : 'Composing reply...'}
            </span>
          </div>
          <div className="space-y-2 animate-pulse">
            <div className="h-3 bg-slate-100 rounded w-3/4" />
            <div className="h-3 bg-slate-100 rounded w-full" />
            <div className="h-3 bg-slate-100 rounded w-5/6" />
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Preview (primary view after auto-compose) ────────
  if (phase === 'preview') {
    return (
      <div className="mx-3 mb-1 border border-indigo-200 rounded-xl bg-white shadow-sm overflow-hidden shrink-0 animate-in fade-in duration-150">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-indigo-600" />
            <span className="text-sm font-bold text-slate-800">Smart Reply</span>
            <span className="text-[9px] text-slate-400 font-medium">{hasApiKey ? 'AI' : 'Template'}</span>
          </div>
          <button onClick={onHide} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
            Hide
          </button>
        </div>

        {/* Composed message */}
        <div className="px-4 pb-2 max-h-48 overflow-y-auto">
          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{composedMessage}</p>
        </div>

        {/* Partial coverage warning */}
        {uncoveredCount > 0 && coveredCount > 0 && (
          <div className="px-4 pb-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle size={10} className="text-amber-500 shrink-0" />
              <span className="text-[10px] text-amber-700">
                {uncoveredCount} topic{uncoveredCount > 1 ? 's' : ''} not covered — review before sending
              </span>
            </div>
          </div>
        )}

        {/* Compact decision summary chips */}
        <div className="px-4 pb-2 flex flex-wrap gap-1 items-center">
          {inquiries.map(inq => {
            const custom = customTexts[inq.id]?.trim();
            const dec = decisions[inq.id];
            const shortLabel = inq.label.replace(/\s*(Request|Complaint|Issue|Inquiry)$/i, '');
            const hasKB = (kbMatchesByInquiry[inq.id] || []).length > 0;
            return (
              <span
                key={inq.id}
                className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5 border ${
                  !hasKB
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : custom
                    ? 'bg-blue-50 text-blue-600 border-blue-200'
                    : dec === 'yes'
                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                    : 'bg-red-50 text-red-500 border-red-200'
                }`}
              >
                {!hasKB ? <AlertTriangle size={7} /> : custom ? <Pencil size={7} /> : dec === 'yes' ? <Check size={7} /> : <Minus size={7} />}
                {shortLabel}
              </span>
            );
          })}
          <button
            onClick={() => { setPhase('configure'); }}
            className="text-[9px] font-medium text-indigo-600 hover:text-indigo-800 ml-1 underline underline-offset-2 decoration-indigo-300"
          >
            Edit
          </button>
        </div>

        {/* Actions */}
        <div className="px-4 py-2.5 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            onClick={() => {
              delete cacheRef.current[cacheKey]; // Consumed — clear so re-open shows draft-detected
              onInsert(composedMessage);
            }}
            className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 shadow-sm transition-all active:scale-95 flex items-center gap-1.5"
          >
            <Pencil size={12} /> Insert to edit
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: Configure (on-demand, from "Edit decisions") ─────
  return (
    <div className="mx-3 mb-1 border border-indigo-200 rounded-xl bg-white shadow-sm overflow-hidden shrink-0 animate-in fade-in duration-150">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 size={14} className="text-indigo-600" />
          <span className="text-sm font-bold text-slate-800">Fine-tune Reply</span>
          <span className="text-[9px] text-slate-400 font-medium">Adjust what the AI includes</span>
        </div>
        <button
          onClick={() => setPhase('preview')}
          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
        >
          Back
        </button>
      </div>

      <div className="px-4 pb-2 space-y-1.5 max-h-64 overflow-y-auto">
        {inquiries.map(inq => {
          const isCustomOpen = expandedCustom === inq.id;
          const hasCustomText = !!customTexts[inq.id]?.trim();
          const question = formatQuestion(inq);
          const matches = kbMatchesByInquiry[inq.id] || [];
          const topMatch = matches[0];
          const currentDec = decisions[inq.id];

          return (
            <div key={inq.id} className="border border-slate-200 rounded-lg overflow-hidden">
              {/* Question + decision row */}
              <div className="px-3 py-2 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-slate-800 leading-snug block">{question}</span>
                  {/* KB context hint */}
                  {topMatch && !hasCustomText ? (
                    <span className="text-[9px] text-slate-400 leading-tight mt-0.5 block truncate">
                      {currentDec === 'yes' ? 'Will use:' : 'Available:'} {topMatch.entry.title}
                      {matches.length > 1 && ` +${matches.length - 1} more`}
                    </span>
                  ) : !topMatch && !hasCustomText ? (
                    <span className="text-[9px] text-amber-500 leading-tight mt-0.5 flex items-center gap-0.5">
                      <AlertTriangle size={8} className="shrink-0" /> Not covered — add a note so AI knows what to say
                    </span>
                  ) : hasCustomText ? (
                    <span className="text-[9px] text-blue-500 leading-tight mt-0.5 block truncate">
                      Custom: "{customTexts[inq.id]?.trim()}"
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  {/* Segmented Yes/No toggle */}
                  <div className="flex rounded-md border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => {
                        setDecisions(p => ({ ...p, [inq.id]: 'yes' }));
                        if (hasCustomText) setCustomTexts(p => ({ ...p, [inq.id]: '' }));
                        setExpandedCustom(null);
                      }}
                      className={`px-2.5 py-1 text-[10px] font-bold transition-colors ${
                        currentDec === 'yes' && !hasCustomText
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white text-slate-400 hover:bg-slate-50'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => {
                        setDecisions(p => ({ ...p, [inq.id]: 'no' }));
                        if (hasCustomText) setCustomTexts(p => ({ ...p, [inq.id]: '' }));
                        setExpandedCustom(null);
                      }}
                      className={`px-2.5 py-1 text-[10px] font-bold transition-colors border-l border-slate-200 ${
                        currentDec === 'no' && !hasCustomText
                          ? 'bg-slate-700 text-white'
                          : 'bg-white text-slate-400 hover:bg-slate-50'
                      }`}
                    >
                      No
                    </button>
                  </div>
                  <button
                    onClick={() => setExpandedCustom(isCustomOpen ? null : inq.id)}
                    className={`w-6 h-6 flex items-center justify-center rounded-md border transition-all ${
                      isCustomOpen || hasCustomText
                        ? 'bg-blue-100 text-blue-600 border-blue-200'
                        : 'bg-white text-slate-300 border-slate-200 hover:text-slate-500 hover:border-slate-300'
                    }`}
                    title="Add custom note for the AI"
                  >
                    {isCustomOpen ? <X size={10} /> : <Pencil size={9} />}
                  </button>
                </div>
              </div>

              {isCustomOpen && (
                <div className="px-3 pb-2 animate-in fade-in slide-in-from-top-1 duration-150">
                  <div className="relative">
                    <input
                      type="text"
                      value={customTexts[inq.id] || ''}
                      onChange={(e) => setCustomTexts(p => ({ ...p, [inq.id]: e.target.value }))}
                      placeholder="Tell the AI what to say instead..."
                      className="w-full border border-slate-200 rounded-lg text-xs py-2 px-3 pr-8 focus:ring-1 focus:ring-blue-400 focus:border-blue-300 outline-none placeholder:text-slate-300"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); setExpandedCustom(null); }
                        if (e.key === 'Escape') setExpandedCustom(null);
                      }}
                    />
                    {customTexts[inq.id]?.trim() && (
                      <button
                        onClick={() => setCustomTexts(p => ({ ...p, [inq.id]: '' }))}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2.5 flex justify-end border-t border-slate-100">
        <button
          onClick={handleRecompose}
          className="px-4 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 shadow-sm transition-all active:scale-95 flex items-center gap-1.5"
        >
          <Sparkles size={12} /> Recompose
        </button>
      </div>
    </div>
  );
}