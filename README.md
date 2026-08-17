# Overlay Player

A floating, always-on-top overlay that sits above whatever else you are doing.
Ask an AI a question and read the answer without leaving the app you're in — or
switch to the video panel and float a YouTube video instead. One codebase: a
Next.js app (UI **and** backend API) rendered inside an Electron window. Built
for macOS first, packages for Windows from the same source.

Single user by design — no accounts, no auth, no server. Your keys, library, and
settings live in files inside the app's own data directory.

## The chat panel

Bring your own key for **Claude**, **ChatGPT**, or **Gemini** — whichever you
have. Pick the provider in the key panel (the 🔑 button), paste a key, and ask.
Answers stream in token by token. `⌘⇧A` from any app reveals the overlay and
puts the caret straight in the question box.

The model name is a free-text field per provider, so you can point it at
anything your account can use rather than waiting for this app to add it.
`OPENAI_BASE_URL` redirects the ChatGPT provider at any OpenAI-compatible
endpoint (a local model server, Azure OpenAI, OpenRouter).

### About your API keys

Keys are stored in `keys.json` in the app's data directory, written with
owner-only permissions (`0600`), separate from `settings.json`. They are read
server-side to call the provider and are **never** sent to the renderer — the UI
only ever learns *whether* a key is set, not what it is.

This is plaintext on disk: the same trust model as `~/.netrc` or any CLI config
file. Anything running as your user account can read it. Don't put a key here
you wouldn't put in a dotfile. Alternatively, set `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `GEMINI_API_KEY` in the environment and the app will use
those instead, writing nothing to disk.

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` starts `next dev` on port 3000 and opens the Electron overlay once
the server is up. Paste a YouTube link in the bar and press Enter.

## What it does

- **Always on top**, above every app including full-screen VS Code, Chrome and
  Safari. On macOS the window is backed by an `NSPanel` (`type: 'panel'`), which
  is what allows it to float over another app's full-screen Space — a plain
  always-on-top window cannot. The pin is re-applied on show, on blur, and on
  any display change, because macOS quietly drops it in all three cases.
- **Present on every Space**, and `⌘⇧M` jumps it to whichever monitor your
  cursor is on. A window only ever lives on one physical display at a time, so
  multi-monitor is an explicit move rather than automatic.
- **See-through by default** — opacity starts at 60% so whatever is behind the
  overlay stays readable. The slider goes from 20% to fully opaque.
- **Click-through mode** — the window goes ghost and your clicks land on the app
  underneath, while the toolbar re-arms itself whenever the cursor moves over it.
- **Frameless and draggable** by its toolbar; resize from the bottom-right grip.
- **Auto-hiding controls** so only the video shows.
- **A saved library** with titles and thumbnails pulled from YouTube's oEmbed
  endpoint (no API key needed).
- **Tray icon** to show/hide/quit, since the window has no title bar.
- Remembers window position, size, opacity, volume, and the last video played.

### Shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘⇧A` / `Ctrl+Shift+A` | Show the overlay and focus the question box |
| `⌘⇧Y` / `Ctrl+Shift+Y` | Show / hide the overlay |
| `⌘⇧C` / `Ctrl+Shift+C` | Toggle click-through |
| `⌘⇧M` / `Ctrl+Shift+M` | Move the overlay to the screen your cursor is on |
| `⌘⇧Space` | Play / pause |
| `⌘⇧↑` / `⌘⇧↓` | Opacity up / down |
| `⌘⇧←` / `⌘⇧→` | Nudge the window left / right |
| `Space` | Play / pause (when the overlay has focus) |
| `←` / `→` | Seek 5s (when the overlay has focus) |

## How it fits together

```
electron/main.js      Overlay window, tray, global shortcuts, boots the server
electron/preload.js   The only bridge to the renderer (contextIsolation on)
src/app/              Next.js App Router — the UI
src/app/api/          The backend: settings, library, link resolution
src/lib/store.ts      JSON persistence in the app's data directory
src/lib/youtube.ts    Link parsing (watch, youtu.be, /shorts, /embed, bare id)
scripts/              Icon generation + standalone server assembly
```

**In development**, Electron attaches to `next dev` on port 3000.

**In production**, `next build` runs with `output: 'standalone'`, producing a
self-contained `server.js`. `scripts/prepare-server.mjs` combines it with the
static assets, electron-builder ships it as `resources/server`, and
`electron/main.js` boots it on a free port using Electron's own bundled Node —
so users never need Node installed.

State lives in Electron's `userData` directory, passed to the server as
`APP_DATA_DIR`:

- macOS — `~/Library/Application Support/Overlay Player/`
- Windows — `%APPDATA%\Overlay Player\`

## Building installers

```bash
npm run dist:mac    # .dmg + .zip (arm64 + x64) → release/
npm run dist:win    # NSIS installer (x64 + arm64) → release/
```

Mac builds are unsigned (`identity: null` in `electron-builder.yml`), which is
fine for personal use — on first launch, right-click the app and choose *Open*.
To ship signed builds, drop that line and set `CSC_LINK` / `CSC_KEY_PASSWORD`.

Cross-building a Windows installer from macOS works for the NSIS target but
needs Wine; the reliable route is to run `npm run dist:win` on Windows (or in
CI on a `windows-latest` runner).

## Troubleshooting

**The overlay never appears and the terminal prints an Electron API error.**
VS Code's integrated terminal exports `ELECTRON_RUN_AS_NODE=1`, which makes the
Electron binary boot as plain Node. `npm run dev` and `npm start` both launch
through `scripts/start-electron.mjs`, which strips it — use those rather than
calling `electron .` directly.

**A packaged build opens to a blank window.** That means the bundled server
could not start. `npm run build` now fails loudly if the standalone payload is
incomplete; if you change the packaging config, note that electron-builder
refuses to copy a `node_modules` directory sitting at the root of an
`extraResources` source, which is why the payload is nested under
`.electron-resources/payload/server`.

## Notes and limits

- Playback goes through YouTube's official IFrame embed. Videos whose owners
  disabled off-site embedding will not play — the app says so and offers an
  *Open on YouTube* button. There is no way around that restriction, and
  bypassing it would break YouTube's Terms of Service.
- The overlay is a normal, visible window. It appears in screen recordings and
  screen shares like any other window.
- Global shortcuts are system-wide; if another app already owns one, Electron
  logs a warning at startup and that single shortcut is skipped.
