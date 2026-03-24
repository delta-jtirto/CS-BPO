interface ScopeBadgeProps {
  scope: string;
  className?: string;
}

const SCOPE_STYLES: Record<string, string> = {
  'Host Global': 'bg-purple-100 text-purple-700',
  'Property': 'bg-blue-100 text-blue-700',
  'Room': 'bg-green-100 text-green-700',
};

const SCOPE_LABELS: Record<string, string> = {
  'Host Global': 'Company-Wide',
  'Property': 'Property',
  'Room': 'Room',
};

export function ScopeBadge({ scope, className = '' }: ScopeBadgeProps) {
  const style = SCOPE_STYLES[scope] || 'bg-slate-100 text-slate-700';
  const label = SCOPE_LABELS[scope] || scope;
  return (
    <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${style} ${className}`}>
      {label}
    </span>
  );
}
