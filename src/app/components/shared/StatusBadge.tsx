interface StatusBadgeProps {
  status: string;
  className?: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  dispatched: 'bg-blue-50 text-blue-700 border-blue-200',
  resolved: 'bg-green-50 text-green-700 border-green-200',
  urgent: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  normal: 'bg-slate-50 text-slate-700 border-slate-200',
  active: 'bg-green-100 text-green-700',
  onboarding: 'bg-amber-100 text-amber-700',
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const style = STATUS_STYLES[status.toLowerCase()] || STATUS_STYLES.normal;
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wide ${style} ${className}`}>
      {status}
    </span>
  );
}
