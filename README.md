# React UI Source Editor

A local dev tool for inspecting and editing React UIs in place. Run the agent, drop a bookmarklet onto your running app, click any element, and edit its **style / className / props / text** in an in-page panel. Changes are written back to the **source file** and Vite HMR (or your bundler's equivalent) reloads the page automatically. Also included: **Undo/Redo** across edits, and **parent/child JSX tree navigation** so you can step up or down the component tree from the clicked element.

---

## Quick start

1. ```bash
   npm install
   ```
2. ```bash
   npm run build:overlay
   ```
3. ```bash
   npm run agent
   ```
   Serves `http://localhost:4567` (override with `PORT=…`). The console prints the port on startup.

4. Open `http://localhost:4567/` and **drag the "UI Source Editor" bookmarklet** to your bookmarks bar.
   > Browsers block pasting `javascript:` URLs directly, so **drag is required** — you cannot paste it into the address bar.

5. Open your running app's tab (e.g. `http://localhost:3000`) and click the bookmark. Click any element to inspect and edit it.

---

## React ≤ 18 — zero setup

Works out of the box. React 18 and earlier attach `_debugSource` metadata to each fiber, which carries the element's source location (file, line, column). The bookmarklet alone is enough — no changes to your target app are needed.

Tree navigation (↑ parent / ↓ child) is available in this mode.

---

## React 19+ — add the Babel plugin

React 19 removed `_debugSource`, so source locations must be injected at build time via a Babel plugin bundled in this repo.

> **DEV ONLY.** The plugin injects absolute file paths; do not enable it in production builds.

**Step 1.** Build the plugin:

```bash
npm run build:plugin
```

This produces `dist/sourceAttrs.mjs`.

**Step 2.** Wire it into your target app's Babel config (dev only):

**Vite** (`@vitejs/plugin-react`):

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import sourceAttrs from '<path-to-this-repo>/dist/sourceAttrs.mjs';

export default defineConfig(({ command }) => ({
  plugins: [
    react(command === 'serve' ? { babel: { plugins: [sourceAttrs] } } : {}),
  ],
}));
```

**webpack + babel-loader / CRA (via craco) / Rollup (`@rollup/plugin-babel`)**: add `sourceAttrs` to that toolchain's Babel `plugins` array in your dev config.

The plugin stamps `data-source-file`, `data-source-line`, and `data-source-column` on host elements; the overlay reads these attributes to resolve the source location.

> **Tree navigation (↑/↓) is disabled in this mode** — the fiber tree is not walked, so parent/child stepping is unavailable.

---

## Bundler support

| Toolchain | Status |
|---|---|
| Vite (`@vitejs/plugin-react`) | ✅ |
| webpack + babel-loader | ✅ |
| CRA (via craco) | ✅ |
| Rollup (`@rollup/plugin-babel`) | ✅ |
| Vite (`@vitejs/plugin-react-swc`) | ❌ SWC — no Babel plugins |
| Next.js (default SWC) | ❌ SWC — no Babel plugins |
| esbuild-only transforms | ❌ no Babel plugins |

Any **Babel-based** toolchain works. **SWC-based** toolchains do not run Babel plugins; an SWC plugin is future work.

---

## Debug aid

To force the data-attribute resolution path on any React version (useful for testing React 19 behavior on a React 18 app), set this in the page console **after** loading the overlay:

```js
window.__uiModifierForceDataSource = true
```

---

## Notes & limitations

- **Dev-only.** The Babel plugin injects absolute file paths; never include it in production builds.
- The agent writes changes to the **absolute path** the element reports and keeps timestamped backups under this repo's `.ui-modifier-backups/`. The target repo stays clean.
- Edits to elements rendered via `.map()` or styled with emotion's `css` prop are surfaced as **manual suggestions**, not auto-applied (safety guard).
- This is a personal/dev tool. The agent is an open `localhost` server — only run it while you need it.
