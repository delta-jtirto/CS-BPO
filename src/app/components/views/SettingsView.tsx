import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  User, Bell, Shield, Code2, Clock, Timer, MessageSquareText,
  GitBranch, Target, Plus, Trash2, Pencil, Zap, AlertTriangle, Users,
  Globe, BarChart3, MessageCircle, Settings2, Bot, Eye, EyeOff, Key, RotateCcw,
  ChevronDown, ChevronRight, ShieldAlert, Pause, X, Info, Sparkles, Copy
} from 'lucide-react';
import { toast } from 'sonner';
import { MOCK_HOSTS } from '../../data/mock-data';
import { useAppContext } from '../../context/AppContext';
import { useIsMobile } from '../ui/use-mobile';

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
type SettingsTab = 'agent' | 'ai' | 'notifications' | 'sla' | 'templates' | 'routing' | 'hours' | 'qa' | 'demo';

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

// --- Session-only banner ---
function SessionBanner() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg mb-4 text-xs text-amber-700">
      <Info size={13} className="shrink-0" />
      <span><strong>Preview mode</strong> — these settings are saved locally and will reset on page reload.</span>
    </div>
  );
}

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
    hasApiKey, maskedApiKey, aiSettingsLoading,
    saveAIApiKey, saveAIModel, saveImportAiModel, clearAIApiKey,
    aiModel, importAiModel, resetToDemo,
    notificationPrefs, updateNotificationPrefs,
  } = useAppContext();

  const validTabs: SettingsTab[] = ['agent', 'ai', 'notifications', 'sla', 'templates', 'routing', 'hours', 'qa', 'demo'];
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
                { tab: 'agent' as SettingsTab, icon: <User size={14} />, label: 'Prefs' },
                { tab: 'ai' as SettingsTab, icon: <Sparkles size={14} />, label: 'AI' },
                { tab: 'notifications' as SettingsTab, icon: <Bell size={14} />, label: 'Alerts' },
                { tab: 'sla' as SettingsTab, icon: <Timer size={14} />, label: 'SLA' },
                { tab: 'templates' as SettingsTab, icon: <MessageSquareText size={14} />, label: 'Templates' },
                { tab: 'routing' as SettingsTab, icon: <GitBranch size={14} />, label: 'Routing' },
                { tab: 'hours' as SettingsTab, icon: <Clock size={14} />, label: 'Hours' },
                { tab: 'qa' as SettingsTab, icon: <Target size={14} />, label: 'QA' },
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
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">My Workspace</h3>
              <nav className="space-y-1">
                {navItem('agent', <User size={16} />, 'My Preferences')}
                {navItem('notifications', <Bell size={16} />, 'Notifications')}
                {navItem('hours', <Clock size={16} />, 'Working Hours')}
              </nav>
            </div>

            <div>
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">AI & Automation</h3>
              <nav className="space-y-1">
                {navItem('ai', <Sparkles size={16} />, 'AI Auto-Reply')}
              </nav>
            </div>

            <div>
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Administration</h3>
              <nav className="space-y-1">
                {navItem('sla', <Timer size={16} />, 'Response Time Rules')}
                {navItem('templates', <MessageSquareText size={16} />, 'Quick Reply Templates')}
                {navItem('routing', <GitBranch size={16} />, 'Ticket Distribution')}
                {navItem('qa', <Target size={16} />, 'Quality & Performance')}
                {navItem('demo', <Sparkles size={16} />, 'Demo Features')}
              </nav>
            </div>

            <div>
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Configuration</h3>
              <nav className="space-y-1">
                <button
                  onClick={() => navigate('/settings/form-builder')}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors text-slate-600 hover:bg-slate-50"
                >
                  <Settings2 size={16} /> Onboarding Form Builder
                </button>
              </nav>
            </div>
          </div>
        )}

        {/* Content */}
        <div className={`flex-1 ${isMobile ? 'p-4' : 'p-8'} overflow-y-auto`}>

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

              {/* Reset to Demo */}
              <h2 className="text-lg font-bold text-slate-800 mt-8 mb-6 flex items-center gap-2">
                <RotateCcw size={18} className="text-red-500" /> Reset
              </h2>
              <div className="bg-white border border-red-200 rounded-xl shadow-sm">
                <div className="p-5">
                  <h3 className="font-bold text-slate-800 text-sm">Reset to Demo State</h3>
                  <p className="text-xs text-slate-500 mt-1 mb-4">
                    Restore all tickets, tasks, knowledge base entries, onboarding data, and preferences back to the original sample data. This does not affect your server-side API key.
                  </p>
                  <button
                    onClick={() => {
                      resetToDemo();
                      navigate('/inbox');
                      toast.success('Everything has been reset to the original demo state');
                    }}
                    className="px-4 py-2 bg-red-600 text-white font-medium rounded-lg text-sm hover:bg-red-700 shadow-sm transition-colors active:scale-95 flex items-center gap-2"
                  >
                    <RotateCcw size={14} /> Reset Everything
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ===== AI AUTO-REPLY (consolidated) ===== */}
          {settingsTab === 'ai' && (
            <div className="max-w-xl mx-auto animate-in fade-in">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Sparkles size={18} className="text-violet-500" /> AI Auto-Reply
                </h2>
              </div>
              <p className="text-xs text-slate-500 mb-6">Configure your AI key, set per-client behavior, and choose how you're notified. Changes save automatically.</p>

              {/* Section 1: Global AI Configuration */}
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 ml-1">AI Connection</h3>
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

              {/* Section 2: Per-Host Config */}
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Client Configuration</h3>
                <div className="flex items-center gap-2">
                  <select value={selectedHostId} onChange={(e) => setSelectedHostId(e.target.value)} className="border border-slate-300 rounded-lg text-xs py-1.5 px-2.5 focus:ring-2 focus:ring-indigo-500 bg-white font-medium text-indigo-700">
                    {MOCK_HOSTS.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 rounded-t-xl flex items-center justify-between">
                  <p className="text-xs text-slate-500">Settings for <strong className="text-indigo-700">{MOCK_HOSTS.find(h => h.id === selectedHostId)?.name}</strong> — changes auto-save.</p>
                  {otherHosts.length > 0 && (
                    <button
                      onClick={() => { setShowBulkApply(!showBulkApply); setBulkTargetIds(new Set()); }}
                      className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 transition-colors"
                    >
                      <Globe size={11} /> Copy to others...
                    </button>
                  )}
                </div>

                {/* Bulk Apply Panel */}
                {showBulkApply && (
                  <div className="px-4 py-3 bg-indigo-50/60 border-b border-indigo-100 animate-in fade-in slide-in-from-top-1 duration-150">
                    <p className="text-xs font-bold text-indigo-800 mb-2">
                      Copy current settings to other clients
                    </p>
                    <p className="text-[11px] text-indigo-600 mb-3">
                      This will overwrite all AI settings (tone, mode, coverage, timing, keywords) for the selected clients.
                    </p>
                    <div className="space-y-1.5 mb-3">
                      {otherHosts.map(h => (
                        <label key={h.id} className="flex items-center gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={bulkTargetIds.has(h.id)}
                            onChange={() => toggleBulkTarget(h.id)}
                            className="rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                          />
                          <span className="text-xs text-slate-700 group-hover:text-indigo-700 transition-colors">{h.name}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleBulkApply}
                        className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
                      >
                        {bulkTargetIds.size === 0 ? `Apply to All (${otherHosts.length})` : `Apply to ${bulkTargetIds.size} Selected`}
                      </button>
                      <button
                        onClick={() => setShowBulkApply(false)}
                        className="px-3 py-1.5 text-slate-600 hover:text-slate-800 text-xs font-medium transition-colors"
                      >
                        Cancel
                      </button>
                      {bulkTargetIds.size > 0 && bulkTargetIds.size < otherHosts.length && (
                        <button
                          onClick={() => setBulkTargetIds(new Set(otherHosts.map(h => h.id)))}
                          className="text-[11px] text-indigo-500 hover:text-indigo-700 underline ml-auto"
                        >
                          Select all
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Brand voice */}
                <FieldRow label="Brand Voice" description="Tell the AI how this client likes their guests to be addressed.">
                  <input
                    type="text"
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    onBlur={() => setToneAndSave(tone)}
                    placeholder="e.g., Warm and professional"
                    className="w-full border border-slate-300 rounded-lg text-sm py-2 px-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 outline-none"
                  />
                </FieldRow>

                {/* Auto-reply toggle */}
                <ToggleRow
                  label={<span className="flex items-center gap-2">Enable Auto-Reply <Bot size={14} className="text-violet-500" /></span>}
                  description="AI automatically responds to guest messages using the knowledge base. Replies appear as violet 'AI Auto-Reply' bubbles."
                  checked={autoReply}
                  onChange={setAutoReplyAndSave}
                />

                {autoReply && (
                  <>
                    {/* Response Mode — always visible */}
                    <div className="px-5 py-4 border-t border-slate-100">
                      <label className="block text-sm font-bold text-slate-800 mb-1">Response Mode</label>
                      <p className="text-xs text-slate-500 mb-3">How the AI delivers its responses.</p>
                      <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-3'} gap-2`}>
                        {([
                          { value: 'auto' as const, label: 'Auto-Send', desc: 'Sends directly to guests' },
                          { value: 'draft' as const, label: 'Draft', desc: 'Holds for your approval' },
                          { value: 'assist' as const, label: 'Assist Only', desc: 'Sidebar panels only' },
                        ]).map(opt => (
                          <RadioCard
                            key={opt.value}
                            selected={autoReplyMode === opt.value}
                            onClick={() => setAutoReplyModeAndSave(opt.value)}
                            label={opt.label}
                            description={opt.desc}
                            compact
                          />
                        ))}
                      </div>
                    </div>

                    {/* Guest Inquiry Routing — always visible, no accordion */}
                    <div className="px-5 py-4 border-t border-slate-100 space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Guest Inquiry Routing</label>
                        <p className="text-[10px] text-slate-400 mb-3">How AI handles guest questions based on knowledge base coverage.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1.5">When AI only has partial answers</label>
                        <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
                          <RadioCard
                            selected={partialCoverage === 'answer-and-escalate'}
                            onClick={() => setPartialCoverageAndSave('answer-and-escalate')}
                            label="Answer & Hand Off"
                            description="Reply with what's in the knowledge base, hand off the rest to your team"
                            compact
                          />
                          <RadioCard
                            selected={partialCoverage === 'escalate-all'}
                            onClick={() => setPartialCoverageAndSave('escalate-all')}
                            label="Hand Off Everything"
                            description="Route entire conversation to your team"
                            compact
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1.5">When AI can't answer at all</label>
                        <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
                          <RadioCard
                            selected={zeroCoverage === 'holding-message'}
                            onClick={() => setZeroCoverageAndSave('holding-message')}
                            label="Send Holding Message"
                            description="Acknowledge the guest, let them know someone's on it"
                            compact
                          />
                          <RadioCard
                            selected={zeroCoverage === 'silent-escalate'}
                            onClick={() => setZeroCoverageAndSave('silent-escalate')}
                            label="Silent Hand-Off"
                            description="Route to your team without messaging the guest"
                            compact
                          />
                        </div>
                      </div>
                    </div>

                    {/* Timing & Cooldown — always visible, no accordion */}
                    <div className="px-5 py-4 border-t border-slate-100 space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                          <Clock size={12} className="text-slate-500" /> Response Speed
                        </label>
                        <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-2`}>
                          {([
                            { value: 'instant' as const, label: 'Instant', time: '2s', desc: 'No wait' },
                            { value: 'quick' as const, label: 'Quick', time: '10s', desc: 'SMS / chat' },
                            { value: 'normal' as const, label: 'Normal', time: '30s', desc: 'Default' },
                            { value: 'patient' as const, label: 'Patient', time: '60s', desc: 'Email-style' },
                          ]).map(opt => (
                            <RadioCard
                              key={opt.value}
                              selected={debouncePreset === opt.value}
                              onClick={() => setDebouncePresetAndSave(opt.value)}
                              label={`${opt.label} (${opt.time})`}
                              description={opt.desc}
                              compact
                            />
                          ))}
                        </div>
                        {debouncePreset === 'instant' && (
                          <p className="text-[10px] text-amber-600 mt-1.5 flex items-center gap-1">
                            <Zap size={10} /> Instant mode fires within 2s. Great for demos, but may reply before the guest finishes typing.
                          </p>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                            <Pause size={12} className="text-slate-500" /> Pause AI after agent reply
                          </label>
                          <Toggle checked={cooldownEnabled} onChange={setCooldownEnabledAndSave} />
                        </div>
                        <p className="text-[11px] text-slate-500 mb-2">
                          Prevent the AI from jumping back in after you reply manually.
                        </p>
                        {cooldownEnabled && (
                          <div className="flex items-center gap-2 ml-0.5">
                            <span className="text-xs text-slate-600">Resume after</span>
                            <input
                              type="number"
                              value={cooldownMinutes}
                              onChange={(e) => setCooldownMinutesAndSave(Math.max(1, Math.min(120, Number(e.target.value))))}
                              min={1} max={120}
                              className="border border-slate-300 rounded-md text-xs py-1 px-2 w-16 text-center focus:ring-1 focus:ring-indigo-500 outline-none"
                            />
                            <span className="text-xs text-slate-500">minutes</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Safety Keywords — collapsible, with summary in header */}
                    <div className="border-t border-slate-100">
                      <button
                        onClick={() => setShowSafety(!showSafety)}
                        className="w-full px-5 py-3.5 flex items-center gap-3 text-left hover:bg-slate-50/50 transition-colors"
                      >
                        <ShieldAlert size={15} className="text-red-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-bold text-slate-800">Safety Escalation Keywords</span>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {safetyKeywords.length} keyword{safetyKeywords.length !== 1 ? 's' : ''} — messages with these always go to a human
                          </p>
                        </div>
                        {showSafety ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      </button>
                      {showSafety && (
                        <div className="px-5 pb-4 animate-in fade-in duration-150">
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {safetyKeywords.map(kw => (
                              <span key={kw} className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 rounded-md text-xs font-medium border border-red-200">
                                {kw}
                                <button onClick={() => removeSafetyKeyword(kw)} className="text-red-400 hover:text-red-600 p-0.5 -mr-1">
                                  <X size={11} />
                                </button>
                              </span>
                            ))}
                            {safetyKeywords.length === 0 && (
                              <span className="text-xs text-slate-400 italic">No keywords set — the AI will handle all topics.</span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={newKeyword}
                              onChange={(e) => setNewKeyword(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSafetyKeyword(); } }}
                              placeholder="Type a keyword and press Enter..."
                              className="flex-1 border border-slate-300 rounded-lg text-xs py-2 px-3 focus:ring-2 focus:ring-red-500 focus:border-red-300 outline-none"
                            />
                            <button onClick={addSafetyKeyword} className="px-3 py-2 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 transition-colors shrink-0">
                              Add
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Section 3: AI Notification Preferences */}
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 ml-1">AI Notifications</h3>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6">
                <ToggleRow
                  label={<span className="flex items-center gap-2"><Bot size={14} className="text-violet-500" /> AI Sent a Reply</span>}
                  description="Show a notification when the AI successfully auto-replies to a guest."
                  checked={notificationPrefs.notifyAutoReply}
                  onChange={(v) => updateNotificationPrefs({ notifyAutoReply: v })}
                />
                <ToggleRow
                  label={<span className="flex items-center gap-2"><ShieldAlert size={14} className="text-amber-500" /> AI Needs Your Help</span>}
                  description="Notify you when the AI escalated a conversation to your queue."
                  checked={notificationPrefs.notifyEscalation}
                  onChange={(v) => updateNotificationPrefs({ notifyEscalation: v })}
                />
                <ToggleRow
                  label={<span className="flex items-center gap-2"><Pencil size={14} className="text-blue-500" /> AI Draft Ready</span>}
                  description="Notify you when the AI prepared a draft that needs your approval."
                  checked={notificationPrefs.notifyDraft}
                  onChange={(v) => updateNotificationPrefs({ notifyDraft: v })}
                  last
                />
              </div>
            </div>
          )}

          {/* ===== NOTIFICATIONS ===== */}
          {settingsTab === 'notifications' && (
            <div className="max-w-xl mx-auto animate-in fade-in">
              <h2 className="text-lg font-bold text-slate-800 mb-1">Notifications</h2>
              <p className="text-xs text-slate-500 mb-6">Control how and when you receive alerts. Changes save automatically.</p>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
                <ToggleRow
                  label="Email Alerts"
                  description="Get an email when a guest conversation needs your attention."
                  checked={notificationPrefs.emailAlerts}
                  onChange={(v) => updateNotificationPrefs({ emailAlerts: v })}
                />
                <ToggleRow
                  label="Sound Alerts"
                  description="Play a notification sound when a high-priority message arrives."
                  checked={notificationPrefs.soundAlerts}
                  onChange={(v) => updateNotificationPrefs({ soundAlerts: v })}
                />
                <ToggleRow
                  label={<span className="flex items-center gap-2">Response Time Warnings <Shield size={14} className="text-red-500" /></span>}
                  description="Get notified when a conversation is close to exceeding its response time target."
                  checked={notificationPrefs.escalationAlerts}
                  onChange={(v) => updateNotificationPrefs({ escalationAlerts: v })}
                  last
                />
              </div>

              <div className="mt-4 px-1">
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Sparkles size={12} /> AI-specific notifications (auto-reply sent, escalation, drafts) are in the <button onClick={() => handleTabChange('ai')} className="text-indigo-600 underline font-medium">AI Auto-Reply</button> tab.
                </p>
              </div>
            </div>
          )}

          {/* ===== RESPONSE TIME RULES ===== */}
          {settingsTab === 'sla' && (
            <div className="max-w-2xl mx-auto animate-in fade-in">
              <div className="mb-6">
                <h2 className="text-lg font-bold text-slate-800">Response Time Rules</h2>
                <p className="text-xs text-slate-500 mt-1">Set how quickly your team should respond to and resolve guest conversations, based on priority level. All times are in minutes.</p>
              </div>
              <SessionBanner />

              {/* Warning threshold */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4">
                <MetricRow
                  label={<span className="flex items-center gap-2"><AlertTriangle size={14} className="text-amber-500" /> Early Warning</span>}
                  description="Show a warning when this percentage of the allowed time has passed."
                  last
                >
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={slaWarningPct} onChange={(e) => setSlaWarningPct(Number(e.target.value))} min={50} max={99} className="border border-slate-300 rounded-md text-sm py-1.5 px-2 w-full text-center focus:ring-1 focus:ring-indigo-500 outline-none" />
                    <span className="text-xs text-slate-400 shrink-0">%</span>
                  </div>
                </MetricRow>
              </div>

              {/* Response time table */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left py-3 px-5 font-bold text-slate-600 text-xs uppercase tracking-wider">Priority</th>
                      <th className="text-center py-3 px-4 font-bold text-slate-600 text-xs uppercase tracking-wider">First Reply</th>
                      <th className="text-center py-3 px-4 font-bold text-slate-600 text-xs uppercase tracking-wider">Resolution</th>
                      <th className="text-center py-3 px-4 font-bold text-slate-600 text-xs uppercase tracking-wider">Escalate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slaThresholds.map((sla, idx) => (
                      <tr key={sla.priority} className={idx < slaThresholds.length - 1 ? 'border-b border-slate-100' : ''}>
                        <td className="py-3 px-5">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold ${sla.color}`}>{sla.priority}</span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1">
                            <input type="number" value={sla.firstResponse} onChange={(e) => updateSlaField(idx, 'firstResponse', Number(e.target.value))} min={1} className="border border-slate-300 rounded-md text-sm py-1 px-2 w-16 text-center focus:ring-1 focus:ring-indigo-500 outline-none" />
                            <span className="text-xs text-slate-400">min</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1">
                            <input type="number" value={sla.resolution} onChange={(e) => updateSlaField(idx, 'resolution', Number(e.target.value))} min={1} className="border border-slate-300 rounded-md text-sm py-1 px-2 w-16 text-center focus:ring-1 focus:ring-indigo-500 outline-none" />
                            <span className="text-xs text-slate-400">min</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1">
                            <input type="number" value={sla.escalateAfter} onChange={(e) => updateSlaField(idx, 'escalateAfter', Number(e.target.value))} min={1} className="border border-slate-300 rounded-md text-sm py-1 px-2 w-16 text-center focus:ring-1 focus:ring-indigo-500 outline-none" />
                            <span className="text-xs text-slate-400">min</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

          {/* ===== TICKET DISTRIBUTION ===== */}
          {settingsTab === 'routing' && (
            <div className="max-w-xl mx-auto animate-in fade-in">
              <h2 className="text-lg font-bold text-slate-800 mb-1">Ticket Distribution</h2>
              <p className="text-xs text-slate-500 mb-6">Choose how incoming guest conversations are assigned to your team members.</p>
              <SessionBanner />

              {/* Routing mode */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="font-bold text-slate-800 text-sm mb-3">Assignment Method</h3>
                  <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-3'} gap-2`}>
                    {[
                      { id: 'round-robin' as const, label: 'Take Turns', desc: 'Distribute evenly across the team', icon: <GitBranch size={16} /> },
                      { id: 'skill-based' as const, label: 'Best Match', desc: 'Assign based on agent expertise', icon: <Zap size={16} /> },
                      { id: 'load-balanced' as const, label: 'Least Busy', desc: 'Give it to whoever has capacity', icon: <BarChart3 size={16} /> },
                    ].map(m => (
                      <RadioCard
                        key={m.id}
                        selected={routingMode === m.id}
                        onClick={() => setRoutingMode(m.id)}
                        label={m.label}
                        description={m.desc}
                        icon={m.icon}
                        compact
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Routing toggles */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4">
                <ToggleRow
                  label="Auto-Assign New Conversations"
                  description="Automatically assign incoming conversations instead of sending them to a shared queue."
                  checked={autoAssign}
                  onChange={setAutoAssign}
                />
                <ToggleRow
                  label="Prioritize Urgent Messages"
                  description="Route high-priority conversations to your most experienced team members first."
                  checked={priorityRouting}
                  onChange={setPriorityRouting}
                />
                <ToggleRow
                  label="Match by Language"
                  description="Assign conversations to team members who speak the guest's language."
                  checked={languageRouting}
                  onChange={setLanguageRouting}
                />
                <ToggleRow
                  label="Prefer Familiar Agents"
                  description="When possible, assign returning guests to the same team member who helped them before."
                  checked={hostAffinity}
                  onChange={setHostAffinity}
                  last
                />
              </div>

              {/* Numeric settings */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6">
                <MetricRow label="Max Active Conversations" description="The most conversations one person can handle at the same time.">
                  <input type="number" value={maxConcurrent} onChange={(e) => setMaxConcurrent(Number(e.target.value))} min={1} max={20} className="border border-slate-300 rounded-md text-sm py-1.5 px-2 w-full text-center focus:ring-1 focus:ring-indigo-500 outline-none" />
                </MetricRow>
                <MetricRow label="Queue Timeout" description="If nobody picks up, move the conversation back to the shared queue after this many minutes." last>
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={fallbackTimeout} onChange={(e) => setFallbackTimeout(Number(e.target.value))} min={1} max={30} className="border border-slate-300 rounded-md text-sm py-1.5 px-2 w-full text-center focus:ring-1 focus:ring-indigo-500 outline-none" />
                    <span className="text-xs text-slate-400 shrink-0">min</span>
                  </div>
                </MetricRow>
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

          {/* ===== QUALITY & PERFORMANCE ===== */}
          {settingsTab === 'qa' && (
            <div className="max-w-xl mx-auto animate-in fade-in">
              <h2 className="text-lg font-bold text-slate-800 mb-1">Quality & Performance</h2>
              <p className="text-xs text-slate-500 mb-6">Define the quality standards and targets for your team's guest interactions.</p>
              <SessionBanner />

              {/* KPI Targets */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4">
                <div className="p-4 bg-slate-50 border-b border-slate-200">
                  <h3 className="font-bold text-sm text-slate-700">Performance Targets</h3>
                  <p className="text-xs text-slate-400 mt-0.5">The benchmarks your team should aim to meet or exceed.</p>
                </div>
                <MetricRow label="Guest Satisfaction Score" description="Minimum average rating from guest feedback (on a 1 to 5 scale).">
                  <div className="flex items-center gap-1.5">
                    <input type="number" step="0.1" value={csatTarget} onChange={(e) => setCsatTarget(Number(e.target.value))} min={1} max={5} className="border border-slate-300 rounded-md text-sm py-1.5 px-2 w-full text-center focus:ring-1 focus:ring-indigo-500 outline-none" />
                    <span className="text-xs text-slate-400 shrink-0">/ 5</span>
                  </div>
                </MetricRow>
                <MetricRow label="First Reply Time" description="How quickly the team should send the first response to a guest (in minutes).">
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={firstResponseTarget} onChange={(e) => setFirstResponseTarget(Number(e.target.value))} min={1} className="border border-slate-300 rounded-md text-sm py-1.5 px-2 w-full text-center focus:ring-1 focus:ring-indigo-500 outline-none" />
                    <span className="text-xs text-slate-400 shrink-0">min</span>
                  </div>
                </MetricRow>
                <MetricRow label="Resolution Rate" description="Percentage of conversations resolved within the allowed response time." last>
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={resolutionRateTarget} onChange={(e) => setResolutionRateTarget(Number(e.target.value))} min={1} max={100} className="border border-slate-300 rounded-md text-sm py-1.5 px-2 w-full text-center focus:ring-1 focus:ring-indigo-500 outline-none" />
                    <span className="text-xs text-slate-400 shrink-0">%</span>
                  </div>
                </MetricRow>
              </div>

              {/* Automated QA */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4">
                <div className="p-4 bg-slate-50 border-b border-slate-200">
                  <h3 className="font-bold text-sm text-slate-700">Automated Quality Checks</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Let the system help monitor and improve reply quality.</p>
                </div>
                <ToggleRow
                  label="AI Reply Scoring"
                  description="Automatically rate each agent reply on empathy, accuracy, and tone so managers can spot coaching opportunities."
                  checked={autoQA}
                  onChange={setAutoQA}
                />
                <ToggleRow
                  label={<span className="flex items-center gap-2">Guest Mood Alerts <AlertTriangle size={14} className="text-amber-500" /></span>}
                  description="Notify a supervisor when a guest seems unhappy or frustrated based on their messages."
                  checked={sentimentAlert}
                  onChange={setSentimentAlert}
                />
                <MetricRow label="Random Review Sample" description="Percentage of resolved conversations randomly picked for a manager to manually review.">
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={qaAuditPct} onChange={(e) => setQaAuditPct(Number(e.target.value))} min={1} max={100} className="border border-slate-300 rounded-md text-sm py-1.5 px-2 w-full text-center focus:ring-1 focus:ring-indigo-500 outline-none" />
                    <span className="text-xs text-slate-400 shrink-0">%</span>
                  </div>
                </MetricRow>
                <MetricRow label="Auto-Escalation Trigger" description="Number of negative guest signals (e.g., complaints, bad ratings) before automatically alerting a supervisor." last>
                  <input type="number" value={escalationThreshold} onChange={(e) => setEscalationThreshold(Number(e.target.value))} min={1} max={10} className="border border-slate-300 rounded-md text-sm py-1.5 px-2 w-full text-center focus:ring-1 focus:ring-indigo-500 outline-none" />
                </MetricRow>
              </div>

              {/* Performance summary card */}
              <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-5 mb-6">
                <h3 className="font-bold text-sm text-indigo-800 mb-3">How Your Team Is Doing (Sample Data)</h3>
                <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-3'} gap-4`}>
                  {[
                    { label: 'Guest Satisfaction', value: '4.6', target: csatTarget.toString(), good: 4.6 >= csatTarget },
                    { label: 'Avg. First Reply', value: '8m', target: `${firstResponseTarget}m`, good: 8 <= firstResponseTarget },
                    { label: 'Resolution Rate', value: '94%', target: `${resolutionRateTarget}%`, good: 94 >= resolutionRateTarget },
                  ].map(kpi => (
                    <div key={kpi.label} className="bg-white/80 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">{kpi.label}</p>
                      <p className={`text-lg font-bold ${kpi.good ? 'text-emerald-600' : 'text-red-600'}`}>{kpi.value}</p>
                      <p className="text-[10px] text-slate-400">Target: {kpi.target}</p>
                    </div>
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

              {/* Sidebar Visibility */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4">
                <div className="p-4 bg-slate-50 border-b border-slate-200">
                  <h3 className="font-bold text-sm text-slate-700">Sidebar Visibility</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Control which demo features appear in the navigation sidebar.</p>
                </div>
                <ToggleRow
                  label="Show Tasks in Sidebar"
                  description="Display the Tasks navigation item for dispatch and operations management."
                  checked={hostSettings[0]?.demoFeatures?.showTasks ?? true}
                  onChange={(checked) => updateHostSettings(hostSettings[0]?.hostId || '', {
                    ...hostSettings[0],
                    demoFeatures: {
                      ...hostSettings[0]?.demoFeatures,
                      showTasks: checked
                    }
                  })}
                />
                <ToggleRow
                  label="Show Analytics in Sidebar"
                  description="Display the Analytics navigation item for reporting and insights."
                  checked={hostSettings[0]?.demoFeatures?.showAnalytics ?? true}
                  onChange={(checked) => updateHostSettings(hostSettings[0]?.hostId || '', {
                    ...hostSettings[0],
                    demoFeatures: {
                      ...hostSettings[0]?.demoFeatures,
                      showAnalytics: checked
                    }
                  })}
                  last
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
  { value: 'google/gemini-2.5-flash-lite-preview', label: 'google/gemini-2.5-flash-lite (fast, cheap)' },
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
          <button onClick={() => setEditing(true)} className="text-xs text-indigo-600 hover:underline font-medium">Change</button>
          <button onClick={onClear} className="text-xs text-red-500 hover:underline font-medium">Remove</button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2">
          <Key size={14} /> Add API Key
        </button>
      )}
    </div>
  );
}
