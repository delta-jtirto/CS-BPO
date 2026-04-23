import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  ArrowLeft, Building, ChevronRight, Code, Database,
  FileText, Home, MapPin, Sparkles,
  Upload, Briefcase, X, Plus, Pencil, Trash2, Save, Check,
  Globe2, Key, Layers, ChevronDown, ChevronUp,
  Rocket, Clock, AlertTriangle, Search,
  Info, Settings2, Filter, CheckSquare, Square,
  ListChecks
} from 'lucide-react';
import { toast } from 'sonner';
import { MOCK_HOSTS } from '../../data/mock-data';
import { useAppContext } from '../../context/AppContext';
import { useIsMobile } from '../ui/use-mobile';
import { ScopeBadge } from '../shared/ScopeBadge';
import { importDocumentAI } from '../../ai/api-client';
import { KB_IMPORT_SYSTEM, KB_IMPORT_USER, resolvePrompt, resolveModel, interpolate } from '../../ai/prompts';
import type { KBEntry, KnowledgeChunk, IngestedDocument } from '../../data/types';
import { normalizeDocument } from '../../lib/doc-normalize';
import { ingestDocument } from '../../ai/import-router';
import { diffReingest, type DiffOutcome } from '../../lib/reingest-diff';
import { ReingestReviewModal, type ReingestDecision } from './ReingestReviewModal';


function relativeTime(isoString: string): string {
  const now = new Date('2026-03-11T12:00:00Z');
  const then = new Date(isoString);
  const diffMs = now.getTime() - then.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months}mo ago`;
  }
  return `${Math.floor(diffDays / 365)}y ago`;
}

function isStaleSince(isoString: string): boolean {
  const now = new Date('2026-03-11T12:00:00Z');
  const then = new Date(isoString);
  return (now.getTime() - then.getTime()) > 90 * 24 * 60 * 60 * 1000;
}

function formatAsToon(data: Record<string, any>[], arrayName = 'data') {
  if (!data || data.length === 0) return `${arrayName}[0]:`;
  const keys = Object.keys(data[0]);
  const header = `${arrayName}[${data.length}]{${keys.join(',')}}:`;
  const rows = data.map(item => {
    return keys.map(k => {
      let val = item[k];
      if (val === null || val === undefined) return 'null';
      val = String(val);
      if (/[,\\\"\\\n\\\r]/.test(val)) {
        val = `"${val.replace(/"/g, '\\"')}"`;
      }
      return val;
    }).join(',');
  }).join('\n  ');
  return `${header}\n  ${rows}`;
}

// ─── KB Document Import Helpers ───────────────────────────────────────────

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string | ArrayBuffer;
        if (typeof content === 'string') {
          resolve(content);
        } else {
          // For binary formats, try to extract text
          const buffer = content as ArrayBuffer;
          if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            // For Excel, skip - we'll get text extraction from API instead
            resolve(`Excel file: ${file.name}`);
          } else {
            const view = new Uint8Array(buffer);
            const text = String.fromCharCode(...view);
            resolve(text);
          }
        }
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));

    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  });
}

function parseKBResponse(responseText: string): Array<{ title: string; content: string; tags: string[] }> {
  try {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('No JSON array found in response:', responseText);
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(entry =>
      entry &&
      typeof entry.title === 'string' &&
      typeof entry.content === 'string' &&
      Array.isArray(entry.tags) &&
      entry.title.trim() &&
      entry.content.trim()
    );
  } catch (err) {
    console.error('Failed to parse KB response:', err);
    return [];
  }
}

// ─── Filter types ────────────────────────────────────────────────────────────
type SourceFilter = 'all' | 'manual' | 'company';
type ScopeFilter = 'all' | 'property' | 'room' | 'global';

