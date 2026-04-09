import React from 'react';
import { Sparkles, Settings2 } from 'lucide-react';

interface SmartReplyHeaderProps {
  title?: string;
  subtitle?: string;
  icon?: 'sparkles' | 'settings';
  onAction: () => void;
  actionLabel: string;
  badge?: React.ReactNode;
}

export function SmartReplyHeader({
  title = 'Smart Reply',
  subtitle,
  icon = 'sparkles',
  onAction,
  actionLabel,
  badge,
}: SmartReplyHeaderProps) {
  const Icon = icon === 'settings' ? Settings2 : Sparkles;

  return (
    <div className="px-4 pt-3 pb-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-indigo-600" />
        <span className="text-sm font-bold text-slate-800">{title}</span>
        {subtitle && <span className="text-[9px] text-slate-400 font-medium">{subtitle}</span>}
        {badge}
      </div>
      <button onClick={onAction} className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium">
        {actionLabel}
      </button>
    </div>
  );
}
