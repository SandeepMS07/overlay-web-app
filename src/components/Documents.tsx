'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon, DocIcon, PlusIcon, TrashIcon } from '@/components/Icons';
import type { DocMeta } from '@/lib/docs';

/**
 * Newest first. The index is append-ordered, so a fresh upload lands at the
 * bottom of a list that is usually taller than the window — you add a file and
 * nothing appears to happen.
 */
function newestFirst(docs: DocMeta[]): DocMeta[] {
  return [...docs].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

/**
 * The documents the assistant answers from, and a reader for them.
 *
 * Two views of the same file, because they are genuinely different things: the
 * original is what you want to read, and the extracted text is what the model
 * actually sees. When an answer comes back wrong, the second one is usually
 * where the reason is — a table that flattened into noise, a heading that
 * swallowed the paragraph under it.
 */
export default function Documents({
  notify,
}: {
  notify: (text: string, error?: boolean) => void;
}) {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const data = (await fetch('/api/docs').then((r) => r.json())) as { docs?: DocMeta[] };
      setDocs(newestFirst(data.docs ?? []));
    } catch {
      /* the panel simply stays empty */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doc = docs.find((d) => d.id === selected) ?? null;

  // A document with no stored original predates originals being kept, so the
  // extracted text is the only thing there is to show.
  const textOnly = !doc?.mime;
  const asText = showText || textOnly;

  useEffect(() => {
    if (!doc || !asText) return;
    let cancelled = false;
    setText('');
    void fetch(`/api/docs/${doc.id}?text=1`)
      .then((r) => r.text())
      .then((body) => {
        if (!cancelled) setText(body);
      })
      .catch(() => notify('Could not read that document.', true));
    return () => {
      cancelled = true;
    };
  }, [doc, asText, notify]);

  const upload = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      const form = new FormData();
      for (const file of Array.from(files)) form.append('file', file);
      setBusy(true);
      const before = new Set(docs.map((d) => d.id));
      try {
        const res = await fetch('/api/docs', { method: 'POST', body: form });
        const data = (await res.json()) as { docs?: DocMeta[]; error?: string; warning?: string };
        const next = newestFirst(data.docs ?? []);
        setDocs(next);
        // Open what was just added. Otherwise the reader keeps showing whatever
        // was there before, and an upload looks like it did nothing.
        const added = next.find((d) => !before.has(d.id));
        if (added) {
          setSelected(added.id);
          setShowText(false);
        }
        if (data.error) notify(data.error, true);
        else if (data.warning) notify(data.warning, true);
        else notify(`Added ${files.length} document${files.length > 1 ? 's' : ''}.`);
      } catch {
        notify('Could not reach the local backend.', true);
      } finally {
        setBusy(false);
      }
    },
    [docs, notify]
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/docs?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        const data = (await res.json()) as { docs?: DocMeta[] };
        setDocs(newestFirst(data.docs ?? []));
        setSelected((current) => (current === id ? null : current));
      } catch {
        notify('Could not remove that document.', true);
      }
    },
    [notify]
  );

  const reindex = useCallback(async () => {
    setBusy(true);
    try {
      const data = (await fetch('/api/docs', { method: 'PUT' }).then((r) => r.json())) as {
        docs?: DocMeta[];
      };
      setDocs(newestFirst(data.docs ?? []));
      const chunks = (data.docs ?? []).reduce((sum, d) => sum + (d.chunks ?? 0), 0);
      notify(`Re-indexed ${data.docs?.length ?? 0} documents into ${chunks} chunks.`);
    } catch {
      notify('Could not re-index.', true);
    } finally {
      setBusy(false);
    }
  }, [notify]);

  const totalChunks = docs.reduce((sum, d) => sum + (d.chunks ?? 0), 0);

  return (
    <div className={`docs${doc ? ' is-reading' : ''}`}>
      <div className="docs-list">
        <div className="docs-head">
          <strong>{docs.length} document{docs.length === 1 ? '' : 's'}</strong>
          <span className="docs-dim">{totalChunks} chunks</span>
          <span className="spacer" />
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}
            title="Add a PDF or text file">
            <PlusIcon />
          </button>
          <button className="btn" onClick={() => void reindex()} disabled={busy || !docs.length}
            title="Re-chunk and re-embed everything — needed after a chunking or model change">
            ⟳
          </button>
        </div>

        <input
          ref={fileRef}
          className="hidden-file"
          type="file"
          multiple
          accept=".pdf,.txt,.md,.markdown,.csv,.json,.log,application/pdf,text/*"
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = '';
          }}
        />

        {docs.length === 0 ? (
          <p className="keys-note">
            Add a CV, a project brief or notes. Text is read once when you add the file, and
            the assistant retrieves the relevant passages when answering.
          </p>
        ) : (
          <ul className="doc-list">
            {docs.map((d) => (
              <li
                key={d.id}
                className={`doc-item${d.id === selected ? ' is-active' : ''}`}
                onClick={() => setSelected(d.id)}
              >
                <DocIcon />
                <span className="doc-name" title={d.name}>
                  {d.name}
                </span>
                <span className="doc-size">{Math.max(1, Math.round(d.chars / 1000))}k</span>
                <button
                  className="btn is-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(d.id);
                  }}
                  title="Remove"
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="docs-view">
        {!doc ? (
          <p className="docs-empty">Pick a document to read it.</p>
        ) : (
          <>
            <div className="docs-head">
              <strong className="doc-name" title={doc.name}>
                {doc.name}
              </strong>
              <span className="spacer" />
              {!textOnly && (
                <button
                  className={`btn${asText ? ' is-active' : ''}`}
                  onClick={() => setShowText((v) => !v)}
                  title={
                    asText
                      ? 'Showing the extracted text — what the model reads'
                      : 'Show the extracted text instead of the file'
                  }
                >
                  Text
                </button>
              )}
              <button className="btn" onClick={() => setSelected(null)} title="Close">
                <CloseIcon />
              </button>
            </div>

            {asText ? (
              <pre className="docs-text">{text || 'Reading…'}</pre>
            ) : (
              // Chromium's built-in PDF viewer, which is better than anything
              // worth hand-rolling — and it is already in this process.
              <iframe className="docs-frame" src={`/api/docs/${doc.id}`} title={doc.name} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