// ─── Filter chip ─────────────────────────────────────────────────────────────
function FilterChip({ label, active, onClick, count }: { label: string; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-all whitespace-nowrap shrink-0 ${
        active
          ? 'bg-indigo-600 text-white border-indigo-600'
          : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
      }`}
    >
      {label}{count !== undefined && <span className="ml-1 opacity-70">{count}</span>}
    </button>
  );
}

// ─── Simulated extraction results for document upload ────────────────────────
const SIMULATED_EXTRACTIONS = [
  { title: 'Check-in Instructions', content: 'Self check-in available 24/7. Building code: 4523#. Room code sent via Airbnb message 24 hours before arrival.', tags: ['Check-in', 'Security'] },
  { title: 'Parking Policy', content: 'No on-site parking. Nearest public parking: City Park Garage (5 min walk), 2,000 JPY/day. Street parking free after 8 PM.', tags: ['Amenities', 'Policies'] },
  { title: 'Quiet Hours', content: 'Quiet hours 10 PM to 8 AM. No music audible outside the unit. Building has thin walls.', tags: ['Policies', 'House Rules'] },
  { title: 'Emergency Contacts', content: 'Building manager: Mr. Tanaka, +81-90-1234-5678 (9 AM-6 PM). After hours emergency: security desk at lobby.', tags: ['Emergency', 'Vendors'] },
];

export function KnowledgeBaseView() {
  const { propertyId: urlPropertyId } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const {
    activeHostFilter, kbEntries, addKBEntry, updateKBEntry, deleteKBEntry, devMode, properties, promptOverrides,
    formTemplate, knowledgeChunks, ingestedDocuments,
    upsertKnowledgeChunks, updateKnowledgeChunk, upsertIngestedDocument,
  } = useAppContext();

  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(urlPropertyId || null);
  const [showToonViewer, setShowToonViewer] = useState(false);
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set());

  // List view state
  const [showScopeGuide, setShowScopeGuide] = useState(() => {
    try { return localStorage.getItem('kb_scope_guide_dismissed') !== 'true'; } catch { return true; }
  });
  const dismissScopeGuide = () => {
    setShowScopeGuide(false);
    try { localStorage.setItem('kb_scope_guide_dismissed', 'true'); } catch {}
  };
  const [showIngestionModal, setShowIngestionModal] = useState(false);
  const [ingestionHost, setIngestionHost] = useState('');
  const [ingestionProperty, setIngestionProperty] = useState('');
  const [ingestionStep, setIngestionStep] = useState<'upload' | 'preview'>('upload');
  const [ingestionFile, setIngestionFile] = useState<string>('');
  const [ingestionPreviewEntries, setIngestionPreviewEntries] = useState<typeof SIMULATED_EXTRACTIONS>([]);
  const [ingestionSelectedEntries, setIngestionSelectedEntries] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Unified ingest pipeline (Phase 1) — produces a diff preview for the
  // ReingestReviewModal. When present, takes precedence over the legacy
  // preview flow above.
  const [reingestState, setReingestState] = useState<{
    doc: IngestedDocument;
    diff: DiffOutcome;
  } | null>(null);
  // List view: inline editing for company-wide rules
  const [listEditingId, setListEditingId] = useState<number | null>(null);
  const [listEditTitle, setListEditTitle] = useState('');
  const [listEditContent, setListEditContent] = useState('');

  // Detail view state
  const [detailSearch, setDetailSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  // Inline editing for detail entries
  const [editingDetailId, setEditingDetailId] = useState<number | null>(null);
  const [editDetailTitle, setEditDetailTitle] = useState('');
  const [editDetailContent, setEditDetailContent] = useState('');
  const [editDetailInternal, setEditDetailInternal] = useState(false);
  // Adding new entry inline
  const [addingEntrySection, setAddingEntrySection] = useState<{ scope: 'Property' | 'Room' | 'Host Global'; sectionId?: string; roomId?: string } | null>(null);
  const [newEntryTitle, setNewEntryTitle] = useState('');
  const [newEntryContent, setNewEntryContent] = useState('');
  const [newEntryInternal, setNewEntryInternal] = useState(false);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  // Bulk selection
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());

  // Expanded global rules on list view
  const [expandedGlobalHost, setExpandedGlobalHost] = useState<string | null>(null);

  const displayHosts = activeHostFilter === 'all' ? MOCK_HOSTS : MOCK_HOSTS.filter(h => h.id === activeHostFilter);

  const navigateToProperty = (propId: string) => {
    setSelectedPropertyId(propId);
    setDetailSearch('');
    setSourceFilter('all');
    setScopeFilter('all');
    setBulkMode(false);
    setBulkSelected(new Set());
    navigate(`/kb/${propId}`);
  };

  const navigateBack = () => {
    setSelectedPropertyId(null);
    navigate('/kb');
  };

  // ─── Upload / Ingestion with preview ───────────────────────────────────────
  const handleUpload = () => {
    if (!ingestionHost) {
      toast.error('Please select a target host company');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    // Unified Phase 1 pipeline:
    //   Stage A (local) → Stage B (AI router per-section) → deterministic diff
    //   → ReingestReviewModal. No "flat entries" parsing — the router yields
    //   typed KnowledgeChunks with slotKey / originalText / confidence.
    try {
      setIngestionFile(file.name);
      toast.loading('Reading document...');
      const normalized = await normalizeDocument(file);

      if (normalized.error) {
        toast.dismiss();
        toast.error('Parse failed', { description: normalized.error });
        return;
      }

      // Contenthash match → skip Stage B entirely.
      const prior = ingestedDocuments.find(d => d.filename === file.name && d.propId === (ingestionProperty || null));
      if (prior && prior.contentHash === normalized.contentHash) {
        toast.dismiss();
        toast.info('Nothing changed', { description: `${file.name} is identical to the last upload.` });
        setIngestionFile('');
        return;
      }

      toast.loading('Classifying content with AI...');
      const prop = ingestionProperty ? properties.find(p => p.id === ingestionProperty) : null;
      const roomNames = prop?.roomNames ?? (prop?.units === 1 ? ['Entire Property'] : Array.from({ length: prop?.units ?? 1 }, (_, i) => `Unit ${i + 1}`));
      const result = await ingestDocument(
        normalized,
        {
          hostId: ingestionHost,
          propId: ingestionProperty || null,
          roomNames,
          promptOverrides,
        },
        formTemplate,
        'user',
      );

      if (result.chunks.length === 0) {
        toast.dismiss();
        toast.warning('No knowledge extracted', {
          description: result.sectionErrors.length > 0
            ? result.sectionErrors.map(e => e.label).join(', ')
            : 'The router found nothing actionable in this document.',
        });
        setIngestionFile('');
        return;
      }

      // Diff against what's already in the store for this docId, scoped
      // appropriately.
      const existingScoped = knowledgeChunks.filter(c =>
        c.hostId === ingestionHost &&
        (ingestionProperty ? c.propId === ingestionProperty : c.propId === null)
      );
      const diff = diffReingest({
        newChunks: result.chunks,
        existingChunks: existingScoped,
        docId: result.doc.id,
        previousDocId: prior?.id,
      });

      setReingestState({ doc: result.doc, diff });
      toast.dismiss();
      const total = diff.summary.newCount + diff.summary.unchangedCount + diff.summary.pendingCount;
      toast.success(`Analyzed ${total} chunks`, {
        description: `${diff.summary.newCount} new · ${diff.summary.pendingCount} need review`,
      });
    } catch (err: unknown) {
      console.error('Ingest error:', err);
      toast.dismiss();
      toast.error('Import failed', {
        description: err instanceof Error ? err.message : String(err),
      });
      setIngestionFile('');
    }
  };

  // Commit the ReingestReviewModal decisions to the store.
  const applyReingest = (decisions: ReingestDecision[]) => {
    if (!reingestState) return;
    const { doc, diff } = reingestState;

    // Resolve pending-review items per user decision.
    const chunksToCommit: KnowledgeChunk[] = [];
    const archiveIds = new Set(diff.toArchive);

    // First, all "unambiguous" inserts (those NOT in pendingReview).
    const pendingProposedIds = new Set(
      diff.pendingReview.map(p => p.proposed?.id).filter((id): id is string => !!id)
    );
    for (const c of diff.toInsert) {
      if (pendingProposedIds.has(c.id)) continue; // handled below via decisions
      chunksToCommit.push(c);
    }

    // Then apply the user's per-item decisions.
    for (const decision of decisions) {
      const item = diff.pendingReview[decision.itemIndex];
      if (!item) continue;

      if (decision.choice === 'use_new' && item.proposed) {
        // Accept the new doc value. If there was an existing override,
        // archive it (user chose the doc over their edit).
        if (item.existing) archiveIds.add(item.existing.id);
        chunksToCommit.push({ ...item.proposed, status: 'active' });
      } else if (decision.choice === 'keep_existing') {
        // Nothing to insert — the existing chunk stays active. Any proposed
        // chunk with status='pending_review' should be dropped (not added).
        // (pendingProposedIds filter above already excluded it.)
      } else {
        // 'skip' — park the proposal as pending_review so the user can come
        // back to it later. The existing chunk (if any) stays put.
        if (item.proposed) {
          chunksToCommit.push({ ...item.proposed, status: 'pending_review' });
        }
      }
    }

    // Flip archived chunks to status='archived'.
    for (const id of archiveIds) {
      updateKnowledgeChunk(id, { status: 'archived' });
    }

    // Clear supersedes pointers on orphaned overrides.
    for (const id of diff.toUnlink) {
      updateKnowledgeChunk(id, { supersedes: undefined });
    }

    // Upsert new / replaced chunks.
    upsertKnowledgeChunks(chunksToCommit);
    // Record the doc.
    upsertIngestedDocument(doc);

    const added = chunksToCommit.filter(c => c.status === 'active').length;
    toast.success(`Imported from "${doc.filename}"`, {
      description: `${added} new · ${archiveIds.size} archived · ${decisions.length} resolved`,
    });

    setReingestState(null);
    setShowIngestionModal(false);
    setIngestionFile('');
  };

  const confirmIngestion = () => {
    const host = MOCK_HOSTS.find(h => h.id === ingestionHost);
    const selectedEntries = ingestionPreviewEntries.filter((_, i) => ingestionSelectedEntries.has(i));
    for (const entry of selectedEntries) {
      addKBEntry({
        hostId: ingestionHost,
        propId: ingestionProperty || null,
        roomId: null,
        scope: ingestionProperty ? 'Property' : 'Host Global',
        title: entry.title,
        content: entry.content,
        tags: entry.tags,
        source: 'manual',
      });
    }
    toast.success(`${selectedEntries.length} entries imported from "${ingestionFile}"`, {
      description: `Added to ${host?.name}${ingestionProperty ? ` — ${properties.find(p => p.id === ingestionProperty)?.name}` : ' (company-wide)'}`,
    });
    setShowIngestionModal(false);
    setIngestionStep('upload');
    setIngestionFile('');
    setIngestionPreviewEntries([]);
  };

  const toggleEntry = (id: number) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ─── Bulk operations ───────────────────────────────────────────────────────
  const toggleBulkSelect = (id: number) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bulkDelete = () => {
    const count = bulkSelected.size;
    for (const id of bulkSelected) {
      deleteKBEntry(id);
    }
    setBulkSelected(new Set());
    setBulkMode(false);
    toast.success(`${count} ${count === 1 ? 'entry' : 'entries'} deleted`);
  };

  // (Unpublished change detection removed — form now auto-syncs to KB)

  // --- Property Detail View ---
  if (selectedPropertyId) {
    const prop = properties.find(p => p.id === selectedPropertyId)!;
    if (!prop) { navigateBack(); return null; }
    const hostName = MOCK_HOSTS.find(h => h.id === prop.hostId)?.name || 'Unknown';
    const allRules = kbEntries.filter(kb => kb.propId === prop.id || (kb.hostId === prop.hostId && kb.scope === 'Host Global'));

    const globalEntries = allRules.filter(r => r.scope === 'Host Global');
    const propertyEntries = allRules.filter(r => r.scope === 'Property');
    const roomEntries = allRules.filter(r => r.scope === 'Room');

    const isStale = prop.lastSyncedAt ? isStaleSince(prop.lastSyncedAt) : false;

    // Counts for inline stats
    const manualCount = propertyEntries.length + roomEntries.length;
    const globalCount = globalEntries.length;

    // ─── Unified flat list with search + filter ──────────────────────────────
    const searchLower = detailSearch.toLowerCase().trim();
    const matchesSearch = (entry: KBEntry) => {
      if (!searchLower) return true;
      return entry.title.toLowerCase().includes(searchLower) ||
        entry.content.toLowerCase().includes(searchLower) ||
        (entry.tags || []).some(t => t.toLowerCase().includes(searchLower));
    };

    const matchesSourceFilter = (entry: KBEntry) => {
      if (sourceFilter === 'all') return true;
      if (sourceFilter === 'manual') return entry.scope !== 'Host Global';
      if (sourceFilter === 'company') return entry.scope === 'Host Global';
      return true;
    };

    const matchesScopeFilter = (entry: KBEntry) => {
      if (scopeFilter === 'all') return true;
      if (scopeFilter === 'property') return entry.scope === 'Property';
      if (scopeFilter === 'room') return entry.scope === 'Room';
      if (scopeFilter === 'global') return entry.scope === 'Host Global';
      return true;
    };

    const filteredEntries = allRules.filter(e => matchesSearch(e) && matchesSourceFilter(e) && matchesScopeFilter(e));
    const filteredTotal = filteredEntries.length;

    // Group for display — section headers as dividers
    const groupedEntries = (() => {
      const groups: { label: string; icon: React.ReactNode; color: string; entries: KBEntry[] }[] = [];
      const manualEs = filteredEntries.filter(e => e.scope !== 'Host Global');
      const companyEntries = filteredEntries.filter(e => e.scope === 'Host Global');

      if (manualEs.length > 0) {
        groups.push({
          label: 'Custom Entries',
          icon: <Pencil size={12} />,
          color: 'indigo',
          entries: manualEs,
        });
      }
      if (companyEntries.length > 0) {
        groups.push({
          label: `Company-Wide Rules`,
          icon: <Globe2 size={12} />,
          color: 'purple',
          entries: companyEntries,
        });
      }
      return groups;
    })();

    const startEditEntry = (entry: KBEntry) => {
      setEditingDetailId(entry.id);
      setEditDetailTitle(entry.title);
      setEditDetailContent(entry.content);
      setEditDetailInternal(!!entry.internal);
    };

    const cancelEditEntry = () => {
      setEditingDetailId(null);
      setEditDetailTitle('');
      setEditDetailContent('');
      setEditDetailInternal(false);
    };

    const saveEditEntry = () => {
      if (editingDetailId === null) return;
      if (!editDetailTitle.trim() || !editDetailContent.trim()) {
        toast.error('Title and content are required');
        return;
      }
      updateKBEntry(editingDetailId, {
        title: editDetailTitle.trim(),
        content: editDetailContent.trim(),
        internal: editDetailInternal,
      });
      cancelEditEntry();
      toast.success('Entry updated');
    };

    const handleDeleteEntry = (entry: KBEntry) => {
      deleteKBEntry(entry.id);
      toast.success(`"${entry.title}" deleted`);
    };

    const startAddEntry = (scope: 'Property' | 'Room' | 'Host Global', sectionId?: string, roomId?: string) => {
      setAddingEntrySection({ scope, sectionId, roomId });
      setNewEntryTitle('');
      setNewEntryContent('');
      setNewEntryInternal(false);
      setSelectedRoomIds([]);
    };

    const cancelAddEntry = () => {
      setAddingEntrySection(null);
      setNewEntryTitle('');
      setNewEntryContent('');
      setNewEntryInternal(false);
      setSelectedRoomIds([]);
    };

    const saveNewEntry = () => {
      if (!addingEntrySection) return;
      if (!newEntryTitle.trim() || !newEntryContent.trim()) {
        toast.error('Title and content are required');
        return;
      }
      if (addingEntrySection.scope === 'Room') {
        if (selectedRoomIds.length === 0) {
          toast.error('Please select at least one room');
          return;
        }
        for (const roomId of selectedRoomIds) {
          addKBEntry({
            hostId: prop.hostId,
            propId: prop.id,
            roomId,
            scope: 'Room',
            title: newEntryTitle.trim(),
            content: newEntryContent.trim(),
            internal: newEntryInternal,
            sectionId: addingEntrySection.sectionId,
            source: 'manual',
          });
        }
        cancelAddEntry();
        toast.success(selectedRoomIds.length === 1 ? 'New entry added' : `Entry added to ${selectedRoomIds.length} rooms`);
      } else {
        addKBEntry({
          hostId: prop.hostId,
          propId: addingEntrySection.scope === 'Host Global' ? null : prop.id,
          roomId: addingEntrySection.roomId || null,
          scope: addingEntrySection.scope,
          title: newEntryTitle.trim(),
          content: newEntryContent.trim(),
          internal: newEntryInternal,
          sectionId: addingEntrySection.sectionId,
          source: 'manual',
        });
        cancelAddEntry();
        toast.success('New entry added');
      }
    };

    // ─── Add-entry form as inline JSX ────────────────────────────────────────
    const isMultiUnit = prop.units > 1;
    const addEntryCurrentScope = addingEntrySection?.scope || 'Property';
    const addEntryScopeColors: Record<string, { bg: string; border: string }> = {
      'Property': { bg: 'bg-indigo-50', border: 'border-indigo-200' },
      'Room': { bg: 'bg-teal-50', border: 'border-teal-200' },
      'Host Global': { bg: 'bg-purple-50', border: 'border-purple-200' },
    };
    const addEntryColors = addEntryScopeColors[addEntryCurrentScope] || addEntryScopeColors['Property'];

    const definedRooms: string[] = (() => {
      if (prop.roomNames && prop.roomNames.length > 0) return prop.roomNames;
      if (prop.units === 1) return ['Entire Property'];
      return Array.from({ length: prop.units }, (_, i) => `Unit ${i + 1}`);
    })();

    const toggleRoom = (room: string) => {
      setSelectedRoomIds(prev =>
        prev.includes(room) ? prev.filter(r => r !== room) : [...prev, room]
      );
    };

    const toggleAllRooms = () => {
      if (selectedRoomIds.length === definedRooms.length) {
        setSelectedRoomIds([]);
      } else {
        setSelectedRoomIds([...definedRooms]);
      }
    };

    // Rec #7: Content fields first, scope below — and Rec #6: hide room scope for single-unit
    const addEntryFormJsx = !addingEntrySection ? (
      <button
        onClick={() => startAddEntry('Property')}
        className="w-full border-2 border-dashed rounded-lg p-2 mt-1.5 text-[10px] font-medium flex items-center justify-center gap-1.5 transition-colors border-indigo-200 text-indigo-500 hover:bg-indigo-50 hover:border-indigo-300"
      >
        <Plus size={10} /> Add custom entry
      </button>
    ) : (
      <div className={`border rounded-lg p-3 mt-1.5 space-y-2 ${addEntryColors.bg} ${addEntryColors.border}`}>
        {/* Rec #4: "Where do I put this?" hint */}
        <div className="flex items-start gap-2 p-2 bg-white/60 border border-slate-200/50 rounded text-[10px] text-slate-500 leading-relaxed">
          <Info size={12} className="shrink-0 mt-0.5 text-slate-400" />
          <span>If this info matches a form field (Wi-Fi, check-in, etc.), update it in the <button onClick={() => navigate(`/kb/onboard/${prop.id}`)} className="text-[10px] text-indigo-500 hover:underline font-medium p-0 leading-[inherit]">property form</button> instead — it auto-syncs to the AI.</span>
        </div>
        {/* Content first (Rec #7) */}
        <input
          type="text"
          placeholder="Entry title (e.g. 'Pool hours', 'Taxi tips')..."
          value={newEntryTitle}
          onChange={(e) => setNewEntryTitle(e.target.value)}
          className="w-full border border-slate-200 rounded text-xs py-1.5 px-2.5 focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
          autoFocus
        />
        <textarea
          placeholder="What should the AI know? One topic per entry works best for retrieval accuracy."
          value={newEntryContent}
          onChange={(e) => setNewEntryContent(e.target.value)}
          className="w-full border border-slate-200 rounded text-xs py-1.5 px-2.5 focus:ring-1 focus:ring-indigo-500 outline-none resize-none min-h-[60px] bg-white"
        />
        {/* Scope selection after content (Rec #7), room hidden for single-unit (Rec #6) */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 shrink-0">Applies to:</span>
          <select
            value={addEntryCurrentScope}
            onChange={(e) => {
              const newScope = e.target.value as 'Property' | 'Room' | 'Host Global';
              setAddingEntrySection({ scope: newScope });
              if (newScope !== 'Room') setSelectedRoomIds([]);
            }}
            className="text-[11px] font-medium bg-white border border-slate-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer"
          >
            <option value="Property">This property only</option>
            {isMultiUnit && <option value="Room">Specific room(s)</option>}
            <option value="Host Global">Company-wide (all properties)</option>
          </select>
        </div>
        {addEntryCurrentScope === 'Room' && isMultiUnit && (
          <div className="bg-white border border-teal-200 rounded-lg p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-teal-700 flex items-center gap-1"><Key size={10} /> Select rooms</span>
              <button
                onClick={toggleAllRooms}
                className="text-[9px] font-medium text-teal-600 hover:text-teal-800 transition-colors"
              >
                {selectedRoomIds.length === definedRooms.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {definedRooms.map(room => {
                const isSelected = selectedRoomIds.includes(room);
                return (
                  <button
                    key={room}
                    onClick={() => toggleRoom(room)}
                    className={`px-2.5 py-1.5 text-[11px] rounded-md border transition-all ${
                      isSelected
                        ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300 hover:bg-teal-50'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {isSelected ? <Check size={10} /> : <Key size={10} className="text-slate-300" />}
                      {room}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedRoomIds.length > 0 && (
              <p className="text-[9px] text-teal-500 mt-1.5">
                {selectedRoomIds.length} of {definedRooms.length} selected
                {selectedRoomIds.length > 1 && ' — one entry will be created per room'}
              </p>
            )}
          </div>
        )}
        <div className="flex items-center justify-between">
          {/* Rec #13: Renamed from "Internal only" */}
          <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer select-none">
            <input type="checkbox" checked={newEntryInternal} onChange={(e) => setNewEntryInternal(e.target.checked)} className="rounded border-slate-300 text-amber-500 focus:ring-amber-500" />
            Agent-only (not shared with guests)
          </label>
          <div className="flex gap-2">
            <button onClick={cancelAddEntry} className="px-2.5 py-1 text-[10px] text-slate-600 hover:bg-white rounded transition-colors">Cancel</button>
            <button onClick={saveNewEntry} className="px-2.5 py-1 text-[10px] bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-1 transition-colors"><Check size={10} /> Save</button>
          </div>
        </div>
        {addEntryCurrentScope === 'Host Global' && (
          <p className="text-[9px] text-purple-400 mt-0.5">
            This entry will appear on all properties under {hostName}.
          </p>
        )}
      </div>
    );

    return (
      <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden animate-in slide-in-from-right-8 duration-300 relative">
        {/* TOON Viewer Modal */}
        {showToonViewer && (
          <div className={`fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center ${isMobile ? 'p-2' : 'p-6'} backdrop-blur-sm animate-in fade-in`}>
            <div className="bg-slate-900 w-full max-w-4xl rounded-xl shadow-2xl flex flex-col overflow-hidden border border-slate-700 max-h-[85vh]">
              <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950">
                <div className="flex items-center gap-2 text-emerald-400">
                  <Code size={18} />
                  <h3 className="font-bold text-sm tracking-wide">Vector DB View (TOON Format)</h3>
                </div>
                <button onClick={() => setShowToonViewer(false)} className="text-slate-400 hover:text-white transition-colors"><X size={20} /></button>
              </div>
              <div className="p-4 flex-1 overflow-y-auto bg-[#0d1117] text-slate-300">
                <div className="text-xs text-slate-500 mb-4 pb-4 border-b border-slate-800">
                  // Retrieved <b>{allRules.length}</b> embeddings for Property: {prop.name}<br/>
                  // Format: Token-Oriented Object Notation (TOON)<br/>
                  // Purpose: Optimized, low-token injection into the LLM context window.
                </div>
                <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">
                  <span className="text-emerald-400">{formatAsToon(allRules, 'rules')}</span>
                </pre>
              </div>
              <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-end">
                <button onClick={() => setShowToonViewer(false)} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700 transition-colors">Close Viewer</button>
              </div>
            </div>
          </div>
        )}

        {/* Header with breadcrumb + inline stats (Rec #8) */}
        <div className="bg-white border-b border-slate-200 px-3 md:px-6 py-3 md:py-4 shrink-0 shadow-sm z-10">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
            <button onClick={navigateBack} className="hover:text-indigo-600 transition-colors">Knowledge Base</button>
            <ChevronRight size={10} />
            <span className="text-slate-500">{hostName}</span>
            <ChevronRight size={10} />
            <span className="text-slate-700 font-medium">{prop.name}</span>
          </div>

          <div className={`flex ${isMobile ? 'flex-col gap-3' : 'items-center justify-between'}`}>
            <div className="flex items-center gap-3 md:gap-4 min-w-0">
              <button onClick={navigateBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-slate-800 shrink-0">
                <ArrowLeft size={isMobile ? 18 : 20} />
              </button>
              <div className={`${isMobile ? 'w-9 h-9 text-base' : 'w-11 h-11 text-lg'} rounded-lg flex items-center justify-center text-white font-bold shadow-inner shrink-0 ${prop.status === 'Active' ? 'bg-gradient-to-br from-indigo-500 to-indigo-700' : 'bg-gradient-to-br from-slate-400 to-slate-600'}`}>
                {prop.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <h1 className={`${isMobile ? 'text-base' : 'text-lg'} font-bold text-slate-800 flex items-center gap-2`}>
                  <span className="truncate">{prop.name}</span>
                  {prop.status === 'Active' ?
                    <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">Active</span> :
                    <span className="bg-amber-100 text-amber-700 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">Setup</span>
                  }
                </h1>
                {/* Inline stats merged into subtitle (Rec #8) */}
                <p className="text-xs text-slate-500 flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1"><MapPin size={11}/> {prop.location}</span>
                  <span className="flex items-center gap-1"><Home size={11}/> {prop.units} {prop.units === 1 ? 'Unit' : 'Units'}</span>
                  {!isMobile && <span className="text-slate-300">|</span>}
                  {!isMobile && (
                    <>
                      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />{manualCount} custom</span>
                      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-purple-500" />{globalCount} company</span>
                    </>
                  )}
                  {prop.lastSyncedAt && (
                    <span className={`flex items-center gap-1 ${isStale ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                      <Clock size={11} /> {relativeTime(prop.lastSyncedAt)}
                      {isStale && <AlertTriangle size={10} />}
                    </span>
                  )}
                </p>
                {/* Mobile-only compact stats row */}
                {isMobile && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />{manualCount}</span>
                    <span className="text-[10px] text-slate-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-purple-500" />{globalCount}</span>
                  </div>
                )}
              </div>
            </div>
            <div className={`flex gap-2 ${isMobile ? 'overflow-x-auto pb-1 -mx-1 px-1' : ''}`}>
              {devMode && (
                <button onClick={() => setShowToonViewer(true)} className="px-3 py-2 text-xs font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 flex items-center gap-2 shadow-sm transition-colors border border-slate-200 whitespace-nowrap shrink-0">
                  <Database size={14} className="text-indigo-500"/> {isMobile ? 'Vectors' : 'Raw Vectors'}
                </button>
              )}
              {/* Bulk mode toggle (Rec #12) */}
              {allRules.length > 0 && (
                <button
                  onClick={() => { setBulkMode(!bulkMode); setBulkSelected(new Set()); }}
                  className={`px-3 py-2 text-xs font-medium rounded-lg flex items-center gap-2 shadow-sm transition-colors border whitespace-nowrap shrink-0 ${
                    bulkMode ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  <ListChecks size={14} /> {bulkMode ? 'Cancel' : 'Select'}
                </button>
              )}
              {(() => {
                const pendingCount = knowledgeChunks.filter(c =>
                  c.status === 'pending_review' &&
                  (c.propId === prop.id || (c.propId === null && c.hostId === prop.hostId))
                ).length;
                return (
                  <button
                    onClick={() => navigate(`/kb/${prop.id}/inspector`)}
                    className={`px-3 py-2 text-xs font-medium rounded-lg flex items-center gap-1.5 shadow-sm transition-colors border whitespace-nowrap shrink-0 relative ${
                      pendingCount > 0
                        ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                        : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                    }`}
                    title={pendingCount > 0
                      ? `${pendingCount} ${pendingCount === 1 ? 'entry needs' : 'entries need'} review`
                      : 'Browse all imported knowledge (FAQs, SOPs, rules, templates…)'
                    }
                  >
                    <Search size={14} /> {isMobile ? 'Inspect' : 'Inspect Knowledge'}
                    {pendingCount > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-amber-600 text-white tabular-nums">
                        {pendingCount}
                      </span>
                    )}
                  </button>
                );
              })()}
              <button
                onClick={() => navigate(`/kb/onboard/${prop.id}`)}
                className="px-4 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 shadow-sm transition-colors whitespace-nowrap shrink-0"
              >
                <Pencil size={14} /> {isMobile ? 'Edit Info' : 'Edit Property Info'}
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className={`flex-1 overflow-y-auto ${isMobile ? 'p-3' : 'p-8'} max-w-5xl mx-auto w-full`}>
          {/* Stale warning banner */}
          {isStale && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 animate-in fade-in">
              <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold text-red-800">This info may be outdated</p>
                <p className="text-xs text-red-600 mt-0.5">Last updated over 90 days ago. Use "Edit Property Info" above to review with the host.</p>
              </div>
            </div>
          )}

          {/* Search bar + filter chips (Rec #1, #3) */}
          {allRules.length > 0 && (
            <div className="mb-4 space-y-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={detailSearch}
                  onChange={(e) => setDetailSearch(e.target.value)}
                  placeholder="Search all entries (e.g. wifi, parking, check-in)..."
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none shadow-sm"
                />
                {detailSearch && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">{filteredTotal} result{filteredTotal !== 1 ? 's' : ''}</span>
                    <button onClick={() => setDetailSearch('')} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                  </div>
                )}
              </div>
              {/* Filter chips (Rec #3) */}
              <div className={`flex items-center gap-2 ${isMobile ? 'overflow-x-auto pb-1 -mx-1 px-1' : 'flex-wrap'}`}>
                <Filter size={12} className="text-slate-400 shrink-0" />
                <FilterChip label="All" active={sourceFilter === 'all'} onClick={() => setSourceFilter('all')} count={allRules.length} />
                <FilterChip label="Custom" active={sourceFilter === 'manual'} onClick={() => setSourceFilter('manual')} count={manualCount} />
                <FilterChip label="Company-Wide" active={sourceFilter === 'company'} onClick={() => setSourceFilter('company')} count={globalCount} />
                <span className="w-px h-4 bg-slate-200 shrink-0" />
                <FilterChip label="All Scopes" active={scopeFilter === 'all'} onClick={() => setScopeFilter('all')} />
                <FilterChip label="Property" active={scopeFilter === 'property'} onClick={() => setScopeFilter('property')} />
                {isMultiUnit && <FilterChip label="Room" active={scopeFilter === 'room'} onClick={() => setScopeFilter('room')} />}
                <FilterChip label="Global" active={scopeFilter === 'global'} onClick={() => setScopeFilter('global')} />
              </div>
            </div>
          )}

          {/* Bulk action bar (Rec #12) */}
          {bulkMode && bulkSelected.size > 0 && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-200">
              <span className="text-xs font-bold text-amber-800">{bulkSelected.size} selected</span>
              <div className="flex gap-2">
                <button onClick={() => setBulkSelected(new Set())} className="px-2.5 py-1 text-[10px] text-slate-600 hover:bg-white rounded transition-colors">Deselect all</button>
                <button onClick={bulkDelete} className="px-2.5 py-1 text-[10px] bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-1 transition-colors"><Trash2 size={10} /> Delete selected</button>
              </div>
            </div>
          )}

          {/* Form knowledge auto-injection note */}
          <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <Sparkles size={14} className="text-indigo-500 shrink-0 mt-0.5" />
            <p className="text-xs text-indigo-700">Form knowledge is automatically injected into every AI reply — no manual sync needed. Add custom entries below for extra context like house rules or local tips.</p>
          </div>

          {/* Empty state */}
          {allRules.length === 0 && (
            <div className={`bg-white border-2 border-dashed border-slate-200 rounded-xl ${isMobile ? 'p-8' : 'p-16'} text-center flex flex-col items-center justify-center`}>
              <FileText size={48} className="text-slate-200 mb-4" />
              <p className="font-bold text-slate-700 mb-1">No custom entries yet</p>
              <p className="text-sm text-slate-500 mb-6">Add individual entries for extra context, or import a document below.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => navigate(`/kb/onboard/${prop.id}`)}
                  className="px-5 py-2.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 shadow-sm"
                >
                  <Pencil size={14} /> Open Property Form
                </button>
                <button
                  onClick={() => startAddEntry('Property')}
                  className="px-5 py-2.5 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 flex items-center gap-2 shadow-sm"
                >
                  <Plus size={14} /> Add Custom Entry
                </button>
              </div>
              {addingEntrySection && (
                <div className="mt-6 w-full max-w-lg text-left">
                  {addEntryFormJsx}
                </div>
              )}
            </div>
          )}

          {/* Flat entry list (Rec #1, #3) */}
          {allRules.length > 0 && (
            <div className="space-y-5">
              {groupedEntries.map(group => (
                <div key={group.label}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className={`p-1 rounded ${group.color === 'green' ? 'bg-green-200 text-green-700' : group.color === 'indigo' ? 'bg-indigo-200 text-indigo-700' : 'bg-purple-200 text-purple-700'}`}>
                      {group.icon}
                    </div>
                    <h3 className={`text-xs font-bold uppercase tracking-wider ${group.color === 'green' ? 'text-green-700' : group.color === 'indigo' ? 'text-indigo-700' : 'text-purple-700'}`}>
                      {group.label}
                    </h3>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${group.color === 'green' ? 'text-green-600 bg-green-50' : group.color === 'indigo' ? 'text-indigo-600 bg-indigo-50' : 'text-purple-600 bg-purple-50'}`}>
                      {group.entries.length}
                    </span>
                    {group.color === 'green' && (
                      <button
                        onClick={() => navigate(`/kb/onboard/${prop.id}`)}
                        className="ml-auto px-2 py-0.5 text-[9px] font-medium text-green-600 bg-green-50 border border-green-200 rounded hover:bg-green-100 transition-colors flex items-center gap-1"
                      >
                        <Pencil size={8} /> Edit in form
                      </button>
                    )}
                    {group.color === 'purple' && (
                      <span className="text-[10px] text-slate-400 ml-1">inherited from {hostName}</span>
                    )}
                    <div className={`flex-1 border-t ml-2 ${group.color === 'green' ? 'border-green-100' : group.color === 'indigo' ? 'border-indigo-100' : 'border-purple-100'}`} />
                  </div>
                  <div className="grid gap-1.5">
                    {group.entries.map(entry => (
                      <EntryCard
                        key={entry.id}
                        entry={entry}
                        expanded={expandedEntries.has(entry.id)}
                        onToggle={() => toggleEntry(entry.id)}
                        isEditing={editingDetailId === entry.id}
                        onEdit={() => startEditEntry(entry)}
                        onSave={saveEditEntry}
                        onCancel={cancelEditEntry}
                        onDelete={() => handleDeleteEntry(entry)}
                        editTitle={editDetailTitle}
                        setEditTitle={setEditDetailTitle}
                        editContent={editDetailContent}
                        setEditContent={setEditDetailContent}
                        editInternal={editDetailInternal}
                        setEditInternal={setEditDetailInternal}
                        bulkMode={bulkMode}
                        bulkSelected={bulkSelected.has(entry.id)}
                        onBulkToggle={() => toggleBulkSelect(entry.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* No results for search/filter */}
              {filteredTotal === 0 && (searchLower || sourceFilter !== 'all' || scopeFilter !== 'all') && (
                <div className="text-center py-8">
                  <Search size={32} className="mx-auto text-slate-200 mb-3" />
                  <p className="text-sm text-slate-500">
                    No entries match {searchLower ? `"${detailSearch}"` : 'these filters'}
                  </p>
                  <button
                    onClick={() => { setDetailSearch(''); setSourceFilter('all'); setScopeFilter('all'); }}
                    className="text-xs text-indigo-500 hover:text-indigo-700 mt-2"
                  >
                    Clear all filters
                  </button>
                </div>
              )}

              {/* Add custom entry — always visible at bottom when not searching */}
              {!searchLower && (
                <div className="pt-1">
                  {addEntryFormJsx}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Host List View ────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden animate-in fade-in duration-200">
      {/* Ingestion Modal — with extraction preview (Rec #9) */}
      {showIngestionModal && (
        <div className={`fixed inset-0 bg-black/50 z-50 flex items-center justify-center ${isMobile ? 'p-2' : 'p-4'} animate-in fade-in duration-200`}>
          <div className={`bg-white rounded-xl shadow-2xl max-w-lg w-full ${isMobile ? 'p-4' : 'p-6'} animate-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600"><Upload size={20} /></div>
                <div>
                  <h3 className="font-bold text-slate-800">
                    {ingestionStep === 'upload' ? 'Upload Document' : `Review Extracted Entries`}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {ingestionStep === 'upload' ? 'AI will extract entries from the document.' : `From "${ingestionFile}" — select which entries to import.`}
                  </p>
                </div>
              </div>
              <button onClick={() => { setShowIngestionModal(false); setIngestionStep('upload'); setIngestionFile(''); }} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            {ingestionStep === 'upload' && (
              <>
                <div className="space-y-4 mb-5">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Target Company <span className="text-red-500">*</span></label>
                    <select
                      value={ingestionHost}
                      onChange={(e) => { setIngestionHost(e.target.value); setIngestionProperty(''); }}
                      className="w-full text-sm border border-slate-300 rounded-lg p-2.5 focus:ring-1 focus:ring-indigo-500 outline-none bg-slate-50"
                    >
                      <option value="">Select Company...</option>
                      {MOCK_HOSTS.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Target Property (Optional)</label>
                    <select
                      value={ingestionProperty}
                      onChange={(e) => setIngestionProperty(e.target.value)}
                      disabled={!ingestionHost}
                      className="w-full text-sm border border-slate-300 rounded-lg p-2.5 focus:ring-1 focus:ring-indigo-500 outline-none bg-slate-50 disabled:opacity-50"
                    >
                      <option value="">All properties (company-wide)</option>
                      {properties.filter(p => !ingestionHost || p.hostId === ingestionHost).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {ingestionHost && (
                  <div className="mb-4 p-2.5 rounded-lg border flex items-center gap-2 text-xs font-bold" style={{
                    backgroundColor: ingestionProperty ? 'rgb(239 246 255)' : 'rgb(250 245 255)',
                    borderColor: ingestionProperty ? 'rgb(191 219 254)' : 'rgb(221 214 254)',
                    color: ingestionProperty ? 'rgb(29 78 216)' : 'rgb(109 40 217)',
                  }}>
                    {ingestionProperty ? <Building size={12} /> : <Globe2 size={12} />}
                    Will apply to: {ingestionProperty ? properties.find(p => p.id === ingestionProperty)?.name : `All ${MOCK_HOSTS.find(h => h.id === ingestionHost)?.name} properties`}
                  </div>
                )}

                <input ref={fileInputRef} type="file" accept=".xlsx,.pdf,.csv,.txt,.json" className="hidden" onChange={handleFileSelected} />
                <div
                  onClick={handleUpload}
                  className="border-2 border-dashed border-indigo-200 bg-indigo-50/50 rounded-xl p-8 flex flex-col items-center justify-center text-center hover:bg-indigo-50 hover:border-indigo-400 transition-colors cursor-pointer group"
                >
                  <Upload size={28} className="text-indigo-500 mb-2 group-hover:scale-110 transition-transform" />
                  <p className="text-sm font-bold text-slate-700">Choose a File to Upload</p>
                  <p className="text-[10px] text-slate-500 mt-1">XLSX, PDF, CSV, TXT, JSON</p>
                </div>
              </>
            )}

            {/* Rec #9: Extraction preview step */}
            {ingestionStep === 'preview' && (
              <>
                <div className="flex-1 overflow-y-auto space-y-2 mb-4">
                  {ingestionPreviewEntries.map((entry, idx) => {
                    const isSelected = ingestionSelectedEntries.has(idx);
                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          setIngestionSelectedEntries(prev => {
                            const next = new Set(prev);
                            next.has(idx) ? next.delete(idx) : next.add(idx);
                            return next;
                          });
                        }}
                        className={`border rounded-lg p-3 cursor-pointer transition-all ${
                          isSelected ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {isSelected ? <CheckSquare size={14} className="text-indigo-600 shrink-0" /> : <Square size={14} className="text-slate-300 shrink-0" />}
                          <h4 className="text-xs font-bold text-slate-700">{entry.title}</h4>
                          <div className="flex gap-1 ml-auto">
                            {entry.tags.map(t => <span key={t} className="text-[8px] text-slate-400 bg-slate-100 px-1 py-0.5 rounded">{t}</span>)}
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed ml-6">{entry.content}</p>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                  <button
                    onClick={() => { setIngestionStep('upload'); setIngestionFile(''); }}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    Back
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-400">{ingestionSelectedEntries.size} of {ingestionPreviewEntries.length} selected</span>
                    <button
                      onClick={confirmIngestion}
                      disabled={ingestionSelectedEntries.size === 0}
                      className="px-4 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Check size={14} /> Import {ingestionSelectedEntries.size} {ingestionSelectedEntries.size === 1 ? 'Entry' : 'Entries'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="bg-white border-b border-slate-200 px-3 md:px-6 py-3 md:py-4 shrink-0 shadow-sm z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className={`${isMobile ? 'text-lg' : 'text-xl'} font-bold flex items-center gap-2`}><Briefcase size={isMobile ? 18 : 20} className="text-slate-500"/> Knowledge Base</h1>
            {!isMobile && <p className="text-xs text-slate-500 mt-0.5">Everything the AI needs to answer guest questions</p>}
          </div>
          <button
            onClick={() => setShowIngestionModal(true)}
            className="px-3 py-2 text-xs font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 flex items-center gap-2 shadow-sm transition-colors border border-slate-200"
          >
            <Upload size={14} /> {isMobile ? 'Upload' : 'Upload Document'}
          </button>
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto ${isMobile ? 'p-3' : 'p-6'}`}>
        <div className={`grid grid-cols-1 ${!isMobile ? 'lg:grid-cols-3' : ''} gap-4 md:gap-6 max-w-7xl mx-auto`}>

          {/* Hierarchical Client List */}
          <div className={showScopeGuide && !isMobile ? 'lg:col-span-2 space-y-4 md:space-y-6' : (!isMobile ? 'lg:col-span-3' : '') + ' space-y-4 md:space-y-6'}>
            {displayHosts.map(host => {
              const hostProperties = properties.filter(p => p.hostId === host.id);
              const globalRules = kbEntries.filter(kb => kb.hostId === host.id && kb.scope === 'Host Global');
              const isGlobalExpanded = expandedGlobalHost === host.id;
              return (
                <div key={host.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className={`bg-slate-900 ${isMobile ? 'p-3' : 'p-4'} flex items-center justify-between text-white`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`${isMobile ? 'w-7 h-7 text-sm' : 'w-8 h-8'} rounded flex items-center justify-center font-bold shrink-0 ${host.brandColor}`}>
                        {host.name.charAt(0)}
                      </div>
                      <h2 className={`font-bold ${isMobile ? 'text-base' : 'text-lg'} truncate`}>{host.name}</h2>
                    </div>
                    <span className="text-[10px] text-slate-400 bg-white/10 px-2 py-1 rounded">
                      {kbEntries.filter(kb => kb.hostId === host.id).length} entries total
                    </span>
                  </div>

                  {/* Company-Level Rules — now inline editable (Rec #5) */}
                  <div className="border-b border-slate-200">
                    <button
                      onClick={() => setExpandedGlobalHost(isGlobalExpanded ? null : host.id)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-purple-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-purple-100 rounded-md text-purple-600">
                          <Globe2 size={14} />
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-bold text-slate-700 flex items-center gap-2">
                            Company-Wide Rules
                            <span className="text-[10px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">{globalRules.length}</span>
                          </p>
                          <p className="text-[10px] text-slate-400">Apply to all properties</p>
                        </div>
                      </div>
                      {isGlobalExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                    </button>

                    {isGlobalExpanded && (
                      <div className="px-4 pb-4 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                        {globalRules.length > 0 ? globalRules.map(rule => (
                          <div key={rule.id} className="bg-white border border-slate-200 rounded-lg p-3 group/grule">
                            {listEditingId === rule.id ? (
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  value={listEditTitle}
                                  onChange={(e) => setListEditTitle(e.target.value)}
                                  className="w-full border border-indigo-200 rounded text-xs py-1.5 px-2.5 focus:ring-1 focus:ring-indigo-500 outline-none bg-white font-bold"
                                  autoFocus
                                />
                                <textarea
                                  value={listEditContent}
                                  onChange={(e) => setListEditContent(e.target.value)}
                                  className="w-full border border-indigo-200 rounded text-xs py-1.5 px-2.5 focus:ring-1 focus:ring-indigo-500 outline-none resize-none min-h-[60px] bg-white leading-relaxed"
                                />
                                <div className="flex gap-2 justify-end">
                                  <button onClick={() => setListEditingId(null)} className="px-2.5 py-1 text-[10px] text-slate-600 hover:bg-slate-100 rounded transition-colors">Cancel</button>
                                  <button
                                    onClick={() => {
                                      if (listEditTitle.trim() && listEditContent.trim()) {
                                        updateKBEntry(rule.id, { title: listEditTitle.trim(), content: listEditContent.trim() });
                                        setListEditingId(null);
                                        toast.success('Rule updated');
                                      }
                                    }}
                                    className="px-2.5 py-1 text-[10px] bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-1 transition-colors"
                                  >
                                    <Save size={10} /> Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 mb-1">
                                  <h4 className="text-xs font-bold text-slate-700">{rule.title}</h4>
                                  <ScopeBadge scope={rule.scope} />
                                  {rule.internal && (
                                    <span className="text-[9px] font-medium text-amber-700 bg-amber-50 px-1 py-0.5 rounded border border-amber-200">Agent-only</span>
                                  )}
                                  {/* Rec #5: Inline edit/delete buttons */}
                                  <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/grule:opacity-100 transition-opacity">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setListEditingId(rule.id); setListEditTitle(rule.title); setListEditContent(rule.content); }}
                                      className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                                      title="Edit rule"
                                    ><Pencil size={11} /></button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); deleteKBEntry(rule.id); toast.success(`"${rule.title}" deleted`); }}
                                      className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                      title="Delete rule"
                                    ><Trash2 size={11} /></button>
                                  </div>
                                </div>
                                <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-2">{rule.content}</p>
                              </>
                            )}
                          </div>
                        )) : (
                          <div className="text-center py-4">
                            <p className="text-[10px] text-slate-400">No company-wide rules yet.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className={`${isMobile ? 'p-2.5' : 'p-4'} space-y-2 bg-slate-50`}>
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Properties ({hostProperties.length})</h3>
                    {hostProperties.map(propItem => {
                      const propTotalCount = kbEntries.filter(kb => kb.propId === propItem.id || (kb.hostId === propItem.hostId && kb.scope === 'Host Global')).length;
                      const isSetup = propItem.status === 'Onboarding';
                      return (
                        <div
                          key={propItem.id}
                          onClick={() => isSetup ? navigate(`/kb/onboard/${propItem.id}`) : navigateToProperty(propItem.id)}
                          className="bg-white border border-slate-200 rounded-lg overflow-hidden hover:border-indigo-300 transition-colors cursor-pointer group shadow-sm"
                        >
                          <div className="p-3 flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="p-2 bg-slate-100 rounded-md text-slate-500 shrink-0"><Building size={16}/></div>
                              <div className="min-w-0">
                                <p className="font-bold text-sm text-slate-800 flex items-center gap-2">
                                  <span className="truncate">{propItem.name}</span>
                                  {isSetup && (
                                    <span className="bg-amber-100 text-amber-700 text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wide shrink-0">Setup</span>
                                  )}
                                </p>
                                <p className="text-xs text-slate-500">{propItem.location} &bull; {propItem.units} {propItem.units === 1 ? 'Unit' : 'Units'}</p>
                              </div>
                            </div>
                            <div className={`flex items-center gap-2 shrink-0 ${isMobile ? 'ml-auto' : ''}`}>
                              {propItem.lastSyncedAt && !isMobile && (
                                <span className={`text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded ${
                                  isStaleSince(propItem.lastSyncedAt)
                                    ? 'text-red-600 bg-red-50 border border-red-200 font-bold'
                                    : 'text-slate-400'
                                }`}>
                                  <Clock size={9} />
                                  {relativeTime(propItem.lastSyncedAt)}
                                  {isStaleSince(propItem.lastSyncedAt) && (
                                    <AlertTriangle size={9} className="text-red-500" />
                                  )}
                                </span>
                              )}
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${propTotalCount > 0 ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 bg-slate-50'}`}>
                                {propTotalCount} {propTotalCount === 1 ? 'entry' : 'entries'}
                              </span>
                              <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-500 transition-colors" />
                            </div>
                          </div>
                          {isSetup && (
                            <div className="px-3 pb-3">
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg">
                                <Rocket size={11} /> Start Onboarding
                              </span>
                              {propTotalCount === 0 && (
                                <span className="text-[10px] text-slate-400 ml-2">No AI knowledge yet</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right Column — Scope Guide (Rec #10: persistent dismissal) */}
          {showScopeGuide && !isMobile && (
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm relative">
                <button
                  onClick={dismissScopeGuide}
                  className="absolute top-3 right-3 text-slate-300 hover:text-slate-500 transition-colors"
                  title="Dismiss guide"
                >
                  <X size={14} />
                </button>
                <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><Layers size={16} className="text-slate-500"/> How AI Knowledge Is Organized</h3>
                <p className="text-xs text-slate-500 mb-4">Rules cascade downward. A company-wide rule automatically applies to every property and room.</p>
                <div className="space-y-0">
                  <div className="flex items-start gap-3 p-2.5 rounded-t-lg bg-purple-50 border border-purple-200 border-b-0">
                    <div className="p-1 bg-purple-200 rounded text-purple-700 mt-0.5"><Globe2 size={12} /></div>
                    <div>
                      <p className="text-xs font-bold text-purple-700">Company-Wide</p>
                      <p className="text-[10px] text-purple-500">Rules from headquarters — apply everywhere</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-2.5 bg-blue-50 border-x border-blue-200 ml-3">
                    <div className="p-1 bg-blue-200 rounded text-blue-700 mt-0.5"><Building size={12} /></div>
                    <div>
                      <p className="text-xs font-bold text-blue-700">Property Info</p>
                      <p className="text-[10px] text-blue-500">Specific to one property</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-2.5 rounded-b-lg bg-green-50 border border-green-200 border-t-0 ml-6">
                    <div className="p-1 bg-green-200 rounded text-green-700 mt-0.5"><Key size={12} /></div>
                    <div>
                      <p className="text-xs font-bold text-green-700">Room Details</p>
                      <p className="text-[10px] text-green-500">Specific to one unit/room</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-100">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">How property info flows to the AI</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md bg-slate-100 flex items-center justify-center shrink-0"><Settings2 size={10} className="text-slate-500" /></div>
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-slate-600">Form Template</p>
                        <p className="text-[9px] text-slate-400">What fields exist (admin setting)</p>
                      </div>
                    </div>
                    <div className="ml-2.5 w-px h-2 bg-slate-200" />
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md bg-indigo-100 flex items-center justify-center shrink-0"><Pencil size={10} className="text-indigo-600" /></div>
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-indigo-700">Property Form</p>
                        <p className="text-[9px] text-slate-400">Fill in values per property</p>
                      </div>
                    </div>
                    <div className="ml-2.5 w-px h-2 bg-slate-200" />
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md bg-green-100 flex items-center justify-center shrink-0"><Sparkles size={10} className="text-green-600" /></div>
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-green-700">AI Knowledge</p>
                        <p className="text-[9px] text-slate-400">What you see here — compiled output</p>
                      </div>
                    </div>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-3 leading-relaxed">
                    Form-generated entries auto-sync whenever you edit the property form. Manually added entries are always preserved.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Show guide toggle when hidden (Rec #10) */}
          {!showScopeGuide && !isMobile && (
            <div className="lg:col-span-3 flex justify-end -mt-4">
              <button
                onClick={() => { setShowScopeGuide(true); try { localStorage.removeItem('kb_scope_guide_dismissed'); } catch {} }}
                className="text-[10px] text-indigo-500 hover:text-indigo-700 flex items-center gap-1 font-medium"
              >
                <Info size={10} /> How AI knowledge is organized
              </button>
            </div>
          )}
        </div>
      </div>

      <ReingestReviewModal
        open={reingestState !== null}
        doc={reingestState?.doc ?? null}
        diff={reingestState?.diff ?? null}
        onCancel={() => { setReingestState(null); setIngestionFile(''); }}
        onApply={applyReingest}
      />
    </div>
  );
}

// ─── Entry Card (Rec #11: simplified badges, #12: bulk mode, #13: renamed internal) ──

function EntryCard({ entry, expanded, onToggle, isEditing, onEdit, onSave, onCancel, onDelete, editTitle, setEditTitle, editContent, setEditContent, editInternal, setEditInternal, bulkMode, bulkSelected, onBulkToggle }: {
  entry: KBEntry;
  expanded: boolean;
  onToggle: () => void;
  isEditing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  editTitle: string;
  setEditTitle: (v: string) => void;
  editContent: string;
  setEditContent: (v: string) => void;
  editInternal: boolean;
  setEditInternal: (v: boolean) => void;
  bulkMode?: boolean;
  bulkSelected?: boolean;
  onBulkToggle?: () => void;
}) {
  const isLong = entry.content.length > 120;

  // Editing mode
  if (isEditing) {
    return (
      <div className="bg-indigo-50 border border-indigo-300 rounded-lg p-3 space-y-2 animate-in fade-in duration-150 ring-2 ring-indigo-200">
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="w-full border border-indigo-200 rounded text-xs py-1.5 px-2.5 focus:ring-1 focus:ring-indigo-500 outline-none bg-white font-bold"
          autoFocus
        />
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          className="w-full border border-indigo-200 rounded text-xs py-1.5 px-2.5 focus:ring-1 focus:ring-indigo-500 outline-none resize-none min-h-[80px] bg-white leading-relaxed"
        />
        <div className="flex items-center justify-between">
          {/* Rec #13: Renamed label */}
          <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer select-none">
            <input type="checkbox" checked={editInternal} onChange={(e) => setEditInternal(e.target.checked)} className="rounded border-slate-300 text-amber-500 focus:ring-amber-500" />
            Agent-only (not shared with guests)
          </label>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-2.5 py-1 text-[10px] text-slate-600 hover:bg-white rounded transition-colors">Cancel</button>
            <button onClick={onSave} className="px-2.5 py-1 text-[10px] bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-1 transition-colors"><Save size={10} /> Save</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`border rounded-lg p-3 transition-all group/card relative ${
        bulkSelected
          ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-200'
          : `bg-white ${expanded ? 'border-indigo-200 ring-1 ring-indigo-100 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`
      }`}
    >
      {/* Bulk checkbox (Rec #12) */}
      {bulkMode && (
        <button
          onClick={(e) => { e.stopPropagation(); onBulkToggle?.(); }}
          className="absolute top-3 left-3 z-10"
        >
          {bulkSelected ? <CheckSquare size={16} className="text-amber-600" /> : <Square size={16} className="text-slate-300" />}
        </button>
      )}

      {/* Hover action buttons */}
      {!bulkMode && (
        <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity z-10">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
            title="Edit entry"
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            title="Delete entry"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}

      <div
        onClick={bulkMode ? () => onBulkToggle?.() : (isLong ? onToggle : undefined)}
        className={bulkMode ? 'cursor-pointer' : (isLong ? 'cursor-pointer' : '')}
        style={bulkMode ? { paddingLeft: 28 } : undefined}
      >
        {/* Rec #11: Simplified badges — source + internal + room only. Tags in expanded view */}
        <div className="flex items-center gap-2 mb-1 flex-wrap pr-16">
          <h4 className="text-xs font-bold text-slate-700">{entry.title}</h4>
          {entry.source === 'manual' && (
            <span className="text-[9px] font-medium text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded border border-indigo-200 flex items-center gap-0.5">
              <Pencil size={7} /> Custom
            </span>
          )}
          {entry.internal && (
            <span className="text-[9px] font-medium text-amber-700 bg-amber-50 px-1 py-0.5 rounded border border-amber-200">Agent-only</span>
          )}
          {entry.roomId && (
            <span className="text-[9px] font-medium text-green-600 bg-green-50 px-1 py-0.5 rounded border border-green-200 flex items-center gap-0.5">
              <Key size={7} /> {entry.roomId}
            </span>
          )}
        </div>
        {expanded || !isLong ? (
          <>
            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{entry.content}</p>
            {/* Rec #11: Tags shown only in expanded view */}
            {expanded && entry.tags && entry.tags.length > 0 && (
              <div className="flex gap-1 mt-2 flex-wrap">
                {entry.tags.map(tag => (
                  <span key={tag} className="text-[9px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{tag}</span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="relative">
            <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">{entry.content}</p>
            <div className="absolute bottom-0 right-0 bg-gradient-to-l from-white via-white to-transparent pl-6 pr-0.5">
              <span className="text-[10px] text-indigo-500 font-medium">show more</span>
            </div>
          </div>
        )}
        {expanded && isLong && (
          <p className="text-[10px] text-indigo-400 mt-1.5 select-none">Click to collapse</p>
        )}
      </div>
    </div>
  );
}
