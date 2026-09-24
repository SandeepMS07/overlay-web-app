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
- **Paste a screenshot** into the composer and ask about it — `⌘⇧⌃4` on macOS
  captures straight to the clipboard. See [Screenshots](#screenshots).
- **A documents tab** that reads your PDFs and images in place, and shows the
  extracted text the model actually works from. See [Documents](#documents).
- **A browser tab** with its own tabs, address bar and history, sharing the
  window's capture exclusion. See [Browser](#browser).
- **Copy any code block** with the button that appears on hover — the reason a
  snippet is on screen is usually that it is about to be typed somewhere else.
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

**What local mode gives up:** web search only. A local model has no internet, so
that toggle greys out. Speech to text is local too — see below.

## Documents

The **Docs** tab, or the 📄 button in the composer, opens the document list.

Each document is stored twice: the extracted text, which is what the model
reads, and the original file, which is what you read. Those are different
things, and the difference is usually where a wrong answer comes from — a
table that flattened into noise, a heading that swallowed the paragraph under
it. Selecting a PDF renders it in Chromium's own viewer; the **Text** button
beside it shows the extraction instead, so the two can be compared directly.

**Images** — a photo, a scan, a screenshot — are kept to be looked at. There is
no text in them to extract without OCR, so they are stored and displayed but
left out of retrieval entirely, and never appear in a prompt. Previously they
were simply rejected.

Documents added before originals were kept show only the extracted text. Add a PDF or a plain
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

**Search is hybrid — embeddings and keywords take turns.** Dense vectors match
meaning and are poor at exact terms: "what is your email" embeds nowhere near a
line reading `Email: someone@example.com`, and with a few hundred chunks the
cosine scores bunch together with no discrimination. BM25 is the complement — it
only matches literal terms, so a proper noun or an address ranks first.

Reciprocal rank fusion was tried for the merge and was **wrong here**: RRF
rewards consensus, so a passage placed mid-table by both rankers outscores one
that a single ranker puts first. For an exact-term lookup with one right answer,
that buried the correct passage outside the top five even though BM25 ranked it
**first**. Round-robin — first place from each ranker, then second, skipping
duplicates — guarantees each ranker its pick. A ranker scoring zero forfeits its
turn rather than injecting an unmatched passage.

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

## Answering as yourself

A checkbox in the key panel switches answers to the first person, drawing on
your own documents as your own experience — "I built…", not "Sandeep built…".

Fill in **My name** underneath. It is not decoration: without a name in the
prompt, "answer as the user" leaves the model with an identity-shaped hole, and
it fills the hole from whatever is nearby. In testing it introduced itself with
the name of one of the user's own projects — a product name sitting 58 times in
the indexed documents was the most name-shaped thing in reach. Retrieval cannot
rescue this, because "what is your name" is a hopeless search query and identity
has to hold on every answer, not only when the right passage ranks. The name is
stated outright instead, and the assistant framing is dropped for that request
rather than left to argue with the persona.

The anti-fabrication rule is the other half. Asked to speak as someone, a model
will invent plausible detail: in testing it produced a confident, entirely
fictional email address and claimed to have no GitHub account. The prompt now
requires contact details, employers, dates, numbers and links to be quoted from
the material and nowhere else, and to answer "I would need to check that"
otherwise. A wrong detail stated confidently is worse than an admission —
especially about your own history.

The name is stored in `settings.json` in the app's data directory, which is not
in the repository.

## Browser

The **Web** tab at the top of the window is a real browser: its own tab strip,
address bar, back/forward, and anything typed that is not an address goes to a
search. It exists so a site can sit inside the same capture-excluded window as
everything else, rather than in a second window that a screen share would show.

It is built on `<webview>` rather than a native `WebContentsView`, so the tab
strip and switching stay ordinary React. A native view is a separate layer the
main process has to position by hand on every resize and panel toggle, and none
of that is worth it here.

Pages load in a `persist:browser` session, kept apart from the app's own: logins
survive a restart, and a site's cookies can never reach the app's requests.
`will-attach-webview` strips the preload and forces `contextIsolation` on every
guest, so a page cannot widen its own privileges by setting attributes.

The user agent is constructed from `process.versions.chrome` rather than
edited out of Electron's default. That is not a
disguise — the engine genuinely is this Chromium — but several large sites gate
login behind a UA allowlist and serve "unsupported browser" to anything they do
not recognise. Unmodified, `chatgpt.com` bounced straight to `/auth/login`;
with a plain Chrome string it served the normal app. Editing the default is
the fragile version — it carries a token named after the app, and `productName`
may contain a space, which no regex over a UA survives cleanly.

Popups are denied and loaded into the tab that opened them. Sign-in flows
routinely start in a popup, and the default would put it in a bare window
outside the overlay — and so outside its capture exclusion.

> **Google sign-in does not work, and cannot be made to.** Google blocks OAuth
> from embedded browsers as policy — the failure is a bare `400 … malformed`
> page from `accounts.google.com`, not something a setting fixes. Anything that
> did make it work would be defeating a security control rather than fixing a
> bug. Use email and password where a site offers it; a Google-SSO-only account
> cannot be signed into here at all.

One trap worth recording, because it costs an afternoon to find: bind the
webview's `src` to the URL that `did-navigate` writes back, and every redirect
becomes a navigation loop — state updates, React rewrites `src`, and the
webview re-navigates on top of the redirect it was already following. It looks
fine until an OAuth flow, which dies as `ERR_ABORTED`. `src` is set once at tab
creation; everything after goes through `loadURL()`.

## Screenshots

Paste an image into the question box — `⌘V` after `⌘⇧⌃4`, or any copied image —
and it goes to the model with your question. Up to four ride along with one
turn; the ✕ on a thumbnail drops it. Pasting with nothing typed asks the model
to answer whatever question is in the picture, which is usually the point.

Images are downscaled to a 1568px long edge and re-encoded as JPEG before they
leave the renderer. A Retina screenshot is several megabytes and base64 adds a
third on top, while every provider downscales past roughly that size anyway — so
the extra pixels would buy nothing but upload latency.

All three hosted providers take the same bytes in different envelopes
(`source.base64`, `image_url`, `inline_data`), so the data URL is split once and
re-wrapped per provider. Local models work too, provided the one you have pulled
can see: `gemma3:12b`, the default here, can. A text-only local model will
simply ignore the image.

## When a provider wobbles

A free tier is capacity-shared, so a request can come back with 503 "high
demand" or a 429 throttle even though the key, the credit and the model are all
fine. Measured on `gemini-3.7-flash` in one afternoon: three 503s in a row,
then a normal answer on the next attempt.

Those are retried automatically — up to three attempts, with full jitter on the
backoff so every client dropped in the same spike does not come back at the
same instant and re-create it. Only 408/429/500/502/503/504 are retried; a 400
or a 401 fails identically the second time, so retrying would just double the
bill.

The retry only covers a failure that happens **before the first token**. Once
text has reached the screen the request cannot be replayed — the retry would
repeat the opening of the answer — so a mid-stream failure is reported instead.
Claude is left unwrapped, since the Anthropic SDK already retries internally.

If a provider is slow rather than failing, the model matters more than the
retry. Same afternoon, same key, one round-trip each:

| Model | Latency |
| --- | --- |
| `gemini-flash-lite-latest` | 0.7s |
| `gemini-3.5-flash-lite` | 0.8s |
| `gemini-3.5-flash` | 1.4s |
| `gemini-3.7-flash` | 1.6s |
| `gemini-3.6-flash` | 12.8s |
| `gemini-flash-latest` | 54.5s |

The `-latest` aliases are not a safe default: they follow whatever Google has
just promoted, which is also whatever everyone else has just started hammering.

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

### Listening continuously

The 👂 button listens until you turn it off, transcribing each utterance and
answering it. It is meant for a meeting, where the questions come from someone
else rather than from you typing.

Segments are cut by **voice activity**, not by a timer: the hook watches input
level and closes a segment after ~900ms of quiet. Cutting on a fixed interval
would slice sentences in half, and half a sentence transcribes badly. Utterances
shorter than 600ms are dropped as coughs and keystrokes, and anything still
running at 20s is cut anyway so a monologue is not held forever.

Audio is captured as raw PCM through the Web Audio API rather than through
MediaRecorder, because the same samples serve both jobs — measuring loudness for
the detector, and building the 16 kHz mono WAV that Whisper wants. Noise
suppression is deliberately **off**: it is tuned for a close talker and eats the
quieter, further-away speech this is supposed to pick up.

An answer already streaming is not interrupted by the next utterance; the new
text lands in the composer instead, so two replies never interleave.

> Recording other people can require their consent, and the rules differ by
> jurisdiction. That is worth knowing before you leave this running in a meeting.

### Running speech to text locally

Transcription tries a local whisper.cpp server first and only falls back to
OpenAI if nothing is listening on it. Local means no API credit and no one
else's voice leaving the machine.

```bash
brew install whisper-cpp
mkdir -p ~/.whisper-models && curl -L -o ~/.whisper-models/ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
npm run stt        # serves an OpenAI-shaped endpoint on 127.0.0.1:8178
```

`whisper-server` is not OpenAI-compatible by default; `--request-path /v1
--inference-path /audio/transcriptions` is what makes its route match, and its
`{"text": ...}` response already matches. `WHISPER_BASE_URL` moves it.

Measured: 0.31s to transcribe a 2.3s clip through the app, against an account
that no longer has credit for the hosted API.

### Push to talk

Press `⌘⌥S` from any app, or the 🎤 button, and the overlay records until you
press it again — this one is for dictating your own question. The take is transcribed and sent as your next
question — no typing.

Recording uses `getUserMedia` with no device filter, so it follows whatever the
OS has set as the **default input**: the built-in laptop microphone unless you
have selected something else system-wide. The microphone is released after every
take rather than held open between questions.

Without a local whisper server, dictation needs a **ChatGPT key** even when
answers come from Claude or Gemini: of the hosted providers only OpenAI's
transcription endpoint accepts this audio directly — Gemini's inline-audio input
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
src/lib/chat.ts        Per-provider streaming, web search, images, document context
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

## Giving it to somebody else

`npm run dist:share` builds into `release-share/` with the on-device provider
left out, and `NEXT_PUBLIC_ENABLE_LOCAL=0` is what removes it.

That flag gates the server as well as the UI, because both the chat and the
settings route validate through `isProviderId` — asking for the local provider
by hand-writing a request gets `Pick a provider first.` rather than a timeout
against a daemon that is not there.

Leaving it in would not have been neutral. It needs Ollama installed and an
8 GB model pulled, so on anyone else's machine it can only ever answer "No
local model server on 127.0.0.1:11434" — which reads as a broken app rather
than a missing prerequisite.

Two things degrade for a recipient, and neither breaks:

- **Retrieval.** Embeddings also came from Ollama, so without it `embed()`
  returns null and whole documents are sent instead of retrieved passages.
  Relevance is lost, function is not.
- **Dictation.** With no local whisper server it falls back to OpenAI, so that
  one needs a ChatGPT key specifically.

They will need their own API key for Claude, ChatGPT or Gemini. Gemini's free
tier costs nothing.

### What travels with the build

`.data` is excluded from the payload, so no keys, no documents and no settings
ship inside the app — a fresh install starts empty. Verified against the
packaged server: `/api/docs` returns `{"docs":[]}` and `/api/keys` returns
`{"configured":[]}`.

`prepare-server.mjs` also replaces the build machine's absolute path with
`/app`. Next records where it was built — `repoRoot`, `outputFileTracingRoot` —
and on a Mac that path contains the account name, which would otherwise travel
with every copy handed out. They are build-time tracing hints rather than
runtime lookups, so a placeholder is as good as the real thing.

### Unsigned builds and Gatekeeper

`identity: null` means these are unsigned, and macOS refuses to open an
unsigned app from the internet. The recipient right-clicks the app and chooses
**Open**, once; or clears the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/Overlay Player.app"
```

Signing properly needs an Apple Developer account. Remove `identity: null` and
set `CSC_LINK` / `CSC_KEY_PASSWORD` to ship signed and notarised.

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

**Reloading** — `⌘R` (or `F5`), with `⇧` added to bypass the HTTP cache. Also
**Reload** in the tray menu. This has to be wired explicitly: the overlay is a
panel driven from the tray, with no application menu, so it does not inherit
the reload item a normal Electron window gets for free.

Most of the time you will not need it. Under `next dev` a change to anything
server-side — `lib/chat.ts`, a route handler — applies on the next request, and
Turbopack pushes renderer changes in by itself.

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
