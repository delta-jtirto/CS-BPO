import React, { useState, useEffect } from 'react';
import { MoreHorizontal, X, AlertTriangle } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import type { DetectedInquiry, InquiryKBMatch } from '../InquiryDetector';
import { formatQuestion } from './types';

interface InquiryDecisionRowProps {
  inquiry: DetectedInquiry;
  kbMatches: InquiryKBMatch[];
  decision: 'yes' | 'no' | undefined;
  customText: string;
  onDecisionChange: (id: string, decision: 'yes' | 'no') => void;
  onCustomTextChange: (id: string, text: string) => void;
}

export function InquiryDecisionRow({
  inquiry,
  kbMatches,
  decision,
  customText,
  onDecisionChange,
  onCustomTextChange,
}: InquiryDecisionRowProps) {
  const [mode, setMode] = useState<'toggle' | 'input'>(customText ? 'input' : 'toggle');
  const [inputValue, setInputValue] = useState(customText);

  const question = formatQuestion(inquiry);
  const topMatch = kbMatches[0];
  const hasCustomText = !!customText.trim();

  // Sync input value with parent customText
  useEffect(() => {
    setInputValue(customText);
  }, [customText]);

  // Map tab value to parent state
  const currentTabValue = hasCustomText ? '' : (decision || 'yes');

  const handleTabChange = (value: string) => {
    onDecisionChange(inquiry.id, value as 'yes' | 'no');
    onCustomTextChange(inquiry.id, '');
  };

  const handleSwitchToInput = () => {
    setMode('input');
    setInputValue('');
    onCustomTextChange(inquiry.id, '');
  };

  const handleSwitchToToggle = () => {
    setMode('toggle');
    setInputValue('');
    onCustomTextChange(inquiry.id, '');
    if (!decision) onDecisionChange(inquiry.id, 'yes');
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    onCustomTextChange(inquiry.id, value);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-semibold text-slate-800 leading-snug">{question}</div>

      {/* KB context hint */}
      {topMatch && !hasCustomText ? (
        <span className="text-[9px] text-slate-400 leading-tight truncate">
          {decision === 'yes' ? 'Will use:' : 'Available:'} {topMatch.entry.title}
          {kbMatches.length > 1 && ` +${kbMatches.length - 1} more`}
        </span>
      ) : !topMatch && !hasCustomText ? (
        <span className="text-[9px] text-amber-500 leading-tight flex items-center gap-0.5">
          <AlertTriangle size={8} className="shrink-0" /> Not covered — add a note so AI knows what to say
        </span>
      ) : hasCustomText ? (
        <span className="text-[9px] text-blue-500 leading-tight truncate">
          Custom: "{customText.trim()}"
        </span>
      ) : null}

      <div className="h-10">
        {mode === 'toggle' && (
          <Tabs
            className="animate-in fade-in duration-150"
            value={currentTabValue}
            onValueChange={handleTabChange}
          >
            <TabsList className="flex h-max bg-slate-100 p-1 rounded-lg">
              <TabsTrigger value="yes" className="flex-1 text-xs rounded-md">
                Yes
              </TabsTrigger>
              <TabsTrigger value="no" className="flex-1 text-xs rounded-md">
                No
              </TabsTrigger>
              <Button
                variant="ghost"
                size="icon"
                className="ml-1 !size-8 hover:!bg-white"
                onClick={handleSwitchToInput}
              >
                <MoreHorizontal size={14} />
              </Button>
            </TabsList>
          </Tabs>
        )}

        {mode === 'input' && (
          <div className="relative flex animate-in fade-in duration-150 items-center gap-1">
            <Input
              placeholder="Tell the AI what to say instead..."
              className="flex-1 text-xs h-9 pr-8 rounded-lg"
              value={inputValue}
              onChange={(e) => handleInputChange(e.currentTarget.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); setMode('toggle'); }
                if (e.key === 'Escape') handleSwitchToToggle();
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 !size-6 !rounded-full text-slate-400 hover:text-slate-600"
              onClick={handleSwitchToToggle}
            >
              <X size={12} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
