# Line Mover

An [Obsidian](https://obsidian.md) plugin that moves lines and blocks up and down with `Alt + ↑/↓`, with smart handling of list hierarchies, heading sections, and code blocks.

## Features

- **Smart movement** (`Alt + ↑/↓`): moves the whole block under your cursor
  - A list item moves together with all its nested children
  - A heading moves together with its entire section (until the next heading of the same or higher level)
  - A fenced code block moves as one atomic unit — content inside is never parsed as lists or headings
- **Single-line movement** (`Alt + Shift + ↑/↓`): moves only the current line, ignoring children
- **Multi-line selection**: select several lines and move them as one block
- **Structure safety**: swapping never breaks list nesting — a sibling item swaps with the entire previous sibling block, not just its last child
- **Spacing preservation**: blank lines between blocks stay between them instead of traveling with the moved block

## Settings

- **Smart movement**: when enabled (default), `Alt + ↑/↓` moves whole blocks; when disabled, they move single lines. `Alt + Shift + ↑/↓` always moves single lines.

All hotkeys can be remapped in *Settings → Hotkeys*.

## Usage

Place the cursor on a line (or select lines) and press:

| Hotkey | Action |
|--------|--------|
| `Alt + ↑` | Move block up (with children, if smart movement is on) |
| `Alt + ↓` | Move block down (with children, if smart movement is on) |
| `Alt + Shift + ↑` | Move single line up |
| `Alt + Shift + ↓` | Move single line down |

## Installation

### From Community Plugins (after approval)

Open *Settings → Community plugins → Browse*, search for **Line Mover** and install.

### Manual installation

Copy `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/line-mover/` and reload Obsidian.

## Development

```bash
npm install
npm run dev     # watch mode
npm run build   # production build
```

## License

[MIT](LICENSE)
