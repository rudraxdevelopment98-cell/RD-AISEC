# How to view these charts (all free)

[← back to control room](index.md)

Everything here is **Markdown + [Mermaid](https://mermaid.js.org/)**. No app required, no account, nothing to pay for. Three ways to view, pick what you like.

## 1. On GitHub (zero setup) ✅
Just push and open the repo on github.com. GitHub renders every Mermaid block (flowcharts, mindmaps, Gantt, sequence, state diagrams) automatically. This is the default — your "control room" is the rendered README + docs.

## 2. In Obsidian — the interactive mindmap / graph view ⭐
This is what gives you the *linked web you described* — see how every doc connects, zoom around like a mindmap.

1. Download **[Obsidian](https://obsidian.md)** (free for personal use).
2. **Open folder as vault** → select this repo folder (`shiva`).
3. Open **Graph View** (the graph icon in the left ribbon) → you see every doc as a node, links as edges.
4. Mermaid renders inline in preview mode out of the box.

> Tip: the relative `[links](...)` between docs are what build the graph. Keep cross-linking docs and the map grows itself.

Optional Obsidian plugins (all free): **Excalidraw** (hand-drawn diagrams), **Kanban** (turn progress.md into a draggable board), **Dataview** (auto-generate task lists from checkboxes).

## 3. In VS Code (while you code)
Install the **Markdown Preview Mermaid Support** extension → live preview of any doc as you edit.

---

## Which chart type for what

| You want to show… | Use | Example here |
|---|---|---|
| The whole idea at a glance | `mindmap` | [overview](overview.md) |
| Timeline / schedule | `gantt` | [roadmap](roadmap.md) |
| Phases + decision gates | `stateDiagram-v2` | [roadmap](roadmap.md) |
| A pipeline / system | `flowchart` | [architecture](architecture.md) |
| An attack step-by-step | `sequenceDiagram` | [threat-model](threat-model.md) |
| A task board | `flowchart` subgraphs (or Obsidian Kanban) | [progress](progress.md) |

## Editing tip
Sketch/preview diagrams fast at the **[Mermaid Live Editor](https://mermaid.live)** (free, no login), then paste the code into a fenced ` ```mermaid ` block here.

## Why this over Notion / Miro / Lucidchart?
Those are fine but: free tiers are limited, charts live *outside* your code, and they're not version-controlled. Here, the charts live **next to the work**, evolve in git history, and render on the same GitHub everyone already sees. One source of truth.

[← back to control room](index.md)
