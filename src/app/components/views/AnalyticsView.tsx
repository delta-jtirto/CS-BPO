import { useState, useMemo } from 'react';
import {
  BarChart3, TrendingUp, Clock, CheckCircle, Users, Zap,
  MessageSquare, Globe, Phone, ArrowUpRight, ArrowDownRight,
  Briefcase, Bot, Shield, ChevronDown
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend
} from 'recharts';
import { useAppContext } from '../../context/AppContext';
import { useIsMobile } from '../ui/use-mobile';
import { MOCK_HOSTS, MOCK_PROPERTIES } from '../../data/mock-data';

// ---------- Mock historical data (simulated 14-day window) ----------

const DAILY_VOLUME = [
  { day: 'Feb 28', tickets: 8, resolved: 7, aiResolved: 5 },
  { day: 'Mar 1', tickets: 12, resolved: 11, aiResolved: 8 },
  { day: 'Mar 2', tickets: 6, resolved: 6, aiResolved: 4 },
  { day: 'Mar 3', tickets: 15, resolved: 14, aiResolved: 10 },
  { day: 'Mar 4', tickets: 9, resolved: 8, aiResolved: 6 },
  { day: 'Mar 5', tickets: 11, resolved: 10, aiResolved: 7 },
  { day: 'Mar 6', tickets: 18, resolved: 16, aiResolved: 12 },
  { day: 'Mar 7', tickets: 14, resolved: 13, aiResolved: 9 },
  { day: 'Mar 8', tickets: 10, resolved: 9, aiResolved: 7 },
  { day: 'Mar 9', tickets: 7, resolved: 7, aiResolved: 5 },
  { day: 'Mar 10', tickets: 13, resolved: 11, aiResolved: 8 },
  { day: 'Mar 11', tickets: 16, resolved: 14, aiResolved: 11 },
  { day: 'Mar 12', tickets: 11, resolved: 9, aiResolved: 6 },
  { day: 'Mar 13', tickets: 6, resolved: 2, aiResolved: 1 },
];

const CHANNEL_DATA = [
  { name: 'Airbnb', value: 42, color: '#FF5A5F' },
  { name: 'Booking.com', value: 28, color: '#003580' },
  { name: 'Phone', value: 15, color: '#6366f1' },
  { name: 'WhatsApp', value: 10, color: '#25D366' },
  { name: 'Email', value: 5, color: '#94a3b8' },
];

const INQUIRY_TYPE_DATA = [
  { type: 'Check-in/out', name: 'Check-in/out', count: 34, color: '#6366f1' },
  { type: 'Maintenance', name: 'Maintenance', count: 28, color: '#ef4444' },
  { type: 'Wi-Fi/Tech', name: 'Wi-Fi/Tech', count: 22, color: '#3b82f6' },
  { type: 'Noise', name: 'Noise', count: 15, color: '#f59e0b' },
  { type: 'Logistics', name: 'Logistics', count: 12, color: '#8b5cf6' },
  { type: 'Billing', name: 'Billing', count: 8, color: '#10b981' },
  { type: 'Directions', name: 'Directions', count: 6, color: '#14b8a6' },
  { type: 'General', name: 'General', count: 5, color: '#94a3b8' },
];

const HOST_METRICS = [
  {
    hostId: 'h1',
    name: 'Delta Luxe Management',
    totalTickets: 58,
    resolved: 52,
    avgResponseMin: 8.2,
    slaCompliance: 94,
    csat: 4.7,
    trend: 'up' as const,
    trendDelta: 3,
    aiResolutionRate: 68,
  },
  {
    hostId: 'h2',
    name: 'Urban Stays Co.',
    totalTickets: 98,
    resolved: 87,
    avgResponseMin: 12.4,
    slaCompliance: 88,
    csat: 4.4,
    trend: 'down' as const,
    trendDelta: -2,
    aiResolutionRate: 62,
  },
];

const RESOLUTION_FUNNEL = [
  { stage: 'AI Auto-resolved', count: 89, pct: 57 },
  { stage: 'Agent Resolved', count: 50, pct: 32 },
  { stage: 'Escalated to Host', count: 11, pct: 7 },
  { stage: 'Still Open', count: 6, pct: 4 },
];

