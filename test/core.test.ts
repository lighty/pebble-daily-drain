import { test } from "node:test";
import assert from "node:assert/strict";
import {
  entryId,
  flattenBody,
  formatBullet,
  formatDailyFileName,
  groupByDate,
  idsPresentInDailyBody,
  insertEntriesIntoDaily,
  parsePebbleIndex,
} from "../src/core";

const SAMPLE = `# Pebble Index

## 2026-11-09 21:15
Buy milk and eggs.

## 2026-11-10 09:02
Idea: a ring that files its own notes.
Second line of the same thought.

## 2026-11-10 14:30
Call the bank about the card.
`;

test("parses entries with date, time and body", () => {
  const entries = parsePebbleIndex(SAMPLE);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].date, "2026-11-09");
  assert.equal(entries[0].time, "21:15");
  assert.equal(entries[0].body, "Buy milk and eggs.");
  assert.equal(
    entries[1].body,
    "Idea: a ring that files its own notes.\nSecond line of the same thought."
  );
});

test("ignores preamble and empty entries", () => {
  const entries = parsePebbleIndex("# Title\n\nSome intro.\n\n## 2026-11-10 08:00\n\n## 2026-11-10 09:00\nReal body.\n");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].time, "09:00");
});

test("ids are deterministic, colon-free and body-sensitive", () => {
  const a = entryId("2026-11-10", "14:30", "Call the bank about the card.");
  const b = entryId("2026-11-10", "14:30", "Call the bank about the card.");
  const c = entryId("2026-11-10", "14:30", "Call the bank about something else.");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^20261110-1430-[0-9a-f]{10}$/);
  assert.ok(!a.includes(":"));
});

test("id is the same for multi-line and flattened bodies", () => {
  const multi = entryId("2026-11-10", "09:02", "Idea: a ring.\nSecond line.");
  const flat = entryId("2026-11-10", "09:02", "Idea: a ring. Second line.");
  assert.equal(multi, flat);
});

test("groups by date in ascending order", () => {
  const grouped = groupByDate(parsePebbleIndex(SAMPLE));
  assert.deepEqual([...grouped.keys()], ["2026-11-09", "2026-11-10"]);
  assert.equal(grouped.get("2026-11-10")?.length, 2);
});

test("flattens bodies and formats bullets", () => {
  assert.equal(flattenBody("line one\nline two"), "line one line two");
  const entries = parsePebbleIndex(SAMPLE);
  assert.equal(formatBullet(entries[2]), "- 14:30 : Call the bank about the card.");
  assert.equal(
    formatBullet(entries[1]),
    "- 09:02 : Idea: a ring that files its own notes. Second line of the same thought."
  );
});

test("inserts a new pebble section into a fresh daily note", () => {
  const entries = parsePebbleIndex(SAMPLE).filter((e) => e.date === "2026-11-10");
  const out = insertEntriesIntoDaily("# 2026-11-10\n", entries, "pebble");
  assert.equal(
    out,
    "# 2026-11-10\n\n## pebble\n\n" +
      "- 09:02 : Idea: a ring that files its own notes. Second line of the same thought.\n" +
      "- 14:30 : Call the bank about the card.\n"
  );
});

test("appends bullets inside an existing pebble section, before the next section", () => {
  const entries = parsePebbleIndex(SAMPLE).filter((e) => e.date === "2026-11-10");
  const daily =
    "# 2026-11-10\n\n## pebble\n\n- 09:02 : Idea: a ring that files its own notes. Second line of the same thought.\n\n## Journal\n\nDear diary.\n";
  const out = insertEntriesIntoDaily(daily, [entries[1]], "pebble");
  assert.ok(out.includes("- 09:02 : Idea: a ring that files its own notes. Second line of the same thought.\n- 14:30 : Call the bank about the card.\n\n## Journal"));
});

test("fallback: ids recomputed from filed bullets match the source ids", () => {
  const entries = parsePebbleIndex(SAMPLE);
  const day = entries.filter((e) => e.date === "2026-11-10");
  const daily = insertEntriesIntoDaily("# 2026-11-10\n", day, "pebble");
  const found = idsPresentInDailyBody(daily, "2026-11-10");
  for (const e of day) assert.ok(found.has(e.id), `missing ${e.id}`);
  assert.ok(!found.has(entries[0].id));
});

test("fallback: legacy v0.1 heading blocks are still recognised", () => {
  const daily = "# 2026-11-10\n\n## 14:30\n\nCall the bank about the card.\n";
  const found = idsPresentInDailyBody(daily, "2026-11-10");
  assert.ok(found.has(entryId("2026-11-10", "14:30", "Call the bank about the card.")));
});

test("daily file name formatting", () => {
  assert.equal(formatDailyFileName("YYYY-MM-DD", "2026-11-10"), "2026-11-10");
  assert.equal(formatDailyFileName("YYYY/MM/YYYY-MM-DD", "2026-01-05"), "2026/01/2026-01-05");
});

// --- Obsidian/Markdown Notes plugin format (v0.3.0) ---
// Blocks exactly as written by the official Pebble plugin in append mode:
// "## YYYY-MM-DD HH:MM" + blank line + text, blocks joined by a blank line.

const PLUGIN_SAMPLE = `# Pebble Index

## 2026-11-11 19:34

First note via the plugin.

## 2026-11-11 20:01

Multi-line note
second line here.

## 2026-11-11 21:12

Tagged note #pebble

## 2026-11-11 22:40

Note with a location.

[location:: geo:35.681,139.767]
[location_label:: Tokyo Station]
`;

test("plugin append format parses like the built-in format", () => {
  const entries = parsePebbleIndex(PLUGIN_SAMPLE);
  assert.equal(entries.length, 4);
  assert.equal(entries[0].date, "2026-11-11");
  assert.equal(entries[0].time, "19:34");
  assert.equal(entries[0].body, "First note via the plugin.");
  assert.equal(entries[1].body, "Multi-line note\nsecond line here.");
});

test("plugin location metadata lines are dropped from the body", () => {
  const entries = parsePebbleIndex(PLUGIN_SAMPLE);
  assert.equal(entries[3].body, "Note with a location.");
});

test("plugin tag is kept by default and stripped when configured", () => {
  const kept = parsePebbleIndex(PLUGIN_SAMPLE);
  assert.equal(kept[2].body, "Tagged note #pebble");
  const stripped = parsePebbleIndex(PLUGIN_SAMPLE, { pluginTag: "pebble" });
  assert.equal(stripped[2].body, "Tagged note");
  // Tag stripping must not eat a mid-text hashtag or a different tag.
  const other = parsePebbleIndex("## 2026-11-11 10:00\n\nUse #pebble wisely #other\n", {
    pluginTag: "pebble",
  });
  assert.equal(other[0].body, "Use #pebble wisely #other");
});

test("plugin entries file and dedupe like built-in entries", () => {
  const entries = parsePebbleIndex(PLUGIN_SAMPLE, { pluginTag: "pebble" });
  const daily = insertEntriesIntoDaily("# 2026-11-11\n", entries, "pebble");
  assert.ok(daily.includes("- 21:12 : Tagged note"));
  assert.ok(daily.includes("- 22:40 : Note with a location."));
  const found = idsPresentInDailyBody(daily, "2026-11-11");
  for (const e of entries) assert.ok(found.has(e.id), `missing ${e.id}`);
});
