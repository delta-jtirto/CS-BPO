import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import {
  ArrowLeft, Home, HelpCircle, ClipboardList, AlertTriangle, MessageSquare,
  Workflow, Archive, Lock, Search, AlertCircle, Edit3, Tag, Trash2,
  CheckCircle2, ChevronRight, Menu, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppContext } from '../../context/AppContext';
import type { KnowledgeChunk, KnowledgeKind, ChunkStatus } from '../../data/types';
import { defaultVisibilityForKind } from '../../data/types';
import { stableHash } from '../../lib/storage';
import { useIsMobile } from '../ui/use-mobile';
import { FieldMappingPicker, type FieldMappingPickerPick } from './inspector/FieldMappingPicker';
import { TriageQueue } from './inspector/TriageQueue';

/**
 * Knowledge Inspector — the single browse/edit surface for every chunk in
 * the store. Three columns:
 *
 *   Categories (kind counts)  │  Entries (selected kind)  │  Detail (one entry)
 *
 * Triage mode (when pending_review entries exist): the middle column
 * becomes a queue, the right column auto-opens the first item, and each
 * resolution auto-advances. Never forces a decision — user can exit
 * triage anytime.
 *
 * Everything here reads/writes via AppContext. No direct IndexedDB access.
 * No AI calls — all intelligence already happened in the ingest pipeline.
 */

type CategoryKey =
  | 'needs-review'
  | KnowledgeKind
  | 'archived';

