'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon, PlusIcon } from '@/components/Icons';

/**
 * A browser inside the overlay.
 *
 * Built on <webview> rather than a native WebContentsView so the tab strip,
 * the address bar and the switching all stay ordinary React. A native view is
 * a separate layer the main process has to position by hand on every resize,
 * scroll and panel toggle, and none of that is worth it here.
 *
 * Everything the pages need — a persistent session, a real user agent, a
 * stripped preload — is set in electron/main.js, because a renderer cannot be
 * trusted to configure the sandbox it is putting somebody else's code into.
 */

/** Electron's <webview>, with the members used here. */
type WebviewTag = HTMLElement & {
  src: string;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  reload(): void;
  stop(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
};

type WebviewProps = {
  ref?: React.Ref<WebviewTag>;
  src?: string;
  partition?: string;
  allowpopups?: string;
  style?: React.CSSProperties;
  className?: string;
};

// `webview` is not in React's element table. Casting the tag name is cleaner
// than an ambient global declaration, and keeps the props checked.
const Webview = 'webview' as unknown as React.FC<WebviewProps>;

type Tab = {
  id: string;
  /**
   * Set once, when the tab is created, and never updated.
   *
   * This is bound to the <webview>'s `src`, and `src` is not a display field —
   * writing to it navigates. Binding it to the live URL below creates a loop:
   * the page redirects, `did-navigate` updates state, React writes `src`, and
   * the webview re-navigates on top of the redirect it was already following.
   * OAuth sign-in dies on exactly that, as ERR_ABORTED.
   */
  initialUrl: string;
  /** Where the tab actually is now. Drives the address bar only. */
  url: string;
  title: string;
  loading: boolean;
};

const HOME = 'https://chatgpt.com/';

const newTab = (url = HOME): Tab => ({
  id: Math.random().toString(36).slice(2),
  initialUrl: url,
  url,
  title: 'New tab',
  loading: true,
});

/**
 * Turns whatever was typed into something loadable. A bare domain gets https,
 * anything that is plainly not an address becomes a search — the same bargain
 * every address bar makes.
 */
function toUrl(input: string): string {
  const text = input.trim();
  if (!text) return HOME;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  if (/^[^\s/]+\.[^\s/]{2,}(\/|$)/.test(text)) return `https://${text}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}

export default function Browser({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab()]);
  const [activeId, setActiveId] = useState<string>(() => '');
  const [address, setAddress] = useState(HOME);
  const [editing, setEditing] = useState(false);

  const views = useRef(new Map<string, WebviewTag>());

  // The first tab's id is only known after the initial state runs.
  useEffect(() => {
    if (!activeId && tabs[0]) setActiveId(tabs[0].id);
  }, [activeId, tabs]);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  // Keep the address bar in step with the active tab — unless the user is
  // mid-edit, where overwriting what they are typing would be maddening.
  useEffect(() => {
    if (!editing && active) setAddress(active.url);
  }, [active, editing]);

  const patch = useCallback((id: string, changes: Partial<Tab>) => {
    setTabs((current) => current.map((t) => (t.id === id ? { ...t, ...changes } : t)));
  }, []);

  /**
   * Wires one <webview> up. Done imperatively because these are DOM events on
   * a custom element, not React props.
   */
  const attach = useCallback(
    (id: string, node: WebviewTag | null) => {
      if (!node) {
        views.current.delete(id);
        return;
      }
      if (views.current.get(id) === node) return;
      views.current.set(id, node);

      node.addEventListener('did-start-loading', () => patch(id, { loading: true }));
      node.addEventListener('did-stop-loading', () => patch(id, { loading: false }));
      node.addEventListener('page-title-updated', (event) => {
        patch(id, { title: (event as CustomEvent & { title: string }).title || 'Untitled' });
      });
      // did-navigate-in-page covers single-page apps, which is most of them —
      // without it the address bar freezes on the first URL of the session.
      const sync = () => patch(id, { url: node.getURL() });
      node.addEventListener('did-navigate', sync);
      node.addEventListener('did-navigate-in-page', sync);
      node.addEventListener('did-fail-load', (event) => {
        const failure = event as CustomEvent & { errorCode: number; errorDescription: string };
        // -3 is ERR_ABORTED, which is what a cancelled navigation reports —
        // including every ordinary "clicked a link before the last one
        // finished". Reporting it would cry wolf constantly.
        if (failure.errorCode === -3) return;
        notify(failure.errorDescription || 'That page failed to load.', true);
      });
    },
    [notify, patch]
  );

  const go = useCallback(
    (input: string) => {
      const url = toUrl(input);
      const view = views.current.get(activeId);
      setEditing(false);
      if (!view) return;
      void view.loadURL(url).catch((err: Error) => {
        // A navigation that supersedes another reports ERR_ABORTED, and that
        // is ordinary: clicking a link, or a site redirecting mid-load.
        if (/ERR_ABORTED|\(-3\)/.test(err.message)) return;
        notify('Could not open that address.', true);
      });
    },
    [activeId, notify]
  );

  const open = useCallback((url?: string) => {
    const tab = newTab(url);
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
  }, []);

  const close = useCallback(
    (id: string) => {
      setTabs((current) => {
        // Never leave zero tabs — an empty browser has no way back to a page.
        if (current.length === 1) return [newTab()];
        const remaining = current.filter((t) => t.id !== id);
        if (id === activeId) {
          const index = current.findIndex((t) => t.id === id);
          setActiveId((remaining[index] ?? remaining[remaining.length - 1]).id);
        }
        return remaining;
      });
      views.current.delete(id);
    },
    [activeId]
  );

  const view = () => views.current.get(activeId);

  return (
    <div className="browser">
      <div className="tabstrip">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab${tab.id === activeId ? ' is-active' : ''}`}
            onClick={() => setActiveId(tab.id)}
            title={tab.title}
          >
            <span className="tab-title">{tab.loading ? 'Loading…' : tab.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                close(tab.id);
              }}
              title="Close tab"
            >
              <CloseIcon />
            </button>
          </div>
        ))}
        <button className="btn tab-new" onClick={() => open()} title="New tab">
          <PlusIcon />
        </button>
      </div>

      <div className="omnibar">
        <button className="btn" onClick={() => view()?.goBack()} title="Back">
          ‹
        </button>
        <button className="btn" onClick={() => view()?.goForward()} title="Forward">
          ›
        </button>
        <button
          className="btn"
          onClick={() => (active?.loading ? view()?.stop() : view()?.reload())}
          title={active?.loading ? 'Stop' : 'Reload'}
        >
          {active?.loading ? '✕' : '⟳'}
        </button>
        <input
          className="field address"
          value={address}
          onChange={(e) => {
            setEditing(true);
            setAddress(e.target.value);
          }}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(address);
            if (e.key === 'Escape') {
              setEditing(false);
              setAddress(active?.url ?? HOME);
              e.currentTarget.blur();
            }
          }}
          placeholder="Search or enter address"
          spellCheck={false}
          onPointerDown={() => window.overlay?.focusWindow()}
        />
      </div>

      <div className="pages">
        {tabs.map((tab) => (
          // Every tab stays mounted and is hidden with CSS. Unmounting would
          // tear the page down — losing a logged-in session, a half-typed
          // message, and the scroll position — every time you switch away.
          <Webview
            key={tab.id}
            ref={(node: WebviewTag | null) => attach(tab.id, node)}
            src={tab.initialUrl}
            partition="persist:browser"
            allowpopups="true"
            className={`page${tab.id === activeId ? ' is-active' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}
