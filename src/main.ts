import { Editor, Plugin, PluginSettingTab, App, Setting } from "obsidian";

interface LineBlock {
  start: number;
  end: number;
  lines: string[];
  indent: number;
}

interface LineMoverSettings {
  smartMove: boolean;
  lang: "auto" | "zh" | "en";
}

const DEFAULT_SETTINGS: LineMoverSettings = {
  smartMove: true,
  lang: "auto",
};

// —— 双语文案:zh / en,lang=auto 时跟随系统语言 ——
const STRINGS = {
  en: {
    langName: "Interface language",
    langDesc: "Auto follows the system language.",
    smartName: "Smart move",
    smartDesc: "When on, the \"Move line up/down (smart)\" commands move the whole block including children; when off, only the current line moves.",
    hotkeyHeading: "Hotkeys",
    smartHint: ": smart move, includes children (controlled by the toggle above)",
    singleHint: ": moves the current line only",
    hotkeyHint: "No default hotkeys are set. Assign keys under Settings → Hotkeys (Alt+↑/↓ and Alt+Shift+↑/↓ recommended).",
    supportName: "Support the developer",
    supportDesc: "If Line Mover helps you, buy the author a coffee.",
    supportButton: "Buy a coffee ☕",
  },
  zh: {
    langName: "界面语言",
    langDesc: "Auto 表示跟随系统语言。",
    smartName: "智能移动模式",
    smartDesc: "开启后「Move line up/down (smart)」命令会连同子项一起移动，关闭后仅移动单行。",
    hotkeyHeading: "快捷键说明",
    smartHint: "：智能移动，包含子项（受上方开关控制）",
    singleHint: "：仅移动当前行",
    hotkeyHint: "插件不预设快捷键，请在 设置 → 快捷键 中为这些命令指定按键（推荐 Alt+↑/↓ 与 Alt+Shift+↑/↓）。",
    supportName: "支持开发者",
    supportDesc: "如果 Line Mover 对你有帮助，请作者喝杯咖啡。",
    supportButton: "请喝咖啡 ☕",
  },
} as const;

type Lang = keyof typeof STRINGS;

export default class LineMoverPlugin extends Plugin {
  settings: LineMoverSettings = DEFAULT_SETTINGS;

