import { Globe2, Mail, Tag } from 'lucide-react';
import type { Ticket } from '../../data/types';

interface TicketDetailsSectionProps {
  ticket: Ticket;
  tags: string[];
}

export function TicketDetailsSection({ ticket, tags }: TicketDetailsSectionProps) {
  return (
    <div className="p-5 border-b border-slate-100">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
        <Tag size={14} /> Ticket Details
      </h3>
      <div className="space-y-3">
        <div>
          <span className="block text-[10px] text-slate-400 mb-1">Channel</span>
          <span className="text-sm font-medium flex items-center gap-1.5">
            <ticket.channelIcon size={14} className="text-slate-500" /> {ticket.channel}
          </span>
        </div>
        {ticket.contactEmail && (
          <div>
            <span className="block text-[10px] text-slate-400 mb-1">From</span>
            <a
              href={`mailto:${ticket.contactEmail}`}
              className="text-sm font-medium flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 truncate"
              title={ticket.contactEmail}
            >
              <Mail size={14} className="text-slate-500 shrink-0" />
              <span className="truncate">{ticket.contactEmail}</span>
            </a>
          </div>
        )}
        <div>
          <span className="block text-[10px] text-slate-400 mb-1">Language</span>
          <span className="text-sm font-medium flex items-center gap-1.5">
            <Globe2 size={14} className="text-slate-500" /> {ticket.language}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-slate-400 mb-1">AI Handover Reason</span>
          <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-2 rounded-md border border-slate-100">
            {ticket.aiHandoverReason}
          </p>
        </div>
        <div>
          <span className="block text-[10px] text-slate-400 mb-1">Tags</span>
          <div className="flex flex-wrap gap-1">
            {tags.map(tag => (
              <span
                key={tag}
                className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full border border-indigo-100 flex items-center gap-1"
              >
                <Tag size={8} /> {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
