import type { OnboardingSection } from '../data/onboarding-template';
import type { KBEntry } from '../data/types';

/**
 * Build AI context directly from raw onboarding form data + manual KB entries.
 *
 * Replaces the old pipeline:
 *   onboardingData → recomposePropertyKB() → KBEntry[] → buildFullKBContext() → TOON
 *
 * New pipeline:
 *   onboardingData → buildPropertyContext() → flat section string → AI prompt
 *
 * FAQs are stored in onboardingData as 'faqs__items' (JSON string of { question, answer }[]).
 * Manual KB entries (from document import) are appended at the end.
 */
export function buildPropertyContext(
  propId: string,
  propName: string,
  onboardingData: Record<string, Record<string, string>>,
  formTemplate: OnboardingSection[],
  roomNames: string[],
  manualKBEntries: KBEntry[],
): string {
  const formData = onboardingData[propId] || {};
  // When no property is resolved (e.g. a proxy ticket before the agent has
  // picked one), don't emit a misleading `[Property: ]` empty header — it
  // signals "property exists but has no data" to the LLM, which is worse
  // than clearly saying "no property context available".
  const lines: string[] = propName
    ? [`[Property: ${propName}]`]
    : ['[No property selected — property-specific knowledge base unavailable. Use general hospitality knowledge tagged source:ai as needed.]'];

  for (const section of formTemplate) {
    if (section.hostHidden) continue;
    // Skip faqs section — handled separately below via faqs__items key
    if (section.id === 'faqs') continue;

    if (section.perRoom) {
      for (let r = 0; r < roomNames.length; r++) {
        const roomLines: string[] = [];
        for (const field of section.fields) {
          if (field.hostHidden) continue;
          const val = formData[`${section.id}__room${r}__${field.id}`]?.trim();
          if (val) roomLines.push(`  ${field.label}: ${val}`);
        }
        if (roomLines.length > 0) {
          lines.push(`\n[${roomNames[r]} \u2014 ${section.title}]`);
          lines.push(...roomLines);
        }
      }
    } else {
      const sLines: string[] = [];
      for (const field of section.fields) {
        if (field.hostHidden) continue;
        const val = formData[`${section.id}__${field.id}`]?.trim();
        if (val) sLines.push(`  ${field.label}: ${val}`);
      }
      if (sLines.length > 0) {
        lines.push(`\n[${section.title}]`);
        lines.push(...sLines);
      }
    }
  }

  // FAQs are stored as a JSON string under 'faqs__items' in onboardingData
  const faqsRaw = formData['faqs__items'];
  if (faqsRaw) {
    try {
      const faqItems: { question: string; answer: string }[] = JSON.parse(faqsRaw);
      const filledFaqs = faqItems.filter(f => f.question.trim() && f.answer.trim());
      if (filledFaqs.length > 0) {
        lines.push('\n[FAQs]');
        for (const f of filledFaqs) {
          lines.push(`  Q: ${f.question}`);
          lines.push(`  A: ${f.answer}`);
        }
      }
    } catch {
      // Malformed JSON — skip
    }
  }

  // Manual KB entries (from document import) — public entries for this property/host
  const manual = manualKBEntries.filter(
    e => !e.internal && (!e.propId || e.propId === propId),
  );
  if (manual.length > 0) {
    lines.push('\n[Additional Knowledge]');
    for (const e of manual) {
      lines.push(`  ${e.title}: ${e.content.replace(/\n/g, ' ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Build a TOON-format KB string for use in the classify-inquiry prompt.
 * Keeps the same token-efficient format used by the auto-reply system so
 * the LLM can align inquiry labels with existing KB entry titles.
 */
export function buildKBToonForClassify(entries: KBEntry[]): string {
  if (entries.length === 0) return '(no knowledge base entries)';
  const lines = ['kb_entries{scope,topic,content}:'];
  for (const e of entries) {
    const scope = e.roomId ? 'room' : 'property';
    const content = e.content.replace(/\n/g, ' ').replace(/"/g, "'");
    lines.push(`  ${scope},${e.title},"${content}"`);
  }
  return lines.join('\n');
}
