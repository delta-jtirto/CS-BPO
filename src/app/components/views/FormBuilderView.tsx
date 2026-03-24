import { useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import {
  ArrowLeft, Plus, Trash2, ChevronDown, ChevronRight,
  GripVertical, Pencil, Save, Eye, EyeOff, Settings2,
  FileText, ToggleLeft, Type, List, Hash, Clock, Phone, Link2,
  AlertTriangle, Check, Copy, Undo2, Info, Diff, X, BedDouble, Building2,
  LayoutList, Layers
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppContext } from '../../context/AppContext';
import type { FormPhase } from '../../context/AppContext';
import { ONBOARDING_SECTIONS as STATIC_SECTIONS } from '../../data/onboarding-template';
import type { OnboardingField, OnboardingSection, FieldType } from '../../data/onboarding-template';

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string; icon: React.ReactNode }[] = [
  { value: 'text', label: 'Short Text', icon: <Type size={12} /> },
  { value: 'textarea', label: 'Long Text', icon: <FileText size={12} /> },
  { value: 'select', label: 'Dropdown', icon: <List size={12} /> },
  { value: 'toggle', label: 'Toggle / Checkbox', icon: <ToggleLeft size={12} /> },
  { value: 'number', label: 'Number', icon: <Hash size={12} /> },
  { value: 'time', label: 'Time', icon: <Clock size={12} /> },
  { value: 'phone', label: 'Phone', icon: <Phone size={12} /> },
  { value: 'url', label: 'URL', icon: <Link2 size={12} /> },
];

const DND_SECTION = 'FORM_BUILDER_SECTION';
const DND_FIELD = 'FORM_BUILDER_FIELD';

const PHASE_COLOR_MAP: Record<string, { dot: string; bg: string; text: string; border: string }> = {
  red:    { dot: 'bg-red-400',    bg: 'bg-red-100',    text: 'text-red-600',    border: 'border-red-200' },
  blue:   { dot: 'bg-blue-400',   bg: 'bg-blue-100',   text: 'text-blue-600',   border: 'border-blue-200' },
  green:  { dot: 'bg-green-400',  bg: 'bg-green-100',  text: 'text-green-600',  border: 'border-green-200' },
  amber:  { dot: 'bg-amber-400',  bg: 'bg-amber-100',  text: 'text-amber-600',  border: 'border-amber-200' },
  purple: { dot: 'bg-purple-400', bg: 'bg-purple-100', text: 'text-purple-600', border: 'border-purple-200' },
  pink:   { dot: 'bg-pink-400',   bg: 'bg-pink-100',   text: 'text-pink-600',   border: 'border-pink-200' },
  cyan:   { dot: 'bg-cyan-400',   bg: 'bg-cyan-100',   text: 'text-cyan-600',   border: 'border-cyan-200' },
  orange: { dot: 'bg-orange-400', bg: 'bg-orange-100', text: 'text-orange-600', border: 'border-orange-200' },
  slate:  { dot: 'bg-slate-400',  bg: 'bg-slate-100',  text: 'text-slate-600',  border: 'border-slate-200' },
};
const DEFAULT_PHASE_COLORS = PHASE_COLOR_MAP['slate'];
const AVAILABLE_COLORS = Object.keys(PHASE_COLOR_MAP);

function getPhaseColors(color: string) {
  return PHASE_COLOR_MAP[color] || DEFAULT_PHASE_COLORS;
}

function fieldTypeIcon(type: FieldType) {
  return FIELD_TYPE_OPTIONS.find(o => o.value === type)?.icon || <Type size={12} />;
}
function fieldTypeLabel(type: FieldType) {
  return FIELD_TYPE_OPTIONS.find(o => o.value === type)?.label || type;
}

// ─── Draggable Section Item ──────────────────────────────────────────────────

interface DragSectionItem { type: string; index: number; id: string }

