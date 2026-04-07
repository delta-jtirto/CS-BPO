import type { LucideIcon } from 'lucide-react';

interface NavItemProps {
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  tooltip: string;
  label: string;
  shortcut?: string;
  /** Optional counter badge — shows an outlined orange dot/number when > 0 */
  badge?: number;
}

export function NavItem({ icon: Icon, active, onClick, tooltip, label, shortcut, badge }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      title={`${tooltip}${shortcut ? ` (${shortcut})` : ''}`}
      className={`py-2.5 px-1 rounded-xl transition-all relative group flex flex-col items-center justify-center w-full gap-1 ${active ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
    >
      <div className="relative">
        <Icon size={18} className={active ? '' : 'group-hover:scale-110 transition-transform'} />
        {badge != null && badge > 0 && (
          <span className="absolute -top-1.5 -right-2 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-white border border-orange-400 text-orange-500 text-[7px] font-bold leading-none px-0.5">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </div>
      <span className={`text-[9px] font-bold tracking-wide leading-none ${active ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'}`}>{label}</span>
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 bg-indigo-600 rounded-r-full shadow-[2px_0_8px_rgba(79,70,229,0.3)]"></span>}
    </button>
  );
}
