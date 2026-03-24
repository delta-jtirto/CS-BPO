import React, { useState } from 'react';
import { 
  Search, MessageSquare, AlertTriangle, Clock, Send, 
  User, Home, Settings, Sparkles, Zap, Wrench, 
  CheckCircle, Globe, ChevronRight, FileText, Phone, Mail,
  Upload, Plus, Filter, MoreVertical, MapPin, 
  Bell, Shield, Bot, Layout, CheckSquare, ArrowLeft,
  ChevronDown, Briefcase, Building, Key, List, LayoutGrid,
  Database, X, Code
} from 'lucide-react';

// --- BPO MULTI-TENANT MOCK DATA ---

const MOCK_HOSTS = [
  { id: 'h1', name: 'Delta Luxe Management', tone: 'Professional & High-End', brandColor: 'bg-purple-600' },
  { id: 'h2', name: 'Urban Stays Co.', tone: 'Casual & Friendly', brandColor: 'bg-emerald-600' },
];

const MOCK_PROPERTIES = [
  { id: 'p1', hostId: 'h1', name: 'Villa Azure', location: 'Bali, Indonesia', units: 1, status: 'Active' },
  { id: 'p2', hostId: 'h2', name: 'Shinjuku Lofts', location: 'Tokyo, Japan', units: 8, status: 'Active' },
  { id: 'p3', hostId: 'h2', name: 'Tahoe Cabins', location: 'California, USA', units: 4, status: 'Onboarding' },
];

const MOCK_TICKETS = [
  {
    id: 't-101', guestName: 'Elena Rodriguez', channel: 'Airbnb', channelIcon: MessageSquare, 
    host: MOCK_HOSTS[0], property: 'Villa Azure', room: 'Entire Villa', 
    status: 'urgent', sla: '03:12', aiHandoverReason: 'Maintenance Request (AC Broken)', 
    summary: 'Guest reports the AC in the master bedroom is blowing warm air.', 
    tags: ['Maintenance', 'High Priority'], language: 'English',
    messages: [
      { id: 1, sender: 'guest', text: 'Hi, we just got back to the villa and the AC in the main bedroom is broken.', time: '14:05' },
      { id: 2, sender: 'system', text: 'Handed to Agent — Maintenance requires vendor dispatch (outside AI capability). Please reply manually or dispatch repair vendor.', time: '14:10' },
    ],
    booking: { checkIn: 'Oct 12', checkOut: 'Oct 18', guests: 4, status: 'Checked In' }
  },
  {
    id: 't-102', guestName: 'Kenji Sato', channel: 'Booking.com', channelIcon: Globe, 
    host: MOCK_HOSTS[1], property: 'Shinjuku Lofts', room: 'Room 402', 
    status: 'warning', sla: '11:45', aiHandoverReason: 'Complex Inquiry (Luggage)', 
    summary: 'Guest wants to drop bags early at 10 AM, but check-in is 3 PM.', 
    tags: ['Logistics', 'Needs Approval'], language: 'Japanese (Auto-translated)',
    messages: [
      { id: 1, sender: 'guest', text: '(Translated) Hello, our flight arrives very early tomorrow. Can we drop our luggage at 10:00 AM?', time: '13:50' },
      { id: 2, sender: 'system', text: 'Handed to Agent — Not in knowledge base: Luggage / Storage. Please coordinate with cleaning vendor and reply manually.', time: '13:51' },
    ],
    booking: { checkIn: 'Tomorrow', checkOut: 'Oct 16', guests: 2, status: 'Upcoming' }
  }
];

const MOCK_KB = [
  { id: 1, hostId: 'h1', propId: 'p1', roomId: null, scope: 'Property', title: 'AC Repair Vendor', content: 'Contact "Bali Breeze HVAC" at +62 812-3456-7890. Tell them it\'s a Delta Luxe property. Max SLA 2 hours.' },
  { id: 2, hostId: 'h1', propId: 'p1', roomId: null, scope: 'Property', title: 'Breaker Location', content: 'Main breaker panel is in the laundry room behind the kitchen door.' },
  { id: 3, hostId: 'h2', propId: null, roomId: null, scope: 'Host Global', title: 'Luggage Drop-off Policy', content: 'For all Urban Stays properties: Early luggage drop-off is strictly prohibited. Direct guests to local coin lockers.' },
  { id: 4, hostId: 'h2', propId: 'p2', roomId: '402', scope: 'Room', title: 'Room 402 Wi-Fi', content: 'Network: Shinjuku_402_5G | Password: urbanstays_tokyo' },
];

