import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Plus, Trash2, Eye, EyeOff, CheckCircle2, Loader2, Copy,
  MessageSquare, Globe, Phone, Mail, AlertCircle, HelpCircle, ExternalLink,
  ChevronDown, ChevronUp, ArrowRight, Settings2, Clock,
} from 'lucide-react';
import { getAccessToken, getUserCompanyIds, supabase } from '@/lib/supabase-client';
import { channelDisplayName } from '@/lib/channel-config';
import { MOCK_HOSTS } from '@/app/data/mock-data';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/app/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/app/components/ui/dialog';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/app/components/ui/tooltip';

const PROXY_URL = import.meta.env.VITE_CHANNEL_PROXY_URL || '';

// ─── LINE Setup Guide ───────────────────────────────────────
const LINE_STEPS = [
  {
    num: 1,
    title: 'Create a LINE Official Account',
    desc: 'Sign up or log in with your LINE account, then create a free Official Account.',
    action: { label: 'Open LINE Official Account', url: 'https://account.line.biz/signup' },
  },
  {
    num: 2,
    title: 'Enable Messaging API',
    desc: 'Inside your Official Account → Settings → Messaging API → Enable. Link it to a Provider (create one if needed).',
    action: { label: 'Open Account Manager', url: 'https://manager.line.biz' },
  },
  {
    num: 3,
    title: 'Copy Channel ID & Secret',
    desc: 'Go to LINE Developers Console → your channel → Basic Settings tab. Copy the Channel ID and Channel Secret.',
    action: { label: 'Open Developers Console', url: 'https://developers.line.biz/console' },
  },
  {
    num: 4,
    title: 'Issue a Channel Access Token',
    desc: 'Still in Developers Console → Messaging API tab → scroll to "Channel access token" → click Issue.',
    action: { label: 'Open Developers Console', url: 'https://developers.line.biz/console' },
  },
];

function LineSetupGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-green-100 bg-green-50/60 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-xs font-semibold text-green-800 flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-600 text-white text-[9px] font-bold">?</span>
          Need help finding these values?
        </span>
        {open
          ? <ChevronUp size={13} className="text-green-600 shrink-0" />
          : <ChevronDown size={13} className="text-green-600 shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-green-100 pt-2.5">
          {LINE_STEPS.map((step, idx) => (
            <div key={step.num} className="flex gap-2.5">
              {/* Step number + connector */}
              <div className="flex flex-col items-center shrink-0">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-600 text-white text-[10px] font-bold shrink-0">
                  {step.num}
                </span>
                {idx < LINE_STEPS.length - 1 && (
                  <div className="w-px flex-1 bg-green-200 my-1" />
                )}
              </div>
              {/* Content */}
              <div className="pb-1 min-w-0">
                <p className="text-xs font-semibold text-slate-700 leading-snug">{step.title}</p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{step.desc}</p>
                <a
                  href={step.action.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium text-green-700 hover:text-green-900 hover:underline"
                >
                  {step.action.label} <ArrowRight size={9} />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Email Sync Advanced Settings ──────────────────────────
// Controls the pg_cron-backed email poll interval. The cron fires every 20s
// in Postgres; the interval setting throttles when the actual IMAP fetch
// callout runs. See: supabase/migrations/*_email_sync_cron.sql
const EMAIL_SYNC_PRESETS = [20, 30, 60] as const;

function EmailSyncAdvanced() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [intervalSec, setIntervalSec] = useState(60);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load current settings once the accordion is opened — avoids a query
  // on every Settings tab visit when nobody touches the advanced panel.
  const loadSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from('email_sync_settings')
      .select('enabled, interval_seconds, last_run_at, last_status')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) { setLoaded(true); return; }
    setEnabled(data.enabled);
    setIntervalSec(data.interval_seconds);
    setLastRunAt(data.last_run_at);
    setLastStatus(data.last_status);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (open && !loaded) loadSettings();
  }, [open, loaded, loadSettings]);

  async function saveInterval(next: number, nextEnabled = enabled) {
    // Clamp defensively — the DB CHECK constraint will also reject, but
    // bailing early gives a cleaner error and avoids a round-trip.
    if (next < 20 || next > 3600) {
      toast.error('Interval must be between 20 and 3600 seconds');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc('set_email_sync_settings', {
      p_interval_seconds: next,
      p_enabled: nextEnabled,
    });
    setSaving(false);
    if (error) {
      toast.error(`Failed to save: ${error.message}`);
      return;
    }
    if (data) {
      const row = Array.isArray(data) ? data[0] : data;
      setIntervalSec(row.interval_seconds);
      setEnabled(row.enabled);
    }
    toast.success('Email sync settings updated');
  }

  const customValue = EMAIL_SYNC_PRESETS.includes(intervalSec as 20 | 30 | 60)
    ? ''
    : String(intervalSec);

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <Settings2 size={13} className="text-slate-500" />
          Advanced — Email sync interval
        </span>
        {open
          ? <ChevronUp size={13} className="text-slate-500 shrink-0" />
          : <ChevronDown size={13} className="text-slate-500 shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-100 pt-3">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            How often the server polls connected mailboxes for new mail.
            Webhook channels (WhatsApp/Instagram/LINE) are push-based and
            ignore this setting.
          </p>

          {/* Preset chips */}
          <div className="flex gap-1.5">
            {EMAIL_SYNC_PRESETS.map(sec => (
              <button
                key={sec}
                disabled={saving}
                onClick={() => saveInterval(sec)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  intervalSec === sec
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {sec}s
              </button>
            ))}
          </div>

          {/* Custom input */}
          <div>
            <label className="text-[10px] font-medium text-slate-500 mb-1 block">
              Custom (20–3600 seconds)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min={20}
                max={3600}
                placeholder={customValue || String(intervalSec)}
                defaultValue={customValue}
                key={`custom-${intervalSec}`}
                onBlur={e => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n) && n !== intervalSec) saveInterval(n);
                }}
                className="h-8 w-24 rounded-md border border-slate-300 bg-white px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
              {intervalSec < 30 && (
                <span className="text-[10px] text-amber-600 flex items-center gap-1">
                  <AlertCircle size={10} />
                  Aggressive — may trigger provider rate limits
                </span>
              )}
            </div>
          </div>

          {/* Enable toggle */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-600">
              {enabled ? 'Sync enabled' : 'Sync paused'}
            </span>
            <button
              disabled={saving}
              onClick={() => saveInterval(intervalSec, !enabled)}
              className={`w-8 h-[18px] rounded-full transition-colors relative cursor-pointer ${
                enabled ? 'bg-indigo-500' : 'bg-slate-300'
              }`}
            >
              <span className={`pointer-events-none absolute top-[2px] left-[2px] w-[14px] h-[14px] bg-white rounded-full shadow-sm transition-transform ${
                enabled ? 'translate-x-[14px]' : 'translate-x-0'
              }`} />
            </button>
          </div>

          {/* Last run indicator */}
          {lastRunAt && (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 pt-1 border-t border-slate-100">
              <Clock size={10} />
              Last tick: {new Date(lastRunAt).toLocaleTimeString()}
              {lastStatus && <span className="text-slate-300">· {lastStatus}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Types ─────────────────────────────────────────────────
interface ChannelAccount {
  id: string;
  company_id: string;
  channel: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_webhook_at?: string | null;
}

type ChannelType = 'whatsapp' | 'instagram' | 'line' | 'email';

interface ChannelConfig {
  label: string;
  icon: typeof Phone;
  color: string;
  fields: { key: string; label: string; type: 'text' | 'password'; help: string }[];
  docsUrl: string;
}

const CHANNEL_CONFIGS: Record<ChannelType, ChannelConfig> = {
  whatsapp: {
    label: 'WhatsApp',
    icon: Phone,
    color: 'emerald',
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started',
    fields: [
      { key: 'phone_number_id', label: 'Phone Number ID', type: 'text', help: 'Meta Business Manager → WhatsApp → API Setup → Phone number ID' },
      { key: 'waba_id', label: 'Business Account ID', type: 'text', help: 'Meta Business Manager → WhatsApp → API Setup → WhatsApp Business Account ID' },
      { key: 'access_token', label: 'Access Token', type: 'password', help: 'System User → Generate Token with whatsapp_business_messaging permission' },
      { key: 'app_secret', label: 'App Secret', type: 'password', help: 'Meta Developer Dashboard → Your App → Settings → Basic → App Secret' },
      { key: 'verify_token', label: 'Webhook Verify Token', type: 'text', help: 'Any string you choose — must match what you enter in Meta webhook config' },
    ],
  },
  instagram: {
    label: 'Instagram',
    icon: Globe,
    color: 'pink',
    docsUrl: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api',
    fields: [
      { key: 'ig_user_id', label: 'Instagram User ID', type: 'text', help: 'Your Instagram Business/Creator account ID from Graph API' },
      { key: 'page_id', label: 'Facebook Page ID', type: 'text', help: 'The Facebook Page linked to your Instagram account' },
      { key: 'access_token', label: 'Page Access Token', type: 'password', help: 'Long-lived Page Access Token with instagram_manage_messages permission' },
      { key: 'app_secret', label: 'App Secret', type: 'password', help: 'Meta Developer Dashboard → Your App → Settings → Basic → App Secret' },
      { key: 'verify_token', label: 'Webhook Verify Token', type: 'text', help: 'Any string — must match your Meta webhook configuration' },
    ],
  },
  line: {
    label: 'LINE',
    icon: MessageSquare,
    color: 'green',
    docsUrl: 'https://developers.line.biz/en/docs/messaging-api/getting-started/',
    fields: [
      { key: 'channel_id', label: 'Channel ID', type: 'text', help: 'LINE Developers Console → Your Channel → Basic Settings → Channel ID' },
      { key: 'channel_secret', label: 'Channel Secret', type: 'password', help: 'LINE Developers Console → Your Channel → Basic Settings → Channel Secret' },
      { key: 'channel_access_token', label: 'Channel Access Token', type: 'password', help: 'LINE Developers Console → Messaging API → Channel Access Token (long-lived)' },
    ],
  },
  email: {
    label: 'Email',
    icon: Mail,
    color: 'blue',
    docsUrl: 'https://support.google.com/accounts/answer/185833?hl=en',
    fields: [
      { key: 'email_address', label: 'Email Address', type: 'text', help: 'The email address to connect (e.g. support@company.com). IMAP/SMTP settings will auto-fill based on your domain.' },
      { key: 'password', label: 'App Password', type: 'password', help: 'Gmail: Generate at myaccount.google.com/apppasswords · Outlook: Use your account password' },
    ],
  },
};

// ─── Component ─────────────────────────────────────────────
export default function ConnectedChannelsPanel() {
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Connect dialog state
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectChannel, setConnectChannel] = useState<ChannelType | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Set<string>>(new Set());
  const [selectedHostId, setSelectedHostId] = useState(MOCK_HOSTS[0]?.id || '');

  // Host mapping derived from account data (persisted in DB via host_id column)
  const channelHostMap: Record<string, string> = {};
  for (const a of accounts) {
    if ((a as unknown as { host_id?: string }).host_id) {
      channelHostMap[a.id] = (a as unknown as { host_id: string }).host_id;
    }
  }

  // Update host mapping on the backend
  const updateHostMapping = async (accountId: string, hostId: string) => {
    try {
      const token = await getAccessToken();
      await fetch(`${PROXY_URL}/api/proxy/accounts/${accountId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ host_id: hostId || null }),
      });
      loadAccounts(); // Refresh to get updated host_id
      window.dispatchEvent(new Event('channel-host-updated')); // Notify AppContext to re-map tickets
    } catch { toast.error('Failed to update host mapping'); }
  };

  // Disconnect dialog state
  const [disconnectTarget, setDisconnectTarget] = useState<ChannelAccount | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  // Resolve the signed-in user's company scope via the JWT-aware RPC.
  // Single-tenant deployments get ['delta-hq']; multi-tenant users will
  // see all their companies and can switch via the picker.
  useEffect(() => {
    let cancelled = false;
    getUserCompanyIds().then(ids => {
      if (cancelled || ids.length === 0) return;
      setCompanyIds(ids);
      setSelectedCompanyId(ids[0]);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Load accounts when company changes
  const loadAccounts = useCallback(async () => {
    if (!selectedCompanyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token || !PROXY_URL) {
        // Not authenticated or proxy not configured
        setAccounts([]);
        setLoading(false);
        return;
      }
      const res = await fetch(`${PROXY_URL}/api/proxy/accounts?company_id=${selectedCompanyId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts ?? []);
      } else {
        console.error('Failed to load channels:', res.status);
        setAccounts([]);
      }
    } catch (err) {
      console.error('Failed to load channels:', err);
      setAccounts([]);
    }
    setLoading(false);
  }, [selectedCompanyId]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // ─── Connect Flow ────────────────────────────────
  function openConnectDialog(channel: ChannelType) {
    setConnectChannel(channel);
    setFormData({});
    setFormError('');
    setShowPasswords(new Set());

    setConnectOpen(true);
  }

  async function handleGmailOAuth() {
    try {
      const token = await getAccessToken();
      const res = await fetch(`${PROXY_URL}/api/auth/gmail-connect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: selectedCompanyId }),
      });
      if (!res.ok) throw new Error('Failed to initiate Gmail OAuth');
      const { url } = await res.json();

      // Open OAuth in popup
      const popup = window.open(url, 'gmail-oauth', 'width=600,height=700');
      // Poll for popup close
      const interval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(interval);
          loadAccounts(); // Refresh list
          toast.success('Gmail connection updated');
        }
      }, 1000);
    } catch (err) {
      toast.error('Failed to start Gmail connection');
    }
  }

  async function handleConnect() {
    if (!connectChannel) return;
    const config = CHANNEL_CONFIGS[connectChannel];

    // Validate all fields filled
    const missing = config.fields.filter(f => !formData[f.key]?.trim());
    if (missing.length > 0) {
      setFormError(`Please fill in: ${missing.map(f => f.label).join(', ')}`);
      return;
    }

    // For email: auto-detect IMAP/SMTP from domain
    let credentials = { ...formData };
    if (connectChannel === 'email') {
      const email = formData.email_address?.trim() || '';
      const domain = email.split('@')[1]?.toLowerCase() || '';
      const presets: Record<string, { imap_host: string; imap_port: string; smtp_host: string; smtp_port: string; provider: string }> = {
        'gmail.com': { imap_host: 'imap.gmail.com', imap_port: '993', smtp_host: 'smtp.gmail.com', smtp_port: '587', provider: 'gmail' },
        'googlemail.com': { imap_host: 'imap.gmail.com', imap_port: '993', smtp_host: 'smtp.gmail.com', smtp_port: '587', provider: 'gmail' },
        'outlook.com': { imap_host: 'outlook.office365.com', imap_port: '993', smtp_host: 'smtp.office365.com', smtp_port: '587', provider: 'microsoft' },
        'hotmail.com': { imap_host: 'outlook.office365.com', imap_port: '993', smtp_host: 'smtp.office365.com', smtp_port: '587', provider: 'microsoft' },
        'live.com': { imap_host: 'outlook.office365.com', imap_port: '993', smtp_host: 'smtp.office365.com', smtp_port: '587', provider: 'microsoft' },
        'yahoo.com': { imap_host: 'imap.mail.yahoo.com', imap_port: '993', smtp_host: 'smtp.mail.yahoo.com', smtp_port: '587', provider: 'imap' },
      };
      // Check exact domain match first, then try Google Workspace (default to Gmail settings for custom domains)
      const preset = presets[domain] || { imap_host: 'imap.gmail.com', imap_port: '993', smtp_host: 'smtp.gmail.com', smtp_port: '587', provider: 'gmail' };
      credentials = { ...credentials, ...preset };
    }

    setConnecting(true);
    setFormError('');
    try {
      const token = await getAccessToken();
      const res = await fetch(`${PROXY_URL}/api/proxy/accounts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          channel: connectChannel,
          display_name: formData[config.fields[0]?.key] || connectChannel,
          credentials,
          host_id: selectedHostId || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error || `Connection failed (${res.status})`);
        setConnecting(false);
        return;
      }

      toast.success(`${config.label} connected`);
      setConnectOpen(false);
      setConnectChannel(null);
      loadAccounts();
    } catch (err) {
      setFormError('Network error — please try again');
    }
    setConnecting(false);
  }

  // ─── Disconnect Flow ─────────────────────────────
  async function handleDisconnect() {
    if (!disconnectTarget) return;
    setDisconnecting(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${PROXY_URL}/api/proxy/accounts/${disconnectTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok || res.status === 204) {
        toast.success(`${channelDisplayName(disconnectTarget.channel)} disconnected`);
        loadAccounts();
      } else {
        toast.error('Failed to disconnect channel');
      }
    } catch {
      toast.error('Network error');
    }
    setDisconnecting(false);
    setDisconnectTarget(null);
  }

  // ─── Helpers ──────────────────────────────────────
  function togglePassword(key: string) {
    setShowPasswords(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function getWebhookUrl(account: ChannelAccount): string {
    return `${PROXY_URL}/api/webhooks/${account.channel}/${account.company_id}`;
  }

  function copyWebhookUrl(account: ChannelAccount) {
    navigator.clipboard.writeText(getWebhookUrl(account));
    toast.success('Webhook URL copied');
  }

  function getStatusBadge(account: ChannelAccount) {
    // Email: credentials stored = connected (no webhook to wait for)
    if (account.channel === 'email' || account.last_webhook_at) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
          <CheckCircle2 size={10} /> Connected
        </span>
      );
    }
    // WhatsApp/Instagram/LINE: waiting for first webhook from the channel platform
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full animate-pulse">
        <AlertCircle size={10} /> Awaiting webhook
      </span>
    );
  }

  // ─── Render ───────────────────────────────────────
  return (
    <div className="max-w-xl mx-auto animate-in fade-in">
      <h2 className="text-lg font-bold text-slate-800 mb-1">Messaging Channels</h2>
      <p className="text-sm text-slate-500 mb-6">
        Connect WhatsApp, Instagram, LINE, or Email to receive and send messages.
      </p>

      {/* Company selector */}
      {companyIds.length > 1 && (
        <div className="mb-6">
          <label className="text-xs font-medium text-slate-500 mb-1 block">Company</label>
          <select
            value={selectedCompanyId}
            onChange={e => setSelectedCompanyId(e.target.value)}
            className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {companyIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </div>
      )}

      {/* Connected channels list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="space-y-3 mb-6">
          {accounts.length === 0 && (
            <div className="text-center py-8 text-slate-400">
              <Phone size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No channels connected yet</p>
            </div>
          )}

          {accounts.map(account => {
            const config = CHANNEL_CONFIGS[account.channel as ChannelType];
            const Icon = config?.icon ?? Phone;
            return (
              <div key={account.id} className="border border-slate-200 rounded-lg p-4 bg-white">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg bg-${config?.color ?? 'slate'}-50 flex items-center justify-center`}>
                      <Icon size={16} className={`text-${config?.color ?? 'slate'}-600`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">
                          {channelDisplayName(account.channel)}
                        </span>
                        {getStatusBadge(account)}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{account.display_name}</p>
                      <div className="mt-0.5">
                        <select
                          value={channelHostMap[account.id] || ''}
                          onChange={e => updateHostMapping(account.id, e.target.value)}
                          className={`text-[10px] border-0 bg-transparent p-0 pr-4 outline-none cursor-pointer ${
                            channelHostMap[account.id] ? 'text-slate-500' : 'text-amber-500'
                          }`}
                        >
                          <option value="">Select host...</option>
                          {MOCK_HOSTS.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setDisconnectTarget(account)}
                    className="text-xs text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1"
                  >
                    <Trash2 size={12} /> Disconnect
                  </button>
                </div>

                {/* Webhook URL — only for channels that need webhook config (not email) */}
                {account.channel !== 'email' && (
                  <div className="mt-3 p-2.5 bg-slate-50 rounded-md flex items-center gap-2">
                    <code className="text-[10px] text-slate-500 flex-1 truncate font-mono">
                      {getWebhookUrl(account)}
                    </code>
                    <button
                      onClick={() => copyWebhookUrl(account)}
                      className="text-slate-400 hover:text-slate-600 transition-colors shrink-0"
                      title="Copy webhook URL"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                )}
                {!account.last_webhook_at && account.channel !== 'email' && (
                  <p className="text-[10px] text-amber-600 mt-1.5 flex items-center gap-1">
                    <AlertCircle size={10} />
                    Configure this URL in your {channelDisplayName(account.channel)} developer dashboard to complete setup.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Connect button */}
      <button
        onClick={() => { setConnectChannel(null); setConnectOpen(true); }}
        className="w-full py-2.5 rounded-lg border-2 border-dashed border-slate-200 text-sm font-medium text-slate-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all flex items-center justify-center gap-2"
      >
        <Plus size={16} /> Connect Channel
      </button>

      {/* Advanced email-sync cron settings */}
      {accounts.some(a => a.channel === 'email') && (
        <div className="mt-6">
          <EmailSyncAdvanced />
        </div>
      )}

      {/* ─── Connect Dialog ────────────────────────── */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {connectChannel ? `Connect ${CHANNEL_CONFIGS[connectChannel]?.label}` : 'Choose Channel'}
            </DialogTitle>
          </DialogHeader>

          {/* Channel picker */}
          {!connectChannel && (
            <div className="grid grid-cols-2 gap-3 py-2">
              {(Object.entries(CHANNEL_CONFIGS) as [ChannelType, ChannelConfig][]).map(([key, config]) => {
                const count = accounts.filter(a => a.channel === key).length;
                return (
                  <button
                    key={key}
                    onClick={() => openConnectDialog(key)}
                    className="p-4 rounded-lg border text-left transition-all border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30"
                  >
                    <config.icon size={20} className="mb-2 text-slate-600" />
                    <p className="text-sm font-semibold">{config.label}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {count > 0
                        ? `${count} connected · add another`
                        : key === 'email' ? 'OAuth flow' : `${config.fields.length} fields`}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Credential form */}
          {connectChannel && (
            <div className="space-y-4 py-2">
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  {formError}
                </div>
              )}

              {/* LINE-specific inline setup guide */}
              {connectChannel === 'line' && <LineSetupGuide />}

              {CHANNEL_CONFIGS[connectChannel].fields.map(field => (
                <div key={field.key}>
                  <div className="flex items-center gap-1 mb-1">
                    <label className="text-xs font-medium text-slate-600">{field.label}</label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="text-slate-300 hover:text-slate-500">
                          <HelpCircle size={12} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[250px] text-xs">
                        {field.help}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="relative">
                    <input
                      type={field.type === 'password' && !showPasswords.has(field.key) ? 'password' : 'text'}
                      value={formData[field.key] || ''}
                      onChange={e => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.help.split('·')[0]?.split('→')[0]?.trim() || field.label}
                      className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 transition-all placeholder:text-slate-400 pr-8"
                    />
                    {field.type === 'password' && (
                      <button
                        type="button"
                        onClick={() => togglePassword(field.key)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showPasswords.has(field.key) ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Map to BPO Host */}
              <div className="pt-2">
                <label className="text-xs font-medium text-slate-600 mb-1 block">Map to BPO Host</label>
                <select
                  value={selectedHostId}
                  onChange={e => setSelectedHostId(e.target.value)}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {MOCK_HOSTS.map(h => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">Messages from this channel will appear under this host in the inbox.</p>
              </div>

              <div className="flex items-center justify-between pt-2">
                {connectChannel !== 'line' ? (
                  <a
                    href={CHANNEL_CONFIGS[connectChannel].docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1"
                  >
                    <ExternalLink size={10} /> View setup docs
                  </a>
                ) : <span />}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setConnectChannel(null); setFormError(''); }}
                    className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConnect}
                    disabled={connecting}
                    className="px-4 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {connecting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                    Connect {CHANNEL_CONFIGS[connectChannel].label}
                  </button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Disconnect Confirmation ──────────────── */}
      <AlertDialog open={!!disconnectTarget} onOpenChange={open => !open && setDisconnectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {disconnectTarget ? channelDisplayName(disconnectTarget.channel) : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately stop all incoming messages on this channel for this company. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {disconnecting ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
