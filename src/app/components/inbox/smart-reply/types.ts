import type { Ticket } from '../../../data/types';
import type { DetectedInquiry, InquiryKBMatch, InquiryDecision } from '../InquiryDetector';

export type Phase = 'draft-detected' | 'analyzing' | 'composing' | 'preview' | 'configure';

/** Cache entry stored by InboxView, keyed by ticketId-messageCount */
export interface SmartReplyCache {
  composedMessage: string;
  decisions: Record<string, 'yes' | 'no'>;
  customTexts: Record<string, string>;
}

export interface SmartReplyPanelProps {
  ticket: Ticket;
  existingDraft: string;
  onInsert: (text: string) => void;
  onHide: () => void;
  cacheRef: React.MutableRefObject<Record<string, SmartReplyCache>>;
  /** AI-classified inquiries with ContextItem[] from AssistantPanel */
  aiInquiries?: DetectedInquiry[];
}

export interface SmartReplyState {
  phase: Phase;
  setPhase: React.Dispatch<React.SetStateAction<Phase>>;
  decisions: Record<string, 'yes' | 'no'>;
  setDecisions: React.Dispatch<React.SetStateAction<Record<string, 'yes' | 'no'>>>;
  customTexts: Record<string, string>;
  setCustomTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  expandedCustom: string | null;
  setExpandedCustom: React.Dispatch<React.SetStateAction<string | null>>;
  composedMessage: string;
  setComposedMessage: React.Dispatch<React.SetStateAction<string>>;
  inquiries: DetectedInquiry[];
  kbMatchesByInquiry: Record<string, InquiryKBMatch[]>;
  coveredCount: number;
  uncoveredCount: number;
  allUncovered: boolean;
  uncoveredLabels: string[];
  hasDraft: boolean;
  hasApiKey: boolean;
  agentName: string;
  doPolish: (draft: string) => Promise<void>;
  doCompose: (inquiryDecisions: Record<string, InquiryDecision>) => Promise<void>;
  handleRecompose: () => void;
  composeTriggered: React.MutableRefObject<boolean>;
  cacheKey: string;
}

/** Turn a detected inquiry into a concise agent-facing Yes/No question. */
export function formatQuestion(inq: DetectedInquiry): string {
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
      const detail = inq.detail;
      if (detail && detail !== 'Guest message requires review') {
        const short = detail.length > 60 ? detail.slice(0, 57) + '...' : detail;
        return `Respond to: "${short}"?`;
      }
      return 'Respond to guest inquiry?';
    }
  }
}
