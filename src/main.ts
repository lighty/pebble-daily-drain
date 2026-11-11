import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
} from "obsidian";
import {
  PebbleEntry,
  formatDailyFileName,
  groupByDate,
  idsPresentInDailyBody,
  insertEntriesIntoDaily,
  parsePebbleIndex,
} from "./core";

interface DailyDrainSettings {
  sourcePath: string;
  dailyFolderOverride: string;
  sectionTitle: string;
  pluginTag: string;
  autoOnStartup: boolean;
  autoOnModify: boolean;
}

const DEFAULT_SETTINGS: DailyDrainSettings = {
  sourcePath: "Pebble Index.md",
  dailyFolderOverride: "",
  sectionTitle: "pebble",
  pluginTag: "",
  autoOnStartup: true,
  autoOnModify: true,
};

const REGISTRY_KEY = "pebble_drained";

interface DailyNotesConfig {
  folder?: string;
  format?: string;
  template?: string;
}

interface DrainPlan {
  date: string;
  path: string;
  file: TFile | null;
  fresh: PebbleEntry[];
  alreadyFiled: number;
}

export default class PebbleDailyDrain extends Plugin {
  settings: DailyDrainSettings = DEFAULT_SETTINGS;
  private running = false;
  private debounceTimer: number | null = null;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "drain-now",
      name: "Drain Pebble Index into daily notes",
      callback: () => void this.drain(false),
    });
    this.addCommand({
      id: "preview-drain",
      name: "Preview drain (show what would be filed, write nothing)",
      callback: () => void this.drain(true),
    });
    this.addSettingTab(new DailyDrainSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoOnStartup) {
        // Give Obsidian Sync a moment to settle before reading the source.
        window.setTimeout(() => void this.drain(false), 3000);
      }
      if (this.settings.autoOnModify) {
        const onChange = (file: unknown) => {
          if (file instanceof TFile && file.path === normalizePath(this.settings.sourcePath)) {
            if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
            this.debounceTimer = window.setTimeout(() => void this.drain(false), 3000);
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

  private async readDailyNotesConfig(): Promise<DailyNotesConfig> {
    try {
      const raw = await this.app.vault.adapter.read(
        normalizePath(`${this.app.vault.configDir}/daily-notes.json`)
      );
      return JSON.parse(raw) as DailyNotesConfig;
    } catch {
      return {};
    }
  }

  private async plan(preview: boolean): Promise<DrainPlan[] | null> {
    const sourcePath = normalizePath(this.settings.sourcePath);
    const source = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(source instanceof TFile)) {
      new Notice(`Pebble Daily Drain: source note not found: ${sourcePath}`);
      return null;
    }
    const entries = parsePebbleIndex(await this.app.vault.read(source), {
      pluginTag: this.settings.pluginTag,
    });
    if (entries.length === 0) {
      new Notice("Pebble Daily Drain: no entries found in the source note.");
      return null;
    }

    const dn = await this.readDailyNotesConfig();
    const folder = this.settings.dailyFolderOverride || dn.folder || "";
    const format = dn.format || "YYYY-MM-DD";

    const plans: DrainPlan[] = [];
    for (const [date, dayEntries] of groupByDate(entries)) {
      const fileName = `${formatDailyFileName(format, date)}.md`;
      const path = normalizePath(folder ? `${folder}/${fileName}` : fileName);
      const existing = this.app.vault.getAbstractFileByPath(path);
      const file = existing instanceof TFile ? existing : null;

      const known = new Set<string>();
      if (file) {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const registered = fm?.[REGISTRY_KEY];
        if (Array.isArray(registered)) {
          for (const id of registered) if (typeof id === "string") known.add(id);
        }
        // Fallback: ids recomputed from the daily note's own body, so a lost
        // frontmatter registry does not cause duplicates.
        const content = await this.app.vault.read(file);
        for (const id of idsPresentInDailyBody(content, date)) known.add(id);
      }

      const fresh = dayEntries.filter((e) => !known.has(e.id));
      plans.push({ date, path, file, fresh, alreadyFiled: dayEntries.length - fresh.length });
    }
    return plans;
  }

  async drain(preview: boolean) {
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
            const tpl = this.app.vault.getAbstractFileByPath(normalizePath(dn.template));
            if (tpl instanceof TFile) initial = await this.app.vault.read(tpl);
          }
          file = await this.app.vault.create(plan.path, initial);
        }

        await this.app.vault.process(file, (data) =>
          insertEntriesIntoDaily(data, plan.fresh, this.settings.sectionTitle)
        );
        // Register ids AFTER the body is written: if the app dies in between,
        // the body-based fallback still prevents duplicates on the next run.
        const ids = plan.fresh.map((e) => e.id);
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          const current: unknown = fm[REGISTRY_KEY];
          const list = Array.isArray(current) ? current.filter((x) => typeof x === "string") : [];
          fm[REGISTRY_KEY] = [...new Set([...(list as string[]), ...ids])];
        });
        added += plan.fresh.length;
      }

      if (added > 0 || skipped > 0) {
        new Notice(
          `Pebble Daily Drain: filed ${added} entr${added === 1 ? "y" : "ies"}` +
            (skipped > 0 ? `, ${skipped} already filed.` : ".")
        );
      }
    } catch (err) {
      console.error("Pebble Daily Drain failed", err);
      new Notice("Pebble Daily Drain: something went wrong. See console for details.");
    } finally {
      this.running = false;
    }
  }

  private async ensureFolder(filePath: string) {
    const parts = filePath.split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
}