export function KnowledgeInspector() {
  const { propertyId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();

  // Mobile drill-in: which of the three panels is visible at a time.
  // Desktop (≥ md) always shows all three columns — this state is a no-op.
  const [mobileView, setMobileView] = useState<'categories' | 'entries' | 'detail'>(
    // If deep-linked with entryId, land on detail. Else categories (most
    // natural entry point from an OnboardingView "Inspect" tap).
    searchParams.get('entryId') ? 'detail' : 'categories',
  );

  const {
    properties,
    knowledgeChunks,
    ingestedDocuments,
    upsertKnowledgeChunks,
    updateKnowledgeChunk,
    deleteKnowledgeChunks,
    setOnboardingBulk,
    onboardingData,
    formTemplate,
  } = useAppContext();

  const prop = properties.find(p => p.id === propertyId);
  const roomNames = useMemo(() => {
    if (!prop) return [];
    if (prop.roomNames && prop.roomNames.length > 0) return prop.roomNames;
    if (prop.units === 1) return ['Entire Property'];
    return Array.from({ length: prop.units }, (_, i) => `Unit ${i + 1}`);
  }, [prop]);

  // Scope to this property (host-global chunks also show when propId === null).
  const scopedChunks = useMemo(
    () => knowledgeChunks.filter(c =>
      prop && (c.propId === propertyId || (c.propId === null && c.hostId === prop.hostId))
    ),
    [knowledgeChunks, prop, propertyId],
  );

  // Category counts — drives the sidebar.
  const counts = useMemo(() => {
    const out: Record<CategoryKey, number> = {
      'needs-review': 0,
      property_fact: 0,
      faq: 0,
      sop: 0,
      urgency_rule: 0,
      reply_template: 0,
      workflow: 0,
      archived: 0,
    };
    for (const c of scopedChunks) {
      if (c.status === 'pending_review') out['needs-review']++;
      else if (c.status === 'archived') out['archived']++;
      else if (c.status === 'active') out[c.kind]++;
      // 'superseded' hidden from counts — audit trail only
    }
    return out;
  }, [scopedChunks]);

  // Landing rule: if pending > 0, land on triage. Else most populous active kind.
  const [category, setCategory] = useState<CategoryKey>(() => {
    if (counts['needs-review'] > 0) return 'needs-review';
    const kinds: KnowledgeKind[] = ['property_fact', 'faq', 'sop', 'urgency_rule', 'reply_template', 'workflow'];
    let best: KnowledgeKind = 'property_fact';
    for (const k of kinds) if (counts[k] > counts[best]) best = k;
    return best;
  });

  // Deep-link support: ?entryId=xxx selects a specific entry on load.
  const [selectedId, setSelectedIdState] = useState<string | null>(
    searchParams.get('entryId') || null,
  );
  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id);
    // Keep URL in sync so refresh/share preserves the selection.
    if (id) {
      searchParams.set('entryId', id);
    } else {
      searchParams.delete('entryId');
    }
    setSearchParams(searchParams, { replace: true });
    // Mobile drill-in: selecting an entry opens the detail panel.
    if (isMobile && id) setMobileView('detail');
  }, [searchParams, setSearchParams, isMobile]);

  // Mobile: picking a category advances to the entries list.
  const handleCategoryClick = useCallback((next: CategoryKey) => {
    setCategory(next);
    setSelectedId(null);
    if (isMobile) setMobileView('entries');
  }, [isMobile, setSelectedId]);

  // Header back button semantics:
  //   desktop        → always exits to OnboardingView
  //   mobile detail  → back to entries
  //   mobile entries → back to categories
  //   mobile cat     → exit to OnboardingView
  const handleHeaderBack = useCallback(() => {
    if (!isMobile) {
      navigate(`/kb/${propertyId}`);
      return;
    }
    if (mobileView === 'detail') { setSelectedId(null); setMobileView('entries'); return; }
    if (mobileView === 'entries') { setMobileView('categories'); return; }
    navigate(`/kb/${propertyId}`);
  }, [isMobile, mobileView, navigate, propertyId, setSelectedId]);

  // Active entries for the selected category.
  const entries = useMemo(() => {
    if (category === 'needs-review') {
      return scopedChunks.filter(c => c.status === 'pending_review');
    }
    if (category === 'archived') {
      return scopedChunks.filter(c => c.status === 'archived');
    }
    return scopedChunks.filter(c => c.status === 'active' && c.kind === category);
  }, [scopedChunks, category]);

  // Auto-select the first entry when entering a category, unless a deep-link
  // already picked one that's visible in this list.
  useEffect(() => {
    if (entries.length === 0) return;
    if (selectedId && entries.some(e => e.id === selectedId)) return;
    setSelectedId(entries[0].id);
  }, [entries, selectedId, setSelectedId]);

  const selected = useMemo(
    () => scopedChunks.find(c => c.id === selectedId) ?? null,
    [scopedChunks, selectedId],
  );

  // Search — global across title + body + structured (client-side).
  const [search, setSearch] = useState('');
  // Mobile: search bar is hidden behind a magnifier icon to save header space.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const needle = search.toLowerCase();
    return entries.filter(c => {
      if (c.title.toLowerCase().includes(needle)) return true;
      if (c.body.toLowerCase().includes(needle)) return true;
      if (c.structured && JSON.stringify(c.structured).toLowerCase().includes(needle)) return true;
      return false;
    });
  }, [entries, search]);

  // Triage session counter — drives the "8 entries resolved" footer.
  const [resolvedInSession, setResolvedInSession] = useState(0);

  // Detail panel mode: 'view' vs 'edit' vs 'map'.
  const [panelMode, setPanelMode] = useState<'view' | 'edit' | 'map'>('view');
  useEffect(() => { setPanelMode('view'); }, [selectedId]);

  // ─── Mutators ───────────────────────────────────────────────────────
  // All writes happen here so the surfaces (TriageQueue, picker, editor) stay
  // pure view components.

  const advanceTriage = useCallback(() => {
    if (category !== 'needs-review') return;
    const remaining = scopedChunks.filter(
      c => c.status === 'pending_review' && c.id !== selectedId,
    );
    if (remaining.length === 0) {
      setSelectedId(null);
    } else {
      setSelectedId(remaining[0].id);
    }
  }, [category, scopedChunks, selectedId, setSelectedId]);

  const handleDiscard = useCallback((c: KnowledgeChunk) => {
    if (!window.confirm(`Discard "${c.title}"? This cannot be undone.`)) return;
    deleteKnowledgeChunks([c.id]);
    setResolvedInSession(x => x + 1);
    advanceTriage();
  }, [deleteKnowledgeChunks, advanceTriage]);

  const handleKeepGeneral = useCallback((c: KnowledgeChunk) => {
    // Verified orphan: keep as active property_fact with no slotKey.
    updateKnowledgeChunk(c.id, {
      status: 'active',
      isOverride: true,
      source: { ...c.source, editedBy: 'user', editReason: 'Kept as general knowledge' },
    });
    setResolvedInSession(x => x + 1);
    toast.success('Kept as general knowledge');
    advanceTriage();
  }, [updateKnowledgeChunk, advanceTriage]);

  const handleMapField = useCallback(async (c: KnowledgeChunk, pick: FieldMappingPickerPick) => {
    if (pick.kind === 'keep_general') return handleKeepGeneral(c);
    if (pick.kind === 'discard') return handleDiscard(c);

    const { sectionId, fieldId, roomIndex } = pick;
    const roomId = roomIndex !== undefined ? `room${roomIndex}` : null;
    const slotKey = `property_fact:${sectionId}:${fieldId}${roomId ? `:${roomId}` : ''}`;

    // Check if the target already has a value (form OR existing active chunk).
    const formKey = roomId
      ? `${sectionId}__${roomId}__${fieldId}`
      : `${sectionId}__${fieldId}`;
    const existingFormValue = (onboardingData[propertyId || ''] || {})[formKey]?.trim();
    const existingChunk = scopedChunks.find(
      x => x.slotKey === slotKey && x.status === 'active' && x.id !== c.id,
    );
    const existingValue = existingChunk?.body.trim() || existingFormValue;

    let finalBody = c.body;
    if (existingValue) {
      const action = window.prompt(
        `This field already has:\n\n"${existingValue}"\n\n` +
        `Type REPLACE to overwrite with "${c.body}", or type APPEND to keep both (joined with a blank line).\n` +
        `Cancel to abort.`,
        'REPLACE',
      );
      if (!action) return; // cancelled
      const norm = action.trim().toUpperCase();
      if (norm === 'REPLACE') {
        finalBody = c.body;
        if (existingChunk) updateKnowledgeChunk(existingChunk.id, { status: 'archived' });
      } else if (norm === 'APPEND') {
        finalBody = `${existingValue}\n\n${c.body}`;
        if (existingChunk) updateKnowledgeChunk(existingChunk.id, { status: 'archived' });
      } else {
        return; // unrecognized — bail safely
      }
    }

    const now = new Date().toISOString();
    const newChunk: KnowledgeChunk = {
      id: `map-${c.id}-${Date.now()}`,
      hostId: c.hostId,
      propId: c.propId,
      roomId,
      kind: 'property_fact',
      title: c.title,
      body: finalBody,
      chunkHash: await stableHash(JSON.stringify({ body: finalBody, sectionId, fieldId })),
      structured: { sectionId, fieldId, roomIndex, originalTitle: c.title },
      slotKey,
      isOverride: true,
      supersedes: c.id,
      source: {
        type: 'manual',
        editedBy: 'user',
        editReason: 'Mapped from unmapped fact',
        extractedAt: now,
      },
      visibility: defaultVisibilityForKind('property_fact'),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    upsertKnowledgeChunks([newChunk]);
    updateKnowledgeChunk(c.id, { status: 'superseded' });

    // Mirror to onboardingData so the form UI reflects it.
    if (propertyId) setOnboardingBulk(propertyId, { [formKey]: finalBody });

    setResolvedInSession(x => x + 1);
    setPanelMode('view');
    toast.success('Mapped', {
      description: counts['needs-review'] - 1 > 0
        ? `${counts['needs-review'] - 1} more to review`
        : 'All caught up',
    });
    advanceTriage();
  }, [handleKeepGeneral, handleDiscard, onboardingData, propertyId, scopedChunks, updateKnowledgeChunk, upsertKnowledgeChunks, setOnboardingBulk, counts, advanceTriage]);

  const handleRestore = useCallback((c: KnowledgeChunk) => {
    updateKnowledgeChunk(c.id, { status: 'active' });
    toast.success('Restored to active knowledge');
  }, [updateKnowledgeChunk]);

  const handleDeleteNow = useCallback((c: KnowledgeChunk) => {
    if (!window.confirm(`Permanently delete "${c.title}"? This cannot be undone.`)) return;
    deleteKnowledgeChunks([c.id]);
    setSelectedId(null);
  }, [deleteKnowledgeChunks, setSelectedId]);

  const handleSaveEdit = useCallback(async (c: KnowledgeChunk, newTitle: string, newBody: string) => {
    const chunkHash = await stableHash(JSON.stringify({ body: newBody, structured: c.structured ?? null }));
    // If this is a doc chunk being edited, create an override on top of it
    // instead of mutating the doc chunk (preserves doc layer for re-ingests).
    if (c.source.type === 'doc_ingest' && !c.isOverride) {
      const now = new Date().toISOString();
      const override: KnowledgeChunk = {
        ...c,
        id: `override-${c.id}-${Date.now()}`,
        title: newTitle,
        body: newBody,
        chunkHash,
        isOverride: true,
        supersedes: c.id,
        source: {
          type: 'manual',
          editedBy: 'user',
          editReason: 'Edited in Inspector',
          extractedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      };
      upsertKnowledgeChunks([override]);
      toast.success('Saved as override', {
        description: 'Doc re-uploads will not overwrite this edit.',
      });
      setSelectedId(override.id);
    } else {
      updateKnowledgeChunk(c.id, {
        title: newTitle,
        body: newBody,
        chunkHash,
      });
      toast.success('Saved');
    }
    // Sync property_fact edits back to form state.
    if (c.kind === 'property_fact' && c.slotKey && propertyId) {
      const parts = c.slotKey.split(':');
      if (parts.length >= 3 && parts[0] === 'property_fact') {
        const sectionId = parts[1];
        const fieldId = parts[2];
        const roomPart = parts[3];
        const key = roomPart ? `${sectionId}__${roomPart}__${fieldId}` : `${sectionId}__${fieldId}`;
        setOnboardingBulk(propertyId, { [key]: newBody });
      }
    }
    setPanelMode('view');
  }, [updateKnowledgeChunk, upsertKnowledgeChunks, propertyId, setOnboardingBulk, setSelectedId]);

  if (!prop) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        Property not found.
      </div>
    );
  }

  const isTriageMode = category === 'needs-review';

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-6 py-3 flex items-center gap-2 sm:gap-3 shrink-0">
        <button
          onClick={handleHeaderBack}
          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 shrink-0"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider hidden sm:block">Knowledge Inspector</div>
          <h1 className="text-sm font-bold text-slate-800 truncate">
            {isMobile ? mobileViewTitle(mobileView, prop.name, category) : prop.name}
          </h1>
        </div>
        {/* Search — full on tablet+, toggle-icon on mobile */}
        {!isMobile || mobileSearchOpen ? (
          <div className="relative flex-1 sm:flex-initial min-w-0">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              autoFocus={mobileSearchOpen}
              className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-md w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
            />
            {isMobile && (
              <button
                type="button"
                onClick={() => { setMobileSearchOpen(false); setSearch(''); }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-100 text-slate-400"
                aria-label="Close search"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMobileSearchOpen(true)}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-500 shrink-0"
            aria-label="Open search"
          >
            <Search size={18} />
          </button>
        )}
      </div>

      {/* Body — 3 columns on desktop; on mobile, drill-in shows one column
          at a time based on `mobileView`. Tablet (md) still shows all three
          but with narrower widths. */}
      <div className="flex-1 flex min-h-0">
        {/* Column 1: Categories.
            Mobile: only visible when mobileView === 'categories'.
            Desktop: always visible, fixed width. */}
        <aside className={`border-r border-slate-200 bg-white shrink-0 overflow-y-auto ${
          isMobile
            ? (mobileView === 'categories' ? 'w-full' : 'hidden')
            : 'w-52 lg:w-56'
        }`}>
          <div className="p-2 space-y-0.5">
            {counts['needs-review'] > 0 && (
              <CategoryBtn
                active={category === 'needs-review'}
                onClick={() => handleCategoryClick('needs-review')}
                icon={<AlertCircle size={14} className="text-amber-600" />}
                label="Needs Review"
                count={counts['needs-review']}
                badgeTone="amber"
              />
            )}
            <CategoryBtn active={category === 'property_fact'} onClick={() => handleCategoryClick('property_fact')} icon={<Home size={14} />} label="Property Facts" count={counts.property_fact} />
            <CategoryBtn active={category === 'faq'} onClick={() => handleCategoryClick('faq')} icon={<HelpCircle size={14} />} label="FAQs" count={counts.faq} />
            <CategoryBtn active={category === 'sop'} onClick={() => handleCategoryClick('sop')} icon={<ClipboardList size={14} />} label="SOPs" count={counts.sop} internal />
            <CategoryBtn active={category === 'urgency_rule'} onClick={() => handleCategoryClick('urgency_rule')} icon={<AlertTriangle size={14} />} label="Urgency Rules" count={counts.urgency_rule} internal />
            <CategoryBtn active={category === 'reply_template'} onClick={() => handleCategoryClick('reply_template')} icon={<MessageSquare size={14} />} label="Reply Templates" count={counts.reply_template} internal />
            <CategoryBtn active={category === 'workflow'} onClick={() => handleCategoryClick('workflow')} icon={<Workflow size={14} />} label="Workflows" count={counts.workflow} internal />
            <CategoryBtn active={category === 'archived'} onClick={() => handleCategoryClick('archived')} icon={<Archive size={14} />} label="Archived" count={counts.archived} />
          </div>

          {/* Recent imports — passive context */}
          {ingestedDocuments.filter(d => d.propId === propertyId).length > 0 && (
            <div className="px-2 py-2 border-t border-slate-100 mt-2">
              <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider px-2 py-1">
                Recent imports
              </div>
              {ingestedDocuments
                .filter(d => d.propId === propertyId)
                .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
                .slice(0, 5)
                .map(d => (
                  <div key={d.id} className="px-2 py-1 text-[10px] text-slate-600 truncate" title={d.filename}>
                    {d.filename}
                    <span className="text-slate-400 ml-1">· {d.chunkIds.length}</span>
                  </div>
                ))}
            </div>
          )}
        </aside>

        {/* Column 2: Entries.
            Mobile: visible only when mobileView === 'entries'.
            Tablet/Desktop: always visible, flexes to fill. */}
        <section className={`border-r border-slate-200 bg-white min-w-0 flex flex-col ${
          isMobile
            ? (mobileView === 'entries' ? 'w-full flex-1' : 'hidden')
            : 'flex-1'
        }`}>
          {isTriageMode ? (
            <TriageQueue
              chunks={filteredEntries}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onExit={() => handleCategoryClick(counts.property_fact > 0 ? 'property_fact' : 'faq')}
              resolvedInSession={resolvedInSession}
            />
          ) : (
            <EntryList
              entries={filteredEntries}
              selectedId={selectedId}
              onSelect={setSelectedId}
              category={category}
            />
          )}
        </section>

        {/* Column 3: Detail.
            Mobile: visible only when mobileView === 'detail' (full width).
            Tablet: narrower (w-80). Desktop: w-[28rem]. */}
        <aside className={`bg-white shrink-0 overflow-y-auto ${
          isMobile
            ? (mobileView === 'detail' ? 'w-full flex-1' : 'hidden')
            : 'w-80 lg:w-[28rem]'
        }`}>
          {!selected ? (
            <div className="p-6 text-sm text-slate-400 text-center">
              Select an entry to see details
            </div>
          ) : panelMode === 'map' ? (
            <FieldMappingPicker
              entryTitle={selected.title}
              formTemplate={formTemplate}
              roomNames={roomNames}
              onPick={pick => handleMapField(selected, pick)}
              onCancel={() => setPanelMode('view')}
            />
          ) : panelMode === 'edit' ? (
            <EntryEditor
              chunk={selected}
              onSave={(title, body) => handleSaveEdit(selected, title, body)}
              onCancel={() => setPanelMode('view')}
            />
          ) : (
            <EntryDetail
              chunk={selected}
              onEdit={() => setPanelMode('edit')}
              onMap={() => setPanelMode('map')}
              onKeepGeneral={() => handleKeepGeneral(selected)}
              onDiscard={() => handleDiscard(selected)}
              onRestore={() => handleRestore(selected)}
              onDeleteNow={() => handleDeleteNow(selected)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Mobile header title — contextualises the view so the user always knows
 *  where they are in the drill-in without needing three visible columns. */
function mobileViewTitle(
  view: 'categories' | 'entries' | 'detail',
  propName: string,
  category: CategoryKey,
): string {
  if (view === 'categories') return propName;
  if (view === 'detail') return 'Entry';
  return CATEGORY_LABEL[category];
}

const CATEGORY_LABEL: Record<CategoryKey, string> = {
  'needs-review': 'Needs Review',
  property_fact: 'Property Facts',
  faq: 'FAQs',
  sop: 'SOPs',
  urgency_rule: 'Urgency Rules',
  reply_template: 'Reply Templates',
  workflow: 'Workflows',
  archived: 'Archived',
};

// ─── Sidebar: category button ──────────────────────────────────────────

function CategoryBtn({
  active, onClick, icon, label, count, internal, badgeTone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  internal?: boolean;
  badgeTone?: 'amber';
}) {
  const disabled = count === 0 && !active;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[13px] transition-colors ${
        active
          ? 'bg-indigo-50 text-indigo-900 font-semibold'
          : disabled
            ? 'text-slate-300 cursor-default'
            : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {internal && <Lock size={10} className="text-slate-400 shrink-0" />}
      <span className={`text-[10px] shrink-0 px-1.5 py-0.5 rounded-full ${
        badgeTone === 'amber'
          ? 'bg-amber-100 text-amber-900 font-bold'
          : active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
      }`}>{count}</span>
    </button>
  );
}

// ─── Middle: entries list (non-triage) ─────────────────────────────────

function EntryList({
  entries, selectedId, onSelect, category,
}: {
  entries: KnowledgeChunk[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  category: CategoryKey;
}) {
  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-slate-400 p-6 text-center">
        {category === 'archived'
          ? 'No archived entries. Chunks removed by re-uploads land here.'
          : 'No entries in this category yet. Upload a doc to populate.'}
      </div>
    );
  }
  return (
    <ul className="flex-1 overflow-y-auto divide-y divide-slate-100">
      {entries.map(c => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onSelect(c.id)}
            className={`w-full text-left px-3 py-2.5 transition-colors ${
              selectedId === c.id
                ? 'bg-indigo-50 border-l-2 border-indigo-500 pl-[calc(0.75rem-2px)]'
                : 'hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2">
              {/* Status icon (prominent, left) — only renders for non-active states */}
              {c.status === 'archived' && <Archive size={12} className="text-slate-400 shrink-0" />}
              {c.isOverride && c.status === 'active' && <span className="text-emerald-500 shrink-0">●</span>}
              <span className="text-sm text-slate-800 truncate font-medium flex-1">{c.title}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
              <span className="truncate flex-1">
                {c.body.slice(0, 80)}{c.body.length > 80 ? '…' : ''}
              </span>
              {/* Provenance (muted, right) */}
              {c.source.docSheet && (
                <span className="shrink-0 tabular-nums">
                  {c.source.docSheet}{c.source.docRow !== undefined ? `·R${c.source.docRow}` : ''}
                </span>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Right: entry detail panel ────────────────────────────────────────

function EntryDetail({
  chunk, onEdit, onMap, onKeepGeneral, onDiscard, onRestore, onDeleteNow,
}: {
  chunk: KnowledgeChunk;
  onEdit: () => void;
  onMap: () => void;
  onKeepGeneral: () => void;
  onDiscard: () => void;
  onRestore: () => void;
  onDeleteNow: () => void;
}) {
  const isPending = chunk.status === 'pending_review';
  const isUnmappedFact = chunk.kind === 'property_fact' && !chunk.slotKey;
  const isArchived = chunk.status === 'archived';
  const daysUntilDelete = isArchived
    ? Math.max(0, 90 - Math.floor((Date.now() - new Date(chunk.updatedAt).getTime()) / 86400000))
    : null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b">
        <div className="flex items-start gap-2">
          <KindIcon kind={chunk.kind} />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 leading-tight">{chunk.title}</h2>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {chunk.kind.replace('_', ' ')}
              {chunk.isOverride && <span className="ml-1.5 text-emerald-600 font-medium">· your edit</span>}
              {chunk.visibility === 'internal' && <span className="ml-1.5 text-slate-400">· 🔒 internal</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Pending banner */}
        {isPending && (
          <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="text-[11px] text-amber-900">
              {isUnmappedFact
                ? "AI found this fact but couldn't match it to a known field. Map it, keep as general knowledge, or discard."
                : 'Low confidence — verify before using.'}
            </div>
          </div>
        )}

        {/* Archive banner + countdown */}
        {isArchived && (
          <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <div className="flex items-start gap-2 text-[11px] text-slate-700">
              <Archive size={14} className="shrink-0 mt-0.5" />
              <div>
                Archived — missing from latest upload{chunk.source.docSheet ? ` of ${chunk.source.docSheet}` : ''}.
              </div>
            </div>
            {daysUntilDelete !== null && (
              <div className="text-[10px] text-slate-500 pl-6">
                Auto-deletes in {daysUntilDelete} days
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div>
          <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Current value</div>
          <div className="text-sm text-slate-900 whitespace-pre-wrap p-3 rounded-lg bg-slate-50 border border-slate-200">
            {chunk.body}
          </div>
        </div>

        {/* Original doc text (if different) */}
        {chunk.source.originalText && chunk.source.originalText.trim() !== chunk.body.trim() && (
          <div>
            <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Original from source</div>
            <pre className="text-xs text-slate-600 whitespace-pre-wrap p-3 rounded-lg bg-white border border-slate-200 font-mono">
              {chunk.source.originalText}
            </pre>
          </div>
        )}

        {/* Structured (per-kind) */}
        {chunk.structured && Object.keys(chunk.structured).length > 0 && chunk.kind !== 'property_fact' && (
          <div>
            <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Structured fields</div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              {Object.entries(chunk.structured).map(([k, v]) => (
                <div key={k} className="text-xs flex gap-2">
                  <span className="text-slate-500 w-24 shrink-0">{k}</span>
                  <span className="text-slate-800 flex-1 break-words">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Provenance */}
        <div className="text-[10px] text-slate-500 pt-2 border-t border-slate-100 space-y-0.5">
          {chunk.source.type === 'doc_ingest' && (
            <div>From {chunk.source.docSheet ?? 'document'}
              {chunk.source.docRow !== undefined ? ` · Row ${chunk.source.docRow}` : ''}
            </div>
          )}
          {chunk.source.editedBy && (
            <div>Edited by {chunk.source.editedBy}{chunk.source.editReason ? ` · ${chunk.source.editReason}` : ''}</div>
          )}
          <div>Updated {new Date(chunk.updatedAt).toLocaleString()}</div>
          {chunk.slotKey && (
            <div className="font-mono text-[9px] text-slate-400">{chunk.slotKey}</div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="border-t px-4 py-3 flex flex-wrap gap-2">
        {isPending && isUnmappedFact ? (
          <>
            <button type="button" onClick={onMap} className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 inline-flex items-center gap-1.5">
              <ChevronRight size={12} /> Map to field
            </button>
            <button type="button" onClick={onKeepGeneral} className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 inline-flex items-center gap-1.5">
              <Tag size={12} /> Keep as general
            </button>
            <button type="button" onClick={onDiscard} className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-red-600 inline-flex items-center gap-1.5">
              <Trash2 size={12} /> Discard
            </button>
          </>
        ) : isPending ? (
          <>
            <button type="button" onClick={onKeepGeneral} className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 inline-flex items-center gap-1.5">
              <CheckCircle2 size={12} /> Approve
            </button>
            <button type="button" onClick={onEdit} className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 inline-flex items-center gap-1.5">
              <Edit3 size={12} /> Edit
            </button>
            <button type="button" onClick={onDiscard} className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-red-600 inline-flex items-center gap-1.5">
              <Trash2 size={12} /> Discard
            </button>
          </>
        ) : isArchived ? (
          <>
            <button type="button" onClick={onRestore} className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700">
              Restore
            </button>
            <button type="button" onClick={onDeleteNow} className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-red-600">
              Delete now
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onEdit} className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 inline-flex items-center gap-1.5">
              <Edit3 size={12} /> Edit
            </button>
            <button type="button" onClick={onDiscard} className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-red-600 inline-flex items-center gap-1.5">
              <Archive size={12} /> Archive
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Right: inline editor ─────────────────────────────────────────────

function EntryEditor({
  chunk, onSave, onCancel,
}: {
  chunk: KnowledgeChunk;
  onSave: (title: string, body: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(chunk.title);
  const [body, setBody] = useState(chunk.body);
  const dirty = title !== chunk.title || body !== chunk.body;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider">Editing</div>
        <div className="text-sm font-medium text-slate-800">{chunk.title}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <label className="block">
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Title</span>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Content</span>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={10}
            className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded font-sans focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
          />
        </label>
        {chunk.source.type === 'doc_ingest' && !chunk.isOverride && (
          <div className="text-[10px] text-slate-500 px-2 py-1.5 bg-indigo-50 border border-indigo-100 rounded">
            Saving will create an override — the original from {chunk.source.docSheet ?? 'the doc'} stays untouched,
            and doc re-uploads won't overwrite your edit.
          </div>
        )}
      </div>
      <div className="border-t px-4 py-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(title, body)}
          disabled={!dirty || !title.trim() || !body.trim()}
          className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ─── Per-kind icon in detail header ──────────────────────────────────

function KindIcon({ kind }: { kind: KnowledgeKind }) {
  const common = 'text-slate-400 shrink-0 mt-0.5';
  switch (kind) {
    case 'property_fact': return <Home size={14} className={common} />;
    case 'faq': return <HelpCircle size={14} className={common} />;
    case 'sop': return <ClipboardList size={14} className={common} />;
    case 'urgency_rule': return <AlertTriangle size={14} className={common} />;
    case 'reply_template': return <MessageSquare size={14} className={common} />;
    case 'workflow': return <Workflow size={14} className={common} />;
  }
}

// Suppress unused-import linting on icons that only appear in JSX conditionals.
void ChevronRight;
