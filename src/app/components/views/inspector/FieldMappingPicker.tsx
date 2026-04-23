import { useState, useMemo } from 'react';
import { ArrowLeft, Tag, Trash2 } from 'lucide-react';
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from '../../ui/command';
import { Button } from '../../ui/button';
import type { OnboardingSection } from '../../../data/onboarding-template';

/**
 * Map-to-field picker for unmapped property_fact entries.
 *
 * Renders a searchable, grouped combobox backed by ONBOARDING_SECTIONS so
 * the user maps an orphan fact to a schema slot without having to guess
 * what fields exist. Per-room fields reveal an inline room picker once
 * selected. Two escape hatches sit beneath the list: keep as general
 * knowledge (verified-orphan) or discard.
 *
 * This component is a pure view — all writes are performed by the parent
 * (via KnowledgeInspector) so the picker doesn't need to know about the
 * chunk store shape.
 */

export type FieldMappingPickerPick =
  | { kind: 'field'; sectionId: string; fieldId: string; roomIndex?: number }
  | { kind: 'keep_general' }
  | { kind: 'discard' };

interface Props {
  entryTitle: string;
  formTemplate: OnboardingSection[];
  roomNames: string[];
  /** Called when the user finalises a choice. Room picking is handled
   *  internally — the parent only sees the resolved pick. */
  onPick: (pick: FieldMappingPickerPick) => void;
  /** Called when the user backs out without picking. */
  onCancel: () => void;
}

export function FieldMappingPicker({
  entryTitle, formTemplate, roomNames, onPick, onCancel,
}: Props) {
  // Two-stage flow: 'field-list' → 'room-picker' (only when the selected
  // field is perRoom and there's more than one room).
  const [stage, setStage] = useState<
    | { name: 'field-list' }
    | { name: 'room-picker'; sectionId: string; fieldId: string; fieldLabel: string; sectionTitle: string }
  >({ name: 'field-list' });

  // Flatten the schema into {sectionId, fieldId, label, ...} rows grouped
  // by section title. Skip the FAQ pseudo-section — FAQs aren't property_facts.
  const groups = useMemo(() => {
    return formTemplate
      .filter(s => s.id !== 'faqs')
      .map(section => ({
        sectionId: section.id,
        sectionTitle: section.title,
        perRoom: section.perRoom === true,
        fields: section.fields.map(f => ({
          fieldId: f.id,
          label: f.label,
          helpText: f.helpText ?? '',
        })),
      }));
  }, [formTemplate]);

  if (stage.name === 'room-picker') {
    const multiRoom = roomNames.length > 1;
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <button
            type="button"
            onClick={() => setStage({ name: 'field-list' })}
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
          >
            <ArrowLeft size={14} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-500">Which room?</div>
            <div className="text-sm font-medium truncate">
              {stage.sectionTitle} · {stage.fieldLabel}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {!multiRoom ? (
            <button
              type="button"
              onClick={() => onPick({ kind: 'field', sectionId: stage.sectionId, fieldId: stage.fieldId, roomIndex: 0 })}
              className="w-full text-left px-3 py-2 rounded hover:bg-slate-100 text-sm"
            >
              Entire Property
            </button>
          ) : roomNames.map((name, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPick({ kind: 'field', sectionId: stage.sectionId, fieldId: stage.fieldId, roomIndex: i })}
              className="w-full text-left px-3 py-2 rounded hover:bg-slate-100 text-sm"
            >
              {name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b">
        <div className="text-xs text-slate-500">Map</div>
        <div className="text-sm font-medium truncate">{entryTitle}</div>
      </div>

      <Command className="flex-1" shouldFilter>
        <CommandInput placeholder="Type to filter fields…" autoFocus />
        <CommandList className="max-h-none flex-1">
          <CommandEmpty>No matching fields</CommandEmpty>

          {groups.map(g => (
            <CommandGroup key={g.sectionId} heading={g.sectionTitle}>
              {g.fields.map(f => (
                <CommandItem
                  key={`${g.sectionId}-${f.fieldId}`}
                  // Feed cmdk the full searchable string so type-ahead
                  // matches section title + field label + help text.
                  value={`${g.sectionTitle} ${f.label} ${f.helpText}`}
                  onSelect={() => {
                    if (g.perRoom && roomNames.length > 0) {
                      setStage({
                        name: 'room-picker',
                        sectionId: g.sectionId,
                        fieldId: f.fieldId,
                        fieldLabel: f.label,
                        sectionTitle: g.sectionTitle,
                      });
                    } else {
                      onPick({ kind: 'field', sectionId: g.sectionId, fieldId: f.fieldId });
                    }
                  }}
                >
                  <span className="truncate">{f.label}</span>
                  {g.perRoom && (
                    <span className="ml-auto text-[10px] text-slate-400 shrink-0">per-room</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>

      <div className="border-t bg-slate-50/60 p-2 space-y-1">
        <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider px-2 py-1">
          Or
        </div>
        <button
          type="button"
          onClick={() => onPick({ kind: 'keep_general' })}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-slate-100 text-sm text-slate-700"
        >
          <Tag size={14} className="text-amber-600" />
          Keep as general knowledge
          <span className="ml-auto text-[10px] text-slate-400">AI uses it, no form field</span>
        </button>
        <button
          type="button"
          onClick={() => onPick({ kind: 'discard' })}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-red-50 text-sm text-slate-700 hover:text-red-700"
        >
          <Trash2 size={14} />
          Discard — not really knowledge
        </button>
      </div>

      <div className="border-t p-2 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>Back</Button>
      </div>
    </div>
  );
}
