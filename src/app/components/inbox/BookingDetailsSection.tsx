import { useState } from 'react';
import {
  User, Users, ChevronDown, ChevronUp, Building, Moon,
  ArrowRight, ExternalLink, FileText, Copy, CreditCard,
} from 'lucide-react';
import { toast } from 'sonner';
import type { BookingDetails } from '@/lib/pms-api';
import type { Ticket } from '../../data/types';
import { BookingStatusBadge, PaymentStatusBadge } from './BookingStatusBadge';

interface BookingDetailsSectionProps {
  bookingDetails: BookingDetails | null;
  bookingLoading: boolean;
  activeTicket: Ticket;
  ticketNotes: string;
  onUpdateNotes: (notes: string) => void;
}

function getInitials(firstName?: string, lastName?: string, fallback?: string): string {
  if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase();
  if (firstName) return firstName[0].toUpperCase();
  if (fallback) {
    const parts = fallback.trim().split(/\s+/);
    return parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : parts[0][0].toUpperCase();
  }
  return '?';
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  return dateStr.replace(/-/g, '/');
}

function formatCurrency(amount: number | undefined, currency?: string): string {
  if (amount === undefined || amount === null) return '-';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency || '$'}${amount.toFixed(2)}`;
  }
}

function guestBreakdown(details: BookingDetails): string {
  const parts: string[] = [];
  if (details.adultsCount && details.adultsCount > 0)
    parts.push(`${details.adultsCount} adult${details.adultsCount > 1 ? 's' : ''}`);
  if (details.childrenCount && details.childrenCount > 0)
    parts.push(`${details.childrenCount} child${details.childrenCount > 1 ? 'ren' : ''}`);
  if (details.infantsCount && details.infantsCount > 0)
    parts.push(`${details.infantsCount} infant${details.infantsCount > 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(', ') : '';
}

