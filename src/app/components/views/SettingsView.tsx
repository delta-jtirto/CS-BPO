import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  User, Bell, Shield, Code2, Clock, Timer, MessageSquareText,
  GitBranch, Target, Plus, Trash2, Pencil, Zap, AlertTriangle, Users,
  Globe, BarChart3, MessageCircle, Settings2, Bot, Eye, EyeOff, Key, RotateCcw,
  ChevronDown, ChevronRight, ShieldAlert, Pause, X, Info, Sparkles, Copy, BrainCircuit,
  Brain, FileText
} from 'lucide-react';
import { PROMPT_DEFAULTS } from '../../ai/prompts';
import type { OperationId } from '../../ai/prompts';
import { PromptGroupCard } from './PromptGroupCard';
import { toast } from 'sonner';
import { MOCK_HOSTS } from '../../data/mock-data';
import { useAppContext } from '../../context/AppContext';
import { useIsMobile } from '../ui/use-mobile';
import { validateToken, maskToken, AuthError } from '@/lib/unibox-auth';
import { Wifi, WifiOff, Plug, CheckCircle2, Loader2, Radio, AlertCircle } from 'lucide-react';
import ConnectedChannelsPanel from './ConnectedChannelsPanel';

// ─── Helper: localStorage-backed state ─────────────────────────
function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [state, setStateRaw] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(`settings_${key}`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return initial;
  });
  const setState = useCallback((v: T | ((prev: T) => T)) => {
    setStateRaw(prev => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try { localStorage.setItem(`settings_${key}`, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [key]);
  return [state, setState];
}

// --- Types ---
type SettingsTab = 'agent' | 'templates' | 'hours' | 'demo' | 'ai' | 'prompts' | 'inboxes';

interface SLAThreshold {
  priority: string;
  color: string;
  firstResponse: number;
  resolution: number;
  escalateAfter: number;
}

interface ReplyTemplate {
  id: string;
  name: string;
  category: string;
  body: string;
  language: string;
}

interface ShiftBlock {
  day: string;
  start: string;
  end: string;
  enabled: boolean;
}

// --- Reusable Toggle ---
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`w-10 h-[22px] rounded-full transition-colors relative cursor-pointer ${checked ? 'bg-indigo-500' : 'bg-slate-300'}`}
    >
      <span className={`pointer-events-none absolute top-[3px] left-[3px] w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0'}`} />
    </button>
  );
}

// --- Inline toggle row (label left, toggle right) ---
function ToggleRow({ label, description, checked, onChange, last }: {
  label: React.ReactNode;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <div className={`p-5 ${last ? '' : 'border-b border-slate-100'}`}>
      <div className="grid grid-cols-[1fr_auto] items-center gap-4">
        <div>
          <h3 className="font-bold text-slate-800 text-sm">{label}</h3>
          <p className="text-xs text-slate-500 mt-1">{description}</p>
        </div>
        <Toggle checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}

// --- Stacked field row (label on top, full-width input below) ---
function FieldRow({ label, description, children, last }: {
  label: React.ReactNode;
  description: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`p-5 ${last ? '' : 'border-b border-slate-100'}`}>
      <h3 className="font-bold text-slate-800 text-sm">{label}</h3>
      <p className="text-xs text-slate-500 mt-1 mb-3">{description}</p>
      {children}
    </div>
  );
}

