#!/usr/bin/env node
/* ==========================================================================
   Cache-busting stamp. Run before every commit (the pre-commit hook does it):

     node scripts/stamp.mjs

   GitHub Pages serves everything with max-age=600 and there's no way to
   change that, so a deploy can take ten minutes to reach someone who just
   refreshed. This gives every JS module and the stylesheet a ?v=<content hash>
   URL (modules via an import map, so the relative imports inside them don't
   need touching), and writes the overall version to both index.html and
   version.json. app.js compares the two on boot and reloads if it's behind.
   ========================================================================== */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);
// Hash with LF endings so a CRLF checkout on Windows stamps the same as Linux.
const fileHash = (path) => hash(readFileSync(path, "utf8").replace(/\r\n/g, "\n"));
const posix = (p) => p.split(sep).join("/");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });
}

const modules = walk(join(ROOT, "js"))
  .map((p) => ({ url: "./" + posix(relative(ROOT, p)), v: fileHash(p) }))
  .sort((a, b) => a.url.localeCompare(b.url));
const cssV = fileHash(join(ROOT, "assets", "styles.css"));
const appV = modules.find((m) => m.url === "./js/app.js").v;

const imports = Object.fromEntries(modules.map((m) => [m.url, `${m.url}?v=${m.v}`]));
const importMap =
  `<!-- stamp:importmap (written by scripts/stamp.mjs — don't edit by hand) -->\n` +
  `<script type="importmap">\n${JSON.stringify({ imports }, null, 2)}\n</script>\n` +
  `<!-- /stamp:importmap -->`;

const indexPath = join(ROOT, "index.html");
let html = readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n");

const swap = (re, to, what) => {
  if (!re.test(html)) throw new Error(`stamp: couldn't find ${what} in index.html`);
  html = html.replace(re, to);
};
swap(/<!-- stamp:importmap[\s\S]*?<!-- \/stamp:importmap -->/, importMap, "the import map markers");
swap(/href="assets\/styles\.css(\?v=[^"]*)?"/, `href="assets/styles.css?v=${cssV}"`, "the stylesheet link");
swap(/src="js\/app\.js(\?v=[^"]*)?"/, `src="js/app.js?v=${appV}"`, "the app.js script tag");

// The version covers the page itself too, minus the line that carries it.
const versionRe = /<meta name="app-version" content="[^"]*" \/>/;
const version = hash(html.replace(versionRe, ""));
swap(versionRe, `<meta name="app-version" content="${version}" />`, "the app-version meta tag");

writeFileSync(indexPath, html);
writeFileSync(join(ROOT, "version.json"), JSON.stringify({ version }) + "\n");
console.log(`stamped ${version} (${modules.length} modules)`);