// Skeleton placeholder
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200 rounded ${className}`} />;
}

const PMS_BASE = import.meta.env.VITE_PMS_API_BASE_URL || 'https://pms.beta.deltahq.com';

export function BookingDetailsSection({
  bookingDetails: bd,
  bookingLoading,
  activeTicket,
  ticketNotes,
  onUpdateNotes,
}: BookingDetailsSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const hasBookingId = Boolean(activeTicket.bookingId);
  const guestFullName = bd
    ? [bd.guestFirstName, bd.guestLastName].filter(Boolean).join(' ') || activeTicket.guestName
    : activeTicket.guestName;

  // No booking at all
  if (!hasBookingId && !bd) {
    return (
      <div>
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <User size={14} /> Guest & Booking
          </h3>
          <div className="text-xs text-slate-400">No booking data available</div>
        </div>
        <IncidentLog notes={ticketNotes} onUpdate={onUpdateNotes} />
      </div>
    );
  }

  // Loading state
  if (bookingLoading) {
    return (
      <div>
        <div className="p-5 border-b border-slate-100 space-y-4">
          {/* Header skeleton */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-20 rounded-md" />
            </div>
            <Skeleton className="h-4 w-4" />
          </div>
          {/* Profile skeleton */}
          <div className="flex items-center gap-3">
            <Skeleton className="w-14 h-14 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-36" />
            </div>
          </div>
          {/* Info skeleton */}
          <div className="space-y-2.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
        <IncidentLog notes={ticketNotes} onUpdate={onUpdateNotes} />
      </div>
    );
  }

  const status = bd?.bookingStatus || activeTicket.bookingStatus;
  const hasPayment = bd?.paymentStatus || bd?.totalDue !== undefined;
  const hasNotes = bd?.internalNote || bd?.externalNote;
  const hasExtendedDetails = bd && (bd.propertyName || bd.checkIn || bd.numberOfGuests > 0);
  const amountDue = (bd?.totalDue !== undefined && bd?.amountPaid !== undefined)
    ? bd.totalDue - bd.amountPaid
    : undefined;

  return (
    <div>
      {/* ── Booking Header ── */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Booking</h3>
            <BookingStatusBadge status={status} />
          </div>
          {activeTicket.bookingId && (
            <a
              href={`${PMS_BASE}/host/bookings/v2/${activeTicket.bookingId}/stay-detail?source=booking_details`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-indigo-500 transition-colors"
              title="Open in PMS"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>

        {/* ── Guest Profile ── */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-lg shrink-0">
            {getInitials(bd?.guestFirstName, bd?.guestLastName, activeTicket.guestName)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{guestFullName}</p>
            {bd?.guestEmail && (
              <p className="text-xs text-slate-400 truncate">{bd.guestEmail}</p>
            )}
            {bd?.guestPhone && (
              <p className="text-[10px] text-slate-400 truncate">{bd.guestPhone}</p>
            )}
          </div>
        </div>

        {/* ── Booking Information ── */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Booking ID</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(String(activeTicket.bookingId || bd?.bookingId || ''));
                toast.success('Copied booking ID');
              }}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition-colors"
            >
              #{activeTicket.bookingId || bd?.bookingId}
              <Copy size={10} className="text-slate-300" />
            </button>
          </div>

          {(bd?.channelName || activeTicket.channel) && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">Channel</span>
              <span className="text-sm font-medium text-slate-700">{bd?.channelName || activeTicket.channel}</span>
            </div>
          )}

          {bd?.preCheckinStatus && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">Pre-checkin</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                bd.preCheckinStatus.toLowerCase() === 'submitted'
                  ? 'bg-violet-50 text-violet-600 border-violet-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
              }`}>
                {bd.preCheckinStatus.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </span>
            </div>
          )}
        </div>

        {/* ── View More / Less Toggle ── */}
        {hasExtendedDetails && (
          <>
            {expanded && (
              <div className="mt-4 pt-3 border-t border-slate-100 space-y-3">
                {/* Property image + name */}
                <div className="flex items-start gap-3">
                  {bd?.propertyImageUrl ? (
                    <img
                      src={bd.propertyImageUrl}
                      alt={bd.propertyName}
                      className="w-16 h-12 rounded-lg object-cover shrink-0"
                    />
                  ) : bd?.propertyName ? (
                    <div className="w-16 h-12 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                      <Building size={16} className="text-slate-400" />
                    </div>
                  ) : null}
                  <div className="min-w-0">
                    {bd?.propertyName && (
                      <p className="text-sm font-semibold text-slate-700 line-clamp-2">{bd.propertyName}</p>
                    )}
                    {bd?.propertySubtitle && (
                      <p className="text-xs text-slate-400 truncate">{bd.propertySubtitle}</p>
                    )}
                    {bd?.roomName && (
                      <p className="text-[10px] text-slate-400">{bd.roomTypeName ? `${bd.roomTypeName} — ${bd.roomName}` : bd.roomName}</p>
                    )}
                  </div>
                </div>

                {/* Check-in → Check-out */}
                {(bd?.checkIn || bd?.checkOut) && (
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    {bd?.checkIn && <span className="font-medium">{formatDate(bd.checkIn)}</span>}
                    {bd?.checkIn && bd?.checkOut && <ArrowRight size={12} className="text-slate-400" />}
                    {bd?.checkOut && <span className="font-medium">{formatDate(bd.checkOut)}</span>}
                  </div>
                )}

                {/* Guest count with breakdown */}
                {bd && bd.numberOfGuests > 0 && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Users size={13} className="text-slate-400" />
                    <span>
                      {bd.numberOfGuests} guest{bd.numberOfGuests > 1 ? 's' : ''}
                      {guestBreakdown(bd) && (
                        <span className="text-xs text-slate-400 ml-1">({guestBreakdown(bd)})</span>
                      )}
                    </span>
                  </div>
                )}

                {/* Number of nights */}
                {bd?.numberOfNights && bd.numberOfNights > 0 && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Moon size={13} className="text-slate-400" />
                    <span>{bd.numberOfNights} night{bd.numberOfNights > 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors py-1"
            >
              {expanded ? 'View Less' : 'View More'}
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </>
        )}
      </div>

      {/* ── Booking Notes ── */}
      {hasNotes && (
        <div className="px-5 py-4 border-b border-slate-100 space-y-3">
          {bd?.internalNote && (
            <div>
              <span className="block text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-1">
                Internal Note (Staff Only)
              </span>
              <p className="text-xs text-slate-600 bg-amber-50 border border-amber-100 rounded-lg p-2.5 leading-relaxed">
                {bd.internalNote}
              </p>
            </div>
          )}
          {bd?.externalNote && (
            <div>
              <span className="block text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-1">
                Guest Note
              </span>
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg p-2.5 leading-relaxed">
                {bd.externalNote}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Payment Info ── */}
      {hasPayment && (
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold flex items-center gap-1">
              <CreditCard size={10} /> Payment
            </span>
            <PaymentStatusBadge status={bd?.paymentStatus} />
          </div>
          <div className="space-y-1.5">
            {bd?.totalDue !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Total Due</span>
                <span className="text-xs text-slate-600">{formatCurrency(bd.totalDue, bd.currency)}</span>
              </div>
            )}
            {bd?.amountPaid !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Paid</span>
                <span className="text-xs text-slate-600">{formatCurrency(bd.amountPaid, bd.currency)}</span>
              </div>
            )}
            {amountDue !== undefined && (
              <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-500">Amount Due</span>
                <span className="text-xs font-bold text-slate-800">{formatCurrency(amountDue, bd?.currency)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── BPO Incident Log ── */}
      <IncidentLog notes={ticketNotes} onUpdate={onUpdateNotes} />
    </div>
  );
}

function IncidentLog({ notes, onUpdate }: { notes: string; onUpdate: (v: string) => void }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100">
      <span className="block text-[10px] text-slate-400 mb-1.5 uppercase tracking-wider font-bold flex items-center gap-1">
        <FileText size={10} /> Incident Log
      </span>
      <textarea
        value={notes}
        onChange={e => onUpdate(e.target.value)}
        placeholder="Record issue details, response history, resolution..."
        rows={4}
        className="w-full text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 placeholder:text-slate-300 leading-relaxed"
      />
    </div>
  );
}