function DraggableSectionItem({
  section, index, isSelected, onSelect, onMove, phases,
}: {
  section: OnboardingSection;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onMove: (from: number, to: number) => void;
  phases: FormPhase[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: DND_SECTION,
    item: (): DragSectionItem => ({ type: DND_SECTION, index, id: section.id }),
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  const [, drop] = useDrop({
    accept: DND_SECTION,
    hover(item: DragSectionItem, monitor) {
      if (!ref.current) return;
      const dragIndex = item.index;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) return;

      const hoverBoundingRect = ref.current.getBoundingClientRect();
      const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
      const clientOffset = monitor.getClientOffset();
      if (!clientOffset) return;
      const hoverClientY = clientOffset.y - hoverBoundingRect.top;

      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) return;
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) return;

      onMove(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  });

  drag(drop(ref));

  return (
    <div
      ref={ref}
      onClick={onSelect}
      style={{ opacity: isDragging ? 0.3 : 1 }}
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs cursor-grab active:cursor-grabbing transition-colors ${
        isSelected
          ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
          : 'text-slate-600 hover:bg-slate-50 border border-transparent'
      }`}
    >
      <GripVertical size={12} className="text-slate-300 shrink-0" />
      <span className={`w-2 h-2 rounded-full shrink-0 ${getPhaseColors(phases.find(p => p.id === section.phase)?.color || 'slate').dot}`} />
      <span className="flex-1 truncate font-medium">{section.title}</span>
      <span className="text-[9px] text-slate-400 shrink-0">{section.fields.length}</span>
      {section.perRoom && (
        <span className="text-[8px] bg-green-100 text-green-600 px-1 rounded shrink-0 flex items-center gap-0.5">
          <BedDouble size={7} /> room
        </span>
      )}
      {section.hostHidden && <EyeOff size={9} className="text-slate-300 shrink-0" />}
    </div>
  );
}

// ─── Draggable Field Card ────────────────────────────────────────────────────

interface DragFieldItem { type: string; index: number; id: string }

function DraggableFieldCard({
  field, index, sectionId, isExpanded, previewFieldId, onToggleExpand,
  onMove, onDelete, onDuplicate, onUpdateField, onSetPreview,
}: {
  field: OnboardingField;
  index: number;
  sectionId: string;
  isExpanded: boolean;
  previewFieldId: string | null;
  onToggleExpand: () => void;
  onMove: (from: number, to: number) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUpdateField: (updates: Partial<OnboardingField>) => void;
  onSetPreview: (id: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag, preview] = useDrag({
    type: DND_FIELD,
    item: (): DragFieldItem => ({ type: DND_FIELD, index, id: field.id }),
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  const [, drop] = useDrop({
    accept: DND_FIELD,
    hover(item: DragFieldItem, monitor) {
      if (!ref.current) return;
      const dragIndex = item.index;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) return;

      const hoverBoundingRect = ref.current.getBoundingClientRect();
      const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
      const clientOffset = monitor.getClientOffset();
      if (!clientOffset) return;
      const hoverClientY = clientOffset.y - hoverBoundingRect.top;

      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) return;
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) return;

      onMove(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  });

  preview(drop(ref));
  const showPreview = previewFieldId === field.id;

  return (
    <div
      ref={ref}
      style={{ opacity: isDragging ? 0.3 : 1 }}
      className={`bg-white border rounded-xl overflow-hidden transition-all ${
        isExpanded ? 'border-indigo-300 ring-1 ring-indigo-100 shadow-md' : 'border-slate-200 hover:border-slate-300 shadow-sm'
      }`}
    >
      {/* Summary row */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={onToggleExpand}>
        <div ref={(node) => { drag(node); }} className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 shrink-0">
          <GripVertical size={14} className="text-slate-300" />
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="p-1 bg-slate-100 rounded text-slate-500">{fieldTypeIcon(field.type)}</div>
          <span className="text-sm font-medium text-slate-700 truncate">{field.label}</span>
          <span className="text-[9px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">{fieldTypeLabel(field.type)}</span>
          {field.required && <span className="text-[9px] text-red-500 bg-red-50 px-1 py-0.5 rounded">Required</span>}
          {field.half && <span className="text-[9px] text-slate-400 bg-slate-50 px-1 py-0.5 rounded">Half</span>}
          {field.hostHidden && <EyeOff size={9} className="text-amber-400" />}
          {field.group && <span className="text-[9px] text-purple-500 bg-purple-50 px-1 py-0.5 rounded truncate max-w-[100px]">{field.group}</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="p-1.5 text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 rounded transition-colors" title="Duplicate"><Copy size={12} /></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors" title="Delete"><Trash2 size={12} /></button>
          <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180 text-indigo-500' : 'text-slate-300'}`} />
        </div>
      </div>

      {/* Expanded editor */}
      {isExpanded && (
        <div className="border-t border-slate-100 px-4 py-4 bg-slate-50/50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Label</label>
              <input type="text" value={field.label} onChange={(e) => onUpdateField({ label: e.target.value })} className="w-full border border-slate-200 rounded-lg text-xs py-2 px-3 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none bg-white" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Field Type</label>
              <select value={field.type} onChange={(e) => onUpdateField({ type: e.target.value as FieldType })} className="w-full border border-slate-200 rounded-lg text-xs py-2 px-3 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none bg-white">
                {FIELD_TYPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Placeholder</label>
              <input type="text" value={field.placeholder || ''} onChange={(e) => onUpdateField({ placeholder: e.target.value || undefined })} className="w-full border border-slate-200 rounded-lg text-xs py-2 px-3 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none bg-white" placeholder="Placeholder text..." />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Sub-Group Header</label>
              <input type="text" value={field.group || ''} onChange={(e) => onUpdateField({ group: e.target.value || undefined })} className="w-full border border-slate-200 rounded-lg text-xs py-2 px-3 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none bg-white" placeholder="e.g. Repair & Maintenance" />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Help Text</label>
              <textarea value={field.helpText || ''} onChange={(e) => onUpdateField({ helpText: e.target.value || undefined })} className="w-full border border-slate-200 rounded-lg text-xs py-2 px-3 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none bg-white resize-none min-h-[50px]" placeholder="Guidance shown below the field..." />
            </div>
            {field.type === 'select' && (
              <div className="col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Dropdown Options (one per line)</label>
                <textarea
                  value={(field.options || []).join('\n')}
                  onChange={(e) => {
                    const opts = e.target.value.split('\n').filter(o => o.trim());
                    onUpdateField({ options: opts.length ? opts : undefined });
                  }}
                  className="w-full border border-slate-200 rounded-lg text-xs py-2 px-3 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none bg-white resize-none min-h-[80px] font-mono"
                  placeholder="Option 1&#10;Option 2&#10;Option 3"
                />
              </div>
            )}
          </div>
          {/* Toggles */}
          <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-slate-100">
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input type="checkbox" checked={field.required || false} onChange={(e) => onUpdateField({ required: e.target.checked })} className="rounded border-slate-300 text-red-500 focus:ring-red-500" />
              Required
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input type="checkbox" checked={field.half || false} onChange={(e) => onUpdateField({ half: e.target.checked })} className="rounded border-slate-300 text-indigo-500 focus:ring-indigo-500" />
              Half width (side by side)
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input type="checkbox" checked={field.hostHidden || false} onChange={(e) => onUpdateField({ hostHidden: e.target.checked })} className="rounded border-slate-300 text-amber-500 focus:ring-amber-500" />
              <EyeOff size={10} className="text-amber-500" /> Hidden from hosts
            </label>
          </div>
          {/* Footer: field ID + preview toggle */}
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-slate-400">Field ID:</span>
              <code className="text-[9px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-mono">{field.id}</code>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onSetPreview(showPreview ? null : field.id); }}
              className={`px-2 py-1 text-[10px] font-medium rounded flex items-center gap-1 transition-colors ${showPreview ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              <Eye size={10} /> {showPreview ? 'Hide Preview' : 'Show Preview'}
            </button>
          </div>
          {showPreview && <SingleFieldPreview field={field} />}
        </div>
      )}
    </div>
  );
}

// ─── Single Field Preview ────────────────────────────────────────────────────

function SingleFieldPreview({ field }: { field: OnboardingField }) {
  return (
    <div className="border border-slate-200 bg-white rounded-lg p-4 mt-3">
      <div className="flex items-center gap-2 mb-3">
        <Eye size={12} className="text-indigo-500" />
        <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">Preview</span>
      </div>
      <div className={field.half ? 'max-w-[50%]' : ''}>
        <FieldRenderer field={field} />
      </div>
    </div>
  );
}

// ─── Shared field renderer (used by single preview AND section preview) ──────

function FieldRenderer({ field }: { field: OnboardingField }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1.5">
        {field.label}
        {field.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {field.helpText && <p className="text-[10px] text-slate-400 mb-1.5">{field.helpText}</p>}
      {(field.type === 'text' || field.type === 'phone' || field.type === 'url') && (
        <input type="text" disabled placeholder={field.placeholder || ''} className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 bg-slate-50 text-slate-400 placeholder:text-slate-300" />
      )}
      {field.type === 'textarea' && (
        <textarea disabled placeholder={field.placeholder || ''} className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 bg-slate-50 text-slate-400 placeholder:text-slate-300 resize-none min-h-[80px]" />
      )}
      {field.type === 'select' && (
        <select disabled className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 bg-slate-50 text-slate-400">
          <option value="">Select...</option>
          {(field.options || []).map(opt => <option key={opt}>{opt}</option>)}
        </select>
      )}
      {field.type === 'toggle' && (
        <div className="flex items-center gap-2">
          <div className="w-10 h-[22px] rounded-full bg-slate-200 relative"><span className="absolute top-[3px] left-[3px] w-4 h-4 bg-white rounded-full shadow-sm" /></div>
          <span className="text-xs text-slate-400">Off</span>
        </div>
      )}
      {field.type === 'number' && (
        <input type="number" disabled placeholder={field.placeholder || ''} className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 bg-slate-50 text-slate-400 placeholder:text-slate-300" />
      )}
      {field.type === 'time' && (
        <input type="time" disabled className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 bg-slate-50 text-slate-400" />
      )}
      {field.hostHidden && (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-amber-500"><EyeOff size={10} /> Hidden from host portal</div>
      )}
    </div>
  );
}

// ─── Shared grouping helper ──────────────────────────────────────────────────

function useGroupedFields(fields: OnboardingField[]) {
  return useMemo(() => {
    const groups: { label: string | null; fields: OnboardingField[] }[] = [];
    let currentGroup: string | null = null;
    for (const f of fields) {
      if (f.group && f.group !== currentGroup) {
        currentGroup = f.group;
        groups.push({ label: f.group, fields: [f] });
      } else {
        if (groups.length === 0) groups.push({ label: null, fields: [] });
        groups[groups.length - 1].fields.push(f);
      }
    }
    return groups;
  }, [fields]);
}

// ─── Grouped fields render (shared between modal & inline) ───────────────────

function GroupedFieldsRender({ grouped, section }: { grouped: { label: string | null; fields: OnboardingField[] }[]; section: OnboardingSection }) {
  return (
    <>
      {section.perRoom && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-2.5 text-[10px] text-green-700 flex items-center gap-2">
          <BedDouble size={12} />
          Repeats for each room/unit
        </div>
      )}
      <p className="text-xs text-slate-500 mb-5">{section.description}</p>
      {section.fields.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-xs">No fields in this section</div>
      ) : (
        <div className="space-y-5">
          {grouped.map((g, gi) => (
            <div key={gi}>
              {g.label && (
                <div className="flex items-center gap-2 mb-3 mt-1">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{g.label}</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                {g.fields.map(f => (
                  <div key={f.id} className={f.half ? '' : 'col-span-2'}>
                    <FieldRenderer field={f} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Inline Section Preview (right panel, always visible on wide screens) ────

function InlineSectionPreview({ section }: { section: OnboardingSection }) {
  const grouped = useGroupedFields(section.fields);
  return (
    <>
      <div className="px-4 py-3 border-b border-slate-200 shrink-0 bg-slate-50/50">
        <div className="flex items-center gap-2 mb-1">
          <Eye size={14} className="text-indigo-500" />
          <h3 className="text-xs font-bold text-slate-700">Live Preview</h3>
        </div>
        <p className="text-[10px] text-slate-400">How &ldquo;{section.title}&rdquo; looks to hosts</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <GroupedFieldsRender grouped={grouped} section={section} />
      </div>
    </>
  );
}

// ─── Section Preview Modal (narrow screens) ──────────────────────────────────

function SectionPreviewPanel({ section, onClose }: { section: OnboardingSection; onClose: () => void }) {
  const grouped = useGroupedFields(section.fields);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col animate-in zoom-in-95">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600"><Eye size={16} /></div>
            <div>
              <h3 className="font-bold text-slate-800">{section.title}</h3>
              <p className="text-xs text-slate-500">How this section appears in the onboarding form</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {section.perRoom && (
              <span className="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded-full flex items-center gap-1"><BedDouble size={10} /> Per Room</span>
            )}
            {section.hostHidden && (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded-full flex items-center gap-1"><EyeOff size={10} /> Internal Only</span>
            )}
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <GroupedFieldsRender grouped={grouped} section={section} />
        </div>
      </div>
    </div>
  );
}

// ─── Changelog / Diff from Defaults ──────────────────────────────────────────

interface DiffEntry {
  type: 'section_added' | 'section_removed' | 'section_reordered' | 'section_modified' |
        'field_added' | 'field_removed' | 'field_modified' | 'field_reordered';
  sectionTitle: string;
  detail: string;
}

function computeChangelog(current: OnboardingSection[], defaults: OnboardingSection[]): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const defaultIds = new Set(defaults.map(s => s.id));
  const currentIds = new Set(current.map(s => s.id));

  // Added sections
  for (const s of current) {
    if (!defaultIds.has(s.id)) {
      diffs.push({ type: 'section_added', sectionTitle: s.title, detail: `New section with ${s.fields.length} fields` });
    }
  }
  // Removed sections
  for (const s of defaults) {
    if (!currentIds.has(s.id)) {
      diffs.push({ type: 'section_removed', sectionTitle: s.title, detail: 'Entire section removed' });
    }
  }

  // Reordered sections
  const defaultOrder = defaults.map(s => s.id);
  const currentOrder = current.filter(s => defaultIds.has(s.id)).map(s => s.id);
  const reordered = currentOrder.some((id, i) => {
    const defIdx = defaultOrder.indexOf(id);
    const prevId = i > 0 ? currentOrder[i - 1] : null;
    const prevDefIdx = prevId ? defaultOrder.indexOf(prevId) : -1;
    return defIdx <= prevDefIdx;
  });
  if (reordered) {
    diffs.push({ type: 'section_reordered', sectionTitle: '(multiple)', detail: 'Section order changed from defaults' });
  }

  // Per-section diffs
  for (const cs of current) {
    const ds = defaults.find(s => s.id === cs.id);
    if (!ds) continue;

    // Section-level changes
    const sectionChanges: string[] = [];
    if (cs.title !== ds.title) sectionChanges.push(`title: "${ds.title}" → "${cs.title}"`);
    if (cs.description !== ds.description) sectionChanges.push('description changed');
    if (cs.phase !== ds.phase) sectionChanges.push(`phase: ${ds.phase} → ${cs.phase}`);
    if (cs.perRoom !== ds.perRoom) sectionChanges.push(`per-room: ${ds.perRoom ? 'on' : 'off'} → ${cs.perRoom ? 'on' : 'off'}`);
    if (cs.hostHidden !== ds.hostHidden) sectionChanges.push(`host-hidden: ${ds.hostHidden ? 'on' : 'off'} → ${cs.hostHidden ? 'on' : 'off'}`);
    if (sectionChanges.length) {
      diffs.push({ type: 'section_modified', sectionTitle: cs.title, detail: sectionChanges.join(', ') });
    }

    // Field-level diffs
    const defaultFieldIds = new Set(ds.fields.map(f => f.id));
    const currentFieldIds = new Set(cs.fields.map(f => f.id));

    for (const f of cs.fields) {
      if (!defaultFieldIds.has(f.id)) {
        diffs.push({ type: 'field_added', sectionTitle: cs.title, detail: `Added field "${f.label}"` });
      }
    }
    for (const f of ds.fields) {
      if (!currentFieldIds.has(f.id)) {
        diffs.push({ type: 'field_removed', sectionTitle: cs.title, detail: `Removed field "${f.label}"` });
      }
    }

    // Modified fields
    for (const cf of cs.fields) {
      const df = ds.fields.find(f => f.id === cf.id);
      if (!df) continue;
      const fieldChanges: string[] = [];
      if (cf.label !== df.label) fieldChanges.push(`label: "${df.label}" → "${cf.label}"`);
      if (cf.type !== df.type) fieldChanges.push(`type: ${df.type} → ${cf.type}`);
      if (cf.required !== df.required) fieldChanges.push(`required: ${cf.required ? 'on' : 'off'}`);
      if (cf.half !== df.half) fieldChanges.push(`half-width: ${cf.half ? 'on' : 'off'}`);
      if (cf.hostHidden !== df.hostHidden) fieldChanges.push(`host-hidden: ${cf.hostHidden ? 'on' : 'off'}`);
      if ((cf.placeholder || '') !== (df.placeholder || '')) fieldChanges.push('placeholder changed');
      if ((cf.helpText || '') !== (df.helpText || '')) fieldChanges.push('help text changed');
      if ((cf.group || '') !== (df.group || '')) fieldChanges.push('group changed');
      if (JSON.stringify(cf.options || []) !== JSON.stringify(df.options || [])) fieldChanges.push('options changed');
      if (fieldChanges.length) {
        diffs.push({ type: 'field_modified', sectionTitle: cs.title, detail: `"${cf.label}": ${fieldChanges.join(', ')}` });
      }
    }

    // Field reorder
    const defFieldOrder = ds.fields.map(f => f.id);
    const curFieldOrder = cs.fields.filter(f => defaultFieldIds.has(f.id)).map(f => f.id);
    if (curFieldOrder.length > 1) {
      const fieldReordered = curFieldOrder.some((id, i) => {
        const di = defFieldOrder.indexOf(id);
        const prevId = i > 0 ? curFieldOrder[i - 1] : null;
        const prevDi = prevId ? defFieldOrder.indexOf(prevId) : -1;
        return di <= prevDi;
      });
      if (fieldReordered) {
        diffs.push({ type: 'field_reordered', sectionTitle: cs.title, detail: 'Field order changed' });
      }
    }
  }

  return diffs;
}

function ChangelogPanel({ diffs, onClose }: { diffs: DiffEntry[]; onClose: () => void }) {
  const typeColor: Record<string, string> = {
    section_added: 'bg-green-100 text-green-700',
    section_removed: 'bg-red-100 text-red-700',
    section_reordered: 'bg-blue-100 text-blue-700',
    section_modified: 'bg-amber-100 text-amber-700',
    field_added: 'bg-green-50 text-green-600',
    field_removed: 'bg-red-50 text-red-600',
    field_modified: 'bg-amber-50 text-amber-600',
    field_reordered: 'bg-blue-50 text-blue-600',
  };
  const typeLabel: Record<string, string> = {
    section_added: 'Section Added',
    section_removed: 'Section Removed',
    section_reordered: 'Sections Reordered',
    section_modified: 'Section Changed',
    field_added: 'Field Added',
    field_removed: 'Field Removed',
    field_modified: 'Field Changed',
    field_reordered: 'Fields Reordered',
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-in zoom-in-95">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600"><Diff size={16} /></div>
            <div>
              <h3 className="font-bold text-slate-800">Changelog</h3>
              <p className="text-xs text-slate-500">{diffs.length} change{diffs.length !== 1 ? 's' : ''} from the default template</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {diffs.length === 0 ? (
            <div className="text-center py-10">
              <Check size={32} className="mx-auto text-green-400 mb-2" />
              <p className="text-sm font-medium text-slate-600">No changes</p>
              <p className="text-xs text-slate-400">The form template matches the defaults exactly.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {diffs.map((d, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${typeColor[d.type] || ''}`}>
                    {typeLabel[d.type] || d.type}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium text-slate-700">{d.sectionTitle}</span>
                    <p className="text-[11px] text-slate-500 mt-0.5">{d.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Manage Phases Modal ─────────────────────────────────────────────────────

function ManagePhasesModal({
  phases, onAdd, onUpdate, onRemove, onReset, onClose, sectionCountByPhase,
}: {
  phases: FormPhase[];
  onAdd: (phase: FormPhase) => void;
  onUpdate: (id: number, updates: Partial<Omit<FormPhase, 'id'>>) => void;
  onRemove: (id: number) => void;
  onReset: () => void;
  onClose: () => void;
  sectionCountByPhase: Record<number, number>;
}) {
  const [addMode, setAddMode] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('green');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const nextId = phases.length > 0 ? Math.max(...phases.map(p => p.id)) + 1 : 1;

  const handleAdd = () => {
    if (!newLabel.trim()) { toast.error('Phase name is required'); return; }
    onAdd({ id: nextId, label: newLabel.trim(), color: newColor });
    setNewLabel('');
    setNewColor('green');
    setAddMode(false);
    toast.success(`Phase ${nextId} added`);
  };

  const startEdit = (phase: FormPhase) => {
    setEditingId(phase.id);
    setEditLabel(phase.label);
    setEditColor(phase.color);
  };

  const saveEdit = () => {
    if (editingId === null || !editLabel.trim()) return;
    onUpdate(editingId, { label: editLabel.trim(), color: editColor });
    setEditingId(null);
    toast.success('Phase updated');
  };

  const confirmDelete = () => {
    if (confirmDeleteId === null) return;
    onRemove(confirmDeleteId);
    setConfirmDeleteId(null);
    toast.success('Phase removed');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col animate-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600"><Layers size={16} /></div>
            <div>
              <h3 className="font-bold text-slate-800">Manage Phases</h3>
              <p className="text-xs text-slate-500">
                {phases.length} phase{phases.length !== 1 ? 's' : ''} &mdash; phases control onboarding progression
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"><X size={16} /></button>
        </div>

        {/* Phase list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {phases.map((phase) => {
            const colors = getPhaseColors(phase.color);
            const sectionCount = sectionCountByPhase[phase.id] || 0;
            const isEditing = editingId === phase.id;
            const isConfirmingDelete = confirmDeleteId === phase.id;

            if (isEditing) {
              return (
                <div key={phase.id} className="border border-indigo-200 bg-indigo-50 rounded-xl p-4 space-y-3 animate-in fade-in duration-150">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 w-16 shrink-0">Phase {phase.id}</span>
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="flex-1 border border-indigo-200 rounded-lg text-xs py-1.5 px-3 focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Color</label>
                    <div className="flex flex-wrap gap-1.5">
                      {AVAILABLE_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => setEditColor(c)}
                          className={`w-6 h-6 rounded-full border-2 transition-all ${getPhaseColors(c).dot} ${
                            editColor === c ? 'border-indigo-500 scale-110 ring-2 ring-indigo-200' : 'border-transparent hover:scale-105'
                          }`}
                          title={c}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-[10px] text-slate-500 hover:bg-white rounded-lg">Cancel</button>
                    <button onClick={saveEdit} className="px-3 py-1.5 text-[10px] bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1"><Save size={10} /> Save</button>
                  </div>
                </div>
              );
            }

            if (isConfirmingDelete) {
              return (
                <div key={phase.id} className="border border-red-200 bg-red-50 rounded-xl p-4 animate-in fade-in duration-150">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="p-1.5 bg-red-100 rounded-lg text-red-600"><Trash2 size={14} /></div>
                    <div>
                      <p className="text-xs font-medium text-slate-800">Delete Phase {phase.id} &mdash; {phase.label}?</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {sectionCount > 0
                          ? `${sectionCount} section${sectionCount !== 1 ? 's' : ''} currently assigned to this phase. They'll keep their phase number but it won't match any phase definition.`
                          : 'No sections are assigned to this phase.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1.5 text-[10px] text-slate-500 hover:bg-white rounded-lg">Cancel</button>
                    <button onClick={confirmDelete} className="px-3 py-1.5 text-[10px] bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-1"><Trash2 size={10} /> Delete</button>
                  </div>
                </div>
              );
            }

            return (
              <div key={phase.id} className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 group hover:bg-white hover:border-slate-200 transition-colors">
                <span className={`w-3 h-3 rounded-full shrink-0 ${colors.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-700">Phase {phase.id}</span>
                    <span className="text-[10px] text-slate-400">&mdash;</span>
                    <span className="text-xs text-slate-600 truncate">{phase.label}</span>
                  </div>
                  <span className="text-[9px] text-slate-400">
                    {sectionCount} section{sectionCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startEdit(phase)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Edit"><Pencil size={12} /></button>
                  <button
                    onClick={() => setConfirmDeleteId(phase.id)}
                    disabled={phases.length <= 1}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title={phases.length <= 1 ? 'At least one phase is required' : 'Delete phase'}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Add new phase form */}
          {addMode ? (
            <div className="border border-indigo-200 bg-indigo-50 rounded-xl p-4 space-y-3 animate-in fade-in duration-150">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-400 w-16 shrink-0">Phase {nextId}</span>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Phase name, e.g. Post-Stay"
                  className="flex-1 border border-indigo-200 rounded-lg text-xs py-1.5 px-3 focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAddMode(false); }}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Color</label>
                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setNewColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${getPhaseColors(c).dot} ${
                        newColor === c ? 'border-indigo-500 scale-110 ring-2 ring-indigo-200' : 'border-transparent hover:scale-105'
                      }`}
                      title={c}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => { setAddMode(false); setNewLabel(''); }} className="px-3 py-1.5 text-[10px] text-slate-500 hover:bg-white rounded-lg">Cancel</button>
                <button onClick={handleAdd} className="px-3 py-1.5 text-[10px] bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1"><Check size={10} /> Add Phase</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddMode(true)}
              className="w-full border-2 border-dashed border-slate-200 rounded-xl p-3 text-xs font-medium text-slate-400 hover:text-indigo-500 hover:border-indigo-200 hover:bg-indigo-50/50 flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus size={12} /> Add Phase
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-between shrink-0 bg-slate-50/50">
          <button
            onClick={() => { onReset(); toast.success('Phases reset to defaults'); }}
            className="px-3 py-1.5 text-[10px] font-medium text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg flex items-center gap-1 transition-colors"
          >
            <Undo2 size={10} /> Reset to defaults
          </button>
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function FormBuilderView() {
  const navigate = useNavigate();
  const {
    formTemplate, updateFormSection, addFormSection, removeFormSection, reorderFormSections,
    updateFormField, addFormField, removeFormField, reorderFormFields,
    resetFormTemplate,
    formPhases, addFormPhase, updateFormPhase, removeFormPhase, resetFormPhases,
  } = useAppContext();

  const [selectedSectionId, setSelectedSectionId] = useState<string>(formTemplate[0]?.id || '');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [previewFieldId, setPreviewFieldId] = useState<string | null>(null);
  const [showSectionPreview, setShowSectionPreview] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editSectionTitle, setEditSectionTitle] = useState('');
  const [editSectionDesc, setEditSectionDesc] = useState('');
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);
  const [addingSectionMode, setAddingSectionMode] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newSectionDesc, setNewSectionDesc] = useState('');
  const [newSectionPhase, setNewSectionPhase] = useState<number>(formPhases[0]?.id ?? 1);
  const [newSectionPerRoom, setNewSectionPerRoom] = useState(false);
  const [deletingSectionId, setDeletingSectionId] = useState<string | null>(null);
  const [showManagePhases, setShowManagePhases] = useState(false);
  const [addingFieldMode, setAddingFieldMode] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');

  const selectedSection = formTemplate.find(s => s.id === selectedSectionId);

  // Changelog diff
  const changelog = useMemo(() => computeChangelog(formTemplate, STATIC_SECTIONS), [formTemplate]);
  const hasChanges = changelog.length > 0;

  // Section handlers
  const startEditSection = (section: OnboardingSection) => {
    setEditingSectionId(section.id);
    setEditSectionTitle(section.title);
    setEditSectionDesc(section.description);
  };

  const saveEditSection = () => {
    if (!editingSectionId || !editSectionTitle.trim()) return;
    updateFormSection(editingSectionId, { title: editSectionTitle.trim(), description: editSectionDesc.trim() });
    setEditingSectionId(null);
    toast.success('Section updated');
  };

  const handleAddSection = () => {
    if (!newSectionTitle.trim()) { toast.error('Section title is required'); return; }
    const id = `custom-${Date.now()}`;
    addFormSection({ id, title: newSectionTitle.trim(), description: newSectionDesc.trim(), phase: newSectionPhase, perRoom: newSectionPerRoom, fields: [] });
    setSelectedSectionId(id);
    setAddingSectionMode(false);
    setNewSectionTitle('');
    setNewSectionDesc('');
    setNewSectionPhase(formPhases[0]?.id ?? 1);
    setNewSectionPerRoom(false);
    toast.success('New section added');
  };

  const confirmDeleteSection = () => {
    if (!deletingSectionId) return;
    const section = formTemplate.find(s => s.id === deletingSectionId);
    removeFormSection(deletingSectionId);
    if (selectedSectionId === deletingSectionId) {
      const remaining = formTemplate.filter(s => s.id !== deletingSectionId);
      setSelectedSectionId(remaining[0]?.id || '');
    }
    setDeletingSectionId(null);
    toast.success(`"${section?.title}" removed`);
  };

  const duplicateSection = (section: OnboardingSection) => {
    const newId = `${section.id}-copy-${Date.now()}`;
    const newFields = section.fields.map(f => ({ ...f, id: `${f.id}-c${Date.now()}` }));
    addFormSection({ ...section, id: newId, title: `${section.title} (Copy)`, fields: newFields });
    setSelectedSectionId(newId);
    toast.success(`"${section.title}" duplicated`);
  };

  const handleAddField = () => {
    if (!selectedSectionId || !newFieldLabel.trim()) { toast.error('Field label is required'); return; }
    const fieldId = `field-${Date.now()}`;
    addFormField(selectedSectionId, { id: fieldId, label: newFieldLabel.trim(), type: newFieldType });
    setAddingFieldMode(false);
    setNewFieldLabel('');
    setNewFieldType('text');
    setExpandedFieldId(fieldId);
    toast.success('Field added');
  };

  const handleDeleteField = (fieldId: string) => {
    if (!selectedSectionId) return;
    removeFormField(selectedSectionId, fieldId);
    if (expandedFieldId === fieldId) setExpandedFieldId(null);
    toast.success('Field removed');
  };

  const duplicateField = (field: OnboardingField) => {
    if (!selectedSectionId) return;
    addFormField(selectedSectionId, { ...field, id: `${field.id}-copy-${Date.now()}`, label: `${field.label} (Copy)` });
    toast.success('Field duplicated');
  };

  const handleMoveField = useCallback((from: number, to: number) => {
    if (selectedSectionId) reorderFormFields(selectedSectionId, from, to);
  }, [selectedSectionId, reorderFormFields]);

  const handleMoveSection = useCallback((from: number, to: number) => {
    reorderFormSections(from, to);
  }, [reorderFormSections]);

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden">

        {/* Reset Confirmation Modal */}
        {showResetConfirm && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95">
              <div className="flex items-start gap-3 mb-4">
                <div className="p-2 bg-amber-100 rounded-lg text-amber-600"><AlertTriangle size={20} /></div>
                <div>
                  <h3 className="font-bold text-slate-800">Reset form to defaults?</h3>
                  <p className="text-sm text-slate-500 mt-1">This will undo all your customizations ({changelog.length} change{changelog.length !== 1 ? 's' : ''}) and restore the original template. Existing property data will not be affected.</p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowResetConfirm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                <button
                  onClick={() => {
                    resetFormTemplate();
                    setShowResetConfirm(false);
                    setSelectedSectionId(formTemplate[0]?.id || '');
                    setExpandedFieldId(null);
                    toast.success('Form template restored to defaults');
                  }}
                  className="px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 flex items-center gap-1.5 transition-colors"
                >
                  <Undo2 size={14} /> Reset
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Section Delete Confirmation */}
        {deletingSectionId && (() => {
          const sectionToDelete = formTemplate.find(s => s.id === deletingSectionId);
          return (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95">
                <div className="flex items-start gap-3 mb-4">
                  <div className="p-2 bg-red-100 rounded-lg text-red-600"><Trash2 size={20} /></div>
                  <div>
                    <h3 className="font-bold text-slate-800">Delete "{sectionToDelete?.title}"?</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      This will permanently remove this section and its {sectionToDelete?.fields.length || 0} field{(sectionToDelete?.fields.length || 0) !== 1 ? 's' : ''} from the template. Existing property data won't be deleted, but the fields will no longer appear in the onboarding form.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setDeletingSectionId(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                  <button onClick={confirmDeleteSection} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-1.5 transition-colors">
                    <Trash2 size={14} /> Delete Section
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Section Preview Modal */}
        {showSectionPreview && selectedSection && (
          <SectionPreviewPanel section={selectedSection} onClose={() => setShowSectionPreview(false)} />
        )}

        {/* Changelog Modal */}
        {showChangelog && (
          <ChangelogPanel diffs={changelog} onClose={() => setShowChangelog(false)} />
        )}

        {/* Manage Phases Modal */}
        {showManagePhases && (
          <ManagePhasesModal
            phases={formPhases}
            onAdd={addFormPhase}
            onUpdate={updateFormPhase}
            onRemove={removeFormPhase}
            onReset={resetFormPhases}
            onClose={() => setShowManagePhases(false)}
            sectionCountByPhase={formTemplate.reduce<Record<number, number>>((acc, s) => {
              acc[s.phase] = (acc[s.phase] || 0) + 1;
              return acc;
            }, {})}
          />
        )}

        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 shrink-0 shadow-sm z-10">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
            <button onClick={() => navigate('/settings')} className="hover:text-indigo-600 transition-colors">Settings</button>
            <ChevronRight size={10} />
            <span className="text-slate-700 font-medium">Form Builder</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => navigate('/settings')} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-slate-800">
                <ArrowLeft size={20} />
              </button>
              <div>
                <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Settings2 size={20} className="text-indigo-600" />
                  Onboarding Form Builder
                </h1>
                <p className="text-xs text-slate-500">Customize what fields hosts fill out when onboarding a property. Drag to reorder.</p>
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={() => navigate('/kb')}
                className="px-3 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 transition-colors"
              >
                <Eye size={12} /> View Knowledge Base
              </button>
              <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-1 rounded">
                {formTemplate.length} sections &bull; {formTemplate.reduce((acc, s) => acc + s.fields.length, 0)} fields
              </span>
              <button
                onClick={() => setShowChangelog(true)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors border ${
                  hasChanges
                    ? 'text-indigo-600 bg-indigo-50 border-indigo-200 hover:bg-indigo-100'
                    : 'text-slate-400 bg-slate-50 border-slate-200'
                }`}
              >
                <Diff size={12} /> {hasChanges ? `${changelog.length} change${changelog.length !== 1 ? 's' : ''}` : 'No changes'}
              </button>
              <button
                onClick={() => setShowResetConfirm(true)}
                disabled={!hasChanges}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
              >
                <Undo2 size={12} /> Reset to Defaults
              </button>
            </div>
          </div>
        </div>

        {/* Body: Sidebar + Main */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar: Section list */}
          <div className="w-72 border-r border-slate-200 bg-white flex flex-col overflow-hidden shrink-0">
            <div className="p-3 border-b border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Form Sections</p>
                <button onClick={() => setShowManagePhases(true)} className="text-[9px] text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5 transition-colors" title="Manage phases">
                  <Layers size={9} /> Phases
                </button>
              </div>
              <div className="text-[10px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                {formPhases.map(p => (
                  <span key={p.id} className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${getPhaseColors(p.color).dot}`} />
                    Phase {p.id} — {p.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {formTemplate.map((section, idx) => (
                <DraggableSectionItem
                  key={section.id}
                  section={section}
                  index={idx}
                  isSelected={selectedSectionId === section.id}
                  onSelect={() => setSelectedSectionId(section.id)}
                  onMove={handleMoveSection}
                  phases={formPhases}
                />
              ))}

              {/* Add section */}
              {addingSectionMode ? (
                <div className="border border-indigo-200 bg-indigo-50 rounded-lg p-3 space-y-2 mt-2 animate-in fade-in duration-150">
                  <input type="text" placeholder="Section title..." value={newSectionTitle} onChange={(e) => setNewSectionTitle(e.target.value)} className="w-full border border-indigo-200 rounded text-xs py-1.5 px-2.5 focus:ring-1 focus:ring-indigo-500 outline-none bg-white" autoFocus />
                  <input type="text" placeholder="Description (optional)..." value={newSectionDesc} onChange={(e) => setNewSectionDesc(e.target.value)} className="w-full border border-indigo-200 rounded text-xs py-1.5 px-2.5 focus:ring-1 focus:ring-indigo-500 outline-none bg-white" />
                  <div className="flex gap-2">
                    <select value={newSectionPhase} onChange={(e) => setNewSectionPhase(Number(e.target.value))} className="flex-1 text-[10px] border border-indigo-200 rounded py-1 px-2 outline-none bg-white">
                      {formPhases.map(p => (
                        <option key={p.id} value={p.id}>Phase {p.id} — {p.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setNewSectionPerRoom(!newSectionPerRoom)}
                      className={`text-[10px] px-2 py-1 rounded border flex items-center gap-1 ${newSectionPerRoom ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white border-indigo-200 text-slate-500'}`}
                    >
                      <BedDouble size={9} /> {newSectionPerRoom ? 'Per Room' : 'Property'}
                    </button>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setAddingSectionMode(false); setNewSectionTitle(''); setNewSectionDesc(''); setNewSectionPhase(formPhases[0]?.id ?? 1); setNewSectionPerRoom(false); }} className="px-2 py-1 text-[10px] text-slate-500 hover:bg-white rounded">Cancel</button>
                    <button onClick={handleAddSection} className="px-2 py-1 text-[10px] bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-1"><Check size={10} /> Add</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setAddingSectionMode(true)} className="w-full mt-2 border-2 border-dashed border-slate-200 rounded-lg p-2 text-[10px] font-medium text-slate-400 hover:text-indigo-500 hover:border-indigo-200 hover:bg-indigo-50/50 flex items-center justify-center gap-1 transition-colors">
                  <Plus size={10} /> Add Section
                </button>
              )}
            </div>
          </div>

          {/* Main content: Selected section's fields */}
          <div className="flex-1 overflow-y-auto p-6">
            {selectedSection ? (
              <div className="max-w-4xl mx-auto">

                {/* Section header */}
                {editingSectionId === selectedSection.id ? (
                  <div className="bg-white border border-indigo-200 rounded-xl p-5 mb-6 space-y-3 shadow-sm">
                    <input type="text" value={editSectionTitle} onChange={(e) => setEditSectionTitle(e.target.value)} className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none font-bold" autoFocus />
                    <textarea value={editSectionDesc} onChange={(e) => setEditSectionDesc(e.target.value)} className="w-full border border-slate-200 rounded-lg text-xs py-2 px-3 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none resize-none min-h-[60px]" placeholder="Section description..." />
                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                      <button onClick={() => setEditingSectionId(null)} className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                      <button onClick={saveEditSection} className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1 transition-colors"><Save size={12} /> Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4 shadow-sm group">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h2 className="text-lg font-bold text-slate-800">{selectedSection.title}</h2>
                          {(() => {
                            const ph = formPhases.find(p => p.id === selectedSection.phase);
                            const c = getPhaseColors(ph?.color || 'slate');
                            return (
                              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${c.bg} ${c.text}`}>
                                Phase {selectedSection.phase}{ph ? ` — ${ph.label}` : ''}
                              </span>
                            );
                          })()}
                          {selectedSection.hostHidden && (
                            <span className="text-[9px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded flex items-center gap-0.5"><EyeOff size={8} /> Internal Only</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mb-3">{selectedSection.description}</p>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button onClick={() => startEditSection(selectedSection)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Edit title & description"><Pencil size={14} /></button>
                        <button onClick={() => duplicateSection(selectedSection)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Duplicate section"><Copy size={14} /></button>
                        <button onClick={() => setShowSectionPreview(true)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Preview full section"><Eye size={14} /></button>
                        <button onClick={() => setDeletingSectionId(selectedSection.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete section"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    {/* ── Section-level quick toggles (always visible) ── */}
                    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
                      {/* Scope: per-property vs per-room */}
                      <div className="inline-grid grid-cols-2 rounded-lg border border-slate-200 overflow-hidden text-[10px] font-medium">
                        <button
                          onClick={() => updateFormSection(selectedSection.id, { perRoom: false })}
                          className={`flex items-center justify-center gap-1 px-3 py-1.5 transition-colors ${
                            !selectedSection.perRoom ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          <Building2 size={10} /> Property-wide
                        </button>
                        <button
                          onClick={() => updateFormSection(selectedSection.id, { perRoom: true })}
                          className={`flex items-center justify-center gap-1 px-3 py-1.5 transition-colors border-l border-slate-200 ${
                            selectedSection.perRoom ? 'bg-green-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          <BedDouble size={10} /> Per Room
                        </button>
                      </div>

                      {/* Phase selector */}
                      <select
                        value={selectedSection.phase}
                        onChange={(e) => updateFormSection(selectedSection.id, { phase: Number(e.target.value) })}
                        className="text-[10px] font-medium border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 outline-none bg-white text-slate-600"
                      >
                        {formPhases.map(p => (
                          <option key={p.id} value={p.id}>Phase {p.id} — {p.label}</option>
                        ))}
                      </select>

                      {/* Host visibility */}
                      <button
                        onClick={() => updateFormSection(selectedSection.id, { hostHidden: !selectedSection.hostHidden })}
                        className={`flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                          selectedSection.hostHidden
                            ? 'bg-amber-50 text-amber-600 border-amber-200'
                            : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {selectedSection.hostHidden ? <EyeOff size={10} /> : <Eye size={10} />}
                        {selectedSection.hostHidden ? 'Hidden from hosts' : 'Visible to hosts'}
                      </button>

                      {/* Preview toggle (only on narrow screens where right panel is hidden) */}
                      <button
                        onClick={() => setShowSectionPreview(true)}
                        className="ml-auto flex items-center gap-1 text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 px-2.5 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors 2xl:hidden"
                      >
                        <LayoutList size={10} /> Preview Section
                      </button>
                    </div>
                  </div>
                )}

                {/* Info banner */}
                <div className="mb-4 bg-slate-100 border border-slate-200 rounded-lg p-3 flex items-start gap-2">
                  <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-slate-500">Drag fields to reorder. Click to expand and edit properties. Changes are saved automatically and persist across refreshes.</p>
                </div>

                {/* Fields list */}
                <div className="space-y-2">
                  {selectedSection.fields.map((field, fieldIdx) => (
                    <DraggableFieldCard
                      key={field.id}
                      field={field}
                      index={fieldIdx}
                      sectionId={selectedSection.id}
                      isExpanded={expandedFieldId === field.id}
                      previewFieldId={previewFieldId}
                      onToggleExpand={() => setExpandedFieldId(expandedFieldId === field.id ? null : field.id)}
                      onMove={handleMoveField}
                      onDelete={() => handleDeleteField(field.id)}
                      onDuplicate={() => duplicateField(field)}
                      onUpdateField={(updates) => updateFormField(selectedSection.id, field.id, updates)}
                      onSetPreview={setPreviewFieldId}
                    />
                  ))}

                  {/* Empty state */}
                  {selectedSection.fields.length === 0 && !addingFieldMode && (
                    <div className="bg-white border-2 border-dashed border-slate-200 rounded-xl p-10 text-center">
                      <FileText size={32} className="mx-auto text-slate-200 mb-3" />
                      <p className="text-sm font-medium text-slate-500 mb-1">No fields in this section</p>
                      <p className="text-xs text-slate-400 mb-4">Add fields to define what information hosts should provide.</p>
                      <button onClick={() => setAddingFieldMode(true)} className="px-4 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1.5 mx-auto shadow-sm">
                        <Plus size={12} /> Add First Field
                      </button>
                    </div>
                  )}

                  {/* Add field form */}
                  {addingFieldMode ? (
                    <div className="bg-white border border-indigo-200 rounded-xl p-4 space-y-3 shadow-sm animate-in fade-in duration-150">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Field Label</label>
                          <input type="text" value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} placeholder="e.g. Building Entrance Code" className="w-full border border-slate-200 rounded-lg text-xs py-2 px-3 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none" autoFocus />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Field Type</label>
                          <select value={newFieldType} onChange={(e) => setNewFieldType(e.target.value as FieldType)} className="w-full border border-slate-200 rounded-lg text-xs py-2 px-3 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none">
                            {FIELD_TYPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button onClick={() => { setAddingFieldMode(false); setNewFieldLabel(''); }} className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                        <button onClick={handleAddField} className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1 transition-colors"><Check size={12} /> Add Field</button>
                      </div>
                    </div>
                  ) : selectedSection.fields.length > 0 && (
                    <button onClick={() => setAddingFieldMode(true)} className="w-full border-2 border-dashed border-slate-200 rounded-xl p-3 text-xs font-medium text-slate-400 hover:text-indigo-500 hover:border-indigo-200 hover:bg-indigo-50/50 flex items-center justify-center gap-1.5 transition-colors">
                      <Plus size={12} /> Add Field
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-slate-400">Select a section from the sidebar</p>
              </div>
            )}
          </div>

          {/* Right panel: always-visible section preview on wide screens */}
          {selectedSection && (
            <div className="hidden 2xl:flex w-[400px] border-l border-slate-200 bg-white flex-col overflow-hidden shrink-0">
              <InlineSectionPreview section={selectedSection} />
            </div>
          )}
        </div>
      </div>
    </DndProvider>
  );
}