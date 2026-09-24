/**
 * Assembles the standalone Next.js server that ships inside the packaged app.
 *
 * `next build` with output:'standalone' emits .next/standalone/server.js plus a
 * pruned node_modules, but deliberately leaves out the static assets and public
 * files. This copies all three into one directory that electron-builder mounts
 * at resources/server.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const standalone = path.join(root, '.next', 'standalone');

// The payload is nested one level deep on purpose. electron-builder's copy
// filter unconditionally rejects a node_modules directory sitting at the root
// of an extraResources source (util/filter.js: `if (relative === "node_modules")
// return false`), which silently produces a server with no dependencies. A
// nested `server/node_modules` matches its "/node_modules" branch and is kept.
const payload = path.join(root, '.electron-resources', 'payload');
const target = path.join(payload, 'server');

if (!fs.existsSync(standalone)) {
  console.error('Missing .next/standalone — run `next build` first.');
  process.exit(1);
}

fs.rmSync(payload, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

// `.data` is the local dev store; it must never ship inside the app bundle.
fs.cpSync(standalone, target, {
  recursive: true,
  filter: (src) => path.basename(src) !== '.data',
});
fs.cpSync(path.join(root, '.next', 'static'), path.join(target, '.next', 'static'), {
  recursive: true,
});

const publicDir = path.join(root, 'public');
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, path.join(target, 'public'), { recursive: true });
}

// Guard both halves of the payload: a missing server.js or missing deps both
// yield an app that launches to a blank window, which is painful to diagnose
// only after packaging.
for (const required of ['server.js', 'node_modules/next/package.json', '.next/static']) {
  if (!fs.existsSync(path.join(target, required))) {
    console.error(`Incomplete standalone payload: ${required} is missing. Packaging would produce a broken app.`);
    process.exit(1);
  }
}

/**
 * Strip the build machine's absolute path out of the payload.
 *
 * Next records where it was built — `repoRoot`, `outputFileTracingRoot` and
 * friends — and on a Mac that path contains the account name. Harmless on your
 * own machine; it travels with every copy you hand to somebody else.
 *
 * These are build-time tracing hints, not runtime lookups, so a placeholder is
 * as good as the real thing. Only text files are touched, and only exact
 * matches of the root.
 */
function scrubBuildPaths(dir) {
  let scrubbed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scrubbed += scrubBuildPaths(full);
      continue;
    }
    if (!/\.(json|js|mjs|cjs)$/.test(entry.name)) continue;
    const before = fs.readFileSync(full, 'utf8');
    if (!before.includes(root)) continue;
    fs.writeFileSync(full, before.split(root).join('/app'), 'utf8');
    scrubbed++;
  }
  return scrubbed;
}

const scrubbed = scrubBuildPaths(target);

console.log(`Prepared standalone server at ${path.relative(root, target)}`);
if (scrubbed) console.log(`Scrubbed the build path from ${scrubbed} file(s).`);
