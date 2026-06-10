// src/agent/bookmarklet.ts

/**
 * Returns the `javascript:` bookmarklet that injects the served overlay bundle
 * as a <script> into the current page. `Date.now()` runs at click time so each
 * click pulls a fresh (uncached) copy of the bundle.
 */
export function bookmarkletHref(port: number): string {
  // snippet is placed RAW into href="...": it must never contain `"` or `&`.
  const snippet =
    `(function(){` +
    `var s=document.createElement('script');` +
    `s.src='http://localhost:${port}/overlay.js?'+Date.now();` +
    `document.body.appendChild(s);` +
    `})();`;
  return "javascript:" + snippet;
}

/**
 * Full landing-page HTML. Shows the agent port and offers a draggable
 * bookmarklet anchor (browsers strip `javascript:` pasted into the address
 * bar, so drag-to-bookmarks-bar is required).
 */
export function landingHtml(port: number): string {
  const href = bookmarkletHref(port);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>antd UI Modifier — overlay</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
  code { background: #f2f2f2; padding: 0 .3em; border-radius: 3px; }
  .bm { display: inline-block; padding: .5em 1em; margin: 1rem 0; background: #1677ff; color: #fff;
        border-radius: 6px; text-decoration: none; font-weight: 600; }
  ol { padding-left: 1.2rem; }
  .meta { color: #555; font-size: 13px; }
</style>
</head>
<body>
<h1>antd UI Modifier</h1>
<p class="meta">Agent port: <code>${port}</code></p>
<p><strong>Drag this to your bookmarks bar:</strong></p>
<p><a class="bm" href="${href}">UI Modifier</a></p>
<ol>
  <li>Open your running app tab (e.g. <code>localhost:3000</code>).</li>
  <li>Click the <strong>UI Modifier</strong> bookmark.</li>
  <li>Click an element and edit it.</li>
</ol>
</body>
</html>`;
}
