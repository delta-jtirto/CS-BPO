interface BookingStatusBadgeProps {
  status: string | undefined;
}

const statusStyles: Record<string, string> = {
  confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'in-house': 'bg-blue-50 text-blue-700 border-blue-200',
  'checked-in': 'bg-blue-50 text-blue-700 border-blue-200',
  active: 'bg-blue-50 text-blue-700 border-blue-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  'waiting-approval': 'bg-amber-50 text-amber-700 border-amber-200',
  'waiting-confirmation': 'bg-amber-50 text-amber-700 border-amber-200',
  'waiting-payment': 'bg-amber-50 text-amber-700 border-amber-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
  'no-show': 'bg-red-50 text-red-700 border-red-200',
  declined: 'bg-red-50 text-red-700 border-red-200',
  'checked-out': 'bg-slate-100 text-slate-600 border-slate-200',
  archived: 'bg-slate-100 text-slate-500 border-slate-200',
  draft: 'bg-slate-50 text-slate-500 border-slate-200',
};

const paymentStyles: Record<string, string> = {
  paid: 'bg-teal-50 text-teal-700 border-teal-200',
  unpaid: 'bg-red-50 text-red-700 border-red-200',
  'pending-payment': 'bg-red-50 text-red-600 border-red-200',
  'partially-paid': 'bg-violet-50 text-violet-700 border-violet-200',
  'waiting-payment': 'bg-amber-50 text-amber-700 border-amber-200',
  refunded: 'bg-slate-50 text-slate-600 border-slate-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  none: 'bg-slate-50 text-slate-500 border-slate-200',
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[_ ]/g, '-');
}

export function BookingStatusBadge({ status }: BookingStatusBadgeProps) {
  if (!status) return null;
  const key = normalize(status);
  const style = statusStyles[key] || 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${style}`}>
      {status.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: string | undefined }) {
  if (!status) return null;
  const key = normalize(status);
  const style = paymentStyles[key] || 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${style}`}>
      {status.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
    </span>
  );
}
