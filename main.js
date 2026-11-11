var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PebbleDailyDrain
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/core.ts
var ENTRY_HEADING = /^##\s+(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?\s*$/;
var TIME_HEADING = /^##\s+(\d{2}):(\d{2})(?::\d{2})?\s*$/;
function hash53(str, seed = 0) {
  let h1 = 3735928559 ^ seed;
  let h2 = 1103547991 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
function normalizeBody(raw) {
  return raw.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
}
function flattenBody(raw) {
  return normalizeBody(raw).replace(/\s*\n\s*/g, " ").replace(/ {2,}/g, " ").trim();
}
function entryId(date, time, body) {
  const digest = hash53(`${date} ${time}
${flattenBody(body)}`).slice(0, 10);
  return `${date.replace(/-/g, "")}-${time.replace(":", "")}-${digest}`;
}
var LOCATION_LINE = /^\[(?:location|location_label)::.*\]\s*$/;
function cleanPluginBody(raw, pluginTag) {
  let body = normalizeBody(raw).split("\n").filter((line) => !LOCATION_LINE.test(line.trim())).join("\n");
  body = normalizeBody(body);
  const tag = (pluginTag != null ? pluginTag : "").trim().replace(/^#/, "");
  if (tag) {
    const suffix = ` #${tag}`;
    if (body.endsWith(suffix)) {
      body = normalizeBody(body.slice(0, -suffix.length));
    } else if (body === `#${tag}`) {
      body = "";
    }
  }
  return body;
}
function parsePebbleIndex(content, opts) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const entries = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    const body = cleanPluginBody(current.bodyLines.join("\n"), opts == null ? void 0 : opts.pluginTag);
    if (body) {
      entries.push({
        date: current.date,
        time: current.time,
        body,
        id: entryId(current.date, current.time, body)
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
function groupByDate(entries) {
  var _a;
  const map = /* @__PURE__ */ new Map();
  for (const e of entries) {
    const list = (_a = map.get(e.date)) != null ? _a : [];
    list.push(e);
    map.set(e.date, list);
  }
  return new Map([...map.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
var BULLET = /^- (\d{2}):(\d{2}) : (.+)$/;
function formatBullet(entry) {
  return `- ${entry.time} : ${flattenBody(entry.body)}`;
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function insertEntriesIntoDaily(content, entries, sectionTitle) {
  if (entries.length === 0) return content;
  const bullets = entries.map(formatBullet);
  const text = content.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const headingRe = new RegExp(`^##\\s+${escapeRegExp(sectionTitle)}\\s*$`, "i");
  const headingIdx = lines.findIndex((l) => headingRe.test(l));
  if (headingIdx === -1) {
    const base = text.replace(/\s+$/, "");
    const section = `## ${sectionTitle}

${bullets.join("\n")}
`;
    return base ? `${base}

${section}` : section;
  }
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
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
function idsPresentInDailyBody(dailyContent, dailyDate) {
  const lines = dailyContent.replace(/\r\n/g, "\n").split("\n");
  const ids = /* @__PURE__ */ new Set();
  for (const line of lines) {
    const b = line.match(BULLET);
    if (b) ids.add(entryId(dailyDate, `${b[1]}:${b[2]}`, b[3]));
  }
  let current = null;
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
function formatDailyFileName(format, date) {
  const [y, mo, d] = date.split("-");
  return format.replace(/YYYY/g, y).replace(/MM/g, mo).replace(/DD/g, d);
}

// src/main.ts
var DEFAULT_SETTINGS = {
  sourcePath: "Pebble Index.md",
  dailyFolderOverride: "",
  sectionTitle: "pebble",
  pluginTag: "",
  autoOnStartup: true,
  autoOnModify: true
};
var REGISTRY_KEY = "pebble_drained";
var PebbleDailyDrain = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.running = false;
    this.debounceTimer = null;
  }
  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: "drain-now",
      name: "Drain Pebble Index into daily notes",
      callback: () => void this.drain(false)
    });
    this.addCommand({
      id: "preview-drain",
      name: "Preview drain (show what would be filed, write nothing)",
      callback: () => void this.drain(true)
    });
    this.addSettingTab(new DailyDrainSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoOnStartup) {
        window.setTimeout(() => void this.drain(false), 3e3);
      }
      if (this.settings.autoOnModify) {
        const onChange = (file) => {
          if (file instanceof import_obsidian.TFile && file.path === (0, import_obsidian.normalizePath)(this.settings.sourcePath)) {
            if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
            this.debounceTimer = window.setTimeout(() => void this.drain(false), 3e3);
          }
        };
        this.registerEvent(this.app.vault.on("modify", onChange));
        this.registerEvent(this.app.vault.on("create", onChange));
      }
    });
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async readDailyNotesConfig() {
    try {
      const raw = await this.app.vault.adapter.read(
        (0, import_obsidian.normalizePath)(`${this.app.vault.configDir}/daily-notes.json`)
      );
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }
  async plan(preview) {
    var _a;
    const sourcePath = (0, import_obsidian.normalizePath)(this.settings.sourcePath);
    const source = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(source instanceof import_obsidian.TFile)) {
      new import_obsidian.Notice(`Pebble Daily Drain: source note not found: ${sourcePath}`);
      return null;
    }
    const entries = parsePebbleIndex(await this.app.vault.read(source), {
      pluginTag: this.settings.pluginTag
    });
    if (entries.length === 0) {
      new import_obsidian.Notice("Pebble Daily Drain: no entries found in the source note.");
      return null;
    }
    const dn = await this.readDailyNotesConfig();
    const folder = this.settings.dailyFolderOverride || dn.folder || "";
    const format = dn.format || "YYYY-MM-DD";
    const plans = [];
    for (const [date, dayEntries] of groupByDate(entries)) {
      const fileName = `${formatDailyFileName(format, date)}.md`;
      const path = (0, import_obsidian.normalizePath)(folder ? `${folder}/${fileName}` : fileName);
      const existing = this.app.vault.getAbstractFileByPath(path);
      const file = existing instanceof import_obsidian.TFile ? existing : null;
      const known = /* @__PURE__ */ new Set();
      if (file) {
        const fm = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
        const registered = fm == null ? void 0 : fm[REGISTRY_KEY];
        if (Array.isArray(registered)) {
          for (const id of registered) if (typeof id === "string") known.add(id);
        }
        const content = await this.app.vault.read(file);
        for (const id of idsPresentInDailyBody(content, date)) known.add(id);
      }
      const fresh = dayEntries.filter((e) => !known.has(e.id));
      plans.push({ date, path, file, fresh, alreadyFiled: dayEntries.length - fresh.length });
    }
    return plans;
  }
  async drain(preview) {
    if (this.running) return;
    this.running = true;
    try {
      const plans = await this.plan(preview);
      if (!plans) return;
      if (preview) {
        new PreviewModal(this.app, plans).open();
        return;
      }
      const dn = await this.readDailyNotesConfig();
      let added = 0;
      let skipped = 0;
      for (const plan of plans) {
        skipped += plan.alreadyFiled;
        if (plan.fresh.length === 0) continue;
        let file = plan.file;
        if (!file) {
          await this.ensureFolder(plan.path);
          let initial = "";
          if (dn.template) {
            const tpl = this.app.vault.getAbstractFileByPath((0, import_obsidian.normalizePath)(dn.template));
            if (tpl instanceof import_obsidian.TFile) initial = await this.app.vault.read(tpl);
          }
          file = await this.app.vault.create(plan.path, initial);
        }
        await this.app.vault.process(
          file,
          (data) => insertEntriesIntoDaily(data, plan.fresh, this.settings.sectionTitle)
        );
        const ids = plan.fresh.map((e) => e.id);
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          const current = fm[REGISTRY_KEY];
          const list = Array.isArray(current) ? current.filter((x) => typeof x === "string") : [];
          fm[REGISTRY_KEY] = [.../* @__PURE__ */ new Set([...list, ...ids])];
        });
        added += plan.fresh.length;
      }
      if (added > 0 || skipped > 0) {
        new import_obsidian.Notice(
          `Pebble Daily Drain: filed ${added} entr${added === 1 ? "y" : "ies"}` + (skipped > 0 ? `, ${skipped} already filed.` : ".")
        );
      }
    } catch (err) {
      console.error("Pebble Daily Drain failed", err);
      new import_obsidian.Notice("Pebble Daily Drain: something went wrong. See console for details.");
    } finally {
      this.running = false;
    }
  }
  async ensureFolder(filePath) {
    const parts = filePath.split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
};
var PreviewModal = class extends import_obsidian.Modal {
  constructor(app, plans) {
    super(app);
    this.plans = plans;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Pebble Daily Drain \u2014 preview" });
    const total = this.plans.reduce((n, p) => n + p.fresh.length, 0);
    contentEl.createEl("p", {
      text: total === 0 ? "Everything is already filed. Nothing to do." : `${total} entr${total === 1 ? "y" : "ies"} would be filed:`
    });
    const ul = contentEl.createEl("ul");
    for (const p of this.plans) {
      if (p.fresh.length === 0) continue;
      ul.createEl("li", { text: `${p.date} \u2192 ${p.path}: ${p.fresh.length}` });
    }
    contentEl.createEl("p", { text: "Preview only \u2014 nothing was written." });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var DailyDrainSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Source note").setDesc(
      `The note Pebble appends to: the built-in integration's "One main note", or the note selected in the Obsidian/Markdown Notes plugin's append mode.`
    ).addText(
      (text) => text.setPlaceholder("Pebble Index.md").setValue(this.plugin.settings.sourcePath).onChange(async (value) => {
        this.plugin.settings.sourcePath = value.trim() || "Pebble Index.md";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Daily notes folder override").setDesc("Leave empty to use the Daily Notes core plugin's folder.").addText(
      (text) => text.setPlaceholder("(from Daily Notes settings)").setValue(this.plugin.settings.dailyFolderOverride).onChange(async (value) => {
        this.plugin.settings.dailyFolderOverride = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Section heading").setDesc("Entries are filed as bullets under this heading in the daily note.").addText(
      (text) => text.setPlaceholder("pebble").setValue(this.plugin.settings.sectionTitle).onChange(async (value) => {
        this.plugin.settings.sectionTitle = value.trim() || "pebble";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Pebble plugin tag").setDesc(
      'Only for the Obsidian/Markdown Notes plugin: if you set a tag there, the plugin appends " #tag" to every note. Enter the same tag here (without #) to strip it from filed entries. Leave empty if unset.'
    ).addText(
      (text) => text.setPlaceholder("(none)").setValue(this.plugin.settings.pluginTag).onChange(async (value) => {
        this.plugin.settings.pluginTag = value.trim().replace(/^#/, "");
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Run on startup").setDesc("Drain shortly after Obsidian opens (after a short delay for sync).").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.autoOnStartup).onChange(async (value) => {
        this.plugin.settings.autoOnStartup = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Run when the source note changes").setDesc("Drain a few seconds after Pebble Index.md is created or modified.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.autoOnModify).onChange(async (value) => {
        this.plugin.settings.autoOnModify = value;
        await this.plugin.saveSettings();
      })
    );
  }
};