class PreviewModal extends Modal {
  private plans: DrainPlan[];

  constructor(app: App, plans: DrainPlan[]) {
    super(app);
    this.plans = plans;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Pebble Daily Drain — preview" });
    const total = this.plans.reduce((n, p) => n + p.fresh.length, 0);
    contentEl.createEl("p", {
      text:
        total === 0
          ? "Everything is already filed. Nothing to do."
          : `${total} entr${total === 1 ? "y" : "ies"} would be filed:`,
    });
    const ul = contentEl.createEl("ul");
    for (const p of this.plans) {
      if (p.fresh.length === 0) continue;
      ul.createEl("li", { text: `${p.date} → ${p.path}: ${p.fresh.length}` });
    }
    contentEl.createEl("p", { text: "Preview only — nothing was written." });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class DailyDrainSettingTab extends PluginSettingTab {
  plugin: PebbleDailyDrain;

  constructor(app: App, plugin: PebbleDailyDrain) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Source note")
      .setDesc(
        "The note Pebble appends to: the built-in integration's \"One main note\", " +
          "or the note selected in the Obsidian/Markdown Notes plugin's append mode."
      )
      .addText((text) =>
        text
          .setPlaceholder("Pebble Index.md")
          .setValue(this.plugin.settings.sourcePath)
          .onChange(async (value) => {
            this.plugin.settings.sourcePath = value.trim() || "Pebble Index.md";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Daily notes folder override")
      .setDesc("Leave empty to use the Daily Notes core plugin's folder.")
      .addText((text) =>
        text
          .setPlaceholder("(from Daily Notes settings)")
          .setValue(this.plugin.settings.dailyFolderOverride)
          .onChange(async (value) => {
            this.plugin.settings.dailyFolderOverride = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Section heading")
      .setDesc("Entries are filed as bullets under this heading in the daily note.")
      .addText((text) =>
        text
          .setPlaceholder("pebble")
          .setValue(this.plugin.settings.sectionTitle)
          .onChange(async (value) => {
            this.plugin.settings.sectionTitle = value.trim() || "pebble";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Pebble plugin tag")
      .setDesc(
        "Only for the Obsidian/Markdown Notes plugin: if you set a tag there, " +
          "the plugin appends \" #tag\" to every note. Enter the same tag here " +
          "(without #) to strip it from filed entries. Leave empty if unset."
      )
      .addText((text) =>
        text
          .setPlaceholder("(none)")
          .setValue(this.plugin.settings.pluginTag)
          .onChange(async (value) => {
            this.plugin.settings.pluginTag = value.trim().replace(/^#/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Run on startup")
      .setDesc("Drain shortly after Obsidian opens (after a short delay for sync).")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoOnStartup).onChange(async (value) => {
          this.plugin.settings.autoOnStartup = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Run when the source note changes")
      .setDesc("Drain a few seconds after Pebble Index.md is created or modified.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoOnModify).onChange(async (value) => {
          this.plugin.settings.autoOnModify = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
