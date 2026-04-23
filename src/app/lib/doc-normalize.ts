import * as XLSX from 'xlsx';
import { stableHash } from './storage';

/**
 * Stage A of the ingest pipeline: normalize any supported upload into a list
 * of labeled text sections. This is the cheap, local, LLM-free step — Stage
 * B (the AI router) only ever sees plain text labeled with a section name.
 *
 * Supported today:
 *   .xlsx / .xls / .csv  — one section per sheet (or the whole sheet for csv)
 *   .md / .txt / .json   — one section per file
 *   anything else        — best-effort text read; large binary blobs should
 *                          be kept out of the pipeline until we add a proper
 *                          PDF / DOCX extractor.
 *
 * We deliberately do NOT try to split long prose into "sub-sections" here.
 * The router prompt is tolerant of one big section, and splitting would
 * require heuristics that drift from doc to doc. Sheets are a natural
 * boundary; paragraphs are not.
 */

export interface NormalizedSection {
  /** Human-readable section label shown in the review UI and passed to the
   *  router as `sectionLabel` (drives the sheet/row provenance in citations). */
  label: string;
  /** Plain text content for this section. */
  text: string;
  /** Sheet name when the source was an xlsx/csv file. Populated for provenance. */
  sheet?: string;
}

export interface NormalizedDocument {
  filename: string;
  /** Hash of the concatenated section text. When this is unchanged between
   *  two uploads of the same doc we can skip Stage B entirely. */
  contentHash: string;
  sections: NormalizedSection[];
  /** Sheet names for xlsx workbooks. */
  sheets?: string[];
  /** Set if extraction failed or yielded nothing usable. */
  error?: string;
}

const MAX_SECTION_CHARS = 60_000; // conservative — keeps one router call under ~15k tokens

export async function normalizeDocument(file: File): Promise<NormalizedDocument> {
  const filename = file.name;
  const lower = filename.toLowerCase();

  try {
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      return await normalizeXlsx(file);
    }
    if (lower.endsWith('.csv')) {
      return await normalizeCsv(file);
    }
    if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.json')) {
      return await normalizePlainText(file);
    }
    // Fallback — best-effort text. The router prompt still works on raw
    // text; we just lose per-section structure.
    return await normalizePlainText(file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      filename,
      contentHash: '',
      sections: [],
      error: `Failed to read ${filename}: ${msg}`,
    };
  }
}

async function normalizeXlsx(file: File): Promise<NormalizedDocument> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheets: string[] = [];
  const sections: NormalizedSection[] = [];

  for (const sheetName of wb.SheetNames) {
    sheets.push(sheetName);
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    // CSV representation preserves row/column structure as text, which is
    // what the router needs. sheet_to_txt collapses too much.
    const text = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const trimmed = text.trim();
    if (!trimmed) continue;
    sections.push({
      label: sheetName,
      sheet: sheetName,
      text: trimmed.slice(0, MAX_SECTION_CHARS),
    });
  }

  const concatenated = sections.map(s => `[Sheet: ${s.label}]\n${s.text}`).join('\n\n');
  return {
    filename: file.name,
    contentHash: await stableHash(concatenated),
    sheets,
    sections,
  };
}

async function normalizeCsv(file: File): Promise<NormalizedDocument> {
  const text = (await file.text()).trim();
  return {
    filename: file.name,
    contentHash: await stableHash(text),
    sections: text ? [{ label: file.name, text: text.slice(0, MAX_SECTION_CHARS) }] : [],
  };
}

async function normalizePlainText(file: File): Promise<NormalizedDocument> {
  const text = (await file.text()).trim();
  return {
    filename: file.name,
    contentHash: await stableHash(text),
    sections: text ? [{ label: file.name, text: text.slice(0, MAX_SECTION_CHARS) }] : [],
  };
}
