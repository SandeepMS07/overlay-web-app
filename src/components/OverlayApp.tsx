'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Chat from '@/components/Chat';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';
import { PROVIDERS } from '@/lib/providers';
import {
  CaptureIcon,
  CloseIcon,
  GhostIcon,
  MinusIcon,
  NoCaptureIcon,
  PinIcon,
} from '@/components/Icons';

const BAR_HEIGHT = 40;

export default function OverlayApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [barVisible, setBarVisible] = useState(true);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [focusToken, setFocusToken] = useState(0);

  const interactiveRef = useRef(true);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 4000);
  }, []);

  // ---------------------------------------------------------------- settings

  const persist = useCallback((patch: Partial<Settings>) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    }, 180);
  }, []);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      persist(patch);
    },
    [persist]
  );

  // ------------------------------------------------------------------- boot

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = (await fetch('/api/settings').then((r) => r.json())) as Settings;
        if (cancelled) return;
        setSettings(stored);
        void window.overlay?.setOpacity(stored.opacity);
        void window.overlay?.setAlwaysOnTop(stored.alwaysOnTop);
        void window.overlay?.setClickThrough(stored.clickThrough);
        void window.overlay?.setHiddenFromCapture(stored.hiddenFromCapture);
      } catch {
        if (!cancelled) notify('Could not reach the local backend.', true);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  // -------------------------------------------------------- window controls

  const setOpacity = useCallback(
    (value: number) => {
      const clamped = Math.min(1, Math.max(0.15, value));
      update({ opacity: clamped });
      void window.overlay?.setOpacity(clamped);
    },
    [update]
  );

  const toggleClickThrough = useCallback(() => {
    const next = !settings.clickThrough;
    update({ clickThrough: next });
    void window.overlay?.setClickThrough(next);
  }, [settings.clickThrough, update]);

  const toggleHiddenFromCapture = useCallback(() => {
    const next = !settings.hiddenFromCapture;
    update({ hiddenFromCapture: next });
    void window.overlay?.setHiddenFromCapture(next);
    notify(
      next
        ? 'Hidden from screen sharing and recordings.'
        : 'Visible in screen sharing and recordings.'
    );
  }, [notify, settings.hiddenFromCapture, update]);

  const toggleAlwaysOnTop = useCallback(() => {
    const next = !settings.alwaysOnTop;
    update({ alwaysOnTop: next });
    void window.overlay?.setAlwaysOnTop(next);
  }, [settings.alwaysOnTop, update]);

  // -------------------------------------------------------- global signals

  useEffect(() => {
    return window.overlay?.onShortcut((action) => {
      if (action === 'opacity-up') setOpacity(settings.opacity + 0.1);
      if (action === 'opacity-down') setOpacity(settings.opacity - 0.1);
      if (action === 'focus-chat') {
        setBarVisible(true);
        setFocusToken((n) => n + 1);
      }
    });
  }, [setOpacity, settings.opacity]);

  useEffect(() => {
    return window.overlay?.onClickThroughChanged((value) => {
      setSettings((prev) => (prev.clickThrough === value ? prev : { ...prev, clickThrough: value }));
    });
  }, []);

  // The tray item and ⌘⇧P flip this in the main process, so mirror it back into
  // the UI and persist it — otherwise the toolbar would show a stale state.
  useEffect(() => {
    return window.overlay?.onHiddenFromCaptureChanged((value) => {
      setSettings((prev) => {
        if (prev.hiddenFromCapture === value) return prev;
        persist({ hiddenFromCapture: value });
        return { ...prev, hiddenFromCapture: value };
      });
    });
  }, [persist]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      setBarVisible(event.clientY <= BAR_HEIGHT + 12 || !settings.compact);

      // The whole panel has to stay clickable in click-through mode — you
      // cannot type into a window that is ignoring the mouse.
      if (settings.clickThrough && !interactiveRef.current) {
        interactiveRef.current = true;
        window.overlay?.setInteractive(true);
      }
    };

    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, [settings.clickThrough, settings.compact]);

  useEffect(() => {
    if (!settings.compact) setBarVisible(true);
  }, [settings.compact]);

  // ----------------------------------------------------------------- resize

  const onResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.screenX;
    const startY = event.screenY;
    const startW = window.innerWidth;
    const startH = window.innerHeight;

    const onMove = (moveEvent: PointerEvent) => {
      void window.overlay?.setSize({
        width: startW + (moveEvent.screenX - startX),
        height: startH + (moveEvent.screenY - startY),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  // ------------------------------------------------------------------ view

  return (
    <div className={`shell${settings.clickThrough ? ' is-clickthrough' : ''}`}>
      <header
        className={`bar${barVisible ? '' : ' is-hidden'}`}
        onPointerDown={() => window.overlay?.focusWindow()}
      >
        <span className="grip">⋮⋮</span>
        <span className="title">
          <strong>{PROVIDERS[settings.provider].label}</strong>
        </span>

        <input
          className="slider"
          type="range"
          min={20}
          max={100}
          value={Math.round(settings.opacity * 100)}
          onChange={(e) => setOpacity(Number(e.target.value) / 100)}
          title={`Opacity ${Math.round(settings.opacity * 100)}%`}
        />

        <button
          className={`btn${settings.hiddenFromCapture ? ' is-active' : ''}`}
          onClick={toggleHiddenFromCapture}
          title={
            settings.hiddenFromCapture
              ? 'Hidden from screen sharing and recordings — click to make it visible (⌘⇧P)'
              : 'Visible in screen sharing and recordings — click to hide it (⌘⇧P)'
          }
        >
          {settings.hiddenFromCapture ? <NoCaptureIcon /> : <CaptureIcon />}
        </button>
        <button
          className={`btn${settings.clickThrough ? ' is-active' : ''}`}
          onClick={toggleClickThrough}
          title="Click-through — let clicks pass to the app underneath (⌘⇧C)"
        >
          <GhostIcon />
        </button>
        <button
          className={`btn${settings.alwaysOnTop ? ' is-active' : ''}`}
          onClick={toggleAlwaysOnTop}
          title="Always on top"
        >
          <PinIcon />
        </button>
        <button className="btn" onClick={() => window.overlay?.hide()} title="Hide (⌘⇧Y)">
          <MinusIcon />
        </button>
        <button className="btn is-danger" onClick={() => window.overlay?.quit()} title="Quit">
          <CloseIcon />
        </button>
      </header>

      <div className="body">
        {ready && (
          <Chat settings={settings} update={update} focusToken={focusToken} notify={notify} />
        )}
      </div>

      {toast && <div className={`toast${toast.error ? ' is-error' : ''}`}>{toast.text}</div>}

      <div className="resize" onPointerDown={onResizeStart} title="Drag to resize" />
    </div>
  );
}
