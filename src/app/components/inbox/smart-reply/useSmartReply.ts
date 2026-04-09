import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { useAppContext } from '../../../context/AppContext';
import {
  detectInquiries,
  scoreKBForInquiry,
  composeReply,
  type DetectedInquiry,
  type InquiryKBMatch,
  type InquiryDecision,
  type ContextItem,
} from '../InquiryDetector';
import { composeReplyAI } from '../../../ai/api-client';
import {
  interpolate,
  resolvePrompt,
  resolveModel,
  resolveTemperature,
  resolveMaxTokens,
} from '../../../ai/prompts';
import type { Phase, SmartReplyPanelProps, SmartReplyState } from './types';

/**
 * Serialise ContextItem[] from the Guest Needs Panel into a compact
 * plain-text block the compose/polish prompts can use as a focused briefing.
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

export function useSmartReply({ ticket, existingDraft, cacheRef, aiInquiries }: SmartReplyPanelProps): SmartReplyState {
  const { kbEntries, agentName, hasApiKey, aiModel, promptOverrides, properties } = useAppContext();

  const cacheKey = `${ticket.id}-${(ticket.messages || []).length}`;
  const hasDraft = existingDraft.trim().length > 10;

  const [phase, setPhase] = useState<Phase>(() => {
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

  const activeProp = properties.find(p => p.name === ticket.property);
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
        temperature: resolveTemperature('polish_draft', promptOverrides),
        maxTokens: resolveMaxTokens('polish_draft', promptOverrides),
      });

      setComposedMessage(result.text);
      setPhase('preview');
    } catch (err: any) {
      toast.error('Polish failed', { description: err.message });
      setComposedMessage(draft);
      setPhase('preview');
    }
  }, [inquiries, kbMatchesByInquiry, ticket, agentName, hasApiKey, aiModel]);

  // ─── Core compose function ────────────────────────────────────
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
          temperature: resolveTemperature('compose_reply', promptOverrides),
          maxTokens: resolveMaxTokens('compose_reply', promptOverrides),
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

  // ─── Auto-compose on mount ────────────────────────────────────
  useEffect(() => {
    if (composeTriggered.current) return;
    if (hasDraft) return;
    if (allUncovered) return;
    const timer = setTimeout(() => {
      composeTriggered.current = true;
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

  // ─── Write to cache ───────────────────────────────────────────
  useEffect(() => {
    if (composedMessage && (phase === 'preview' || phase === 'configure')) {
      cacheRef.current[cacheKey] = {
        composedMessage,
        decisions,
        customTexts,
      };
    }
  }, [composedMessage, decisions, customTexts, phase, cacheKey, cacheRef]);

  // ─── Manual recompose from configure phase ────────────────────
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

  return {
    phase,
    setPhase,
    decisions,
    setDecisions,
    customTexts,
    setCustomTexts,
    expandedCustom,
    setExpandedCustom,
    composedMessage,
    setComposedMessage,
    inquiries,
    kbMatchesByInquiry,
    coveredCount,
    uncoveredCount,
    allUncovered,
    uncoveredLabels,
    hasDraft,
    hasApiKey,
    agentName,
    doPolish,
    doCompose,
    handleRecompose,
    composeTriggered,
    cacheKey,
  };
}
