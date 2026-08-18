# Overlay Player

A floating, always-on-top AI assistant that sits above whatever else you are
doing. Ask a question, read the answer, get back to work — without switching
away from the app you're in. One codebase: a Next.js app (UI **and** backend
API) rendered inside an Electron window. Built for macOS first, packages for
Windows from the same source.

Single user by design — no accounts, no auth, no server of your own. Your keys
and settings live in files inside the app's own data directory.

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` starts `next dev` on port 3000 and opens the Electron overlay once
the server is up. Paste an API key in the 🔑 panel and ask a question — or skip
the key entirely and [run a model locally](#running-locally). Set `PORT` if
something else already owns 3000.

## What it does

- **Bring your own key** for **Claude**, **ChatGPT**, or **Gemini** — whichever
  you have. Switch providers from the key panel at any time.
- **Streams answers** token by token, with a stop button mid-answer.
- **Runs offline** — a switch in the composer moves answering to a model on
  your own machine via Ollama. See [Running locally](#running-locally).
- **Your own documents** — attach a CV, a brief or notes and the assistant
  answers from them, retrieving only the relevant passages. See
  [Documents](#documents).
- **Web search** — a globe toggle in the composer lets the model look things up
  before answering. See [Web search](#web-search).
- **Ask by voice** — `⌘⌥S` records the default microphone, transcribes it, and
  sends the question without you typing. See [Speech to text](#speech-to-text).
- **`⌘⇧A` from any app** reveals the overlay with the caret already in the
  question box.
- **Always on top**, above every app including full-screen VS Code, Chrome and
  Safari. On macOS the window is backed by an `NSPanel` (`type: 'panel'`), which
  is what allows it to float over another app's full-screen Space — a plain
  always-on-top window cannot. The pin is re-applied on show, on blur, and on
  any display change, because macOS quietly drops it in all three cases.
- **Present on every Space**, and `⌘⇧M` jumps it to whichever monitor your
  cursor is on. A window only ever lives on one physical display at a time, so
  multi-monitor is an explicit move rather than automatic.
- **Always excluded from screen capture** — the window is left out of screen
  shares, recordings and screenshots, with no toggle to switch it off. See
  [Screen-capture exclusion](#screen-capture-exclusion) for what that does and
  does not cover.
- **See-through** — opacity starts at 95% so whatever is behind the overlay
  stays readable. The slider goes from 20% to fully opaque.
- **Click-through mode** — the window goes ghost and your clicks land on the app
  underneath.
- **Frameless and draggable** by its toolbar; resize from the bottom-right grip.
- **Tray icon** to show/hide/quit, since the window has no title bar.
- Remembers window position, size, opacity, and your provider choice.

### Models

The model name is a free-text field per provider, so you can point it at
anything your account can use rather than waiting for this app to add it. Leave
it blank to use the provider's default.

`OPENAI_BASE_URL` redirects the ChatGPT provider at any OpenAI-compatible
endpoint — a local model server, Azure OpenAI, OpenRouter.

### Shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘⇧A` / `Ctrl+Shift+A` | Show the overlay and focus the question box |
| `⌘⇧Y` / `Ctrl+Shift+Y` | Show / hide the overlay |
| `⌘⇧C` / `Ctrl+Shift+C` | Toggle click-through |
| `⌘⌥S` / `Ctrl+Alt+S` | Start / stop dictation |
| `⌘⇧M` / `Ctrl+Shift+M` | Move the overlay to the screen your cursor is on |
| `⌘⇧↑` / `⌘⇧↓` | Opacity up / down |
| `⌘⇧←` / `⌘⇧→` | Nudge the window left / right |
| `Enter` | Send · `Shift+Enter` for a newline |

## Running locally

The 🔌 button in the composer switches between a cloud provider and a model
running on this machine. Nothing leaves your computer in local mode, no API key
is involved, and it works with the network unplugged.

