import { memo } from 'react';
import { Clock, Sparkles, User, ArrowDown, ArrowLeft, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Ticket, InquiryResolutionMap, InquiryResolutionState } from '../../data/types';
import type { DetectedInquiry } from './InquiryDetector';
import type { BookingDetails } from '@/lib/pms-api';
import { AssistantPanel } from './AssistantPanel';
import { BookingDetailsSection } from './BookingDetailsSection';
import { TicketDetailsSection } from './TicketDetailsSection';
import { HostSection } from './HostSection';

interface ContextSidebarPaneProps {
  activeTicket: Ticket;
  activeTags: string[];
  isMobile: boolean;
  showMobileDetails: boolean;
  setShowMobileDetails: (v: boolean) => void;
  rightCollapsed: boolean;
  rightOverlayOpen: boolean;
  setRightOverlayOpen: (v: boolean) => void;
  displayRightWidth: number;
  RIGHT_MIN: number;
  rightWidth: number;
  resizing: 'left' | 'right' | null;
  rightTab: 'assistant' | 'details';
  setRightTab: (v: 'assistant' | 'details') => void;
  // Booking details
  bookingDetails: BookingDetails | null;
  bookingLoading: boolean;
  ticketNotes: string;
  onUpdateNotes: (v: string) => void;
  onUpdateProperty?: (property: string) => void;
  needsPropertyMapping?: boolean;
  // De-escalation
  deescalateTicket: (id: string) => void;
  // AssistantPanel props
  onComposeReply: (text: string) => void;
  onNavigateToKB: (propId: string) => void;
  onInquiriesClassified: (inquiries: DetectedInquiry[]) => void;
  // Inquiry resolution tracking
  inquiryResolutions?: InquiryResolutionMap;
  onResolutionChange?: (type: string, state: InquiryResolutionState) => void;
  onBulkResolution?: (handled: boolean) => void;
  onSummaryUpdate?: (summary: string) => void;
  onClassifyingChange?: (isClassifying: boolean) => void;
}

function ContextSidebarPaneImpl({
  activeTicket,
  activeTags,
  isMobile,
  showMobileDetails, setShowMobileDetails,
  rightCollapsed, rightOverlayOpen, setRightOverlayOpen,
  displayRightWidth, RIGHT_MIN, rightWidth, resizing,
  rightTab, setRightTab,
  bookingDetails, bookingLoading,
  ticketNotes, onUpdateNotes, onUpdateProperty,
  needsPropertyMapping,
  deescalateTicket,
  onComposeReply, onNavigateToKB, onInquiriesClassified,
  inquiryResolutions, onResolutionChange, onBulkResolution, onSummaryUpdate, onClassifyingChange,
}: ContextSidebarPaneProps) {
  return (
    <div
      className={`${
        isMobile
          ? (showMobileDetails ? 'fixed inset-0 z-50 w-full animate-in slide-in-from-right duration-200' : 'hidden')
          : rightCollapsed
            ? (rightOverlayOpen ? 'flex absolute right-0 top-0 bottom-0 z-50 shadow-2xl rounded-l-xl animate-in slide-in-from-right duration-200' : 'hidden')
            : 'flex shrink-0 overflow-hidden'
      } bg-white border-l border-slate-200 flex flex-col`}
      style={!isMobile ? { width: rightCollapsed && rightOverlayOpen ? Math.min(rightWidth, 380) : rightCollapsed ? 0 : displayRightWidth, minWidth: rightCollapsed ? 0 : RIGHT_MIN, transition: resizing ? 'none' : 'width 0.2s ease' } : undefined}
    >
      {/* SLA header */}
      <div className={`px-3 py-2 border-b flex items-center justify-between shrink-0 min-h-[52px] ${activeTicket.status === 'urgent' ? 'bg-red-50 border-red-200' : activeTicket.status === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-center gap-2">
          {isMobile && (
            <button onClick={() => setShowMobileDetails(false)} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-200 transition-colors">
              <ArrowLeft size={16} />
            </button>
          )}
          {!isMobile && rightCollapsed && rightOverlayOpen && (
            <button onClick={() => setRightOverlayOpen(false)} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-200 transition-colors">
              <X size={14} />
            </button>
          )}
          <Clock size={14} className={activeTicket.status === 'urgent' ? 'text-red-500' : activeTicket.status === 'warning' ? 'text-amber-500' : 'text-slate-400'} />
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">SLA</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-lg font-bold tabular-nums ${activeTicket.status === 'urgent' ? 'text-red-600' : activeTicket.status === 'warning' ? 'text-amber-600' : 'text-slate-700'}`}>
            {activeTicket.sla}
          </span>
          {activeTicket.status !== 'normal' && (
            <button
              onClick={() => {
                deescalateTicket(activeTicket.id);
                toast.success('De-escalated to normal', { description: `${activeTicket.guestName}'s ticket priority lowered.` });
              }}
              className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-slate-200 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 hover:border-emerald-200 transition-colors uppercase tracking-wider"
              title="De-escalate to normal priority"
            >
              <ArrowDown size={9} className="inline mr-0.5" /> De-escalate
            </button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-slate-200 shrink-0">
        <button
          onClick={() => setRightTab('assistant')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-bold transition-colors relative ${
            rightTab === 'assistant'
              ? 'text-indigo-600'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <Sparkles size={12} /> Research
          {rightTab === 'assistant' && (
            <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-indigo-600 rounded-full" />
          )}
        </button>
        <button
          onClick={() => setRightTab('details')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-bold transition-colors relative ${
            rightTab === 'details'
              ? 'text-indigo-600'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <User size={12} /> Details
          {needsPropertyMapping && rightTab !== 'details' && (
            <span className="absolute -top-0.5 -right-1 w-2 h-2 bg-amber-400 rounded-full" />
          )}
          {rightTab === 'details' && (
            <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-indigo-600 rounded-full" />
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {rightTab === 'assistant' ? (
          <AssistantPanel
            ticket={activeTicket}
            onComposeReply={onComposeReply}
            onNavigateToKB={onNavigateToKB}
            onInquiriesClassified={onInquiriesClassified}
            inquiryResolutions={inquiryResolutions}
            onResolutionChange={onResolutionChange}
            onBulkResolution={onBulkResolution}
            onSummaryUpdate={onSummaryUpdate}
            onClassifyingChange={onClassifyingChange}
          />
        ) : (
          <div>
            <BookingDetailsSection
              bookingDetails={bookingDetails}
              bookingLoading={bookingLoading}
              activeTicket={activeTicket}
              ticketNotes={ticketNotes}
              onUpdateNotes={onUpdateNotes}
              onUpdateProperty={onUpdateProperty}
            />
            <TicketDetailsSection ticket={activeTicket} tags={activeTags} />
            <HostSection host={activeTicket.host} />
          </div>
        )}
      </div>
    </div>
  );
}

export const ContextSidebarPane = memo(ContextSidebarPaneImpl);
