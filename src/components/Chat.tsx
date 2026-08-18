'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PROVIDER_IDS, PROVIDERS, type ChatMessage, type ProviderId } from '@/lib/providers';
import type { Settings } from '@/lib/settings';
import { useDictation } from '@/lib/useDictation';
// Type-only: lib/docs.ts is server-side and pulls in node:fs at runtime.
import type { DocMeta } from '@/lib/docs';
import {
  ChipIcon,
  CloseIcon,
  DocIcon,
  GlobeIcon,
  KeyIcon,
  MicIcon,
  PlusIcon,
  SendIcon,
  StopIcon,
  TrashIcon,
} from '@/components/Icons';

type Props = {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  /** Bumping this focuses the composer — used by the global shortcut. */
  focusToken: number;
  /** Bumping this starts or stops dictation — used by the global shortcut. */
  dictateToken: number;
  notify: (text: string, error?: boolean) => void;
};

export default function Chat({ settings, update, focusToken, dictateToken, notify }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState('');
  const [configured, setConfigured] = useState<ProviderId[]>([]);
  const [keysOpen, setKeysOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [docsOpen, setDocsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const provider = settings.provider;
  const info = PROVIDERS[provider];
  const hasKey = !info.requiresKey || configured.includes(provider);
  const isLocal = info.offline;

  /** Flip between the local model and whichever cloud provider was last used. */
  const toggleLocal = useCallback(() => {
    if (isLocal) update({ provider: settings.cloudProvider });
    else update({ cloudProvider: provider, provider: 'local' });
  }, [isLocal, provider, settings.cloudProvider, update]);

  // ------------------------------------------------------------- key status

  const refreshKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/keys');
      const data = (await res.json()) as { configured: ProviderId[] };
      setConfigured(data.configured ?? []);
    } catch {
      /* the settings panel will still work; sending will report the real error */
    }
  }, []);

  useEffect(() => {
    void refreshKeys();
  }, [refreshKeys]);

  // ------------------------------------------------------------- documents

  const refreshDocs = useCallback(async () => {
    try {
      const res = await fetch('/api/docs');
      const data = (await res.json()) as { docs?: DocMeta[] };
      setDocs(data.docs ?? []);
    } catch {
      /* the panel still opens; uploading will report the real error */
    }
  }, []);

  useEffect(() => {
    void refreshDocs();
  }, [refreshDocs]);

  const uploadDocs = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const form = new FormData();
      for (const file of Array.from(files)) form.append('file', file);

      setUploading(true);
      try {
        const res = await fetch('/api/docs', { method: 'POST', body: form });
        const data = (await res.json().catch(() => ({}))) as {
          docs?: DocMeta[];
          error?: string;
          warning?: string;
        };
        if (data.docs) setDocs(data.docs);
        if (!res.ok) notify(data.error ?? 'Could not add that file.', true);
        else if (data.warning) notify(data.warning, true);
        else notify(files.length === 1 ? 'Document added.' : `${files.length} documents added.`);
      } catch {
        notify('Could not reach the local backend.', true);
      } finally {
        setUploading(false);
      }
    },
    [notify]
  );

  const deleteDoc = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/docs?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = (await res.json()) as { docs?: DocMeta[] };
      setDocs(data.docs ?? []);
    } catch {
      /* leave the list as-is; the next open re-reads it */
    }
  }, []);

  // Open the key panel automatically the first time a provider has no key.
  useEffect(() => {
    if (configured.length === 0) setKeysOpen(true);
  }, [configured.length]);

  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus();
  }, [focusToken]);

  // Keep the newest text in view while the answer streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, partial]);

  // -------------------------------------------------------------- sending

  /**
   * `override` lets dictation send its transcript directly. Going through the
   * draft state instead would send a stale value, because setDraft has not
   * committed by the time this runs.
   */
  const send = useCallback(async (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || streaming) return;

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setDraft('');
    setPartial('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let received = '';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          provider,
          model: settings.models?.[provider] ?? '',
          messages: next,
          webSearch: settings.webSearch,
        }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        notify(data.error ?? 'The request failed.', true);
        setMessages(messages); // roll back the unanswered turn
        setDraft(text);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: 'delta'; text: string }
            | { type: 'error'; message: string }
            | { type: 'done' };

          if (event.type === 'delta') {
            received += event.text;
            setPartial(received);
          } else if (event.type === 'error') {
            notify(event.message, true);
          }
        }
      }

      if (received) setMessages([...next, { role: 'assistant', content: received }]);
      else setMessages(next);
    } catch (err) {
      // An abort is the user pressing stop — keep whatever streamed in.
      if ((err as Error).name === 'AbortError') {
        if (received) setMessages([...next, { role: 'assistant', content: received }]);
      } else {
        notify('Could not reach the local backend.', true);
        setMessages(messages);
        setDraft(text);
      }
    } finally {
      abortRef.current = null;
      setPartial('');
      setStreaming(false);
    }
  }, [draft, messages, notify, provider, settings.models, settings.webSearch, streaming]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  // ------------------------------------------------------------- dictation

  const dictation = useDictation({
    onText: (text) => void send(text),
    onError: (message) => notify(message, true),
  });

  // Fired by ⌘⌥S from any app. The token only ever increases, so this runs once
  // per press rather than on every re-render.
  useEffect(() => {
    if (dictateToken > 0) dictation.toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictateToken]);

  const saveKey = useCallback(async () => {
    const key = keyDraft.trim();
    if (!key) return;
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key }),
      });
      const data = (await res.json()) as { configured?: ProviderId[]; error?: string };
      if (!res.ok) {
        notify(data.error ?? 'Could not save the key.', true);
        return;
      }
      setConfigured(data.configured ?? []);
      setKeyDraft('');
      setKeysOpen(false);
      notify(`${PROVIDERS[provider].label} key saved.`);
    } catch {
      notify('Could not reach the local backend.', true);
    }
  }, [keyDraft, notify, provider]);

  const removeKey = useCallback(async () => {
    const res = await fetch(`/api/keys?provider=${provider}`, { method: 'DELETE' });
    const data = (await res.json().catch(() => ({}))) as { configured?: ProviderId[] };
    setConfigured(data.configured ?? []);
    notify(`${PROVIDERS[provider].label} key removed.`);
  }, [notify, provider]);

  // ----------------------------------------------------------------- view

  return (
    <div className="chat">
      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && !partial && (
          <div className="chat-intro">
            <p>
              Ask anything and the answer appears here, floating over whatever you are doing.
            </p>
            <p className="chat-intro-dim">
              {hasKey
                ? `Using ${PROVIDERS[provider].label}. Press ⌘⇧A from any app to jump straight to the box.`
                : `Add a ${PROVIDERS[provider].label} API key to get started.`}
            </p>
          </div>
        )}

        {messages.map((message, index) => (
          <Bubble key={index} role={message.role} content={message.content} />
        ))}

        {partial && <Bubble role="assistant" content={partial} />}
        {streaming && !partial && <div className="chat-thinking">Thinking…</div>}
      </div>

      {docsOpen && (
        <div className="keys">
          <div className="keys-row">
            <strong className="keys-title">Documents</strong>
            <span className="spacer" />
            <button
              className="btn"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="Add a PDF or text file"
            >
              <PlusIcon />
              {uploading ? 'Reading…' : 'Add'}
            </button>
            <button className="btn" onClick={() => setDocsOpen(false)} title="Close">
              <CloseIcon />
            </button>
          </div>

          <input
            ref={fileRef}
            className="hidden-file"
            type="file"
            multiple
            accept=".pdf,.txt,.md,.markdown,.csv,.json,.log,application/pdf,text/*"
            onChange={(e) => {
              void uploadDocs(e.target.files);
              e.target.value = '';
            }}
          />

          {docs.length === 0 ? (
            <p className="keys-note">
              Add a CV, a project brief or notes, and the assistant will use them when
              answering. Text is read once when you add the file — PDFs and plain text.
            </p>
          ) : (
            <ul className="doc-list">
              {docs.map((doc) => (
                <li key={doc.id} className="doc-item">
                  <DocIcon />
                  <span className="doc-name" title={doc.name}>
                    {doc.name}
                  </span>
                  <span className="doc-size">{Math.max(1, Math.round(doc.chars / 1000))}k</span>
                  <button
                    className="btn is-danger"
                    onClick={() => void deleteDoc(doc.id)}
                    title="Remove"
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {keysOpen && (
        <div className="keys">
          <div className="keys-row">
            {PROVIDER_IDS.map((id) => (
              <button
                key={id}
                className={`btn${provider === id ? ' is-active' : ''}`}
                onClick={() => update({ provider: id })}
              >
                {PROVIDERS[id].label}
                {configured.includes(id) ? ' ✓' : ''}
              </button>
            ))}
            <span className="spacer" />
            <button className="btn" onClick={() => setKeysOpen(false)} title="Close">
              <CloseIcon />
            </button>
          </div>

          <label className="keys-field">
            <span>Model</span>
            <input
              className="field"
              value={settings.models?.[provider] ?? ''}
              placeholder={PROVIDERS[provider].defaultModel}
              onChange={(e) =>
                update({ models: { ...settings.models, [provider]: e.target.value } })
              }
              spellCheck={false}
            />
          </label>

          {info.requiresKey && (
          <label className="keys-field">
            <span>API key</span>
            <input
              className="field"
              type="password"
              value={keyDraft}
              placeholder={hasKey ? '•••••••• (saved)' : PROVIDERS[provider].keyHint}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveKey();
              }}
              spellCheck={false}
              autoComplete="off"
            />
            <button className="btn" onClick={() => void saveKey()} disabled={!keyDraft.trim()}>
              Save
            </button>
            {hasKey && (
              <button className="btn is-danger" onClick={() => void removeKey()} title="Remove key">
                <TrashIcon />
              </button>
            )}
          </label>
          )}

          <label className="keys-field keys-check">
            <input
              type="checkbox"
              checked={settings.compact}
              onChange={(e) => update({ compact: e.target.checked })}
            />
            <span>Auto-hide the toolbar until the cursor reaches the top</span>
          </label>

          <p className="keys-note">
            {isLocal
              ? 'Runs on this machine through Ollama. Nothing leaves your computer, and no key is needed. '
              : "Stored locally in this app's data folder, readable only by your user account, and sent only to " +
                PROVIDERS[provider].label + '. '}
            <a
              href={PROVIDERS[provider].keyUrl}
              onClick={(e) => {
                e.preventDefault();
                window.overlay?.openExternal(PROVIDERS[provider].keyUrl);
              }}
            >
              {isLocal ? 'Browse models' : 'Get a key'}
            </a>
          </p>
        </div>
      )}

      <div className="composer">
        <textarea
          ref={inputRef}
          className="composer-input"
          value={draft}
          rows={1}
          placeholder={
            dictation.state === 'recording'
              ? 'Listening… ⌘⌥S or the mic button to stop'
              : dictation.state === 'transcribing'
                ? 'Transcribing…'
                : hasKey
                  ? 'Ask a question, or press ⌘⌥S to speak…'
                  : 'Add an API key to start'
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          onPointerDown={() => window.overlay?.focusWindow()}
          spellCheck={false}
        />

        <div className="composer-actions">
          <button
            className={`btn${dictation.state === 'recording' ? ' is-recording' : ''}`}
            onClick={dictation.toggle}
            disabled={streaming || dictation.state === 'transcribing'}
            title={
              dictation.state === 'recording'
                ? 'Stop and send (⌘⌥S)'
                : 'Ask by voice — records the default microphone (⌘⌥S)'
            }
          >
            <MicIcon />
          </button>
          <button
            className={`btn${isLocal ? ' is-active' : ''}`}
            onClick={toggleLocal}
            title={
              isLocal
                ? `Running locally on this machine — click to go back to ${PROVIDERS[settings.cloudProvider].label}`
                : 'Run the model on this machine instead (offline)'
            }
          >
            <ChipIcon />
          </button>
          <button
            className={`btn${settings.webSearch && !isLocal ? ' is-active' : ''}`}
            onClick={() => update({ webSearch: !settings.webSearch })}
            disabled={isLocal}
            title={
              isLocal
                ? 'A local model has no internet access'
                : settings.webSearch
                  ? 'Web search on — the model can look things up'
                  : 'Web search off — answers from the model only'
            }
          >
            <GlobeIcon />
          </button>
          <button
            className={`btn${docsOpen ? ' is-active' : ''}`}
            onClick={() => {
              setDocsOpen((v) => !v);
              void refreshDocs();
            }}
            title={docs.length ? `${docs.length} document(s) in context` : 'Add documents'}
          >
            <DocIcon />
            {docs.length > 0 && <span className="badge">{docs.length}</span>}
          </button>
                    <button
            className={`btn${keysOpen ? ' is-active' : ''}`}
            onClick={() => setKeysOpen((v) => !v)}
            title={`${PROVIDERS[provider].label} · key and model`}
          >
            <KeyIcon />
          </button>
          <button
            className="btn"
            onClick={() => setMessages([])}
            disabled={messages.length === 0 || streaming}
            title="Clear conversation"
          >
            <TrashIcon />
          </button>
          {streaming ? (
            <button className="btn is-danger" onClick={stop} title="Stop">
              <StopIcon />
            </button>
          ) : (
            <button
              className="btn is-active"
              onClick={() => void send()}
              disabled={!draft.trim()}
              title="Send (Enter)"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a message as light markdown.
 *
 * Deliberately hand-rolled rather than pulling in a markdown library: the
 * subset that actually shows up in short chat answers is small, and a parser
 * plus a sanitiser would be a large dependency shipped into an overlay. Only
 * these constructs are understood — anything else renders as the literal text
 * the model wrote, which is the safe failure.
 */
function Bubble({ role, content }: { role: ChatMessage['role']; content: string }) {
  const segments = content.split(/```/);

  return (
    <div className={`bubble is-${role}`}>
      {segments.map((segment, index) =>
        index % 2 === 1 ? (
          <pre key={index} className="code">
            <code>{segment.replace(/^[a-zA-Z0-9+-]*\n/, '')}</code>
          </pre>
        ) : (
          <Markdown key={index} text={segment} />
        )
      )}
    </div>
  );
}

/** Block-level markdown: headings, list items, rules, paragraphs. */
function Markdown({ text }: { text: string }) {
  if (!text.trim()) return null;

  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    const items = list;
    list = [];
    blocks.push(
      <ul key={`u${blocks.length}`} className="md-list">
        {items.map((item, i) => (
          <li key={i}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    );
  };

  const flushPara = () => {
    if (para.length === 0) return;
    const joined = para.join(' ');
    para = [];
    blocks.push(
      <p key={`p${blocks.length}`} className="md-p">
        <Inline text={joined} />
      </p>
    );
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushList();
      flushPara();
      continue;
    }
    // A horizontal rule would just eat vertical space in a small window.
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flushList();
      flushPara();
      continue;
    }

    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      flushPara();
      // Every heading level renders the same: the window is too small for a
      // type scale to mean anything.
      blocks.push(
        <p key={`h${blocks.length}`} className="md-h">
          <Inline text={heading[2]} />
        </p>
      );
      continue;
    }

    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      list.push(bullet[1]);
      continue;
    }

    flushList();
    para.push(line.trim());
  }

  flushList();
  flushPara();
  return <>{blocks}</>;
}

/** Inline markdown: `code`, **bold**, *italic*, and bare links. */
function Inline({ text }: { text: string }) {
  // One pass over alternating delimiters; the capture groups line up with the
  // branches below, so the split result can be walked without re-parsing.
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|https?:\/\/\S+)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <code key={i} className="md-code">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        if (/^https?:\/\//.test(part)) {
          return (
            <a
              key={i}
              href={part}
              onClick={(e) => {
                e.preventDefault();
                window.overlay?.openExternal(part);
              }}
            >
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