It needs [Ollama](https://ollama.com) and at least one pulled model:

```bash
ollama serve                     # start the daemon
ollama pull gemma3:12b           # ~8 GB, the default chat model
ollama pull nomic-embed-text     # ~274 MB, for document retrieval
ollama list                      # the names you can type in the model field
```

**Pick an instruct model, not a reasoning one.** This matters more than size. A
reasoning model such as `qwen3:30b-a3b` spends its first ~750 tokens thinking
before writing a visible character — measured at **13.2s to the first character
and 29.6s total**, against **4s and 6s** for `gemma3:12b`. And you cannot switch
that off: Ollama's `think: false`, `reasoning_effort: "none"` and Qwen's
`/no_think` were all tried, and each either kept thinking or moved the reasoning
*into the visible answer*, which is worse. Reasoning models are a good choice
when you want a considered answer and can wait; they are the wrong choice for an
overlay.

No code change was needed for the chat side: Ollama speaks the OpenAI
chat-completions dialect, so the local provider is the same streaming code
pointed at `http://127.0.0.1:11434/v1`. `OLLAMA_BASE_URL` moves it elsewhere.

**Sizing.** On Apple Silicon, CPU and GPU share one pool of memory, so unified
memory is the ceiling. A 4-bit quantised model costs roughly **0.6 GB per
billion parameters**; leave ~16 GB for the OS and your apps. A mixture-of-experts
model such as `qwen3:30b-a3b` activates only ~3B parameters per token, so it
answers far faster than a dense model of the same file size — which is what you
want in an overlay.

**What local mode gives up:** web search is disabled (the toggle greys out —
a local model has no internet), and dictation still calls OpenAI, since Ollama
does not serve audio transcription. A local Whisper server would close that gap.

## Documents

The 📄 button in the composer opens the document panel. Add a PDF or a plain
text file (`.txt`, `.md`, `.csv`, `.json`) and its text is extracted **once, at
upload**, then stored alongside your settings. Every question after that carries
the documents as context, so you can ask "what did I do at my last job" and get
an answer from your own CV.

- PDFs are parsed with `unpdf`, a serverless build of pdf.js — no worker setup
  and nothing native to compile. A scanned PDF with no selectable text is
  rejected with a message saying so rather than silently contributing nothing.
- `.doc`/`.docx` are **not** supported; export to PDF first.
- Each document is capped at 40k characters and the whole set at 80k, so a large
  library cannot blow the context window.

### Retrieval

If `nomic-embed-text` is available through Ollama, documents are **chunked and
embedded at upload**, and at question time the question is embedded and the five
closest passages are sent rather than whole documents. That is what makes many
or large documents practical.

**Chunk on meaning, not on character count.** Blocks are split at blank lines and
packed whole; a block longer than the target is split at sentence ends. Fixed
1200-character windows were tried first and were measurably worse: a window over
a Q&A document merges several unrelated answers, and the one vector that results
represents all of them and therefore none of them well. On a factual-lookup test
the fixed-window version failed to retrieve the right passage at all for
"how many users did X serve" — the correct chunk was not even in the top five.
After switching to block boundaries the same test found the answer in the top
five for **7 of 7** questions, and end-to-end answers went from wrong to **7/7
correct**.

Changing the chunking or the embedding model invalidates every stored vector —
old and new vectors are not comparable, and mixing them degrades ranking
silently rather than failing. `PUT /api/docs` re-chunks and re-embeds everything
from the stored text.

Embedding is strictly an optimisation here: if the daemon is not running, upload
still works and the documents are sent whole. You lose relevance, not function.

Measured on a 21-question retrieval check against this app's own document
format: **81% top-1, 90% top-3**. Since eight passages are sent, a document that
ranks third is still in the answer. Worth knowing the failure mode — questions
whose wording shares no vocabulary with the passage ("what motorcycle do I ride"
against a passage naming only the model of bike) are where a small embedding
model misses.

Two things worth knowing. Document context is re-sent **on every question** —
retrieved passages when embeddings are available, whole documents otherwise — so
it is paid for on every turn; remove what you are not using. And the extracted
text and its vectors sit unencrypted in the app's data directory, next to
`settings.json`; treat them like any other file in your home directory.

## Web search

The 🌐 toggle in the composer lets the model search before answering. It is off
by default, since searching costs more and adds latency. Each provider does this
differently:

| Provider | How |
| --- | --- |
| Claude | The `web_search_20260209` server tool — Anthropic runs the search, so there is no tool loop here |
| Gemini | The `google_search` grounding tool |
| ChatGPT | **Swaps the model** to `gpt-5-search-api` for that request |

That last row is the awkward one. OpenAI's ordinary chat models cannot search at
all — search lives either in the Responses API or in dedicated Chat Completions
search models. Swapping the model keeps the streaming path the rest of the app
already uses instead of introducing a second response format, but it does mean
your chosen OpenAI model is ignored while the toggle is on, and those models
always search rather than deciding whether to. `OPENAI_SEARCH_MODEL` overrides
which one is used.

## Speech to text

Press `⌘⌥S` from any app, or the mic button in the composer, and the overlay
records until you press it again. The take is transcribed and sent as your next
question — no typing.

Recording uses `getUserMedia` with no device filter, so it follows whatever the
OS has set as the **default input**: the built-in laptop microphone unless you
have selected something else system-wide. The microphone is released after every
take rather than held open between questions.

**Dictation needs a ChatGPT key**, even if answers come from Claude or Gemini.
Of the three providers, OpenAI's transcription endpoint is the only one that
accepts the recorder's WebM/Opus audio directly — Gemini's inline-audio input
takes wav/mp3/ogg/flac but not WebM, and Claude has no audio input at all.
`OPENAI_TRANSCRIBE_MODEL` overrides the model (default `whisper-1`), and
`OPENAI_BASE_URL` points it at a local Whisper server if you would rather not
send audio anywhere.

macOS asks for microphone permission the first time. If you refuse it, the grant
lives in System Settings › Privacy & Security › Microphone.

> **The mic indicator is not hidden.** While recording, macOS shows its orange
> dot in the menu bar and Control Center. The overlay window is excluded from
> screen capture; that indicator is not, and it is plainly visible to anyone
> watching a share of your full screen. Recording other people may also need
> their consent depending on where you are.

## Screen-capture exclusion

The overlay asks the OS window server to leave it out of captures
(`setContentProtection`), which is the same mechanism password managers use to
keep a vault out of a recording. It is **always on**: there is deliberately no
toggle, no tray item and no shortcut, so it cannot be switched off by accident.
The flag is re-asserted whenever the window is shown, loses focus, or the
display configuration changes, because macOS drops native window flags in all
three cases.

- **macOS** — `NSWindowSharingNone`. Honoured by ScreenCaptureKit and the older
  CGWindowList path, which is what Zoom, Meet, Teams, Slack, QuickTime and `⌘⇧5`
  all capture through.
- **Windows** — `WDA_EXCLUDEFROMCAPTURE` on Windows 10 2004 and later, where the
  window is simply absent. Older builds can only black the region out, which is
  more conspicuous than leaving it visible.

This is a window-server flag, not magic. Anything capturing outside that path
still sees the overlay: a phone camera pointed at your screen, an HDMI capture
box, a remote-control tool that mirrors the framebuffer at driver level, or a
proctoring agent that reads the window list rather than the pixels. Verify it on
your own machine before relying on it — press `⌘⇧5`, take a screenshot, and see
whether the overlay is in the image.

Worth stating plainly: hiding the window from a capture does not hide the app
from the machine. Any process that enumerates running applications — which is
what interview-proctoring and exam-lockdown software is built to do — still sees
it by name.

## About your API keys

Keys are stored in `keys.json` in the app's data directory, written with
owner-only permissions (`0600`), separate from `settings.json`. They are read
server-side to call the provider and are **never** sent to the renderer — the UI
only ever learns *whether* a key is set, not what it is.

This is plaintext on disk: the same trust model as `~/.netrc` or any CLI config
file. Anything running as your user account can read it. Don't put a key here
you wouldn't put in a dotfile. Alternatively, set `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `GEMINI_API_KEY` in the environment and the app will use
those instead, writing nothing to disk.

## How it fits together

```
electron/main.js       Overlay window, tray, global shortcuts, boots the server
electron/preload.js    The only bridge to the renderer (contextIsolation on)
src/app/               Next.js App Router — the UI
src/app/api/chat/      Streams a reply from the selected provider
src/app/api/keys/      Stores API keys; reports presence, never values
src/app/api/docs/      Reference documents: add, list, remove
src/app/api/settings/  Window and provider preferences
src/app/api/transcribe/ Speech to text for the dictation button
src/lib/chat.ts        Per-provider streaming, web search, document context
src/lib/docs.ts        Document storage, text extraction, retrieval
src/lib/embeddings.ts  Local embeddings and cosine similarity via Ollama
src/lib/providers.ts   Provider registry and defaults
src/lib/secrets.ts     Key storage (0600, server-side only)
src/lib/settings.ts    Settings shape + defaults, shared by client and server
src/lib/store.ts       JSON persistence in the app's data directory
src/lib/transcribe.ts  Audio -> text via OpenAI's transcription endpoint
src/lib/useDictation.ts Microphone capture in the renderer
scripts/               Icon generation + standalone server assembly
```

`src/lib/settings.ts` is deliberately free of Node imports: the client shares it
with the server, and importing `store.ts` from a client component would drag
`node:fs` into the browser bundle and fail the build.

**In development**, Electron attaches to `next dev` on port 3000. Set `PORT` to
move both halves together if something else already has that port:

```bash
PORT=3010 npm run dev
```

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

## Debugging

There are three separate places things can go wrong, each with its own console.

**The UI (renderer)** — Chrome DevTools. Press `F12` or `⌘⌥I` with the overlay
focused, or use **Developer Tools** in the tray menu. It opens detached, because
docking it inside a window this narrow leaves no room for the app. These are
window-local key bindings, not global shortcuts, so `F12` and `⌘⌥I` still belong
to every other app on the machine.

> The DevTools window is a window of its own and is **not** excluded from screen
> capture the way the overlay is. Close it before sharing your screen.

**The API routes (Next server)** — `console.log` from anything under
`src/app/api/` and `src/lib/` goes to the terminal running `npm run dev`. Next
also keeps a structured copy at `.next/dev/logs/next-development.log`. In a
packaged build the bundled server's output is forwarded to the parent process
with a `[next]` prefix. You can also hit the routes directly, without the UI:

```bash
curl -s http://127.0.0.1:3000/api/settings
curl -s http://127.0.0.1:3000/api/keys          # reports presence, never values
curl -s -X POST http://127.0.0.1:3000/api/transcribe -F "audio=@clip.webm"
```

**The Electron main process** — window, tray, shortcuts and permissions. Its
`console.log` also goes to the `npm run dev` terminal. For a real debugger,
start it with an inspector and attach from `chrome://inspect`:

```bash
node scripts/start-electron.mjs --inspect=5858
```

## Troubleshooting

**The overlay never appears and the terminal prints an Electron API error.**
VS Code's integrated terminal exports `ELECTRON_RUN_AS_NODE=1`, which makes the
Electron binary boot as plain Node. `npm run dev` and `npm start` both launch
through `scripts/start-electron.mjs`, which strips it — use those rather than
calling `electron .` directly.

**A packaged build opens to a blank window.** That means the bundled server
could not start. `npm run build` fails loudly if the standalone payload is
incomplete; if you change the packaging config, note that electron-builder
refuses to copy a `node_modules` directory sitting at the root of an
`extraResources` source, which is why the payload is nested under
`.electron-resources/payload/server`.

## Notes and limits

- Global shortcuts are system-wide; if another app already owns one, Electron
  logs a warning at startup and that single shortcut is skipped.
- Conversations are held in memory only — closing the overlay clears the thread.
