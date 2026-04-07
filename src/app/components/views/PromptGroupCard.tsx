import React, { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import type { OperationId, PromptOverride, PromptDefaults } from '../../ai/prompts';
import { extractVariables } from '../../ai/prompts';

const PROMPT_MODEL_PRESETS = [
  { value: 'google/gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
  { value: 'google/gemini-3.1-flash-lite-preview', label: 'gemini-3.1-flash-lite' },
  { value: 'google/gemini-2.0-flash-001', label: 'gemini-2.0-flash' },
  { value: 'openai/gpt-4o-mini', label: 'gpt-4o-mini' },
  { value: 'openai/gpt-4.1-mini', label: 'gpt-4.1-mini' },
  { value: 'openai/gpt-4.1-nano', label: 'gpt-4.1-nano' },
  { value: 'openai/gpt-4o', label: 'gpt-4o' },
  { value: 'anthropic/claude-sonnet-4', label: 'claude-sonnet-4' },
  { value: 'anthropic/claude-3.5-haiku', label: 'claude-3.5-haiku' },
  { value: 'meta-llama/llama-3.3-70b-instruct', label: 'llama-3.3-70b' },
];

interface PromptGroupCardProps {
  operationId: OperationId;
  defaults: PromptDefaults;
  override: PromptOverride | undefined;
  onUpdate: (field: keyof PromptOverride, value: string | number | undefined) => void;
  onReset: (field?: keyof PromptOverride) => void;
  initiallyOpen?: boolean;
}

function isOverridden(override: PromptOverride | undefined): boolean {
  if (!override) return false;
  return Object.values(override).some(v => v !== undefined);
}

function VariableChips({ template }: { template: string }) {
  const vars = extractVariables(template);
  if (vars.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {vars.map(v => (
        <span key={v} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-500 border border-slate-200">
          {`{{${v}}}`}
        </span>
      ))}
    </div>
  );
}

interface PromptTextareaProps {
  label: string;
  defaultValue: string;
  currentValue: string | undefined;
  onSave: (value: string | undefined) => void;
  onReset: () => void;
  minHeight?: string;
}

function PromptTextarea({ label, defaultValue, currentValue, onSave, onReset, minHeight = '160px' }: PromptTextareaProps) {
  const [draft, setDraft] = useState(currentValue ?? defaultValue);
  const isCustom = currentValue !== undefined;

  React.useEffect(() => {
    setDraft(currentValue ?? defaultValue);
  }, [currentValue, defaultValue]);

  const handleBlur = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed === defaultValue.trim()) {
      onSave(undefined);
    } else {
      onSave(trimmed || undefined);
    }
  }, [draft, defaultValue, onSave]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        {isCustom && (
          <button
            onClick={() => { setDraft(defaultValue); onReset(); }}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            title="Reset to default"
          >
            <RotateCcw size={11} />
            Reset
          </button>
        )}
      </div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={handleBlur}
        className="w-full border border-slate-300 rounded-lg text-xs font-mono py-2 px-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 outline-none resize-y text-slate-700 leading-relaxed"
        style={{ minHeight }}
        spellCheck={false}
      />
      <VariableChips template={defaultValue} />
    </div>
  );
}

interface ModelSelectorProps {
  defaultModel: string;
  currentModel: string | undefined;
  onSave: (value: string | undefined) => void;
  onReset: () => void;
}

