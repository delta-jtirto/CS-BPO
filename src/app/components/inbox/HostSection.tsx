import { Briefcase } from 'lucide-react';
import type { Host } from '../../data/types';

interface HostSectionProps {
  host: Host;
}

export function HostSection({ host }: HostSectionProps) {
  return (
    <div className="p-5">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
        <Briefcase size={14} /> Host
      </h3>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg ${host.brandColor} flex items-center justify-center text-white font-bold text-sm`}>
            {host.name.charAt(0)}
          </div>
          <div>
            <p className="text-sm font-bold text-slate-700">{host.name}</p>
            <p className="text-[10px] text-slate-400">Tone: {host.tone}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
