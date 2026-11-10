/**
 * Pure logic for Pebble Daily Drain.
 *
 * This module has no Obsidian imports so it can be unit-tested in plain Node.
 * Everything platform-specific (vault access, frontmatter processing, UI)
 * lives in main.ts.
 */

export interface PebbleEntry {
  /** Calendar date of the recording, `YYYY-MM-DD`. */
  date: string;
  /** Time of day of the recording, `HH:MM` (24h). */
  time: string;
  /** Transcript body, trimmed. */
  body: string;
  /** Deterministic dedupe id, e.g. `20261110-1430-9f3ac21e4b`. */
  id: string;
}

const ENTRY_HEADING = /^##\s+(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?\s*$/;
const TIME_HEADING = /^##\s+(\d{2}):(\d{2})(?::\d{2})?\s*$/;

/** cyrb53 string hash, returned as hex. Pure JS: safe on mobile (no Node crypto). */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

function normalizeBody(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

/**
 * Build the deterministic id for an entry.
 * Format: `YYYYMMDD-HHMM-<10 hex chars>` — deliberately contains no `:`
 * so it is a safe plain scalar in YAML frontmatter.
 */
export function entryId(date: string, time: string, body: string): string {
  const digest = hash53(`${date} ${time}\n${normalizeBody(body)}`).slice(0, 10);
  return `${date.replace(/-/g, "")}-${time.replace(":", "")}-${digest}`;
}

/**
 * Parse a `Pebble Index.md` file in the Pebble app's "One main note" format:
 *
 *     ## 2026-11-10 14:30
 *     transcript text...
 *
 *     ## 2026-11-10 15:02
 *     next transcript...
 *
 * Text before the first heading is ignored. Entries with an empty body
 * are skipped.
 */
export function parsePebbleIndex(content: string): PebbleEntry[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const entries: PebbleEntry[] = [];
  let current: { date: string; time: string; bodyLines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const body = normalizeBody(current.bodyLines.join("\n"));
    if (body) {
      entries.push({
        date: current.date,
        time: current.time,
        body,
        id: entryId(current.date, current.time, body),
      });
    }
    current = null;
  };

  for (const line of lines) {
    const m = line.match(ENTRY_HEADING);
    if (m) {
      flush();
      current = { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  flush();
  return entries;
}

/** Group entries by date, preserving in-day order. Dates are sorted ascending. */
export function groupByDate(entries: PebbleEntry[]): Map<string, PebbleEntry[]> {
  const map = new Map<string, PebbleEntry[]>();
  for (const e of entries) {
    const list = map.get(e.date) ?? [];
    list.push(e);
    map.set(e.date, list);
  }
  return new Map([...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export type HeadingStyle = "time" | "original";

/** Render one entry as it will appear inside the daily note. */
export function formatEntry(entry: PebbleEntry, style: HeadingStyle): string {
  const heading = style === "original" ? `## ${entry.date} ${entry.time}` : `## ${entry.time}`;
  return `${heading}\n\n${entry.body}`;
}

/**
 * Fallback dedupe: recompute the ids of entries already present in a daily
 * note, by scanning its `## HH:MM` (or `## YYYY-MM-DD HH:MM`) blocks.
 * This protects against duplicates even if the frontmatter registry
 * (`pebble_drained`) was lost in a sync conflict or deleted by hand.
 */
export function idsPresentInDailyBody(dailyContent: string, dailyDate: string): Set<string> {
  const lines = dailyContent.replace(/\r\n/g, "\n").split("\n");
  const ids = new Set<string>();
  let current: { date: string; time: string; bodyLines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const body = normalizeBody(current.bodyLines.join("\n"));
    if (body) ids.add(entryId(current.date, current.time, body));
    current = null;
  };

  for (const line of lines) {
    const full = line.match(ENTRY_HEADING);
    const timeOnly = line.match(TIME_HEADING);
    if (full) {
      flush();
      current = { date: `${full[1]}-${full[2]}-${full[3]}`, time: `${full[4]}:${full[5]}`, bodyLines: [] };
    } else if (timeOnly) {
      flush();
      current = { date: dailyDate, time: `${timeOnly[1]}:${timeOnly[2]}`, bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  flush();
  return ids;
}

/** Extract the date (`YYYY-MM-DD`) from a daily-note file name like `2026-11-10.md`. */
export function dateFromDailyFileName(fileName: string): string | null {
  const m = fileName.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Apply a Daily Notes date format (`YYYY-MM-DD` style) to a date. */
export function formatDailyFileName(format: string, date: string): string {
  const [y, mo, d] = date.split("-");
  return format.replace(/YYYY/g, y).replace(/MM/g, mo).replace(/DD/g, d);
}
