'use client';

import { useCallback, useEffect, useState } from 'react';
import { useYouTubePlayer } from '@/lib/useYouTubePlayer';
import type { Settings, Track } from '@/lib/store';
import {
  ExternalIcon,
  ListIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/Icons';

type Props = {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  notify: (text: string, error?: boolean) => void;
  /** False while the chat panel is in front — the panel stays mounted so audio keeps playing. */
  active: boolean;
};

type Current = { videoId: string; title: string; author?: string };

export default function VideoPanel({ settings, update, notify, active }: Props) {
  const [library, setLibrary] = useState<Track[]>([]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [input, setInput] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const player = useYouTubePlayer({
    volume: settings.volume,
    autoplay: settings.autoplay,
    onError: (message) => notify(message, true),
  });

  // ------------------------------------------------------------------ boot

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tracks = (await fetch('/api/library').then((r) => r.json())) as Track[];
        if (cancelled) return;
        setLibrary(tracks);

        if (settings.lastVideoId) {
          const saved = tracks.find((t) => t.videoId === settings.lastVideoId);
          setCurrent({
            videoId: settings.lastVideoId,
            title: saved?.title ?? settings.lastVideoId,
            author: saved?.author,
          });
        }
      } catch {
        if (!cancelled) notify('Could not load your library.', true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once: lastVideoId is only used to restore the initial video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (current) player.load(current.videoId);
  }, [current, player.load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    player.applyVolume(settings.volume);
  }, [settings.volume, player.applyVolume]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play/pause from the global shortcut, but only while this panel is in front.
  useEffect(() => {
    if (!active) return;
    return window.overlay?.onShortcut((action) => {
      if (action === 'playpause') player.toggle();
    });
  }, [active, player.toggle]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------- actions

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

  const save = useCallback(async () => {
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
      if (data.duplicate) notify('Already in your library.');
      else {
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

  const playTrack = useCallback(
    (track: Track) => {
      setCurrent({ videoId: track.videoId, title: track.title, author: track.author });
      update({ lastVideoId: track.videoId });
      setLibraryOpen(false);
    },
    [update]
  );

  // ----------------------------------------------------------------- view

  return (
    <div className="video">
      <div className="video-bar">
        <button className="btn" onClick={player.toggle} disabled={!current} title="Play / pause">
          {player.playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <input
          className="field"
          value={input}
          placeholder={current ? current.title : 'Paste a YouTube link…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void play(input);
          }}
          onPointerDown={() => window.overlay?.focusWindow()}
          spellCheck={false}
        />

        <button className="btn" onClick={() => void play(input)} disabled={busy || !input.trim()} title="Play">
          <PlayIcon />
        </button>
        <button
          className="btn"
          onClick={() => void save()}
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
      </div>

      <div className="stage">
        <div ref={player.mountRef} />
        {!current && (
          <div className="empty">
            <p>Paste a YouTube link above to float it over whatever you are doing.</p>
          </div>
        )}
      </div>

      {libraryOpen && (
        <aside className="library">
          <div className="library-head">
            <span>Library · {library.length}</span>
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
              <p className="library-empty">Nothing saved yet. Paste a link and press + to keep it.</p>
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
    </div>
  );
}