// --- Inline metric row (label left, small number input right) ---
function MetricRow({ label, description, children, last }: {
  label: React.ReactNode;
  description: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`p-5 ${last ? '' : 'border-b border-slate-100'}`}>
      <div className="grid grid-cols-[1fr_100px] items-center gap-4">
        <div>
          <h3 className="font-bold text-slate-800 text-sm">{label}</h3>
          <p className="text-xs text-slate-500 mt-1">{description}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function SessionBanner() { return null; }

// --- Radio Card (consistent pattern for all selection cards) ---
function RadioCard({ selected, onClick, label, description, icon, compact }: {
  selected: boolean;
  onClick: () => void;
  label: string;
  description: string;
  icon?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-lg border-2 text-left transition-all w-full ${
        selected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {icon && <div className={`mb-1.5 ${selected ? 'text-indigo-600' : 'text-slate-400'}`}>{icon}</div>}
      <p className={`${compact ? 'text-xs' : 'text-sm'} font-bold ${selected ? 'text-indigo-700' : 'text-slate-700'}`}>{label}</p>
      <p className={`${compact ? 'text-[10px]' : 'text-xs'} text-slate-500 mt-0.5`}>{description}</p>
    </button>
  );
}

// --- Mock Data ---
const INITIAL_SLA_THRESHOLDS: SLAThreshold[] = [
  { priority: 'Urgent', color: 'text-red-600 bg-red-50', firstResponse: 5, resolution: 30, escalateAfter: 10 },
  { priority: 'High', color: 'text-orange-600 bg-orange-50', firstResponse: 15, resolution: 60, escalateAfter: 30 },
  { priority: 'Normal', color: 'text-blue-600 bg-blue-50', firstResponse: 30, resolution: 120, escalateAfter: 60 },
  { priority: 'Low', color: 'text-slate-600 bg-slate-100', firstResponse: 60, resolution: 240, escalateAfter: 120 },
];

const INITIAL_TEMPLATES: ReplyTemplate[] = [
  { id: '1', name: 'Welcome Check-in', category: 'Check-in', body: 'Welcome to {property_name}! Your room {room_number} is ready. Here\'s everything you need to know for a wonderful stay...', language: 'en' },
  { id: '2', name: 'Wi-Fi Instructions', category: 'Amenities', body: 'Great question! The Wi-Fi network is "{wifi_name}" and the password is "{wifi_password}". Let me know if you have any trouble connecting.', language: 'en' },
  { id: '3', name: 'Late Checkout Request', category: 'Check-out', body: 'I\'d be happy to check on late checkout availability for you. Let me confirm with the property and get right back to you!', language: 'en' },
  { id: '4', name: 'Maintenance Acknowledgment', category: 'Maintenance', body: 'I\'m sorry about the inconvenience. I\'ve submitted a maintenance request and our team will address this as soon as possible. Is there anything else I can help with?', language: 'en' },
  { id: '5', name: 'Checkout Reminder', category: 'Check-out', body: 'Just a friendly reminder that checkout is at {checkout_time} tomorrow. Please leave the keys {key_instructions}. We hope you enjoyed your stay!', language: 'en' },
  { id: '6', name: 'Noise Complaint Response', category: 'Issues', body: 'I\'m very sorry to hear about the noise disturbance. I\'ll reach out to the other guests immediately. Please don\'t hesitate to contact us again if the issue persists.', language: 'en' },
];

const INITIAL_SHIFTS: ShiftBlock[] = [
  { day: 'Monday', start: '08:00', end: '17:00', enabled: true },
  { day: 'Tuesday', start: '08:00', end: '17:00', enabled: true },
  { day: 'Wednesday', start: '08:00', end: '17:00', enabled: true },
  { day: 'Thursday', start: '08:00', end: '17:00', enabled: true },
  { day: 'Friday', start: '08:00', end: '17:00', enabled: true },
  { day: 'Saturday', start: '10:00', end: '14:00', enabled: false },
  { day: 'Sunday', start: '10:00', end: '14:00', enabled: false },
];

const TEMPLATE_CATEGORIES = ['Check-in', 'Check-out', 'Amenities', 'Maintenance', 'Issues', 'Billing', 'General'];

const AFTER_HOURS_PRESETS = [
  { id: 'back-soon', label: 'We\'ll be back during business hours', body: 'Thanks for reaching out! Our team is currently offline. We\'ll get back to you as soon as we\'re back during our regular hours ({business_hours}). If this is urgent, please call the property directly.' },
  { id: 'auto-ai', label: 'Let AI handle simple questions', body: '' },
  { id: 'custom', label: 'Custom auto-reply message', body: '' },
];

export function SettingsView() {
  const { tab: urlTab } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const {
    darkMode, setDarkMode, devMode, setDevMode,
    agentName, setAgentName, defaultLanguage, setDefaultLanguage,
    hostSettings, updateHostSettings,
    agentPresence, setAgentPresence, autoAwayMinutes, setAutoAwayMinutes,
    hasApiKey, maskedApiKey, aiSettingsLoading,
    saveAIApiKey, saveAIModel, saveImportAiModel, clearAIApiKey,
    aiModel, importAiModel, resetToDemo,
    notificationPrefs, updateNotificationPrefs,
    promptOverrides, updatePromptOverride, resetPromptOverride,
  } = useAppContext();

  const validTabs: SettingsTab[] = ['agent', 'ai', 'templates', 'hours', 'demo', 'prompts', 'inboxes', 'channels'];
  // Map old 'client' tab to new 'ai' tab for backward compatibility
  const resolvedTab = urlTab === 'client' ? 'ai' : urlTab;
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(
    validTabs.includes(resolvedTab as SettingsTab) ? (resolvedTab as SettingsTab) : 'agent'
  );

  // AI tab: host selector + local shadow state with auto-save
  const [selectedHostId, setSelectedHostId] = useState(MOCK_HOSTS[0]?.id || '');
  const currentHostSettings = hostSettings.find(s => s.hostId === selectedHostId);
  const [tone, setTone] = useState(currentHostSettings?.tone || '');
  const [autoReply, setAutoReply] = useState(currentHostSettings?.autoReply || false);
  const [autoReplyMode, setAutoReplyMode] = useState<'auto' | 'draft' | 'assist'>(currentHostSettings?.autoReplyMode || 'auto');
  const [partialCoverage, setPartialCoverage] = useState<'answer-and-escalate' | 'escalate-all'>(currentHostSettings?.partialCoverage || 'answer-and-escalate');
  const [zeroCoverage, setZeroCoverage] = useState<'holding-message' | 'silent-escalate'>(currentHostSettings?.zeroCoverage || 'holding-message');
  const [cooldownEnabled, setCooldownEnabled] = useState(currentHostSettings?.cooldownEnabled ?? true);
  const [cooldownMinutes, setCooldownMinutes] = useState(currentHostSettings?.cooldownMinutes ?? 10);
  const [debouncePreset, setDebouncePreset] = useState<'instant' | 'quick' | 'normal' | 'patient'>(currentHostSettings?.debouncePreset || 'normal');
  const [safetyKeywords, setSafetyKeywords] = useState<string[]>(currentHostSettings?.safetyKeywords || []);
  const [newKeyword, setNewKeyword] = useState('');
  const [showSafety, setShowSafety] = useState(false);
  const [showBulkApply, setShowBulkApply] = useState(false);
  const [bulkTargetIds, setBulkTargetIds] = useState<Set<string>>(new Set());

  // Auto-save: debounced write to AppContext on any change
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSave = useCallback((updates: Record<string, any>) => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      updateHostSettings(selectedHostId, updates);
    }, 400);
  }, [selectedHostId, updateHostSettings]);

  // Sync local state FROM context when host changes (don't re-collapse safety)
  useEffect(() => {
    const settings = hostSettings.find(s => s.hostId === selectedHostId);
    if (settings) {
      setTone(settings.tone);
      setAutoReply(settings.autoReply);
      setAutoReplyMode(settings.autoReplyMode || 'auto');
      setPartialCoverage(settings.partialCoverage || 'answer-and-escalate');
      setZeroCoverage(settings.zeroCoverage || 'holding-message');
      setCooldownEnabled(settings.cooldownEnabled ?? true);
      setCooldownMinutes(settings.cooldownMinutes ?? 10);
      setDebouncePreset(settings.debouncePreset || 'normal');
      setSafetyKeywords(settings.safetyKeywords || []);
      setNewKeyword('');
    }
  }, [selectedHostId, hostSettings]);

  // Advanced AI settings collapsed by default
  const [showAiAdvanced, setShowAiAdvanced] = useState(false);

  // Session-persisted state for operational tabs
  const [slaThresholds, setSlaThresholds] = usePersistedState('slaThresholds', INITIAL_SLA_THRESHOLDS);
  const [slaWarningPct, setSlaWarningPct] = usePersistedState('slaWarningPct', 80);
  const [templates, setTemplates] = usePersistedState('templates', INITIAL_TEMPLATES);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateFilter, setTemplateFilter] = useState('All');
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [newTemplate, setNewTemplate] = useState<Omit<ReplyTemplate, 'id'>>({ name: '', category: 'General', body: '', language: 'en' });
  const [routingMode, setRoutingMode] = usePersistedState<'round-robin' | 'skill-based' | 'load-balanced'>('routingMode', 'skill-based');
  const [autoAssign, setAutoAssign] = usePersistedState('autoAssign', true);
  const [maxConcurrent, setMaxConcurrent] = usePersistedState('maxConcurrent', 8);
  const [priorityRouting, setPriorityRouting] = usePersistedState('priorityRouting', true);
  const [languageRouting, setLanguageRouting] = usePersistedState('languageRouting', true);
  const [hostAffinity, setHostAffinity] = usePersistedState('hostAffinity', true);
  const [fallbackTimeout, setFallbackTimeout] = usePersistedState('fallbackTimeout', 5);
  const [shifts, setShifts] = usePersistedState('shifts', INITIAL_SHIFTS);
  const [timezone, setTimezone] = usePersistedState('timezone', 'Asia/Tokyo');
  const [autoAwayOnShiftEnd, setAutoAwayOnShiftEnd] = usePersistedState('autoAwayOnShiftEnd', true);
  const [afterHoursMode, setAfterHoursMode] = usePersistedState<'back-soon' | 'auto-ai' | 'custom'>('afterHoursMode', 'back-soon');
  const [afterHoursCustomMsg, setAfterHoursCustomMsg] = usePersistedState('afterHoursCustomMsg', 'Thank you for your message. Our team is currently away and will respond during our next business day. For emergencies, please contact the property directly.');
  const [csatTarget, setCsatTarget] = usePersistedState('csatTarget', 4.5);
  const [firstResponseTarget, setFirstResponseTarget] = usePersistedState('firstResponseTarget', 10);
  const [resolutionRateTarget, setResolutionRateTarget] = usePersistedState('resolutionRateTarget', 92);
  const [autoQA, setAutoQA] = usePersistedState('autoQA', true);
  const [sentimentAlert, setSentimentAlert] = usePersistedState('sentimentAlert', true);
  const [qaAuditPct, setQaAuditPct] = usePersistedState('qaAuditPct', 25);
  const [escalationThreshold, setEscalationThreshold] = usePersistedState('escalationThreshold', 3);

  const handleTabChange = (tab: SettingsTab) => {
    setSettingsTab(tab);
    navigate(`/settings/${tab === 'agent' ? '' : tab}`);
  };

  // AI tab: mutators that also auto-save
  const setToneAndSave = (v: string) => { setTone(v); autoSave({ tone: v }); };
  const setAutoReplyAndSave = (v: boolean) => { setAutoReply(v); autoSave({ autoReply: v }); };
  const setAutoReplyModeAndSave = (v: 'auto' | 'draft' | 'assist') => { setAutoReplyMode(v); autoSave({ autoReplyMode: v }); };
  const setPartialCoverageAndSave = (v: 'answer-and-escalate' | 'escalate-all') => { setPartialCoverage(v); autoSave({ partialCoverage: v }); };
  const setZeroCoverageAndSave = (v: 'holding-message' | 'silent-escalate') => { setZeroCoverage(v); autoSave({ zeroCoverage: v }); };
  const setCooldownEnabledAndSave = (v: boolean) => { setCooldownEnabled(v); autoSave({ cooldownEnabled: v }); };
  const setCooldownMinutesAndSave = (v: number) => { setCooldownMinutes(v); autoSave({ cooldownMinutes: v }); };
  const setDebouncePresetAndSave = (v: 'instant' | 'quick' | 'normal' | 'patient') => { setDebouncePreset(v); autoSave({ debouncePreset: v }); };

  // ─── Bulk Apply ────────────────────────────────────────────
  const otherHosts = MOCK_HOSTS.filter(h => h.id !== selectedHostId);
  const currentSettingsSnapshot = () => ({
    tone, autoReply, autoReplyMode, partialCoverage, zeroCoverage,
    cooldownEnabled, cooldownMinutes, debouncePreset, safetyKeywords,
  });

  const handleBulkApply = () => {
    const snapshot = currentSettingsSnapshot();
    const targets = bulkTargetIds.size === 0 ? otherHosts.map(h => h.id) : Array.from(bulkTargetIds);
    for (const hostId of targets) {
      updateHostSettings(hostId, snapshot);
    }
    const count = targets.length;
    toast.success(`Settings applied to ${count} client${count !== 1 ? 's' : ''}`, {
      description: `Copied from ${MOCK_HOSTS.find(h => h.id === selectedHostId)?.name}`,
    });
    setShowBulkApply(false);
    setBulkTargetIds(new Set());
  };

  const toggleBulkTarget = (hostId: string) => {
    setBulkTargetIds(prev => {
      const next = new Set(prev);
      if (next.has(hostId)) next.delete(hostId); else next.add(hostId);
      return next;
    });
  };

  const addSafetyKeyword = () => {
    const kw = newKeyword.trim().toLowerCase();
    if (!kw) return;
    if (safetyKeywords.includes(kw)) { toast.error('Already in the list'); return; }
    const next = [...safetyKeywords, kw];
    setSafetyKeywords(next);
    setNewKeyword('');
    autoSave({ safetyKeywords: next });
  };

  const removeSafetyKeyword = (kw: string) => {
    const next = safetyKeywords.filter(k => k !== kw);
    setSafetyKeywords(next);
    autoSave({ safetyKeywords: next });
  };

  const updateSlaField = (idx: number, field: keyof SLAThreshold, value: number) => {
    setSlaThresholds(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const handleAddTemplate = () => {
    if (!newTemplate.name.trim() || !newTemplate.body.trim()) { toast.error('Please fill in both the name and message body'); return; }
    setTemplates(prev => [...prev, { ...newTemplate, id: Date.now().toString() }]);
    setNewTemplate({ name: '', category: 'General', body: '', language: 'en' });
    setShowAddTemplate(false);
    toast.success('Reply template added');
  };

  const handleDeleteTemplate = (id: string) => {
    setTemplates(prev => prev.filter(c => c.id !== id));
    toast.success('Reply template removed');
  };

  const updateShift = (idx: number, field: keyof ShiftBlock, value: string | boolean) => {
    setShifts(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const navItem = (tab: SettingsTab, icon: React.ReactNode, label: string) => (
    <button
      key={tab}
      onClick={() => handleTabChange(tab)}
      className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${settingsTab === tab ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
    >
      {icon} {label}
    </button>
  );

  const filteredTemplates = templateFilter === 'All' ? templates : templates.filter(c => c.category === templateFilter);

  return (
    <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden animate-in fade-in duration-200">
      <div className="h-14 md:h-16 bg-white border-b border-slate-200 px-3 md:px-6 flex items-center shrink-0 shadow-sm">
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Mobile: horizontal scrollable tab strip */}
        {isMobile ? (
          <div className="bg-white border-b border-slate-200 shrink-0 overflow-x-auto">
            <div className="flex gap-1 px-3 py-2 min-w-max">
              {([
                { tab: 'inboxes' as SettingsTab, icon: <Globe size={14} />, label: 'Inboxes' },
                { tab: 'agent' as SettingsTab, icon: <User size={14} />, label: 'Prefs' },
                { tab: 'ai' as SettingsTab, icon: <Sparkles size={14} />, label: 'AI' },
                { tab: 'templates' as SettingsTab, icon: <MessageSquareText size={14} />, label: 'Templates' },
                { tab: 'hours' as SettingsTab, icon: <Clock size={14} />, label: 'Hours' },
                { tab: 'prompts' as SettingsTab, icon: <BrainCircuit size={14} />, label: 'Prompts' },
                { tab: 'demo' as SettingsTab, icon: <Sparkles size={14} />, label: 'Demo' },
              ]).map(item => (
                <button
                  key={item.tab}
                  onClick={() => handleTabChange(item.tab)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors whitespace-nowrap ${
                    settingsTab === item.tab
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      : 'text-slate-500 border border-transparent hover:bg-slate-50'
                  }`}
                >
                  {item.icon} {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Desktop: Sidebar */
          <div className="w-64 bg-white border-r border-slate-200 p-4 shrink-0 flex flex-col gap-6 overflow-y-auto">
            <div>
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Connections</h3>
              <nav className="space-y-1">
                {navItem('inboxes', <Globe size={16} />, 'Connected Inboxes')}
                {navItem('channels', <Radio size={16} />, 'Messaging Channels')}
              </nav>
            </div>

            <div>
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">My Workspace</h3>
              <nav className="space-y-1">
                {navItem('agent', <User size={16} />, 'My Preferences')}
                {navItem('hours', <Clock size={16} />, 'Working Hours')}
                {navItem('templates', <MessageSquareText size={16} />, 'Quick Reply Templates')}
              </nav>
            </div>

            <div>
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Administration</h3>
              <nav className="space-y-1">
                {navItem('demo', <Sparkles size={16} />, 'Demo Features')}
              </nav>
            </div>

            <div>
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Configuration</h3>
              <nav className="space-y-1">
                {navItem('ai', <Sparkles size={16} />, 'AI Configuration')}
                {navItem('prompts', <BrainCircuit size={16} />, 'AI Prompts')}
                <button
                  onClick={() => navigate('/settings/form-builder')}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors text-slate-600 hover:bg-slate-50"
                >
                  <Settings2 size={16} /> Knowledge Requirements
                </button>
              </nav>
            </div>
          </div>
        )}

        {/* Content */}
        <div className={`flex-1 ${isMobile ? 'p-4' : 'p-8'} overflow-y-auto`}>

          {/* ===== CONNECTED INBOXES ===== */}
          {settingsTab === 'inboxes' && (
            <ConnectedInboxesPanel />
          )}

          {/* ===== MESSAGING CHANNELS ===== */}
          {settingsTab === 'channels' && (
            <ConnectedChannelsPanel />
          )}

          {/* ===== MY PREFERENCES ===== */}
          {settingsTab === 'agent' && (
            <div className="max-w-xl mx-auto animate-in fade-in">
              <h2 className="text-lg font-bold text-slate-800 mb-1">My Preferences</h2>
              <p className="text-xs text-slate-500 mb-6">Personal workspace settings and display options.</p>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
                <ToggleRow
                  label="Dark Mode"
                  description="Use a darker color scheme for the workspace interface. (Preview only)"
                  checked={darkMode}
                  onChange={(v) => { setDarkMode(v); toast.info(v ? 'Dark mode turned on' : 'Light mode turned on'); }}
                />
                <ToggleRow
                  label={<span className="flex items-center gap-2">Developer Mode <Code2 size={14} className="text-indigo-500" /></span>}
                  description="Show advanced tools like the data viewer and raw rule formats in the Guest Info section."
                  checked={devMode}
                  onChange={(v) => { setDevMode(v); toast.info(v ? 'Developer mode turned on' : 'Developer mode turned off'); }}
                />
                <FieldRow label="Display Name" description="The name guests see when you reply to their messages.">
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    onBlur={() => toast.success(`Display name updated to "${agentName}"`)}
                    placeholder="Enter your display name"
                    className="w-full border border-slate-300 rounded-lg text-sm py-2 px-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 outline-none"
                  />
                </FieldRow>
                <FieldRow label="Default Reply Language" description="The language used when the AI drafts replies for you." last>
                  <select
                    value={defaultLanguage}
                    onChange={(e) => {
                      setDefaultLanguage(e.target.value);
                      toast.success(`Language set to ${e.target.selectedOptions[0].text}`);
                    }}
                    className="w-full border border-slate-300 rounded-lg text-sm py-2 px-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 outline-none"
                  >
                    <option value="en">English</option>
                    <option value="ja">Japanese</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="id">Indonesian</option>
                  </select>
                </FieldRow>
              </div>
            </div>
          )}

          {/* ===== QUICK REPLY TEMPLATES ===== */}
          {settingsTab === 'templates' && (
            <div className="max-w-2xl mx-auto animate-in fade-in">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Quick Reply Templates</h2>
                  <p className="text-xs text-slate-500 mt-1">Pre-written messages your team can send with one click. Use {'{placeholders}'} like {'{property_name}'} for details that change per guest.</p>
                </div>
                <button onClick={() => setShowAddTemplate(true)} className="px-3 py-2 bg-indigo-600 text-white font-medium rounded-lg text-xs hover:bg-indigo-700 shadow-sm flex items-center gap-1.5 shrink-0">
                  <Plus size={14} /> New Template
                </button>
              </div>
              <SessionBanner />

              {/* Category filter */}
              <div className={`flex gap-1.5 mb-4 ${isMobile ? 'overflow-x-auto pb-1' : 'flex-wrap'}`}>
                {['All', ...TEMPLATE_CATEGORIES].map(cat => (
                  <button key={cat} onClick={() => setTemplateFilter(cat)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 whitespace-nowrap ${templateFilter === cat ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    {cat}
                  </button>
                ))}
              </div>

              {/* Add form */}
              {showAddTemplate && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 mb-4 animate-in fade-in">
                  <h3 className="font-bold text-sm text-indigo-800 mb-3">Create New Template</h3>
                  <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-3 mb-3`}>
                    <input placeholder="Template name (e.g., Early Check-in)" value={newTemplate.name} onChange={(e) => setNewTemplate(p => ({ ...p, name: e.target.value }))} className="border border-indigo-200 rounded-lg text-sm py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none bg-white" />
                    <select value={newTemplate.category} onChange={(e) => setNewTemplate(p => ({ ...p, category: e.target.value }))} className="border border-indigo-200 rounded-lg text-sm py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none bg-white">
                      {TEMPLATE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <textarea placeholder="Type your message here... Use {property_name}, {room_number}, etc. for dynamic values" value={newTemplate.body} onChange={(e) => setNewTemplate(p => ({ ...p, body: e.target.value }))} className="w-full border border-indigo-200 rounded-lg text-sm py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none bg-white resize-none min-h-[80px] mb-3" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowAddTemplate(false)} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md">Cancel</button>
                    <button onClick={handleAddTemplate} className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700">Save Template</button>
                  </div>
                </div>
              )}

              {/* Template list */}
              <div className="space-y-2">
                {filteredTemplates.map(tmpl => (
                  <div key={tmpl.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="p-4 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-sm text-slate-800">{tmpl.name}</h3>
                          <span className="text-[10px] font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded">{tmpl.category}</span>
                          <span className="text-[10px] font-medium bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded flex items-center gap-0.5"><Globe size={9} /> {tmpl.language.toUpperCase()}</span>
                        </div>
                        {editingTemplateId === tmpl.id ? (
                          <textarea
                            defaultValue={tmpl.body}
                            onBlur={(e) => {
                              setTemplates(prev => prev.map(c => c.id === tmpl.id ? { ...c, body: e.target.value } : c));
                              setEditingTemplateId(null);
                              toast.success('Template updated');
                            }}
                            autoFocus
                            className="w-full border border-indigo-300 rounded-lg text-xs py-2 px-2.5 focus:ring-1 focus:ring-indigo-500 outline-none resize-none min-h-[60px] bg-indigo-50/50"
                          />
                        ) : (
                          <p className="text-xs text-slate-500 line-clamp-2">{tmpl.body}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => setEditingTemplateId(editingTemplateId === tmpl.id ? null : tmpl.id)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors" title="Edit">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDeleteTemplate(tmpl.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredTemplates.length === 0 && (
                  <div className="text-center py-12 text-slate-400 text-sm">No templates in this category yet.</div>
                )}
              </div>
            </div>
          )}

          {/* ===== WORKING HOURS ===== */}
          {settingsTab === 'hours' && (
            <div className="max-w-xl mx-auto animate-in fade-in">
              <h2 className="text-lg font-bold text-slate-800 mb-1">Working Hours</h2>
              <p className="text-xs text-slate-500 mb-6">Set your availability schedule and control what happens when you're offline.</p>
              <SessionBanner />

              {/* Timezone */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4">
                <FieldRow label="Timezone" description="All times in your schedule are shown in this timezone." last>
                  <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full border border-slate-300 rounded-lg text-sm py-2 px-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 outline-none">
                    <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                    <option value="Asia/Manila">Asia/Manila (PHT)</option>
                    <option value="America/New_York">America/New York (EST)</option>
                    <option value="America/Los_Angeles">America/Los Angeles (PST)</option>
                    <option value="Europe/London">Europe/London (GMT)</option>
                    <option value="Asia/Bangkok">Asia/Bangkok (ICT)</option>
                    <option value="Asia/Bali">Asia/Bali (WITA)</option>
                  </select>
                </FieldRow>
              </div>

              {/* Weekly schedule */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4 overflow-hidden">
                <div className="p-4 bg-slate-50 border-b border-slate-200">
                  <h3 className="font-bold text-sm text-slate-700">Weekly Schedule</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Toggle each day on or off, then set your start and end times.</p>
                </div>
                {shifts.map((shift, idx) => (
                  <div key={shift.day} className={`px-4 md:px-5 py-3 flex ${isMobile ? 'flex-col gap-2' : 'items-center gap-4'} ${idx < shifts.length - 1 ? 'border-b border-slate-100' : ''}`}>
                    <div className={`flex items-center gap-3 ${isMobile ? '' : ''}`}>
                      <div className={`${isMobile ? 'w-16' : 'w-24'} shrink-0`}>
                        <span className={`text-sm font-medium ${shift.enabled ? 'text-slate-800' : 'text-slate-400'}`}>{isMobile ? shift.day.slice(0, 3) : shift.day}</span>
                      </div>
                      <Toggle checked={shift.enabled} onChange={(v) => updateShift(idx, 'enabled', v)} />
                      {!shift.enabled && (
                        <span className="text-xs text-slate-400 ml-1">Day off</span>
                      )}
                    </div>
                    {shift.enabled && (
                      <div className={`flex items-center gap-2 ${isMobile ? 'ml-0' : 'ml-2'}`}>
                        <input type="time" value={shift.start} onChange={(e) => updateShift(idx, 'start', e.target.value)} className="border border-slate-300 rounded-md text-xs py-1 px-2 focus:ring-1 focus:ring-indigo-500 outline-none" />
                        <span className="text-xs text-slate-400">to</span>
                        <input type="time" value={shift.end} onChange={(e) => updateShift(idx, 'end', e.target.value)} className="border border-slate-300 rounded-md text-xs py-1 px-2 focus:ring-1 focus:ring-indigo-500 outline-none" />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* After-hours behavior */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4">
                <ToggleRow
                  label="Set Me as Away When My Shift Ends"
                  description="Automatically change your status to away so new conversations aren't assigned to you."
                  checked={autoAwayOnShiftEnd}
                  onChange={setAutoAwayOnShiftEnd}
                  last
                />
              </div>

              {/* After-hours auto-reply */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6 overflow-hidden">
                <div className="p-4 bg-slate-50 border-b border-slate-200">
                  <h3 className="font-bold text-sm text-slate-700 flex items-center gap-2"><MessageCircle size={14} className="text-indigo-500" /> After-Hours Auto-Reply</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Choose what happens when a guest messages outside your working hours.</p>
                </div>
                <div className="p-5 space-y-3">
                  {AFTER_HOURS_PRESETS.map(preset => (
                    <label
                      key={preset.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${afterHoursMode === preset.id ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300'}`}
                    >
                      <input
                        type="radio"
                        name="afterHoursMode"
                        value={preset.id}
                        checked={afterHoursMode === preset.id}
                        onChange={() => setAfterHoursMode(preset.id as typeof afterHoursMode)}
                        className="mt-0.5 accent-indigo-600"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${afterHoursMode === preset.id ? 'text-indigo-700' : 'text-slate-700'}`}>{preset.label}</p>
                        {preset.id === 'back-soon' && afterHoursMode === 'back-soon' && (
                          <div className="mt-2 bg-white border border-indigo-200 rounded-lg p-3">
                            <p className="text-xs text-slate-500 mb-1.5 font-medium">Message guests will see:</p>
                            <p className="text-xs text-slate-600 italic">{preset.body}</p>
                          </div>
                        )}
                        {preset.id === 'auto-ai' && (
                          <p className="text-xs text-slate-400 mt-0.5">The AI will try to answer simple questions using your guest info rules. Complex issues will be queued for your next shift.</p>
                        )}
                      </div>
                    </label>
                  ))}

                  {/* Custom message editor */}
                  {afterHoursMode === 'custom' && (
                    <div className="ml-7 animate-in fade-in">
                      <p className="text-xs text-slate-500 mb-2">Write the message guests will receive when they reach out outside your working hours:</p>
                      <textarea
                        value={afterHoursCustomMsg}
                        onChange={(e) => setAfterHoursCustomMsg(e.target.value)}
                        placeholder="Type your auto-reply message here..."
                        className="w-full border border-slate-300 rounded-lg text-sm py-2.5 px-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 outline-none resize-none min-h-[100px]"
                      />
                      <p className="text-[10px] text-slate-400 mt-1.5">Tip: Use {'{business_hours}'} to automatically insert your schedule, and {'{property_name}'} for the property.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ===== AI CONFIGURATION ===== */}
          {settingsTab === 'ai' && (
            <div className="max-w-2xl mx-auto animate-in fade-in space-y-5">
              <div>
                <h2 className="text-lg font-bold text-slate-800 mb-1">AI Configuration</h2>
                <p className="text-xs text-slate-500">Control when AI acts automatically and how it handles guest messages.</p>
              </div>

              {/* ── Auto-Actions (When Away) ── */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-sm text-slate-800">Auto-Actions (When Away)</h3>
                    <p className="text-xs text-slate-500 mt-0.5">These settings govern automated behavior — not what AI can do manually.</p>
                  </div>
                  <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${agentPresence === 'away' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${agentPresence === 'away' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                    {agentPresence === 'away' ? 'Away — AI active' : 'Online — AI on standby'}
                  </div>
                </div>

                <div className="px-5 py-4 space-y-5">
                  {/* Mode selector */}
                  <div>
                    <p className="text-xs font-semibold text-slate-600 mb-2.5">When you're away, AI should:</p>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { mode: 'auto',   label: 'Reply for me',  desc: 'Sends reply automatically' },
                        { mode: 'draft',  label: 'Draft for me',  desc: 'Holds for your review' },
                        { mode: 'assist', label: 'Suggest only',  desc: 'Sidebar suggestions' },
                      ] as const).map(({ mode, label, desc }) => {
                        const isSelected = autoReplyMode === mode;
                        return (
                          <button
                            key={mode}
                            onClick={() => { setAutoReplyMode(mode); autoSave({ autoReplyMode: mode }); }}
                            className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-center transition-all ${
                              isSelected
                                ? 'border-indigo-400 bg-indigo-50 shadow-sm'
                                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <span className={`text-[11px] font-bold leading-tight ${isSelected ? 'text-indigo-700' : 'text-slate-700'}`}>{label}</span>
                            <span className={`text-[9px] leading-snug ${isSelected ? 'text-indigo-500' : 'text-slate-400'}`}>{desc}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Auto-away timer */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-600">Auto-away after idle</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Automatically switch to Away after inactivity. 0 = disabled.</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={120}
                        value={autoAwayMinutes}
                        onChange={e => setAutoAwayMinutes(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-14 text-center border border-slate-200 rounded-lg py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      />
                      <span className="text-xs text-slate-400">min</span>
                    </div>
                  </div>

                  {/* Info note */}
                  <div className="flex items-start gap-2 bg-slate-50 rounded-lg px-3 py-2.5">
                    <Info size={12} className="text-slate-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-slate-500 leading-snug">
                      AI drafting and suggestions are always available in the sidebar, even when you're Online.
                    </p>
                  </div>

                  {/* Advanced toggle */}
                  <button
                    onClick={() => setShowAiAdvanced(v => !v)}
                    className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    {showAiAdvanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    Advanced settings
                  </button>

                  {showAiAdvanced && (
                    <div className="border border-slate-100 rounded-xl p-4 space-y-4 bg-slate-50/60">
                      {/* Reply delay */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-slate-600">Reply delay</p>
                          <p className="text-[10px] text-slate-400">Wait for guest to finish typing before AI replies.</p>
                        </div>
                        <select
                          value={debouncePreset}
                          onChange={e => { setDebouncePreset(e.target.value as typeof debouncePreset); autoSave({ debouncePreset: e.target.value }); }}
                          className="border border-slate-200 rounded-lg py-1.5 px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                        >
                          <option value="instant">Instant (2s)</option>
                          <option value="quick">Quick (10s)</option>
                          <option value="normal">Normal (30s)</option>
                          <option value="patient">Patient (60s)</option>
                        </select>
                      </div>

                      {/* Cooldown */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-slate-600">Pause AI after I reply</p>
                          <p className="text-[10px] text-slate-400">Prevents AI from cutting in after you've taken over.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { const next = !cooldownEnabled; setCooldownEnabled(next); autoSave({ cooldownEnabled: next }); }}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${cooldownEnabled ? 'bg-indigo-500' : 'bg-slate-200'}`}
                          >
                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${cooldownEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </button>
                          {cooldownEnabled && (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={1}
                                max={120}
                                value={cooldownMinutes}
                                onChange={e => { const v = parseInt(e.target.value) || 10; setCooldownMinutes(v); autoSave({ cooldownMinutes: v }); }}
                                className="w-12 text-center border border-slate-200 rounded-lg py-1 text-xs font-semibold text-slate-700 focus:outline-none"
                              />
                              <span className="text-[10px] text-slate-400">min</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Safety keywords */}
                      <div>
                        <p className="text-xs font-semibold text-slate-600 mb-1.5">Always escalate if message contains</p>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {safetyKeywords.map(kw => (
                            <span key={kw} className="flex items-center gap-1 text-[10px] bg-red-50 border border-red-200 text-red-700 px-2 py-0.5 rounded-full">
                              {kw}
                              <button onClick={() => { const next = safetyKeywords.filter(k => k !== kw); setSafetyKeywords(next); autoSave({ safetyKeywords: next }); }}>
                                <X size={9} />
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newKeyword}
                            onChange={e => setNewKeyword(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && newKeyword.trim()) {
                                const next = [...safetyKeywords, newKeyword.trim()];
                                setSafetyKeywords(next);
                                autoSave({ safetyKeywords: next });
                                setNewKeyword('');
                              }
                            }}
                            placeholder="Add keyword…"
                            className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                          <button
                            onClick={() => {
                              if (newKeyword.trim()) {
                                const next = [...safetyKeywords, newKeyword.trim()];
                                setSafetyKeywords(next);
                                autoSave({ safetyKeywords: next });
                                setNewKeyword('');
                              }
                            }}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-medium text-slate-600 transition-colors"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Customize prompts link */}
              <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Customize AI tone &amp; prompts</p>
                  <p className="text-xs text-slate-500 mt-0.5">Adjust how AI writes replies to match your brand voice.</p>
                </div>
                <button
                  onClick={() => { setSettingsTab('prompts'); setTimeout(() => { document.querySelector('[data-operation="compose_reply"]')?.scrollIntoView({ behavior: 'smooth' }); }, 100); }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shrink-0"
                >
                  <BrainCircuit size={13} />
                  AI Prompts
                </button>
              </div>
            </div>
          )}

          {/* ===== AI PROMPTS ===== */}
          {settingsTab === 'prompts' && (
            <div className="max-w-3xl mx-auto animate-in fade-in">
              <h2 className="text-lg font-bold text-slate-800 mb-1">AI Prompts</h2>
              <p className="text-xs text-slate-500 mb-6">
                Customize the system and user prompts for each AI operation. Changes are saved automatically and persist across sessions.
                Use <code className="bg-slate-100 px-1 rounded text-[10px]">{'{{variable}}'}</code> placeholders shown below each field — they are filled in at runtime.
              </p>

              {/* Group: Reply & Drafting */}
              <div className="mb-6">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-1">Reply &amp; Drafting</h3>
                <div className="flex flex-col gap-3">
                  {(['compose_reply', 'polish_draft', 'auto_reply'] as OperationId[]).map((op, i) => (
                    <PromptGroupCard
                      key={op}
                      operationId={op}
                      defaults={PROMPT_DEFAULTS[op]}
                      override={promptOverrides[op]}
                      onUpdate={(field, value) => updatePromptOverride(op, field, value)}
                      onReset={(field) => resetPromptOverride(op, field)}
                      initiallyOpen={i === 0}
                    />
                  ))}
                </div>
              </div>

              {/* Group: Detection & Analysis */}
              <div className="mb-6">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-1">Detection &amp; Analysis</h3>
                <p className="text-[11px] text-slate-400 mb-2 ml-1">
                  <span className="font-medium text-slate-500">Classify Inquiry</span> categorises what the guest is asking.{' '}
                  <span className="font-medium text-slate-500">Inquiry Summary</span> appended to it when <span className="font-medium">AI Summary</span> mode is active — controls the agent briefing in the Guest Needs panel.
                </p>
                <div className="flex flex-col gap-3">
                  {(['classify_inquiry', 'inquiry_summary'] as OperationId[]).map((op) => (
                    <PromptGroupCard
                      key={op}
                      operationId={op}
                      defaults={PROMPT_DEFAULTS[op]}
                      override={promptOverrides[op]}
                      onUpdate={(field, value) => updatePromptOverride(op, field, value)}
                      onReset={(field) => resetPromptOverride(op, field)}
                      initiallyOpen={false}
                    />
                  ))}
                </div>
              </div>

              {/* Group: Knowledge & Assistant */}
              <div className="mb-6">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-1">Knowledge &amp; Assistant</h3>
                <div className="flex flex-col gap-3">
                  {(['ask_ai', 'kb_import'] as OperationId[]).map((op) => (
                    <PromptGroupCard
                      key={op}
                      operationId={op}
                      defaults={PROMPT_DEFAULTS[op]}
                      override={promptOverrides[op]}
                      onUpdate={(field, value) => updatePromptOverride(op, field, value)}
                      onReset={(field) => resetPromptOverride(op, field)}
                      initiallyOpen={false}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ===== DEMO FEATURES ===== */}
          {settingsTab === 'demo' && (
            <div className="max-w-xl mx-auto animate-in fade-in">
              <h2 className="text-lg font-bold text-slate-800 mb-1">Demo Features</h2>
              <p className="text-xs text-slate-500 mb-6">Configure demo and development features for this workspace.</p>
              <SessionBanner />

              {/* Display Options */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4">
                <div className="p-4 bg-slate-50 border-b border-slate-200">
                  <h3 className="font-bold text-sm text-slate-700">Display Options</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Control display preferences for the workspace.</p>
                </div>
                <ToggleRow
                  label="Show Zoom Control"
                  description="Display the zoom control in the top bar. Disable to use browser native zooming."
                  checked={hostSettings[0]?.demoFeatures?.showZoomOverride ?? true}
                  onChange={(checked) => updateHostSettings(hostSettings[0]?.hostId || '', {
                    ...hostSettings[0],
                    demoFeatures: {
                      ...hostSettings[0]?.demoFeatures,
                      showZoomOverride: checked
                    }
                  })}
                  last
                />
              </div>

              {/* AI Connection */}
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 ml-1">AI Configuration</h3>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6">
                <AIKeyFieldBackend
                  hasApiKey={hasApiKey}
                  maskedApiKey={maskedApiKey}
                  loading={aiSettingsLoading}
                  onSave={async (key) => {
                    try {
                      await saveAIApiKey(key);
                      toast.success(key ? 'API key saved to server' : 'API key cleared');
                    } catch (err: any) {
                      toast.error('Failed to save API key', { description: err.message });
                    }
                  }}
                  onClear={async () => {
                    try {
                      await clearAIApiKey();
                      toast.success('API key cleared');
                    } catch (err: any) {
                      toast.error('Failed to clear API key', { description: err.message });
                    }
                  }}
                />
                <AIModelSelector
                  currentModel={aiModel}
                  onSave={async (model) => {
                    try {
                      await saveAIModel(model);
                      toast.success(`AI model set to ${model}`);
                    } catch (err: any) {
                      toast.error('Failed to save model', { description: err.message });
                    }
                  }}
                />

                <ImportAIModelSelector
                  currentModel={importAiModel}
                  onSave={async (model) => {
                    try {
                      await saveImportAiModel(model);
                      toast.success(`Import AI model set to ${model}`);
                    } catch (err: any) {
                      toast.error('Failed to save model', { description: err.message });
                    }
                  }}
                />
              </div>

              {/* Reset to Demo */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
                <div className="p-4 bg-slate-50 border-b border-slate-200">
                  <h3 className="font-bold text-sm text-slate-700">Reset & Data Management</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Restore the workspace to demo defaults.</p>
                </div>
                <div className="p-5">
                  <button
                    onClick={() => {
                      if (confirm('Reset all tickets, tasks, and settings to demo defaults? This cannot be undone.')) {
                        resetToDemo();
                        toast.success('Workspace reset to demo data');
                      }
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm font-medium text-red-700 hover:bg-red-100 transition-colors"
                  >
                    <RotateCcw size={16} />
                    Reset to Demo Data
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── AI Model Selector (preset + custom) ─────────────────

const PRESET_MODELS = [
  { value: 'openai/gpt-4o-mini', label: 'openai/gpt-4o-mini (fast, cheap)' },
  { value: 'openai/gpt-4o', label: 'openai/gpt-4o (best quality)' },
  { value: 'openai/gpt-4.1-mini', label: 'openai/gpt-4.1-mini' },
  { value: 'openai/gpt-4.1-nano', label: 'openai/gpt-4.1-nano (fastest)' },
  { value: 'anthropic/claude-sonnet-4', label: 'anthropic/claude-sonnet-4' },
  { value: 'anthropic/claude-3.5-haiku', label: 'anthropic/claude-3.5-haiku' },
  { value: 'google/gemini-2.5-flash-lite', label: 'google/gemini-2.5-flash-lite (fast, cheap)' },
  { value: 'google/gemini-2.0-flash-001', label: 'google/gemini-2.0-flash' },
  { value: 'google/gemini-3.1-flash-lite-preview', label: 'google/gemini-3.1-flash-lite' },
  { value: 'meta-llama/llama-3.3-70b-instruct', label: 'meta-llama/llama-3.3-70b' },
];

function AIModelSelector({ currentModel, onSave }: {
  currentModel: string;
  onSave: (model: string) => void;
}) {
  const isPreset = PRESET_MODELS.some(m => m.value === currentModel);
  const [mode, setMode] = useState<'preset' | 'custom'>(isPreset ? 'preset' : 'custom');
  const [customModel, setCustomModel] = useState(isPreset ? '' : currentModel);

  return (
    <div className="p-5 border-b border-slate-100">
      <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-1">
        <Bot size={14} className="text-indigo-500" /> AI Model
      </h3>
      <p className="text-xs text-slate-500 mb-3">Choose which model to use via OpenRouter. Affects reply quality, speed, and cost.</p>

      <div className="flex gap-2 mb-3">
        <button onClick={() => setMode('preset')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === 'preset' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>Popular Models</button>
        <button onClick={() => setMode('custom')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === 'custom' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>Custom Model ID</button>
      </div>

      {mode === 'preset' ? (
        <select
          value={isPreset ? currentModel : ''}
          onChange={(e) => onSave(e.target.value)}
          className="w-full border border-slate-300 rounded-lg text-sm py-2 px-3 focus:ring-2 focus:ring-indigo-500 outline-none"
        >
          {PRESET_MODELS.map(m => (
            <option key={m.value} value={m.value}>{m.label}{m.value === currentModel ? ' (current)' : ''}</option>
          ))}
        </select>
      ) : (
        <div className="flex gap-2">
          <input
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder="e.g., anthropic/claude-3.5-sonnet"
            className="flex-1 border border-slate-300 rounded-lg text-sm py-2 px-3 focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <button
            onClick={() => { if (customModel.trim()) onSave(customModel.trim()); }}
            disabled={!customModel.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Apply
          </button>
        </div>
      )}

      {currentModel && (
        <p className="text-[11px] text-slate-400 mt-2">
          Current: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{currentModel}</code>
        </p>
      )}
    </div>
  );
}

// ─── Import AI Model Selector ────────────────────────

function ImportAIModelSelector({ currentModel, onSave }: {
  currentModel: string;
  onSave: (model: string) => void;
}) {
  const isPreset = PRESET_MODELS.some(m => m.value === currentModel);
  const [mode, setMode] = useState<'preset' | 'custom'>(isPreset ? 'preset' : 'custom');
  const [customModel, setCustomModel] = useState(isPreset ? '' : currentModel);

  return (
    <div className="p-5 border-b border-slate-100">
      <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-1">
        <Bot size={14} className="text-indigo-500" /> Document Import AI Model
      </h3>
      <p className="text-xs text-slate-500 mb-3">Choose which model to use for extracting and mapping imported files. Can be different from auto-reply model.</p>

      <div className="flex gap-2 mb-3">
        <button onClick={() => setMode('preset')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === 'preset' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>Popular Models</button>
        <button onClick={() => setMode('custom')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === 'custom' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>Custom Model ID</button>
      </div>

      {mode === 'preset' ? (
        <select
          value={isPreset ? currentModel : ''}
          onChange={(e) => onSave(e.target.value)}
          className="w-full border border-slate-300 rounded-lg text-sm py-2 px-3 focus:ring-2 focus:ring-indigo-500 outline-none"
        >
          {PRESET_MODELS.map(m => (
            <option key={m.value} value={m.value}>{m.label}{m.value === currentModel ? ' (current)' : ''}</option>
          ))}
        </select>
      ) : (
        <div className="flex gap-2">
          <input
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder="e.g., anthropic/claude-3.5-sonnet"
            className="flex-1 border border-slate-300 rounded-lg text-sm py-2 px-3 focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <button
            onClick={() => { if (customModel.trim()) onSave(customModel.trim()); }}
            disabled={!customModel.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Apply
          </button>
        </div>
      )}

      {currentModel && (
        <p className="text-[11px] text-slate-400 mt-2">
          Current: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{currentModel}</code>
        </p>
      )}
    </div>
  );
}

// ─── AI Key Field (backend-stored) ────────────────────────

function AIKeyFieldBackend({ hasApiKey, maskedApiKey, loading, onSave, onClear }: {
  hasApiKey: boolean;
  maskedApiKey: string;
  loading: boolean;
  onSave: (key: string) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="p-5">
      <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-1">
        <Key size={14} className="text-amber-500" /> OpenRouter API Key
      </h3>
      <p className="text-xs text-slate-500 mb-3">
        Required for AI auto-reply. Get a key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">openrouter.ai/keys</a>. The key is stored on the server, never in your browser.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <div className="w-4 h-4 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin" />
          Loading...
        </div>
      ) : editing ? (
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="sk-or-v1-..."
              autoFocus
              className="w-full border border-indigo-300 rounded-lg text-sm py-2 px-3 pr-8 focus:ring-2 focus:ring-indigo-500 outline-none bg-indigo-50/30"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button onClick={() => { onSave(inputValue); setEditing(false); setInputValue(''); }} className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Save</button>
          <button onClick={() => { setEditing(false); setInputValue(''); }} className="px-3 py-2 text-slate-500 hover:bg-slate-100 rounded-lg text-sm">Cancel</button>
        </div>
      ) : hasApiKey ? (
        <div className="flex items-center gap-3">
          <code className="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg text-sm font-mono border border-emerald-200">{maskedApiKey}</code>
          <button onClick={() => setEditing(true)} className="text-[10px] text-indigo-600 hover:underline font-medium p-0 leading-[inherit]">Change</button>
          <button onClick={onClear} className="text-[10px] text-red-500 hover:underline font-medium p-0 leading-[inherit]">Remove</button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2">
          <Key size={14} /> Add API Key
        </button>
      )}
    </div>
  );
}

// ─── Connected Inboxes Panel ─────────────────────────────────
function ConnectedInboxesPanel() {
  const { properties, hostSettings, addFirestoreConnection, removeFirestoreConnection, firestoreConnections } = useAppContext();

  // Local state for the "Connect Inbox" flow
  const [showForm, setShowForm] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validatedCompany, setValidatedCompany] = useState<{ name: string; userId: string } | null>(null);
  const [selectedHostId, setSelectedHostId] = useState('');
  const [validationError, setValidationError] = useState('');

  // Saved connections — persisted in Supabase KV (localStorage as cache)
  const [savedInboxes, setSavedInboxes] = useState<Array<{
    hostId: string;
    companyName: string;
    maskedToken: string;
    connectedAt: string;
  }>>([]);
  const inboxesLoadedRef = useRef(false);

  // Load saved inboxes from Supabase on mount
  useEffect(() => {
    if (inboxesLoadedRef.current) return;
    inboxesLoadedRef.current = true;
    (async () => {
      try {
        const { getInboxes } = await import('../../ai/api-client');
        const inboxes = await getInboxes();
        setSavedInboxes(inboxes);
      } catch {
        // Fallback to localStorage cache
        try {
          const raw = localStorage.getItem('settings_connected_inboxes');
          if (raw) setSavedInboxes(JSON.parse(raw));
        } catch { /* ignore */ }
      }
    })();
  }, []);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [updatingTokenId, setUpdatingTokenId] = useState<string | null>(null);
  const [updateTokenInput, setUpdateTokenInput] = useState('');
  const [updateTokenValidating, setUpdateTokenValidating] = useState(false);

  const handleValidate = async () => {
    if (!tokenInput.trim()) return;
    setValidating(true);
    setValidationError('');
    setValidatedCompany(null);

    try {
      const user = await validateToken(tokenInput.trim());
      setValidatedCompany({ name: user.name, userId: user.unibox_user_id });
      if (MOCK_HOSTS.length === 1) setSelectedHostId(MOCK_HOSTS[0].id);
    } catch (err) {
      if (err instanceof AuthError) {
        setValidationError(err.message);
      } else {
        setValidationError('Failed to validate token. Check your network and try again.');
      }
    } finally {
      setValidating(false);
    }
  };

  const handleConnect = () => {
    if (!validatedCompany || !selectedHostId) return;

    const host = MOCK_HOSTS.find(h => h.id === selectedHostId);
    if (!host) return;

    if (savedInboxes.some(i => i.hostId === selectedHostId)) {
      toast.error('This host is already connected to an inbox.');
      return;
    }

    // Save to Supabase KV (+ localStorage cache)
    const masked = maskToken(tokenInput.trim());
    const connectedAt = new Date().toISOString();
    const entry = { hostId: selectedHostId, companyName: validatedCompany.name, maskedToken: masked, connectedAt };
    setSavedInboxes(prev => [...prev, entry]);
    (async () => {
      try {
        const { saveInbox } = await import('../../ai/api-client');
        await saveInbox(selectedHostId, {
          companyName: validatedCompany!.name,
          maskedToken: masked,
          connectedAt,
          accessToken: tokenInput.trim(),
        });
      } catch (err) {
        console.error('Failed to persist inbox to Supabase:', err);
      }
      // Keep the non-secret inbox metadata cache in sync for faster cold
      // boot. Tokens are intentionally NOT written to localStorage — they
      // live only in Supabase KV and in-memory via useFirestoreConnections.
      try {
        const raw = localStorage.getItem('settings_connected_inboxes');
        const list = raw ? JSON.parse(raw) : [];
        list.push(entry);
        localStorage.setItem('settings_connected_inboxes', JSON.stringify(list));
      } catch { /* ignore */ }
    })();

    // Activate the connection in AppContext — triggers Firebase auth + Firestore subscription
    addFirestoreConnection(tokenInput.trim(), host).catch(err => {
      toast.error('Failed to activate connection', { description: err.message });
    });

    toast.success(`Connected "${validatedCompany.name}" to ${host.name}`);
    setShowForm(false);
    setTokenInput('');
    setValidatedCompany(null);
    setSelectedHostId('');
    setShowToken(false);
  };

  const handleDisconnect = (hostId: string) => {
    setDisconnectingId(hostId);
  };

  const confirmDisconnect = (hostId: string) => {
    setSavedInboxes(prev => prev.filter(i => i.hostId !== hostId));
    // Remove from Supabase KV + localStorage cache
    (async () => {
      try {
        const { deleteInbox } = await import('../../ai/api-client');
        await deleteInbox(hostId);
      } catch (err) {
        console.error('Failed to delete inbox from Supabase:', err);
      }
      try {
        const raw = localStorage.getItem('settings_connected_inboxes');
        const list = raw ? JSON.parse(raw) : [];
        localStorage.setItem('settings_connected_inboxes', JSON.stringify(list.filter((i: any) => i.hostId !== hostId)));
        // Belt-and-braces: scrub any legacy token from the pre-Supabase-KV
        // cache if a user is disconnecting after upgrading.
        localStorage.removeItem('settings_inbox_tokens');
      } catch { /* ignore */ }
    })();
    // Tear down Firebase app + unsubscribe from Firestore
    removeFirestoreConnection(hostId).catch(() => {});
    setDisconnectingId(null);
    toast.success('Inbox disconnected');
  };

  const handleTestConnection = async (hostId: string) => {
    setTestingId(hostId);
    try {
      const { getInboxToken } = await import('../../ai/api-client');
      const token = await getInboxToken(hostId);
      if (!token) {
        toast.error('Token not found — please reconnect this inbox.');
        return;
      }
      await validateToken(token);
      toast.success('Connection is healthy');
    } catch (err) {
      if (err instanceof AuthError) {
        toast.error(err.message);
      } else {
        toast.error('Connection test failed');
      }
    } finally {
      setTestingId(null);
    }
  };

  const handleUpdateToken = async (hostId: string) => {
    if (!updateTokenInput.trim()) return;
    setUpdateTokenValidating(true);
    try {
      const user = await validateToken(updateTokenInput.trim());
      // Update saved inbox metadata
      const masked = maskToken(updateTokenInput.trim());
      setSavedInboxes(prev => prev.map(i =>
        i.hostId === hostId ? { ...i, maskedToken: masked, companyName: user.name } : i
      ));
      // Persist to Supabase KV
      const { saveInbox } = await import('../../ai/api-client');
      await saveInbox(hostId, {
        companyName: user.name,
        maskedToken: masked,
        connectedAt: new Date().toISOString(),
        accessToken: updateTokenInput.trim(),
      });
      // No localStorage write — Supabase KV (set via saveInbox above) is
      // the only persistent store for tokens; reconnect() updates the
      // in-memory mirror inside useFirestoreConnections.
      // Reconnect with new token
      const host = MOCK_HOSTS.find(h => h.id === hostId);
      if (host) {
        await removeFirestoreConnection(hostId);
        await addFirestoreConnection(updateTokenInput.trim(), host);
      }
      toast.success('Token updated', { description: `Reconnected to ${user.name}` });
      setUpdatingTokenId(null);
      setUpdateTokenInput('');
    } catch (err) {
      if (err instanceof AuthError) {
        toast.error(err.message);
      } else {
        toast.error('Invalid token — check and try again');
      }
    } finally {
      setUpdateTokenValidating(false);
    }
  };

  const availableHosts = MOCK_HOSTS.filter(h => !savedInboxes.some(i => i.hostId === h.id));

  return (
    <div className="max-w-xl mx-auto animate-in fade-in">
      <h2 className="text-lg font-bold text-slate-800 mb-1">Connected Inboxes</h2>
      <p className="text-xs text-slate-500 mb-6">
        Connect your Unified Inbox accounts to receive real-time guest conversations from Airbnb, Booking.com, and other channels.
      </p>

      {/* Connected inboxes list */}
      {savedInboxes.length > 0 && (
        <div className="space-y-3 mb-6">
          {savedInboxes.map((inbox) => {
            const host = MOCK_HOSTS.find(h => h.id === inbox.hostId);
            const isDisconnecting = disconnectingId === inbox.hostId;
            const isTesting = testingId === inbox.hostId;
            const isUpdatingToken = updatingTokenId === inbox.hostId;

            // Wire live status from firestoreConnections
            const liveConn = firestoreConnections.find(c => c.hostId === inbox.hostId);
            const liveStatus = liveConn?.status || 'disconnected';
            const statusConfig = liveStatus === 'connected'
              ? { label: 'Connected', color: 'bg-emerald-50 text-emerald-600', icon: <Wifi size={10} /> }
              : liveStatus === 'expired'
              ? { label: 'Token Expired', color: 'bg-red-50 text-red-500', icon: <AlertCircle size={10} /> }
              : liveStatus === 'permission-denied'
              ? { label: 'Permission Denied', color: 'bg-red-50 text-red-500', icon: <AlertCircle size={10} /> }
              : liveStatus === 'network-error'
              ? { label: 'Network Error', color: 'bg-amber-50 text-amber-600', icon: <Wifi size={10} /> }
              : { label: 'Disconnected', color: 'bg-slate-100 text-slate-400', icon: <Wifi size={10} /> };

            return (
              <div key={inbox.hostId} className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                {isDisconnecting ? (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-700">
                      Disconnect <strong>{inbox.companyName}</strong> from <strong>{host?.name}</strong>? Active conversations from this inbox will no longer be visible.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => confirmDisconnect(inbox.hostId)}
                        className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700"
                      >
                        Disconnect
                      </button>
                      <button
                        onClick={() => setDisconnectingId(null)}
                        className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-200"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold ${host?.brandColor || 'bg-slate-400'}`}>
                        {(host?.name || '?').charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800 truncate">{inbox.companyName}</span>
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusConfig.color}`}>
                            {statusConfig.icon} {statusConfig.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span>Mapped to {host?.name || 'Unknown'}</span>
                          <span>·</span>
                          <span>Token: {inbox.maskedToken}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleTestConnection(inbox.hostId)}
                          disabled={isTesting}
                          className="px-2.5 py-1.5 text-[11px] font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-50"
                        >
                          {isTesting ? <Loader2 size={12} className="animate-spin" /> : 'Test'}
                        </button>
                        <button
                          onClick={() => { setUpdatingTokenId(isUpdatingToken ? null : inbox.hostId); setUpdateTokenInput(''); }}
                          className="px-2.5 py-1.5 text-[11px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100"
                        >
                          {isUpdatingToken ? 'Cancel' : 'Update'}
                        </button>
                        <button
                          onClick={() => handleDisconnect(inbox.hostId)}
                          className="px-2 py-1.5 text-[11px] font-medium text-slate-400 hover:text-red-500 transition-colors"
                          title="Disconnect"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    {/* Inline token update */}
                    {isUpdatingToken && (
                      <div className="flex items-center gap-2 pl-11">
                        <input
                          type="password"
                          autoFocus
                          value={updateTokenInput}
                          onChange={e => setUpdateTokenInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleUpdateToken(inbox.hostId)}
                          placeholder="Paste new token..."
                          className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
                        />
                        <button
                          onClick={() => handleUpdateToken(inbox.hostId)}
                          disabled={updateTokenValidating || !updateTokenInput.trim()}
                          className="px-3 py-1.5 text-[11px] font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {updateTokenValidating ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {savedInboxes.length === 0 && !showForm && (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center mb-6">
          <Plug size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-medium text-slate-600 mb-1">No inboxes connected</p>
          <p className="text-xs text-slate-400 mb-4">Connect your first Unified Inbox to start receiving real guest conversations.</p>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 inline-flex items-center gap-2"
          >
            <Plus size={14} /> Connect Inbox
          </button>
        </div>
      )}

      {/* Connect Inbox form */}
      {showForm && (
        <div className="bg-white border border-indigo-200 rounded-xl shadow-sm p-5 mb-6">
          <h3 className="font-bold text-slate-800 text-sm mb-1 flex items-center gap-2">
            <Plug size={14} className="text-indigo-500" /> Connect a New Inbox
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Paste your Unified Inbox access token. You can find it in your browser's localStorage (key: <code className="text-[10px] bg-slate-100 px-1 rounded">access_token</code>) when logged into the Unified Inbox.
          </p>

          {/* Step 1: Token input */}
          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">Access Token</label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={tokenInput}
                  onChange={(e) => { setTokenInput(e.target.value); setValidatedCompany(null); setValidationError(''); }}
                  placeholder="Paste your Unified Inbox access token..."
                  className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 pr-8 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button
                onClick={handleValidate}
                disabled={!tokenInput.trim() || validating}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5 shrink-0"
              >
                {validating ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Validate
              </button>
            </div>
            {validationError && (
              <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
                <AlertTriangle size={12} /> {validationError}
              </p>
            )}
          </div>

          {/* Step 2: Company name + host mapping */}
          {validatedCompany && (
            <div className="border-t border-slate-100 pt-4 space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-emerald-700">Token validated</p>
                  <p className="text-xs text-emerald-600">Company: <strong>{validatedCompany.name}</strong></p>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">Map to BPO Host</label>
                <select
                  value={selectedHostId}
                  onChange={(e) => setSelectedHostId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="">Select a host...</option>
                  {availableHosts.map(h => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-slate-400">
                  This maps real-time chats from "{validatedCompany.name}" to the selected BPO host profile for SLA and tag routing.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleConnect}
                  disabled={!selectedHostId}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Plug size={14} /> Connect Inbox
                </button>
                <button
                  onClick={() => { setShowForm(false); setTokenInput(''); setValidatedCompany(null); setSelectedHostId(''); setValidationError(''); setShowToken(false); }}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add more button */}
      {savedInboxes.length > 0 && !showForm && availableHosts.length > 0 && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full border border-dashed border-slate-300 rounded-xl p-3 text-sm text-slate-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/50 transition-colors flex items-center justify-center gap-2"
        >
          <Plus size={14} /> Connect Another Inbox
        </button>
      )}
    </div>
  );
}
