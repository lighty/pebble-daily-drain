import { test } from "node:test";
import assert from "node:assert/strict";
import {
  entryId,
  formatDailyFileName,
  formatEntry,
  groupByDate,
  idsPresentInDailyBody,
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

test("groups by date in ascending order", () => {
  const grouped = groupByDate(parsePebbleIndex(SAMPLE));
  assert.deepEqual([...grouped.keys()], ["2026-11-09", "2026-11-10"]);
  assert.equal(grouped.get("2026-11-10")?.length, 2);
});

test("formats entries for daily notes", () => {
  const [e] = parsePebbleIndex(SAMPLE).slice(2);
  assert.equal(formatEntry(e, "time"), "## 14:30\n\nCall the bank about the card.");
  assert.equal(formatEntry(e, "original"), "## 2026-11-10 14:30\n\nCall the bank about the card.");
});

test("fallback: ids recomputed from a daily note's body match the source ids", () => {
  const entries = parsePebbleIndex(SAMPLE);
  const day = entries.filter((e) => e.date === "2026-11-10");
  const daily = `# 2026-11-10\n\n${day.map((e) => formatEntry(e, "time")).join("\n\n")}\n`;
  const found = idsPresentInDailyBody(daily, "2026-11-10");
  for (const e of day) assert.ok(found.has(e.id), `missing ${e.id}`);
  assert.ok(!found.has(entries[0].id));
});

test("daily file name formatting", () => {
  assert.equal(formatDailyFileName("YYYY-MM-DD", "2026-11-10"), "2026-11-10");
  assert.equal(formatDailyFileName("YYYY/MM/YYYY-MM-DD", "2026-01-05"), "2026/01/2026-01-05");
});
