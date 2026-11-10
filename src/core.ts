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
 * Flatten a body to a single line: entries are filed as list items, so
 * line breaks become spaces. The dedupe id is computed from this flattened
 * form, so the id recomputed from a filed bullet always matches the id
 * computed from the (possibly multi-line) source entry.
 */
export function flattenBody(raw: string): string {
  return normalizeBody(raw).replace(/\s*\n\s*/g, " ").replace(/ {2,}/g, " ").trim();
}

/**
 * Build the deterministic id for an entry.
 * Format: `YYYYMMDD-HHMM-<10 hex chars>` — deliberately contains no `:`
 * so it is a safe plain scalar in YAML frontmatter.
 */
export function entryId(date: string, time: string, body: string): string {
  const digest = hash53(`${date} ${time}\n${flattenBody(body)}`).slice(0, 10);
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

const BULLET = /^- (\d{2}):(\d{2}) : (.+)$/;

/** Render one entry as a bullet for the daily note: `- HH:MM : text`. */
export function formatBullet(entry: PebbleEntry): string {
  return `- ${entry.time} : ${flattenBody(entry.body)}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Insert entries into a daily note's content, as bullets under a
 * `## <sectionTitle>` section (default title: `pebble`):
 *
 *     ## pebble
 *     - 20:01 : first note
 *     - 20:54 : second note
 *
 * If the section already exists, the bullets are appended after its last
 * existing bullet (before the next `##` heading). Otherwise a new section
 * is appended at the end of the note.
 */
export function insertEntriesIntoDaily(
  content: string,
  entries: PebbleEntry[],
  sectionTitle: string
): string {
  if (entries.length === 0) return content;
  const bullets = entries.map(formatBullet);
  const text = content.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const headingRe = new RegExp(`^##\\s+${escapeRegExp(sectionTitle)}\\s*$`, "i");
  const headingIdx = lines.findIndex((l) => headingRe.test(l));

  if (headingIdx === -1) {
    const base = text.replace(/\s+$/, "");
    const section = `## ${sectionTitle}\n\n${bullets.join("\n")}\n`;
    return base ? `${base}\n\n${section}` : section;
  }

  // Section ends at the next level-2 heading, or at end of file.
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  // Insert after the last existing bullet in the section, if any;
  // otherwise right after the heading (and its following blank line).
  let insertAt = -1;
  for (let i = end - 1; i > headingIdx; i--) {
    if (BULLET.test(lines[i])) {
      insertAt = i + 1;
      break;
    }
  }
  if (insertAt === -1) {
    insertAt = headingIdx + 1;
    if (insertAt < lines.length && lines[insertAt].trim() === "") insertAt++;
  }
  lines.splice(insertAt, 0, ...bullets);
  return lines.join("\n").replace(/\s+$/, "") + "\n";
}

/**
 * Fallback dedupe: recompute the ids of entries already present in a daily
 * note. Recognises the current bullet format (`- HH:MM : text`) anywhere in
 * the note, plus the legacy v0.1 heading blocks (`## HH:MM` /
 * `## YYYY-MM-DD HH:MM`).
 * This protects against duplicates even if the frontmatter registry
 * (`pebble_drained`) was lost in a sync conflict or deleted by hand.
 */
export function idsPresentInDailyBody(dailyContent: string, dailyDate: string): Set<string> {
  const lines = dailyContent.replace(/\r\n/g, "\n").split("\n");
  const ids = new Set<string>();

  for (const line of lines) {
    const b = line.match(BULLET);
    if (b) ids.add(entryId(dailyDate, `${b[1]}:${b[2]}`, b[3]));
  }

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