  /** 解析界面语言:设置优先,auto 跟随系统(navigator.language,弹窗窗口同样可用)。 */
  uiLang(): Lang {
    if (this.settings.lang !== "auto") return this.settings.lang;
    return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  t<K extends keyof (typeof STRINGS)["en"]>(key: K): string {
    return STRINGS[this.uiLang()][key];
  }

  async onload() {
    await this.loadSettings();

    // 智能移动（含子项，受设置开关控制）。不预设快捷键，避免与用户已有快捷键冲突
    this.addCommand({
      id: "move-line-up-smart",
      name: "Move line up (smart, with children)",
      editorCallback: (editor: Editor) => this.moveLine(editor, "up", this.settings.smartMove),
    });

    this.addCommand({
      id: "move-line-down-smart",
      name: "Move line down (smart, with children)",
      editorCallback: (editor: Editor) => this.moveLine(editor, "down", this.settings.smartMove),
    });

    // 仅移动当前行（不含子项）
    this.addCommand({
      id: "move-line-up-single",
      name: "Move line up (single line only)",
      editorCallback: (editor: Editor) => this.moveLine(editor, "up", false),
    });

    this.addCommand({
      id: "move-line-down-single",
      name: "Move line down (single line only)",
      editorCallback: (editor: Editor) => this.moveLine(editor, "down", false),
    });

    this.addSettingTab(new LineMoverSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<LineMoverSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private moveLine(editor: Editor, direction: "up" | "down", smart: boolean) {
    const cursor = editor.getCursor();
    const lineNum = cursor.line;
    const totalLines = editor.lineCount();

    // 多行选区：把选中的行整体作为一个块移动
    const selFrom = editor.getCursor("from");
    const selTo = editor.getCursor("to");
    const hasMultiSelection = selFrom.line !== selTo.line;

    let block: LineBlock;
    if (hasMultiSelection) {
      const start = Math.min(selFrom.line, selTo.line);
      const end = Math.max(selFrom.line, selTo.line);
      block = { start, end, lines: [], indent: this.getIndent(editor.getLine(start)) };
    } else if (smart) {
      block = this.getLineBlock(editor, lineNum);
    } else {
      block = {
        start: lineNum,
        end: lineNum,
        lines: [editor.getLine(lineNum)],
        indent: this.getIndent(editor.getLine(lineNum)),
      };
    }

    // 尾部空行不跟随块移动，保持原有段落间距
    while (block.end > block.start && editor.getLine(block.end).trim() === "") {
      block.end--;
    }

    // Calculate target position
    let targetStart: number;
    let targetEnd: number;
    let gapCount = 0;

    if (direction === "up") {
      if (block.start === 0) return;

      // 上方相邻行可能是上一个同级项的子项，需要回溯到其块首，否则会拆散列表层级
      const aboveStart = smart
        ? this.findPrecedingBlockStart(editor, block)
        : block.start - 1;
      if (aboveStart === null || aboveStart < 0) return;

      const aboveBlock = smart
        ? this.getLineBlock(editor, aboveStart)
        : {
            start: block.start - 1,
            end: block.start - 1,
            lines: [editor.getLine(block.start - 1)],
            indent: 0,
          };
      let aboveEnd = aboveBlock.end;
      while (aboveEnd > aboveBlock.start && editor.getLine(aboveEnd).trim() === "") {
        aboveEnd--;
      }
      // 上方标题节可能延伸到包含当前块，交换单元收缩到当前块上方一行为止
      if (aboveEnd > block.start - 1) aboveEnd = block.start - 1;
      gapCount = block.start - 1 - aboveEnd;
      targetStart = aboveBlock.start;
      targetEnd = block.end;
    } else {
      if (block.end >= totalLines - 1) return;

      let belowFirst: number;
      if (smart) {
        belowFirst = block.end + 1;
        while (belowFirst < totalLines && editor.getLine(belowFirst).trim() === "") {
          belowFirst++;
        }
        if (belowFirst >= totalLines) return;
      } else {
        belowFirst = block.end + 1;
      }

      const belowBlock = smart
        ? this.getLineBlock(editor, belowFirst)
        : {
            start: belowFirst,
            end: belowFirst,
            lines: [editor.getLine(belowFirst)],
            indent: 0,
          };
      // 下方块的尾部空行不进入交换区间，保持原有段落间距
      let belowEnd = belowBlock.end;
      while (belowEnd > belowBlock.start && editor.getLine(belowEnd).trim() === "") {
        belowEnd--;
      }
      gapCount = belowBlock.start - 1 - block.end;
      targetStart = block.start;
      targetEnd = belowEnd;
    }

    // Get all lines in the target range
    const allLines: string[] = [];
    for (let i = targetStart; i <= targetEnd; i++) {
      allLines.push(editor.getLine(i));
    }

    // Reorder lines based on direction（块之间的空行留在两块之间，不跟随移动）
    const currentBlockSize = block.end - block.start + 1;
    let reorderedLines: string[];

    if (direction === "up") {
      const aboveEndIdx = block.start - targetStart - gapCount - 1;
      const aboveLines = allLines.slice(0, aboveEndIdx + 1);
      const gapLines = allLines.slice(aboveEndIdx + 1, aboveEndIdx + 1 + gapCount);
      const currentLines = allLines.slice(aboveEndIdx + 1 + gapCount);
      reorderedLines = [...currentLines, ...gapLines, ...aboveLines];
    } else {
      const belowLines = allLines.slice(currentBlockSize + gapCount);
      const gapLines = allLines.slice(currentBlockSize, currentBlockSize + gapCount);
      const currentLines = allLines.slice(0, currentBlockSize);
      reorderedLines = [...belowLines, ...gapLines, ...currentLines];
    }

    // Replace the entire range
    const from = { line: targetStart, ch: 0 };
    const to = { line: targetEnd, ch: editor.getLine(targetEnd).length };
    editor.replaceRange(reorderedLines.join("\n"), from, to);

    // Update cursor position
    const cursorOffsetInBlock = cursor.line - block.start;
    const newLine = direction === "up"
      ? targetStart + cursorOffsetInBlock
      : targetStart + (allLines.length - currentBlockSize) + cursorOffsetInBlock;

    editor.setCursor({ line: Math.min(newLine, editor.lineCount() - 1), ch: cursor.ch });
  }

  // 从当前块上方一行往上找上一个同级块的首行：
  // 跳过空行与缩进更深的子行；代码围栏作为原子块；纯文本行若属于上方标题节，则回溯到标题行整节交换
  private findPrecedingBlockStart(editor: Editor, block: LineBlock): number | null {
    let p = block.start - 1;
    while (p >= 0) {
      const fence = this.fenceRangeAt(editor, p);
      if (fence) {
        p = fence.start;
        break;
      }
      const line = editor.getLine(p);
      if (/^\s*(`{3,}|~{3,})/.test(line)) {
        // 闭合围栏行：回溯到对应的打开行，整块交换
        const ch = line.match(/^\s*(`{3,}|~{3,})/)![1].charAt(0);
        let open = -1;
        for (let i = 0; i <= p - 1; i++) {
          const m = editor.getLine(i).match(/^\s*(`{3,}|~{3,})/);
          if (!m) continue;
          if (open === -1) open = i;
          else if (m[1].charAt(0) === ch) open = -1;
        }
        if (open !== -1) p = open;
        break;
      }
      if (line.trim() === "" || this.getIndent(line) > block.indent) {
        p--;
        continue;
      }
      break;
    }
    if (p < 0) return null;
    const pLine = editor.getLine(p);
    const atFence = this.fenceRangeAt(editor, p);
    if (!this.isListItem(pLine) && !this.isHeading(pLine) && !(atFence && atFence.start === p)) {
      for (let k = p - 1; k >= 0; k--) {
        if (this.fenceRangeAt(editor, k)) break; // 不跨代码围栏吸收标题节
        const line = editor.getLine(k);
        if (line.trim() === "") continue;
        if (this.isHeading(line)) p = k;
        break;
      }
    }
    return p;
  }

  // 返回包含 lineNum 的代码围栏范围（含开闭围栏行）；不在围栏内返回 null
  private fenceRangeAt(editor: Editor, lineNum: number): { start: number; end: number } | null {
    const totalLines = editor.lineCount();
    let start = -1;
    let marker = "";
    for (let i = 0; i <= lineNum; i++) {
      const line = editor.getLine(i);
      const m = line.match(/^\s*(`{3,}|~{3,})/);
      if (!m) continue;
      if (start === -1) {
        start = i;
        marker = m[1].charAt(0).repeat(3);
      } else if (line.trim().startsWith(marker)) {
        start = -1;
      }
    }
    if (start === -1) return null;
    let end = totalLines - 1;
    for (let i = lineNum + 1; i < totalLines; i++) {
      if (editor.getLine(i).trim().startsWith(marker)) {
        end = i;
        break;
      }
    }
    return { start, end };
  }

  private getLineBlock(editor: Editor, lineNum: number): LineBlock {
    const line = editor.getLine(lineNum);
    const indent = this.getIndent(line);

    // 代码围栏作为原子块整体移动，围栏内内容不参与列表/标题解析
    const fence = this.fenceRangeAt(editor, lineNum);
    if (fence) {
      return { start: fence.start, end: fence.end, lines: [], indent: 0 };
    }

    if (this.isHeading(line)) {
      return this.getHeadingBlock(editor, lineNum);
    }

    if (this.isListItem(line)) {
      return this.getListBlock(editor, lineNum);
    }

    return {
      start: lineNum,
      end: lineNum,
      lines: [line],
      indent,
    };
  }

  private isHeading(line: string): boolean {
    return /^#{1,6}\s/.test(line.trim());
  }

  private isListItem(line: string): boolean {
    return /^(\s*)([-*+]|\d+\.)\s/.test(line);
  }

  private getIndent(line: string): number {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }

  private getHeadingLevel(line: string): number {
    const match = line.match(/^(#{1,6})\s/);
    return match ? match[1].length : 0;
  }

  private getHeadingBlock(editor: Editor, lineNum: number): LineBlock {
    const line = editor.getLine(lineNum);
    const level = this.getHeadingLevel(line);
    const totalLines = editor.lineCount();
    const lines: string[] = [line];

    let end = lineNum;
    for (let i = lineNum + 1; i < totalLines; i++) {
      const nextLine = editor.getLine(i);
      if (this.isHeading(nextLine) && this.getHeadingLevel(nextLine) <= level) {
        break;
      }
      lines.push(nextLine);
      end = i;
    }

    return {
      start: lineNum,
      end,
      lines,
      indent: 0,
    };
  }

  private getListBlock(editor: Editor, lineNum: number): LineBlock {
    const line = editor.getLine(lineNum);
    const indent = this.getIndent(line);
    const totalLines = editor.lineCount();
    const lines: string[] = [line];

    let end = lineNum;
    for (let i = lineNum + 1; i < totalLines; i++) {
      const nextLine = editor.getLine(i);
      const nextIndent = this.getIndent(nextLine);

      if (nextIndent <= indent && nextLine.trim() !== "") {
        break;
      }

      if (nextLine.trim() === "") {
        lines.push(nextLine);
        end = i;
        continue;
      }

      lines.push(nextLine);
      end = i;
    }

    return {
      start: lineNum,
      end,
      lines,
      indent,
    };
  }
}

class LineMoverSettingTab extends PluginSettingTab {
  plugin: LineMoverPlugin;

  constructor(app: App, plugin: LineMoverPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName(this.plugin.t("langName"))
      .setDesc(this.plugin.t("langDesc"))
      .addDropdown((drop) =>
        drop
          .addOption("auto", "Auto")
          .addOption("zh", "简体中文")
          .addOption("en", "English")
          .setValue(this.plugin.settings.lang)
          .onChange(async (value) => {
            this.plugin.settings.lang = value as LineMoverSettings["lang"];
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("smartName"))
      .setDesc(this.plugin.t("smartDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.smartMove)
          .onChange(async (value) => {
            this.plugin.settings.smartMove = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName(this.plugin.t("hotkeyHeading")).setHeading();

    const descEl = containerEl.createDiv({ cls: "setting-item-description" });
    const smartRow = descEl.createEl("p");
    smartRow.createEl("strong", { text: "Move line up/down (smart, with children)" });
    smartRow.appendText(this.plugin.t("smartHint"));
    const singleRow = descEl.createEl("p");
    singleRow.createEl("strong", { text: "Move line up/down (single line only)" });
    singleRow.appendText(this.plugin.t("singleHint"));
    descEl.createEl("p").setText(this.plugin.t("hotkeyHint"));

    // 赞助入口:manifest 提供 fundingUrl 时才显示
    const funding = (this.plugin.manifest as { fundingUrl?: string }).fundingUrl;
    if (funding) {
      new Setting(containerEl)
        .setName(this.plugin.t("supportName"))
        .setDesc(this.plugin.t("supportDesc"))
        .addButton((b) => b.setButtonText(this.plugin.t("supportButton")).setCta().onClick(() => window.open(funding)));
    }
  }
}
