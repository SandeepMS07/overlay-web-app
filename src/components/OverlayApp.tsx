'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useYouTubePlayer } from '@/lib/useYouTubePlayer';
import type { Settings, Track } from '@/lib/store';
import {
  CloseIcon,
  ExternalIcon,
  GhostIcon,
  ListIcon,
  MinusIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
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
};

type Current = { videoId: string; title: string; author?: string };

export default function OverlayApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [library, setLibrary] = useState<Track[]>([]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [input, setInput] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [barVisible, setBarVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  const barRef = useRef<HTMLElement | null>(null);
  const inputFocused = useRef(false);
  const interactiveRef = useRef(true);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3200);
  }, []);

  const player = useYouTubePlayer({
    volume: settings.volume,
    autoplay: settings.autoplay,
    onError: (message) => notify(message, true),
  });

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
        const [s, lib] = await Promise.all([
          fetch('/api/settings').then((r) => r.json() as Promise<Settings>),
          fetch('/api/library').then((r) => r.json() as Promise<Track[]>),
        ]);
        if (cancelled) return;

        setSettings(s);
        setLibrary(lib);

        // Push the restored window preferences back into the main process.
        void window.overlay?.setOpacity(s.opacity);
        void window.overlay?.setAlwaysOnTop(s.alwaysOnTop);
        void window.overlay?.setClickThrough(s.clickThrough);

        if (s.lastVideoId) {
          const saved = lib.find((t) => t.videoId === s.lastVideoId);
          setCurrent({
            videoId: s.lastVideoId,
            title: saved?.title ?? s.lastVideoId,
            author: saved?.author,
          });
        }
      } catch {
        if (!cancelled) notify('Could not reach the local backend.', true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [notify]);

  // Push the current video into the player once both are settled.
  useEffect(() => {
    if (current) player.load(current.videoId);
    // player.load is stable (useCallback with no deps)
  }, [current, player.load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    player.applyVolume(settings.volume);
  }, [settings.volume, player.applyVolume]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------- playback

  const play = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/resolve?url=${encodeURIComponent(value)}`);
        const data = await res.json();
        if (!res.ok) {
          notify(data.error ?? 'Could not play that link.', true);
          return;
        }
        setCurrent({ videoId: data.videoId, title: data.title, author: data.author });
        update({ lastVideoId: data.videoId });
        setInput('');
        setLibraryOpen(false);
      } catch {
        notify('Could not reach the local backend.', true);
      } finally {
        setBusy(false);
      }
    },
    [notify, update]
  );

  const playTrack = useCallback(
    (track: Track) => {
      setCurrent({ videoId: track.videoId, title: track.title, author: track.author });
      update({ lastVideoId: track.videoId });
      setLibraryOpen(false);
    },
    [update]
  );

  const saveCurrent = useCallback(async () => {
    const target = input.trim() || current?.videoId;
    if (!target) return;
    setBusy(true);
    try {
      const res = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data.error ?? 'Could not save that video.', true);
        return;
      }
      if (data.duplicate) {
        notify('Already in your library.');
      } else {
        setLibrary((prev) => [data.track as Track, ...prev]);
        notify('Saved to library.');
      }
    } catch {
      notify('Could not reach the local backend.', true);
    } finally {
      setBusy(false);
    }
  }, [current, input, notify]);

  const removeTrack = useCallback(async (track: Track) => {
    setLibrary((prev) => prev.filter((t) => t.id !== track.id));
    await fetch(`/api/library?id=${encodeURIComponent(track.id)}`, { method: 'DELETE' });
  }, []);

  // ------------------------------------------------------- window controls

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
    const off = window.overlay?.onShortcut((action) => {
      if (action === 'playpause') player.toggle();
      if (action === 'opacity-up') setOpacity(settings.opacity + 0.1);
      if (action === 'opacity-down') setOpacity(settings.opacity - 0.1);
    });
    return off;
  }, [player.toggle, setOpacity, settings.opacity]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const off = window.overlay?.onClickThroughChanged((value) => {
      setSettings((prev) => (prev.clickThrough === value ? prev : { ...prev, clickThrough: value }));
    });
    return off;
  }, []);

  // Decides both toolbar auto-hide and, in click-through mode, when to briefly
  // hand input back to the window so the controls stay usable.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const overBar = event.clientY <= BAR_HEIGHT + 12;
      const shouldShow = overBar || libraryOpen || inputFocused.current || !settings.compact;
      setBarVisible(shouldShow);

      if (settings.clickThrough) {
        const wantsInput = overBar || libraryOpen;
        if (wantsInput !== interactiveRef.current) {
          interactiveRef.current = wantsInput;
          window.overlay?.setInteractive(wantsInput);
        }
      }
    };

    const onLeave = () => {
      if (settings.compact && !libraryOpen && !inputFocused.current) setBarVisible(false);
      if (settings.clickThrough && interactiveRef.current) {
        interactiveRef.current = false;
        window.overlay?.setInteractive(false);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, [libraryOpen, settings.clickThrough, settings.compact]);

  useEffect(() => {
    if (!settings.compact) setBarVisible(true);
  }, [settings.compact]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement;
      if (event.key === 'Escape') {
        if (typing) (event.target as HTMLInputElement).blur();
        else setLibraryOpen(false);
        return;
      }
      if (typing) return;
      if (event.code === 'Space') {
        event.preventDefault();
        player.toggle();
      }
      if (event.key === 'ArrowRight') player.seek(5);
      if (event.key === 'ArrowLeft') player.seek(-5);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player.toggle, player.seek]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="stage">
        <div ref={player.mountRef} />
        {!current && (
          <div className="empty">
            <h1>Overlay Player</h1>
            <p>
              Paste a YouTube link above to float it over whatever you are doing. Press{' '}
              <kbd>⌘⇧Y</kbd> to show or hide, <kbd>⌘⇧C</kbd> for click-through.
            </p>
          </div>
        )}
      </div>

      {settings.clickThrough && <div className="hover-sensor" />}

      <header ref={barRef} className={`bar${barVisible ? '' : ' is-hidden'}`}>
        <span className="grip">⋮⋮</span>

        <button
          className="btn"
          onClick={player.toggle}
          disabled={!current}
          title="Play / pause (⌘⇧Space)"
        >
          {player.playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <input
          className="field"
          value={input}
          placeholder={current ? current.title : 'Paste a YouTube link…'}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => {
            inputFocused.current = true;
            setBarVisible(true);
          }}
          onBlur={() => {
            inputFocused.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void play(input);
          }}
          spellCheck={false}
        />

        <button className="btn" onClick={() => void play(input)} disabled={busy || !input.trim()} title="Play">
          <PlayIcon />
        </button>

        <button
          className="btn"
          onClick={() => void saveCurrent()}
          disabled={busy || (!input.trim() && !current)}
          title="Save to library"
        >
          <PlusIcon />
        </button>

        <button
          className={`btn${libraryOpen ? ' is-active' : ''}`}
          onClick={() => setLibraryOpen((v) => !v)}
          title="Library"
        >
          <ListIcon />
        </button>

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

        <button className="btn" onClick={() => window.overlay?.hide()} title="Hide (⌘⇧Y to bring back)">
          <MinusIcon />
        </button>

        <button className="btn is-danger" onClick={() => window.overlay?.quit()} title="Quit">
          <CloseIcon />
        </button>
      </header>

      {libraryOpen && (
        <aside className="library">
          <div className="library-head">
            <span>Library · {library.length}</span>
            <label className="pill">
              <input
                type="checkbox"
                checked={settings.compact}
                onChange={(e) => update({ compact: e.target.checked })}
              />
              Auto-hide controls
            </label>
            <label className="pill">
              Volume
              <input
                className="slider"
                type="range"
                min={0}
                max={100}
                value={settings.volume}
                onChange={(e) => update({ volume: Number(e.target.value) })}
              />
            </label>
          </div>

          <div className="library-list">
            {library.length === 0 ? (
              <p className="library-empty">
                Nothing saved yet. Paste a link and press <kbd>+</kbd> to keep it here.
              </p>
            ) : (
              library.map((track) => (
                <div
                  key={track.id}
                  className={`track${current?.videoId === track.videoId ? ' is-current' : ''}`}
                  onClick={() => playTrack(track)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') playTrack(track);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={track.thumbnail} alt="" />
                  <div className="track-meta">
                    <b>{track.title}</b>
                    <small>{track.author ?? track.videoId}</small>
                  </div>
                  <button
                    className="btn"
                    title="Open on YouTube"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.overlay?.openExternal(`https://www.youtube.com/watch?v=${track.videoId}`);
                    }}
                  >
                    <ExternalIcon />
                  </button>
                  <button
                    className="btn is-danger"
                    title="Remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeTrack(track);
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      {toast && <div className={`toast${toast.error ? ' is-error' : ''}`}>{toast.text}</div>}

      <div className="resize" onPointerDown={onResizeStart} title="Drag to resize" />
    </div>
  );
}
