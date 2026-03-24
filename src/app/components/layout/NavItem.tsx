import type { LucideIcon } from 'lucide-react';

interface NavItemProps {
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  tooltip: string;
  label: string;
  shortcut?: string;
}

export function NavItem({ icon: Icon, active, onClick, tooltip, label, shortcut }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      title={`${tooltip}${shortcut ? ` (${shortcut})` : ''}`}
      className={`py-2.5 px-1 rounded-xl transition-all relative group flex flex-col items-center justify-center w-full gap-1 ${active ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
    >
      <Icon size={18} className={active ? '' : 'group-hover:scale-110 transition-transform'} />
      <span className={`text-[9px] font-bold tracking-wide leading-none ${active ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'}`}>{label}</span>
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 bg-indigo-600 rounded-r-full shadow-[2px_0_8px_rgba(79,70,229,0.3)]"></span>}
    </button>
  );
}
