# Pebble Daily Drain — design notes

## Problem

The Pebble Index 01's Obsidian integration offers three modes — one main
note, one existing note, or one file per recording. There is no "one note
per day" mode. The desired behaviour: recordings consolidated into the
daily note of the day they were made.

## Constraints (from the actual environment)

- Phone is an **iPhone** — no Android-only tooling (e.g. indexRouter).
- Vault syncs with **paid Obsidian Sync** — which has no public API
  (end-to-end encrypted), so nothing outside Obsidian can write into the
  vault directly.
- **No always-on server** at home — webhook receivers are out.
- Therefore the transform must run *inside* Obsidian, using only the
  mobile-compatible Vault API (`isDesktopOnly: false`).

## Approach

Source: the Pebble integration in **One main note** mode appends entries to
`Pebble Index.md` under headings like `## 2026-11-10 14:30`, body running
until the next heading. The plugin:

1. Parses the source note into dated entries.
2. Resolves the destination from the Daily Notes core plugin config
   (`.obsidian/daily-notes.json`: folder, format, template).
3. Creates `<folder>/YYYY-MM-DD.md` if missing, applying the configured
   template itself (the core plugin's creation path is not invoked).
4. Appends each entry as a bullet `- HH:MM : text` under a `## pebble`
   section in that day's note (section title is a setting; the section is
   created at the end of the note if missing, and bullets are appended
   inside it if it already exists). Multi-line transcripts are flattened
   to one line.
5. Records the entry's ID in the destination's frontmatter registry.

Triggers: on layout ready (with a settle delay for Sync), on source-file
create/modify (debounced), and manual commands ("Drain now" / "Preview
drain" — preview writes nothing).

v1 is non-destructive: the source note is never modified.

## Idempotency

Body-visible markers were rejected (noisy). Per-entry YAML mid-document is
not possible — Obsidian only treats a file's first block as frontmatter; a
mid-file `---` is a horizontal rule.

Chosen design: a **frontmatter registry** on each daily note.

```yaml
---
pebble_drained:
  - 20261110-1430-9f3ac21e4b
---
```

- IDs are deterministic: `YYYYMMDD-HHMM-` + 10 hex chars of a cyrb53 hash
  of `date + time + normalized body`. No `:` in the ID, so each list item
  is a safe YAML plain scalar.
- Writes go through `fileManager.processFrontMatter`, which merges with
  (and preserves) existing properties such as `tags`.
- Body is written *before* the registry update, so a crash in between is
  still safe.

Known weaknesses and mitigations:

- The list shows in the Properties panel if property display is enabled.
  Bounded by that day's entry count; can be hidden in Obsidian settings.
- Frontmatter is a hot spot: two devices draining simultaneously could
  Sync-conflict and drop one side's ID additions. Mitigation: a **fallback
  check** recomputes IDs from the destination's existing entries (time
  heading + body), so unedited entries are not re-filed even if the
  registry is lost. Entries whose body was hand-edited remain protected by
  the surviving registry ID.
- Recommendation: enable auto-drain mainly on one device; run the command
  manually on others.

Alternatives compared:

| Method | Visible in notes | Survives plugin reinstall | Cross-device | Notes |
| --- | --- | --- | --- | --- |
| Frontmatter registry (chosen) | Properties panel only | Yes | Via the note itself | Hot-spot risk, mitigated by fallback |
| HTML comment in body | Yes, in source view | Yes | Via the note itself | Rejected: clutters the text |
| Plugin `data.json` | No | No (per-device unless settings sync) | Only if plugin settings sync | Nothing in notes, but registry can silently desync per device |

## Roadmap

- v1: main-note source, triggers, preview, settings.
- v1.1: polish — settings UI, edge-case hardening against real samples.
- v2: "separate file per note" as an alternative source.
