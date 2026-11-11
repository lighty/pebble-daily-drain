# Pebble Daily Drain

An [Obsidian](https://obsidian.md) plugin that files your
[Pebble Index 01](https://repebble.com) voice notes into **daily notes** —
one note per day.

Every Pebble recording lands in a single `Pebble Index.md` in your vault —
written either by the Pebble app's built-in Obsidian integration, or by the
official Obsidian/Markdown Notes plugin (append mode). This plugin
periodically drains those entries into the daily note for the day each
recording was made, so your ring notes live next to everything else in
that day.

Inside the daily note, entries are filed as a compact bullet list under a
`## pebble` section:

```markdown
## pebble
- 20:01 : Feeling good today
- 20:54 : Apparently the One Piece manga is great
```

Multi-line transcripts are flattened onto the bullet's single line.

- No server, no webhook. Runs entirely inside Obsidian, on mobile too
  (iPhone included) — only the Vault API is used.
- Non-destructive: `Pebble Index.md` is never modified or deleted.
- Idempotent: run it as often as you like, on as many devices as you like;
  entries are never filed twice (see "How duplicates are prevented").

## Setup

1. Set up **one** of the two supported ways for Pebble to append notes to
   a single file in your vault (see "Where the notes come from" below).
   The recommended route is the official Obsidian/Markdown Notes plugin.
2. Install this plugin (see below).
3. Done — it drains on startup and whenever `Pebble Index.md` changes.
   You can also run it manually from the command palette.

### Where the notes come from

Daily Drain reads one source note (`Pebble Index.md` by default) made of
`## YYYY-MM-DD HH:MM` entry blocks. Two Pebble-side writers produce
exactly that shape, and archives written by one keep working after you
switch to the other:

**Route A — the official Obsidian/Markdown Notes plugin (recommended)**

This is the Pebble app's **Plugins** system (Pebble app → Settings →
Plugins → "Plugins / permissions preview") — not to be confused with
Obsidian community plugins such as this one.

1. Turn the Plugins preview **on**.
2. Install the **Obsidian/Markdown Notes** plugin from the Pebble
   appstore and grant it read/write access when asked.
3. In the plugin's settings:
   - pick your vault as the folder,
   - set the note mode to **Append to an existing note** and select
     `Pebble Index.md` (or whichever note Daily Drain reads),
   - leave **Tag** empty (or set the same tag in Daily Drain's
     "Pebble plugin tag" setting so it is stripped when filing),
   - placement: **bottom** (entries stay chronological; top also works).
4. Make sure the Index notes destination points at
   Obsidian/Markdown Notes, then record a test note and check that
   `Pebble Index.md` gains a new `## YYYY-MM-DD HH:MM` block.

> The plugin's **"create a separate note per recording"** mode is *not*
> a supported source: each recording becomes its own file, and Daily
> Drain reads a single appended note. Use append mode.

**Route B — the built-in integration (legacy)**

Keep the Plugins preview **off** and set the Pebble app's built-in
Obsidian integration to **One main note**. While the Plugins preview is
on, the built-in destinations are hidden in favour of plugin ones, so
the two routes are mutually exclusive — pick one.

If your notes suddenly stop arriving, check the route you chose: for
Route A, the Plugins preview must be on and the Obsidian/Markdown Notes
plugin configured (folder granted, append target selected); for Route B,
the preview must be off. A short test recording should add a new
`## YYYY-MM-DD HH:MM` block to the source note either way.

## Install

### Install with BRAT

1. Install the `BRAT` plugin from Obsidian Community Plugins
2. Open `BRAT` settings
3. Choose `Add Beta plugin`
4. Enter `https://github.com/lighty/pebble-daily-drain`
5. Install and enable `Pebble Daily Drain`

BRAT expects this repository to publish GitHub Releases. If installation fails, make sure you are using a released version instead of an unreleased commit.

### Manual install

1. Download `main.js`, `manifest.json` (and `versions.json`) from this repo or from a release.
2. Copy them into your vault at:
   `.obsidian/plugins/pebble-daily-drain/`
3. In Obsidian: Settings → Community plugins → enable **Pebble Daily Drain**.

If you use Obsidian Sync with plugin sync enabled, the plugin propagates to
your other devices automatically.

## Releases

This repository publishes GitHub Releases for BRAT. Each release includes
these assets:

- `main.js`
- `manifest.json`

To cut a release: tag the version (e.g. `0.1.0`), then create a GitHub
Release for that tag with `main.js` and `manifest.json` attached as
individual assets.

## Commands

- **Drain Pebble Index into daily notes** — file everything now.
- **Preview drain** — show, per date, how many entries *would* be filed.
  Writes nothing.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Source note | `Pebble Index.md` | The note Pebble appends to. |
| Daily notes folder override | *(empty)* | Empty = use the Daily Notes core plugin's folder/format/template. |
| Section heading | `pebble` | Entries are filed as bullets under this heading. |
| Pebble plugin tag | *(empty)* | Route A only: the tag set in the Obsidian/Markdown Notes plugin, stripped from filed entries. |
| Run on startup | On | Runs a few seconds after launch, to let sync settle. |
| Run when the source note changes | On | Debounced. |

Output follows your **Daily Notes** core plugin configuration (folder,
date format, template). New daily notes are created from your template when
one is configured.

## How duplicates are prevented

Each entry gets a deterministic ID: `YYYYMMDD-HHMM-<hash of the text>`,
e.g. `20261110-1430-9f3ac21e4b`. IDs are stored **in the daily note's
frontmatter**, so note bodies stay clean:

```yaml
---
pebble_drained:
  - 20261110-1430-9f3ac21e4b
---
```

Before filing, the plugin checks two things:

1. the `pebble_drained` frontmatter list, and
2. a fallback: IDs recomputed from the daily note's existing bullets
   (`- HH:MM : text`), so even if the frontmatter is lost — e.g. to an
   Obsidian Sync conflict — unedited entries are not filed twice.

If you hand-edit a filed entry's body, the frontmatter ID still protects it;
if you delete an entry from a daily note entirely, it will be filed again on
the next run (it still exists in `Pebble Index.md`).

> Tip: to avoid two devices racing on the same frontmatter, enable the
> automatic triggers mainly on one device (e.g. your phone) and use the
> manual command elsewhere.

## Development

```sh
npm install
npm test        # unit tests for the parser / dedupe logic (src/core.ts)
npm run build   # type-check + bundle to main.js
```

Layout: `src/core.ts` is pure logic with no Obsidian imports (unit-tested);
`src/main.ts` is the plugin itself.

## Status / limitations

- **v0.3.0** — supports the Pebble app's official Obsidian/Markdown Notes
  plugin (Plugins preview, append mode) as the note source, alongside the
  legacy built-in integration: both write identical
  `## YYYY-MM-DD HH:MM` blocks. The parser additionally drops the
  plugin's `[location:: …]` metadata lines and can strip the plugin's
  configured ` #tag` suffix (new "Pebble plugin tag" setting). The
  plugin's separate-file ("create") mode is not a supported source yet.
- **v0.2.0** — daily-note format changed: entries are filed as bullets
  (`- HH:MM : text`) under a `## pebble` section instead of one heading
  per entry. Dedupe IDs are now computed from the flattened single-line
  text, so IDs from v0.1.0 filings differ; the frontmatter registry and
  the legacy heading fallback still prevent re-filing in practice.
- **v0.1.0** — assumes the Pebble app's "One main note" format
  (`## YYYY-MM-DD HH:MM` headings, body until the next heading), as
  documented for the integration. Verification against a real-world
  `Pebble Index.md` sample is in progress; if Pebble changes the format,
  the parser in `src/core.ts` is the only place that needs updating.
- The source note grows forever by design (it is the raw archive; Obsidian
  Sync keeps its version history). Archiving/rotation may come later.
- Roadmap: support for the "separate file for each note" mode as a source.

## License

MIT — see [LICENSE](LICENSE).