function ModelSelector({ defaultModel, currentModel, onSave, onReset }: ModelSelectorProps) {
  const effectiveModel = currentModel ?? defaultModel;
  const isPreset = PROMPT_MODEL_PRESETS.some(p => p.value === effectiveModel);
  const [mode, setMode] = useState<'preset' | 'custom'>(isPreset ? 'preset' : 'custom');
  const [customValue, setCustomValue] = useState(isPreset ? '' : effectiveModel);
  const isCustom = currentModel !== undefined;

  React.useEffect(() => {
    const preset = PROMPT_MODEL_PRESETS.some(p => p.value === (currentModel ?? defaultModel));
    setMode(preset ? 'preset' : 'custom');
    setCustomValue(preset ? '' : (currentModel ?? defaultModel));
  }, [currentModel, defaultModel]);

  const handlePresetChange = (val: string) => {
    onSave(val === defaultModel ? undefined : val);
  };

  const handleCustomBlur = () => {
    const trimmed = customValue.trim();
    onSave(trimmed && trimmed !== defaultModel ? trimmed : undefined);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4">
        <label className="text-xs font-medium text-slate-600">Model</label>
        {isCustom && (
          <button
            onClick={() => { setMode('preset'); setCustomValue(''); onReset(); }}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            title="Reset to default"
          >
            <RotateCcw size={11} />
            Reset
          </button>
        )}
      </div>
      <div className="flex gap-2 mb-1">
        <button
          onClick={() => setMode('preset')}
          className={`text-xs px-2 py-1 rounded border transition-colors ${mode === 'preset' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
        >
          Preset
        </button>
        <button
          onClick={() => setMode('custom')}
          className={`text-xs px-2 py-1 rounded border transition-colors ${mode === 'custom' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
        >
          Custom
        </button>
      </div>
      {mode === 'preset' ? (
        <select
          value={effectiveModel}
          onChange={e => handlePresetChange(e.target.value)}
          className="border border-slate-300 rounded-md text-xs py-1.5 px-2 focus:ring-1 focus:ring-indigo-500 outline-none max-w-xs"
        >
          {PROMPT_MODEL_PRESETS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
          {!PROMPT_MODEL_PRESETS.some(p => p.value === effectiveModel) && (
            <option value={effectiveModel}>{effectiveModel}</option>
          )}
        </select>
      ) : (
        <input
          type="text"
          value={customValue}
          placeholder={`e.g. ${defaultModel}`}
          onChange={e => setCustomValue(e.target.value)}
          onBlur={handleCustomBlur}
          className="border border-slate-300 rounded-md text-xs py-1.5 px-2 focus:ring-1 focus:ring-indigo-500 outline-none max-w-xs"
        />
      )}
      <p className="text-[10px] text-slate-400 mt-0.5">
        Default: <span className="font-mono">{defaultModel}</span>
      </p>
    </div>
  );
}

export function PromptGroupCard({ operationId, defaults, override, onUpdate, onReset, initiallyOpen = false }: PromptGroupCardProps) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const customized = isOverridden(override);

  const currentTemp = override?.temperature ?? defaults.temperature;
  const currentMaxTokens = override?.maxTokens ?? defaults.maxTokens;
  const currentModel = override?.model ?? defaults.model;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="text-slate-400 shrink-0">
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">{defaults.label}</span>
            {customized && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                Customized
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{defaults.description}</p>
        </div>
        <div className="shrink-0 text-right hidden sm:block">
          <span className="text-xs text-slate-400 font-mono">{currentModel.split('/').pop()}</span>
          <span className="text-xs text-slate-300 mx-1">·</span>
          <span className="text-xs text-slate-400">t{currentTemp} · {currentMaxTokens}tok</span>
        </div>
      </button>

      {/* Body */}
      {isOpen && (
        <div className="px-5 pb-5 pt-1 border-t border-slate-100 flex flex-col gap-4">
          <PromptTextarea
            label="System Prompt"
            defaultValue={defaults.system}
            currentValue={override?.system}
            onSave={v => onUpdate('system', v)}
            onReset={() => onReset('system')}
            minHeight="180px"
          />
          <PromptTextarea
            label="User Prompt Template"
            defaultValue={defaults.user}
            currentValue={override?.user}
            onSave={v => onUpdate('user', v)}
            onReset={() => onReset('user')}
            minHeight="120px"
          />

          {/* Model + Temperature + Max Tokens */}
          <div className="flex flex-wrap gap-6">
            <ModelSelector
              defaultModel={defaults.model}
              currentModel={override?.model}
              onSave={v => onUpdate('model', v)}
              onReset={() => onReset('model')}
            />

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-4">
                <label className="text-xs font-medium text-slate-600">Temperature</label>
                {override?.temperature !== undefined && (
                  <button
                    onClick={() => onReset('temperature')}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <RotateCcw size={11} />
                    Reset
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0} max={2} step={0.1}
                  value={currentTemp}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) onUpdate('temperature', v === defaults.temperature ? undefined : Math.min(2, Math.max(0, v)));
                  }}
                  className="border border-slate-300 rounded-md text-sm py-1.5 px-2 w-20 text-center focus:ring-1 focus:ring-indigo-500 outline-none"
                />
                <span className="text-xs text-slate-400">0 – 2</span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-4">
                <label className="text-xs font-medium text-slate-600">Max Tokens</label>
                {override?.maxTokens !== undefined && (
                  <button
                    onClick={() => onReset('maxTokens')}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <RotateCcw size={11} />
                    Reset
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={64} max={8192} step={64}
                  value={currentMaxTokens}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) onUpdate('maxTokens', v === defaults.maxTokens ? undefined : Math.min(8192, Math.max(64, v)));
                  }}
                  className="border border-slate-300 rounded-md text-sm py-1.5 px-2 w-24 text-center focus:ring-1 focus:ring-indigo-500 outline-none"
                />
                <span className="text-xs text-slate-400">64 – 8192</span>
              </div>
            </div>
          </div>

          {/* Reset all */}
          {customized && (
            <div className="pt-1 border-t border-slate-100">
              <button
                onClick={() => onReset()}
                className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 transition-colors"
              >
                <RotateCcw size={12} />
                Reset all fields to defaults
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
