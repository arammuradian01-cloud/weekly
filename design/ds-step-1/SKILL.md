---
name: sravni-internal-design
description: Use this skill to generate well-branded interfaces and assets for Сравни internal products (Weekly 2.0 and other department tools), either for production or throwaway prototypes/mocks. Contains design guidelines, colors for light and dark theme, type, fonts, icons and React components.
user-invocable: true
---

Read the readme.md file within this skill, and explore the other available files: styles.css and tokens/ for values, components/<group>/ for React components (each with .d.ts and .prompt.md), guidelines/tokens-table.md for the developer token table.
If creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out and create static HTML files for the user to view, linking styles.css. If working on production code, copy tokens into globals.css (@theme) and use the component names as in guidelines/tokens-table.md.
Rules that always apply: Russian UI texts on «вы», verb-first buttons, no exclamation marks, no emoji, no parallelogram, no white text on green or blue, one green primary button per screen, status colour always with a word, red only for overdue, errors and deletion.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts or production code, depending on the need.

### Оболочка (layout)
- `AppShell` variant sidebar | header; адаптив через container queries, ничего дополнительно задавать не нужно.
- `SiteHeader`, `MegaMenu`, `Tile`/`Tiles`, `PageHeader`, `Section`, `Columns`, `Logo` (официальный логотип из assets/logo).
