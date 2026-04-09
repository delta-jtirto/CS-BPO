import React from 'react';
import { Loader2 } from 'lucide-react';
import { Skeleton } from '@/app/components/ui/skeleton';
import { SmartReplyHeader } from './SmartReplyHeader';
import type { Phase } from './types';

interface Props {
  phase: Phase;
  hasApiKey: boolean;
  onHide: () => void;
}

export function SmartReplyAnalyzing({ phase, hasApiKey, onHide }: Props) {
  return (
    <>
      <SmartReplyHeader onAction={onHide} actionLabel="Hide" />
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2 py-4 justify-center">
          <Loader2 size={16} className="animate-spin text-indigo-600" />
          <span className="text-sm text-slate-500">
            {phase === 'analyzing' ? 'Analyzing conversation...' : hasApiKey ? 'AI is composing...' : 'Composing reply...'}
          </span>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      </div>
    </>
  );
}
