'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Chat from '@/components/Chat';
import VideoPanel from '@/components/VideoPanel';
import type { Settings } from '@/lib/store';
import { PROVIDERS } from '@/lib/providers';
import {
  ChatIcon,
  CloseIcon,
  GhostIcon,
  MinusIcon,
  PinIcon,
  VideoIcon,
} from '@/components/Icons';

const BAR_HEIGHT = 40;

const DEFAULTS: Settings = {
  opacity: 0.6,
  clickThrough: false,
  alwaysOnTop: true,
  volume: 60,
  autoplay: true,
  compact: false,
  lastVideoId: null,
  mode: 'chat',
  provider: 'anthropic',
  models: {},
};

export default function OverlayApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [barVisible, setBarVisible] = useState(true);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  // The video panel stays mounted once used so audio keeps playing behind chat.
  const [videoMounted, setVideoMounted] = useState(false);

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

  useEffect(() => {
    if (settings.mode === 'video') setVideoMounted(true);
  }, [settings.mode]);

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
        update({ mode: 'chat' });
        setBarVisible(true);
        setFocusToken((n) => n + 1);
      }
    });
  }, [setOpacity, settings.opacity, update]);

  useEffect(() => {
    return window.overlay?.onClickThroughChanged((value) => {
      setSettings((prev) => (prev.clickThrough === value ? prev : { ...prev, clickThrough: value }));
    });
  }, []);

  // Drives toolbar auto-hide, and in click-through mode hands input back while
  // the cursor is over the controls.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const overBar = event.clientY <= BAR_HEIGHT + 12;
      setBarVisible(overBar || !settings.compact);

      if (settings.clickThrough) {
        // In chat, the whole panel needs to stay clickable — you cannot type
        // into a window that is ignoring the mouse.
        const wantsInput = settings.mode === 'chat' || overBar;
        if (wantsInput !== interactiveRef.current) {
          interactiveRef.current = wantsInput;
          window.overlay?.setInteractive(wantsInput);
        }
      }
    };

    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, [settings.clickThrough, settings.compact, settings.mode]);

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

  const isChat = settings.mode === 'chat';

  return (
    <div className={`shell${settings.clickThrough ? ' is-clickthrough' : ''}`}>
      <header
        className={`bar${barVisible ? '' : ' is-hidden'}`}
        onPointerDown={() => window.overlay?.focusWindow()}
      >
        <span className="grip">⋮⋮</span>

        <div className="modes">
          <button
            className={`btn${isChat ? ' is-active' : ''}`}
            onClick={() => update({ mode: 'chat' })}
            title="Ask a question (⌘⇧A)"
          >
            <ChatIcon />
          </button>
          <button
            className={`btn${!isChat ? ' is-active' : ''}`}
            onClick={() => update({ mode: 'video' })}
            title="Video player"
          >
            <VideoIcon />
          </button>
        </div>

        <span className="title">
          {isChat ? PROVIDERS[settings.provider].label : 'Video'}
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

      {/* The YouTube iframe swallows mousemove, so click-through mode needs a
          transparent layer above it to notice the cursor reaching the toolbar. */}
      {settings.clickThrough && !isChat && <div className="hover-sensor" />}

      <div className="body">
        {ready && (
          <div className="panel" hidden={!isChat}>
            <Chat settings={settings} update={update} focusToken={focusToken} notify={notify} />
          </div>
        )}

        {videoMounted && (
          <div className="panel" hidden={isChat}>
            <VideoPanel settings={settings} update={update} notify={notify} active={!isChat} />
          </div>
        )}
      </div>

      {toast && <div className={`toast${toast.error ? ' is-error' : ''}`}>{toast.text}</div>}

      <div className="resize" onPointerDown={onResizeStart} title="Drag to resize" />
    </div>
  );
}