const INITIAL_TASKS = [
  { id: 'tsk-1', title: 'Fix AC in Master BR', host: 'Delta Luxe', prop: 'Villa Azure', vendor: 'Bali Breeze HVAC', status: 'dispatched', due: 'Today, 18:00' },
  { id: 'tsk-2', title: 'Mid-stay Cleaning', host: 'Urban Stays', prop: 'Shinjuku Lofts - 402', vendor: 'Tokyo Clean Co', status: 'pending', due: 'Tomorrow, 11:00' },
];


// --- COMPONENTS ---

// 1. INBOX VIEW
function InboxView({ activeHost, activeTicketId, setActiveTicketId }) {
  // Filter tickets by active host
  const filteredTickets = activeHost === 'all' ? MOCK_TICKETS : MOCK_TICKETS.filter(t => t.host.id === activeHost);
  const activeTicket = filteredTickets.find(t => t.id === activeTicketId) || filteredTickets[0] || MOCK_TICKETS[0];
  
  const [replyText, setReplyText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [kbSearch, setKbSearch] = useState('');
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);

  // Filter KB based on current ticket hierarchy
  const activeKbData = MOCK_KB.filter(kb => 
    (kb.hostId === activeTicket.host.id && (!kb.propId || kb.propId === MOCK_PROPERTIES.find(p => p.name === activeTicket.property)?.id)) &&
    (kb.title.toLowerCase().includes(kbSearch.toLowerCase()) || kb.content.toLowerCase().includes(kbSearch.toLowerCase()))
  );

  const generateAIDraft = () => {
    setIsGeneratingDraft(true);
    setTimeout(() => {
      setReplyText(`Hi ${activeTicket.guestName.split(' ')[0]}, looking into this for you right now at ${activeTicket.property}. I will update you shortly!`);
      setIsGeneratingDraft(false);
    }, 800);
  };

  if (!activeTicket) return <div className="flex-1 flex items-center justify-center">No active tickets for this client.</div>;

  return (
    <div className="flex h-full w-full overflow-hidden animate-in fade-in duration-200">
      
      {/* Inbox List Pane */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800 flex items-center justify-between">
            Inbox
            <span className="bg-slate-200 text-slate-600 text-xs px-2 py-1 rounded-full">{filteredTickets.length}</span>
          </h2>
        </div>
        <div className="overflow-y-auto flex-1">
          {filteredTickets.map(ticket => (
            <div 
              key={ticket.id}
              onClick={() => { setActiveTicketId(ticket.id); setReplyText(''); }}
              className={`p-4 border-b border-slate-100 cursor-pointer transition-colors relative ${activeTicket.id === ticket.id ? 'bg-indigo-50 border-l-4 border-l-indigo-600' : 'hover:bg-slate-50 border-l-4 border-l-transparent'}`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="font-semibold text-sm truncate">{ticket.guestName}</span>
                <span className={`text-xs font-bold flex items-center gap-1 ${
                  ticket.status === 'urgent' ? 'text-red-600' : ticket.status === 'warning' ? 'text-amber-600' : 'text-slate-500'
                }`}><Clock size={12} /> {ticket.sla}</span>
              </div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Briefcase size={10} /> {ticket.host.name}
              </div>
              <div className="text-xs text-slate-500 mb-2 flex items-center gap-1"><ticket.channelIcon size={12} /> {ticket.property} • {ticket.room}</div>
              <div className="text-xs text-slate-600 line-clamp-2 leading-snug bg-white p-1.5 rounded border border-slate-100 shadow-sm"><span className="font-medium text-indigo-600">AI:</span> {ticket.aiHandoverReason}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Pane */}
      <div className="flex-1 flex flex-col bg-slate-50 min-w-0">
        <div className="h-20 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-sm z-10">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              <span className="flex items-center gap-1"><Briefcase size={12}/> {activeTicket.host.name}</span>
              <ChevronRight size={10}/>
              <span className="flex items-center gap-1"><Building size={12}/> {activeTicket.property}</span>
              <ChevronRight size={10}/>
              <span className="flex items-center gap-1"><Key size={12}/> {activeTicket.room}</span>
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold truncate text-slate-800">{activeTicket.guestName}</h1>
              <span className="bg-slate-100 text-slate-600 text-[10px] px-2 py-0.5 rounded-md border border-slate-200 flex items-center gap-1">
                <activeTicket.channelIcon size={10}/> {activeTicket.channel}
              </span>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button className="px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-2 shadow-sm transition-colors"><CheckCircle size={14} /> Resolve</button>
          </div>
        </div>

        <div className="bg-indigo-50/50 border-b border-indigo-100 p-4 shrink-0">
          <div className="flex items-start gap-3">
            <div className="bg-indigo-100 p-2 rounded-full text-indigo-600 mt-0.5"><Sparkles size={16} /></div>
            <div>
              <h3 className="text-xs font-bold text-indigo-800 uppercase tracking-wider mb-1">AI Context Summary</h3>
              <p className="text-sm text-indigo-900 leading-relaxed">{activeTicket.summary}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          {activeTicket.messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col max-w-[80%] ${msg.sender === 'guest' ? 'self-start' : msg.sender === 'system' ? 'self-center items-center my-2' : 'self-end'}`}>
              {msg.sender === 'system' ? (
                <div className="bg-slate-200 text-slate-600 text-xs px-4 py-1.5 rounded-full flex items-center gap-2 shadow-sm"><AlertTriangle size={12} className="text-amber-500" />{msg.text}</div>
              ) : (
                <>
                  <span className={`text-[10px] text-slate-400 mb-1 px-1 ${msg.sender === 'guest' ? 'text-left' : 'text-right'}`}>{msg.sender === 'guest' ? activeTicket.guestName : 'Delta AI'} • {msg.time}</span>
                  <div className={`p-3 rounded-2xl shadow-sm text-sm ${msg.sender === 'guest' ? 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm' : 'bg-slate-800 text-white rounded-tr-sm'}`}>{msg.text}</div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 bg-white border-t border-slate-200 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-medium text-slate-500 flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded">
                <Briefcase size={12} className="text-slate-400"/> Replying as: <strong className="text-slate-700">{activeTicket.host.name}</strong>
              </span>
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Tone: {activeTicket.host.tone}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={generateAIDraft} disabled={isGeneratingDraft} className="text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded hover:bg-indigo-100 flex items-center gap-1.5 transition-colors">
                {isGeneratingDraft ? <span className="animate-pulse">Generating...</span> : <><Sparkles size={14} /> AI Draft Reply</>}
              </button>
            </div>
          </div>
          <div className="relative">
            <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder={`Draft your reply to ${activeTicket.guestName.split(' ')[0]}...`} className="w-full border border-slate-300 rounded-lg p-3 pr-12 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none min-h-[100px] bg-slate-50/50"></textarea>
            <button className="absolute bottom-3 right-3 bg-indigo-600 text-white p-2 rounded-md hover:bg-indigo-700 shadow-sm transition-transform active:scale-95"><Send size={16} /></button>
          </div>
        </div>
      </div>

      {/* Right Context Pane */}
      <div className="w-80 bg-white border-l border-slate-200 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2"><User size={14} /> Guest & Booking</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><span className="block text-[10px] text-slate-400 mb-0.5">Check-in</span><span className="text-sm font-medium">{activeTicket.booking.checkIn}</span></div>
            <div><span className="block text-[10px] text-slate-400 mb-0.5">Check-out</span><span className="text-sm font-medium">{activeTicket.booking.checkOut}</span></div>
          </div>
        </div>
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex-1">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Bot size={14} /> AI Knowledge Base</h3>
          <div className="relative mb-4">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input type="text" placeholder="Search rules for this unit..." value={kbSearch} onChange={(e) => setKbSearch(e.target.value)} className="w-full border border-slate-200 rounded-md py-2 pl-9 pr-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none" />
          </div>
          <div className="space-y-3">
            {activeKbData.length > 0 ? activeKbData.map(kb => (
              <div key={kb.id} className="bg-white border border-slate-200 rounded-md p-3 shadow-sm hover:border-indigo-300 transition-colors cursor-pointer group">
                <div className="flex justify-between items-start mb-1">
                  <h4 className="text-xs font-bold text-slate-700 group-hover:text-indigo-700 transition-colors">{kb.title}</h4>
                  <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${kb.scope === 'Host Global' ? 'bg-purple-100 text-purple-700' : kb.scope === 'Property' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{kb.scope}</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed mt-1">{kb.content}</p>
                <button className="mt-2 text-[10px] font-medium text-indigo-600 flex items-center gap-1 hover:underline">Insert <ChevronRight size={10} /></button>
              </div>
            )) : <div className="text-xs text-slate-500 text-center py-4">No rules found for this scope.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// 2. KNOWLEDGE BASE & CRM VIEW
function KnowledgeBaseView({ activeHost }) {
  const [selectedPropertyId, setSelectedPropertyId] = useState(null);
  const [showToonViewer, setShowToonViewer] = useState(false);
  
  const displayHosts = activeHost === 'all' ? MOCK_HOSTS : MOCK_HOSTS.filter(h => h.id === activeHost);

  // Helper to dynamically encode JS objects into TOON tabular format arrays
  const formatAsToon = (data, arrayName = 'data') => {
    if (!data || data.length === 0) return `${arrayName}[0]:`;
    const keys = Object.keys(data[0]);
    const header = `${arrayName}[${data.length}]{${keys.join(',')}}:`;
    const rows = data.map(item => {
      return keys.map(k => {
        let val = item[k];
        if (val === null || val === undefined) return 'null';
        val = String(val);
        // TOON Quoting Rule: quote if contains comma, quote, or newline
        if (/[,"\n\r]/.test(val)) {
          val = `"${val.replace(/"/g, '\\"')}"`;
        }
        return val;
      }).join(',');
    }).join('\n  ');
    return `${header}\n  ${rows}`;
  };

  if (selectedPropertyId) {
    const prop = MOCK_PROPERTIES.find(p => p.id === selectedPropertyId);
    const rules = MOCK_KB.filter(kb => kb.propId === prop.id || (kb.hostId === prop.hostId && kb.scope === 'Host Global'));
    
    return (
      <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden animate-in slide-in-from-right-8 duration-300 relative">
        {/* Modal Overlay for TOON Vector Viewer */}
        {showToonViewer && (
          <div className="absolute inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in">
            <div className="bg-slate-900 w-full max-w-4xl rounded-xl shadow-2xl flex flex-col overflow-hidden border border-slate-700">
              <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950">
                <div className="flex items-center gap-2 text-emerald-400">
                  <Code size={18} />
                  <h3 className="font-bold text-sm tracking-wide">Vector DB View (TOON Format)</h3>
                </div>
                <button onClick={() => setShowToonViewer(false)} className="text-slate-400 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-4 flex-1 overflow-y-auto bg-[#0d1117] text-slate-300">
                <div className="text-xs text-slate-500 mb-4 pb-4 border-b border-slate-800">
                  // Retrieved <b>{rules.length}</b> embeddings for Property: {prop.name}<br/>
                  // Format: Token-Oriented Object Notation (TOON)<br/>
                  // Purpose: Optimized, low-token injection into the LLM context window.
                </div>
                <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">
                  <span className="text-emerald-400">{formatAsToon(rules, 'rules')}</span>
                </pre>
              </div>
              <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-end">
                <button onClick={() => setShowToonViewer(false)} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700 transition-colors">Close Viewer</button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="h-20 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-sm z-10">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setSelectedPropertyId(null)}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-slate-800"
            >
              <ArrowLeft size={20} />
            </button>
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-inner ${prop.status === 'Active' ? 'bg-gradient-to-br from-indigo-500 to-indigo-700' : 'bg-gradient-to-br from-slate-400 to-slate-600'}`}>
              {prop.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                {prop.name}
                {prop.status === 'Active' ? 
                  <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide">Active</span> : 
                  <span className="bg-amber-100 text-amber-700 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide">Onboarding</span>
                }
              </h1>
              <p className="text-xs text-slate-500 flex items-center gap-3">
                <span className="flex items-center gap-1"><MapPin size={12}/> {prop.location}</span>
                <span className="flex items-center gap-1"><Home size={12}/> {prop.units} Units</span>
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowToonViewer(true)} className="px-3 py-2 text-sm font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 flex items-center gap-2 shadow-sm transition-colors border border-slate-200">
              <Database size={16} className="text-indigo-500"/> View Raw Vectors (TOON)
            </button>
            <button className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 flex items-center gap-2 shadow-sm transition-colors">
              <Settings size={16} /> Property Settings
            </button>
          </div>
        </div>

        {/* Details Content */}
        <div className="flex-1 overflow-y-auto p-8 flex gap-8 max-w-7xl mx-auto w-full">
          {/* Rules List */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Bot className="text-indigo-500" size={20} /> 
                Active AI Rules ({rules.length})
              </h2>
            </div>

            <div className="grid gap-4">
              {rules.length > 0 ? rules.map(rule => (
                <div key={rule.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-all group">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-800">{rule.title}</h3>
                      <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${rule.scope === 'Host Global' ? 'bg-purple-100 text-purple-700' : rule.scope === 'Property' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{rule.scope}</span>
                    </div>
                    <button className="text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"><MoreVertical size={16} /></button>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-3 rounded border border-slate-100">{rule.content}</p>
                </div>
              )) : (
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-xl p-12 text-center flex flex-col items-center justify-center text-slate-500">
                  <FileText size={48} className="text-slate-300 mb-4" />
                  <p className="font-bold text-slate-700">No specific rules found.</p>
                  <p className="text-sm mb-4">Upload a document to train the AI on this property.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden animate-in fade-in duration-200">
      <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-sm z-10">
        <h1 className="text-xl font-bold flex items-center gap-2"><Briefcase size={20} className="text-slate-500"/> Client Knowledge Base (CRM)</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          
          {/* Hierarchical Client List */}
          <div className="lg:col-span-2 space-y-6">
            {displayHosts.map(host => (
              <div key={host.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="bg-slate-900 p-4 flex items-center justify-between text-white">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded flex items-center justify-center font-bold ${host.brandColor}`}>
                      {host.name.charAt(0)}
                    </div>
                    <h2 className="font-bold text-lg">{host.name}</h2>
                  </div>
                  <button className="text-xs font-medium bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded transition-colors">Manage Global Rules</button>
                </div>
                
                <div className="p-4 space-y-2 bg-slate-50">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Properties ({MOCK_PROPERTIES.filter(p => p.hostId === host.id).length})</h3>
              {MOCK_PROPERTIES.filter(p => p.hostId === host.id).map(prop => (
                <div 
                  key={prop.id} 
                  onClick={() => setSelectedPropertyId(prop.id)}
                  className="bg-white border border-slate-200 rounded-lg p-3 hover:border-indigo-300 transition-colors cursor-pointer flex items-center justify-between group shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-100 rounded-md text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors"><Building size={16}/></div>
                        <div>
                          <p className="font-bold text-sm text-slate-800">{prop.name}</p>
                          <p className="text-[10px] text-slate-500">{prop.location} • {prop.units} Units</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xs font-medium text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-100">12 Rules</span>
                        <ChevronRight size={16} className="text-slate-300 group-hover:text-indigo-500"/>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Targeted Ingestion Widget */}
          <div className="lg:col-span-1">
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm sticky top-6">
              <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><Sparkles size={16} className="text-indigo-500"/> Targeted Data Ingestion</h3>
              <p className="text-xs text-slate-500 mb-6">Upload documents to update the AI's knowledge. Documents must be targeted to prevent cross-client contamination.</p>
              
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">1. Target Host Company <span className="text-red-500">*</span></label>
                  <select className="w-full text-sm border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 outline-none bg-slate-50">
                    <option value="">Select Host Company...</option>
                    {MOCK_HOSTS.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">2. Target Property (Optional)</label>
                  <select className="w-full text-sm border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 outline-none bg-slate-50">
                    <option value="">Apply to all properties (Global)</option>
                    {MOCK_PROPERTIES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="border-2 border-dashed border-indigo-200 bg-indigo-50/50 rounded-xl p-6 flex flex-col items-center justify-center text-center hover:bg-indigo-50 hover:border-indigo-400 transition-colors cursor-pointer group mb-4">
                <Upload size={24} className="text-indigo-500 mb-2 group-hover:scale-110 transition-transform" />
                <p className="text-sm font-bold text-slate-700">Upload Extracted Doc</p>
                <p className="text-[10px] text-slate-500 mt-1">XLSX, PDF, CSV</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// 3. TASKS VIEW
function TasksView({ activeHost }) {
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [viewMode, setViewMode] = useState('kanban'); // 'kanban' or 'table'

  const filteredTasks = activeHost === 'all' ? tasks : tasks.filter(t => MOCK_HOSTS.find(h => h.id === activeHost)?.name.includes(t.host.split(' ')[0]));

  const columns = [
    { id: 'pending', title: 'Pending Dispatch', color: 'bg-amber-100 text-amber-800 border-amber-200' },
    { id: 'dispatched', title: 'Vendor Dispatched', color: 'bg-blue-100 text-blue-800 border-blue-200' },
    { id: 'resolved', title: 'Resolved / Verify', color: 'bg-green-100 text-green-800 border-green-200' }
  ];

  const handleStatusChange = (taskId, newStatus) => setTasks(tasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t));

  return (
    <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden animate-in fade-in duration-200">
      <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-sm">
        <h1 className="text-xl font-bold flex items-center gap-2"><Wrench size={20} className="text-slate-500"/> BPO Dispatch Board</h1>
        <div className="flex gap-4 items-center">
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button onClick={() => setViewMode('kanban')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'kanban' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}><LayoutGrid size={16}/></button>
            <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}><List size={16}/></button>
          </div>
          <button className="px-3 py-1.5 text-sm font-medium bg-slate-900 text-white rounded hover:bg-slate-800 flex items-center gap-2 shadow-sm transition-colors"><Plus size={14} /> New Ticket</button>
        </div>
      </div>
      
      <div className="flex-1 p-6 overflow-hidden flex flex-col">
        {viewMode === 'kanban' ? (
          <div className="flex gap-6 h-full min-w-max overflow-x-auto">
            {columns.map(col => (
              <div key={col.id} className="w-80 flex flex-col h-full">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-700 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${col.color.split(' ')[0].replace('100', '500')}`}></span>
                    {col.title}
                  </h3>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${col.color} border`}>
                    {filteredTasks.filter(t => t.status === col.id).length}
                  </span>
                </div>
                
                <div className="flex-1 bg-slate-200/50 rounded-xl p-3 flex flex-col gap-3 overflow-y-auto border border-slate-200 border-dashed">
                  {filteredTasks.filter(t => t.status === col.id).map(task => (
                    <div key={task.id} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all group">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{task.id}</span>
                        <select 
                            value={task.status}
                            onChange={(e) => handleStatusChange(task.id, e.target.value)}
                            className={`text-[10px] font-bold px-2 py-1 rounded appearance-none cursor-pointer border outline-none ${
                              task.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                              task.status === 'dispatched' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                              'bg-green-50 text-green-700 border-green-200'
                            }`}
                          >
                            <option value="pending">Pending</option>
                            <option value="dispatched">Dispatched</option>
                            <option value="resolved">Resolved</option>
                        </select>
                      </div>
                      <h4 className="font-bold text-sm text-slate-800 mb-1 leading-tight">{task.title}</h4>
                      <div className="text-[10px] text-slate-500 space-y-1 mb-3">
                        <p className="flex items-center gap-1.5"><Briefcase size={10} className="text-slate-400"/> <strong>{task.host}</strong></p>
                        <p className="flex items-center gap-1.5"><Building size={10} className="text-slate-400"/> {task.prop}</p>
                      </div>
                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-600 font-medium bg-slate-50 px-2.5 py-1 rounded border border-slate-200">
                          <User size={10} className="text-slate-400"/> {task.vendor}
                        </div>
                        <span className="text-[10px] font-medium text-slate-500 flex items-center gap-1"><Clock size={10}/> {task.due}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex-1">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="p-4">Status</th>
                  <th className="p-4">ID / Task</th>
                  <th className="p-4">Host Company</th>
                  <th className="p-4">Property</th>
                  <th className="p-4">Assigned Vendor</th>
                  <th className="p-4">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTasks.map(task => (
                  <tr key={task.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4">
                      <span className={`text-[10px] font-bold px-2 py-1 rounded border ${
                        task.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        task.status === 'dispatched' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        'bg-green-50 text-green-700 border-green-200'
                      }`}>{task.status.toUpperCase()}</span>
                    </td>
                    <td className="p-4">
                      <div className="text-[10px] text-slate-400 font-bold mb-0.5">{task.id}</div>
                      <div className="font-bold text-slate-800">{task.title}</div>
                    </td>
                    <td className="p-4 font-medium text-slate-700 flex items-center gap-2 mt-2"><Briefcase size={12} className="text-slate-400"/> {task.host}</td>
                    <td className="p-4 text-slate-600">{task.prop}</td>
                    <td className="p-4"><span className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs border border-slate-200">{task.vendor}</span></td>
                    <td className="p-4 text-slate-500 text-xs">{task.due}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// 4. SETTINGS VIEW (Split BPO Logic)
function SettingsView() {
  const [settingsTab, setSettingsTab] = useState('agent'); // 'agent' or 'client'

  return (
    <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden animate-in fade-in duration-200">
      <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center shrink-0 shadow-sm">
        <h1 className="text-xl font-bold">Settings & Configurations</h1>
      </div>
      
      <div className="flex-1 flex overflow-hidden">
        {/* Settings Sidebar */}
        <div className="w-64 bg-white border-r border-slate-200 p-4 shrink-0 flex flex-col gap-6">
          
          <div>
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">My Workspace</h3>
            <nav className="space-y-1">
              <button onClick={() => setSettingsTab('agent')} className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${settingsTab === 'agent' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}><User size={16}/> Agent Preferences</button>
            </nav>
          </div>

          <div>
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">BPO Administration</h3>
            <nav className="space-y-1">
              <button onClick={() => setSettingsTab('client')} className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${settingsTab === 'client' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}><Briefcase size={16}/> Client Configurations</button>
            </nav>
          </div>

        </div>

        {/* Settings Content */}
        <div className="flex-1 p-8 overflow-y-auto">
          {settingsTab === 'agent' ? (
            <div className="max-w-2xl animate-in fade-in">
              <h2 className="text-lg font-bold text-slate-800 mb-6">Agent Preferences</h2>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-6">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">Dark Mode</h3>
                    <p className="text-xs text-slate-500 mt-1">Switch workspace interface to dark theme.</p>
                  </div>
                  <input type="checkbox" className="toggle-checkbox w-10 h-5 rounded-full bg-slate-300 cursor-pointer appearance-none checked:bg-indigo-500 transition-colors" />
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-2xl animate-in fade-in">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-slate-800">Client AI Configurations</h2>
                <select className="border border-slate-300 rounded-md text-sm py-1.5 px-3 focus:ring-1 focus:ring-indigo-500 bg-white font-medium text-indigo-700">
                  {MOCK_HOSTS.map(h => <option key={h.id}>{h.name}</option>)}
                </select>
              </div>
              
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-6">
                <div className="bg-slate-50 p-4 border-b border-slate-200">
                  <p className="text-xs text-slate-500">Settings below apply <strong className="text-slate-800">only</strong> to tickets and properties managed by the selected Host Company.</p>
                </div>

                <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                  <div className="pr-12">
                    <h3 className="font-bold text-slate-800 text-sm">Custom Brand Tone</h3>
                    <p className="text-xs text-slate-500 mt-1">Instructions given to the LLM for drafting replies for this specific client.</p>
                  </div>
                  <input type="text" defaultValue="Professional & High-End" className="border border-slate-300 rounded-md text-sm py-1.5 px-3 w-48 text-right" />
                </div>

                <div className="p-5 flex items-center justify-between">
                  <div className="pr-12">
                    <h3 className="font-bold text-slate-800 text-sm">Full Auto-Resolution (Beta)</h3>
                    <p className="text-xs text-slate-500 mt-1">Allow AI to send messages directly to guests without agent approval for simple inquiries (e.g., Wi-Fi passwords).</p>
                  </div>
                  <input type="checkbox" className="toggle-checkbox w-10 h-5 rounded-full bg-slate-300 cursor-pointer appearance-none checked:bg-indigo-500 transition-colors" />
                </div>
              </div>

              <div className="flex justify-end">
                <button className="px-5 py-2 bg-indigo-600 text-white font-medium rounded-lg text-sm hover:bg-indigo-700 shadow-sm transition-colors active:scale-95">Save Client Rules</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// --- MAIN APP COMPONENT ---
export default function App() {
  const [activeTab, setActiveTab] = useState('inbox');
  const [activeTicketId, setActiveTicketId] = useState(MOCK_TICKETS[0].id);
  const [activeHostFilter, setActiveHostFilter] = useState('all'); // NEW: Global BPO Filter

  const renderActiveView = () => {
    switch (activeTab) {
      case 'inbox': return <InboxView activeHost={activeHostFilter} activeTicketId={activeTicketId} setActiveTicketId={setActiveTicketId} />;
      case 'tasks': return <TasksView activeHost={activeHostFilter} />;
      case 'kb': return <KnowledgeBaseView activeHost={activeHostFilter} />;
      case 'settings': return <SettingsView />;
      default: return <InboxView activeHost={activeHostFilter} activeTicketId={activeTicketId} setActiveTicketId={setActiveTicketId} />;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden selection:bg-indigo-100 selection:text-indigo-900">
      
      {/* GLOBAL TOP BAR (BPO Context Switcher) */}
      <div className="h-14 bg-slate-900 text-white flex items-center px-4 justify-between shrink-0 z-30 shadow-md">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 font-bold text-lg tracking-tight">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center shadow-inner">Δ</div>
            Delta AI Ops
          </div>
          <div className="w-px h-6 bg-slate-700 hidden md:block"></div>
          <div className="hidden md:flex items-center gap-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Workspace:</span>
            <select 
              value={activeHostFilter}
              onChange={(e) => setActiveHostFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white text-sm rounded px-3 py-1 focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer hover:bg-slate-700 transition-colors"
            >
              <option value="all">🌐 All Host Companies</option>
              {MOCK_HOSTS.map(h => <option key={h.id} value={h.id}>🏢 {h.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="text-slate-400 hover:text-white transition-colors relative">
            <Bell size={18} />
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-slate-900"></span>
          </button>
          <div className="flex items-center gap-2 pl-4 border-l border-slate-700">
            <div className="w-7 h-7 rounded-full bg-slate-300 border border-slate-600 overflow-hidden cursor-pointer">
              <img src={`https://api.dicebear.com/7.x/notionists/svg?seed=Felix`} alt="Agent Profile" />
            </div>
            <span className="text-xs font-medium text-slate-300 hidden sm:block">Agent Felix</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* NARROW NAVIGATION SIDEBAR */}
        <div className="w-16 bg-white border-r border-slate-200 flex flex-col items-center py-4 shrink-0 shadow-sm z-20">
          <nav className="flex flex-col gap-3 w-full px-2">
            <NavItem icon={MessageSquare} active={activeTab === 'inbox'} onClick={() => setActiveTab('inbox')} tooltip="Omnichannel Inbox" />
            <NavItem icon={CheckSquare} active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} tooltip="Dispatch & Operations" />
            <NavItem icon={FileText} active={activeTab === 'kb'} onClick={() => setActiveTab('kb')} tooltip="Client Knowledge Base" />
          </nav>
          <div className="mt-auto flex flex-col gap-3 w-full px-2">
            <NavItem icon={Settings} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} tooltip="Platform Settings" />
          </div>
        </div>

        {/* DYNAMIC CONTENT AREA */}
        {renderActiveView()}
      </div>

    </div>
  );
}

// Helper component for Sidebar items
function NavItem({ icon: Icon, active, onClick, tooltip }) {
  return (
    <button 
      onClick={onClick}
      title={tooltip}
      className={`p-3 rounded-xl transition-all relative group flex items-center justify-center w-full ${active ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
    >
      <Icon size={20} className={active ? '' : 'group-hover:scale-110 transition-transform'} />
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-indigo-600 rounded-r-md shadow-[2px_0_8px_rgba(79,70,229,0.4)]"></span>}
    </button>
  );
}