const RECENT_ACTIVITY = [
  { id: 1, action: 'Resolved ticket', detail: 'Elena Rodriguez — AC repair confirmed', time: '14 min ago', type: 'resolve' as const },
  { id: 2, action: 'AI auto-resolved', detail: 'Guest asked about Wi-Fi password (Villa Azure)', time: '22 min ago', type: 'ai' as const },
  { id: 3, action: 'Task dispatched', detail: 'Mid-stay cleaning — Shinjuku Lofts 402', time: '45 min ago', type: 'task' as const },
  { id: 4, action: 'Knowledge base updated', detail: 'Villa Azure check-in procedure edited via form', time: '1 hr ago', type: 'kb' as const },
  { id: 5, action: 'Ticket escalated', detail: 'Noise complaint — Yuki Tanaka (Shinjuku Lofts)', time: '2 hr ago', type: 'escalate' as const },
  { id: 6, action: 'AI auto-resolved', detail: 'Parking question — Booking.com guest', time: '3 hr ago', type: 'ai' as const },
];

// ---------- Component ----------

type TimeRange = '7d' | '14d' | '30d';

export function AnalyticsView() {
  const { tickets, tasks, kbEntries, activeHostFilter } = useAppContext();
  const isMobile = useIsMobile();
  const [timeRange, setTimeRange] = useState<TimeRange>('14d');

  // Live counts derived from context
  const openTickets = tickets.length;
  const pendingTasks = tasks.filter(t => t.status === 'pending').length;
  const dispatchedTasks = tasks.filter(t => t.status === 'dispatched').length;
  const totalKB = kbEntries.length;

  const volumeData = useMemo(() => {
    if (timeRange === '7d') return DAILY_VOLUME.slice(-7);
    if (timeRange === '14d') return DAILY_VOLUME;
    // 30d — pad with extra simulated days
    const extra = Array.from({ length: 16 }, (_, i) => ({
      day: `Feb ${12 + i}`,
      tickets: Math.floor(Math.random() * 12) + 4,
      resolved: Math.floor(Math.random() * 10) + 3,
      aiResolved: Math.floor(Math.random() * 7) + 2,
    }));
    return [...extra, ...DAILY_VOLUME];
  }, [timeRange]);

  const totalResolved = DAILY_VOLUME.reduce((s, d) => s + d.resolved, 0);
  const totalTicketsHist = DAILY_VOLUME.reduce((s, d) => s + d.tickets, 0);
  const totalAI = DAILY_VOLUME.reduce((s, d) => s + d.aiResolved, 0);

  return (
    <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden animate-in fade-in duration-200">
      {/* Header */}
      <div className="h-14 md:h-16 bg-white border-b border-slate-200 px-3 md:px-6 flex items-center justify-between shrink-0 shadow-sm">
        <h1 className={`${isMobile ? 'text-base' : 'text-xl'} font-bold flex items-center gap-2`}>
          <BarChart3 size={isMobile ? 16 : 20} className="text-slate-500" /> Analytics
        </h1>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            {(['7d', '14d', '30d'] as TimeRange[]).map(r => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-2 md:px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                  timeRange === r ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {r === '7d' ? '7D' : r === '14d' ? '14D' : '30D'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-4 md:space-y-6">

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            label="Open Tickets"
            value={openTickets}
            icon={<MessageSquare size={16} />}
            color="indigo"
            sub={`${totalResolved} resolved this period`}
            trend={{ direction: 'down', value: 12, good: true }}
          />
          <KPICard
            label="Avg Response"
            value="10.3 min"
            icon={<Clock size={16} />}
            color="blue"
            sub="First reply time"
            trend={{ direction: 'down', value: 8, good: true }}
          />
          <KPICard
            label="SLA Compliance"
            value="91%"
            icon={<Shield size={16} />}
            color="emerald"
            sub={`${totalTicketsHist} total tickets`}
            trend={{ direction: 'up', value: 3, good: true }}
          />
          <KPICard
            label="AI Resolution"
            value={`${Math.round((totalAI / totalTicketsHist) * 100)}%`}
            icon={<Bot size={16} />}
            color="purple"
            sub={`${totalAI} of ${totalTicketsHist} auto-resolved`}
            trend={{ direction: 'up', value: 5, good: true }}
          />
        </div>

        {/* Charts Row 1: Volume + Channel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Ticket Volume */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <TrendingUp size={14} className="text-indigo-500" /> Ticket Volume
              </h2>
              {!isMobile && (
                <div className="flex items-center gap-4 text-[10px] font-bold">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-400" /> Total</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Resolved</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" /> AI Auto</span>
                </div>
              )}
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={volumeData}>
                <defs>
                  <linearGradient id="gradTickets" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Area type="monotone" dataKey="tickets" stroke="#818cf8" fill="url(#gradTickets)" strokeWidth={2} />
                <Area type="monotone" dataKey="resolved" stroke="#34d399" fill="url(#gradResolved)" strokeWidth={2} />
                <Area type="monotone" dataKey="aiResolved" stroke="#a78bfa" fill="none" strokeWidth={2} strokeDasharray="4 4" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Channel Distribution */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4">
              <Globe size={14} className="text-blue-500" /> Channel Mix
            </h2>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={CHANNEL_DATA}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={72}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {CHANNEL_DATA.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(value: number) => [`${value}%`, 'Share']}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {CHANNEL_DATA.map(c => (
                <span key={c.name} className="flex items-center gap-1.5 text-[10px] text-slate-600 font-medium">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                  {c.name} ({c.value}%)
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Charts Row 2: Inquiry Types + Resolution Funnel */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Inquiry Types */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4">
              <Zap size={14} className="text-amber-500" /> Inquiry Types
            </h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={INQUIRY_TYPE_DATA} layout="vertical" barSize={16}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis dataKey="type" type="category" tick={{ fontSize: 10, fill: '#64748b' }} width={90} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {INQUIRY_TYPE_DATA.map((entry) => (
                    <Cell key={entry.type} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Resolution Funnel */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4">
              <CheckCircle size={14} className="text-emerald-500" /> Resolution Breakdown
            </h2>
            <div className="space-y-3 mt-2">
              {RESOLUTION_FUNNEL.map((stage, i) => (
                <div key={stage.stage}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-600">{stage.stage}</span>
                    <span className="text-xs font-bold text-slate-800">{stage.count} <span className="text-slate-400 font-normal">({stage.pct}%)</span></span>
                  </div>
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        i === 0 ? 'bg-emerald-500' : i === 1 ? 'bg-indigo-500' : i === 2 ? 'bg-amber-500' : 'bg-slate-400'
                      }`}
                      style={{ width: `${stage.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
              <div className="flex items-center gap-2">
                <Bot size={14} className="text-emerald-600" />
                <span className="text-xs font-bold text-emerald-800">57% AI auto-resolution rate</span>
              </div>
              <p className="text-[11px] text-emerald-700 mt-1">
                Up from 49% last period. Knowledge Base coverage improvements drove +8pt gain.
              </p>
            </div>
          </div>
        </div>

        {/* Row 3: Per-Host Performance + Activity Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Host Performance Cards */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <Briefcase size={14} className="text-slate-500" /> Per-Client Performance
            </h2>
            {HOST_METRICS.map(host => {
              const hostData = MOCK_HOSTS.find(h => h.id === host.hostId);
              const propCount = MOCK_PROPERTIES.filter(p => p.hostId === host.hostId).length;
              return (
                <div key={host.hostId} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-2 h-2 rounded-full ${hostData?.brandColor || 'bg-slate-400'}`} />
                        <span className="text-sm font-bold text-slate-800">{host.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium">{propCount} properties &bull; {hostData?.tone}</span>
                    </div>
                    <div className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg ${
                      host.trend === 'up' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                    }`}>
                      {host.trend === 'up' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                      {Math.abs(host.trendDelta)}% vs last period
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <MetricCell label="Total Tickets" value={host.totalTickets} />
                    <MetricCell label="Resolved" value={host.resolved} accent="emerald" />
                    <MetricCell label="Avg Response" value={`${host.avgResponseMin}m`} />
                    <MetricCell label="SLA Compliance" value={`${host.slaCompliance}%`} accent={host.slaCompliance >= 90 ? 'emerald' : 'amber'} />
                    <MetricCell label="AI Resolution" value={`${host.aiResolutionRate}%`} accent="purple" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Activity Feed */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4">
              <Clock size={14} className="text-slate-500" /> Recent Activity
            </h2>
            <div className="space-y-0">
              {RECENT_ACTIVITY.map((item, i) => (
                <div key={item.id} className="flex gap-3 py-3 border-b border-slate-100 last:border-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    item.type === 'resolve' ? 'bg-emerald-100 text-emerald-600' :
                    item.type === 'ai' ? 'bg-purple-100 text-purple-600' :
                    item.type === 'task' ? 'bg-blue-100 text-blue-600' :
                    item.type === 'kb' ? 'bg-indigo-100 text-indigo-600' :
                    'bg-amber-100 text-amber-600'
                  }`}>
                    {item.type === 'resolve' ? <CheckCircle size={12} /> :
                     item.type === 'ai' ? <Bot size={12} /> :
                     item.type === 'task' ? <Zap size={12} /> :
                     item.type === 'kb' ? <TrendingUp size={12} /> :
                     <ArrowUpRight size={12} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-700">{item.action}</p>
                    <p className="text-[11px] text-slate-500 truncate">{item.detail}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom: Live Operations Summary */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4">
            <Users size={14} className="text-indigo-500" /> Live Operations Snapshot
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-indigo-50 rounded-xl border border-indigo-100">
              <div className="text-2xl font-bold text-indigo-700">{openTickets}</div>
              <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mt-1">Open Tickets</div>
            </div>
            <div className="text-center p-4 bg-amber-50 rounded-xl border border-amber-100">
              <div className="text-2xl font-bold text-amber-700">{pendingTasks}</div>
              <div className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mt-1">Pending Tasks</div>
            </div>
            <div className="text-center p-4 bg-blue-50 rounded-xl border border-blue-100">
              <div className="text-2xl font-bold text-blue-700">{dispatchedTasks}</div>
              <div className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mt-1">Dispatched</div>
            </div>
            <div className="text-center p-4 bg-emerald-50 rounded-xl border border-emerald-100">
              <div className="text-2xl font-bold text-emerald-700">{totalKB}</div>
              <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider mt-1">Articles</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Sub-components ----------

interface KPICardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'indigo' | 'blue' | 'emerald' | 'purple';
  sub: string;
  trend?: { direction: 'up' | 'down'; value: number; good: boolean };
}

const COLOR_MAP = {
  indigo: { bg: 'bg-indigo-50', border: 'border-indigo-100', icon: 'bg-indigo-100 text-indigo-600', value: 'text-indigo-700' },
  blue: { bg: 'bg-blue-50', border: 'border-blue-100', icon: 'bg-blue-100 text-blue-600', value: 'text-blue-700' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-100', icon: 'bg-emerald-100 text-emerald-600', value: 'text-emerald-700' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-100', icon: 'bg-purple-100 text-purple-600', value: 'text-purple-700' },
};

function KPICard({ label, value, icon, color, sub, trend }: KPICardProps) {
  const c = COLOR_MAP[color];
  return (
    <div className={`${c.bg} rounded-xl border ${c.border} p-4 shadow-sm`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${c.icon}`}>{icon}</div>
      </div>
      <div className={`text-2xl font-bold ${c.value}`}>{value}</div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-slate-500">{sub}</span>
        {trend && (
          <span className={`text-[10px] font-bold flex items-center gap-0.5 ${
            trend.good ? 'text-emerald-600' : 'text-red-600'
          }`}>
            {trend.direction === 'up' ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
            {trend.value}%
          </span>
        )}
      </div>
    </div>
  );
}

function MetricCell({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="text-center">
      <div className={`text-lg font-bold ${
        accent === 'emerald' ? 'text-emerald-600' :
        accent === 'amber' ? 'text-amber-600' :
        accent === 'purple' ? 'text-purple-600' :
        'text-slate-800'
      }`}>{value}</div>
      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{label}</div>
    </div>
  );
}