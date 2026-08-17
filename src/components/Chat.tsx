'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PROVIDER_IDS, PROVIDERS, type ChatMessage, type ProviderId } from '@/lib/providers';
import type { Settings } from '@/lib/settings';
import { CloseIcon, KeyIcon, SendIcon, StopIcon, TrashIcon } from '@/components/Icons';

type Props = {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  /** Bumping this focuses the composer — used by the global shortcut. */
  focusToken: number;
  notify: (text: string, error?: boolean) => void;
};

export default function Chat({ settings, update, focusToken, notify }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState('');
  const [configured, setConfigured] = useState<ProviderId[]>([]);
  const [keysOpen, setKeysOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const provider = settings.provider;
  const hasKey = configured.includes(provider);

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

  const send = useCallback(async () => {
    const text = draft.trim();
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
  }, [draft, messages, notify, provider, settings.models, streaming]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

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

          <label className="keys-field keys-check">
            <input
              type="checkbox"
              checked={settings.compact}
              onChange={(e) => update({ compact: e.target.checked })}
            />
            <span>Auto-hide the toolbar until the cursor reaches the top</span>
          </label>

          <p className="keys-note">
            Stored locally in this app&apos;s data folder, readable only by your user account, and
            sent only to {PROVIDERS[provider].label}.{' '}
            <a
              href={PROVIDERS[provider].keyUrl}
              onClick={(e) => {
                e.preventDefault();
                window.overlay?.openExternal(PROVIDERS[provider].keyUrl);
              }}
            >
              Get a key
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
          placeholder={hasKey ? 'Ask a question…' : 'Add an API key to start'}
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
 * Renders a message, giving fenced code blocks a monospace block of their own.
 * Everything else is plain text with preserved wrapping.
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
          segment && <span key={index}>{segment}</span>
        )
      )}
    </div>
  );
}
