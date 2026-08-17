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

console.log(`Prepared standalone server at ${path.relative(root, target)}`);
