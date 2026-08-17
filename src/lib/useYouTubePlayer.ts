'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

let apiPromise: Promise<any> | null = null;

/** Loads the YouTube IFrame API once per page and resolves with window.YT. */
function loadIframeApi(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('Could not load the YouTube player. Check your connection.'));
    document.head.appendChild(script);
  });

  return apiPromise;
}

const EMBED_BLOCKED = new Set([101, 150]);

type Options = {
  volume: number;
  autoplay: boolean;
  onError?: (message: string) => void;
};

export function useYouTubePlayer({ volume, autoplay, onError }: Options) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const pendingRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  // Keep the latest option values reachable from callbacks created once.
  const optsRef = useRef({ volume, autoplay, onError });
  optsRef.current = { volume, autoplay, onError };

  useEffect(() => {
    let cancelled = false;

    loadIframeApi()
      .then((YT) => {
        if (cancelled || !mountRef.current || playerRef.current) return;

        playerRef.current = new YT.Player(mountRef.current, {
          host: 'https://www.youtube-nocookie.com',
          playerVars: {
            autoplay: optsRef.current.autoplay ? 1 : 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            origin: window.location.origin,
          },
          events: {
            onReady: (event: any) => {
              if (cancelled) return;
              event.target.setVolume(optsRef.current.volume);
              setReady(true);
              // A video chosen before the API finished loading is applied now.
              const queued = pendingRef.current;
              if (queued) {
                pendingRef.current = null;
                if (optsRef.current.autoplay) event.target.loadVideoById(queued);
                else event.target.cueVideoById(queued);
              }
            },
            onStateChange: (event: any) => {
              if (cancelled) return;
              setPlaying(event.data === window.YT.PlayerState.PLAYING);
            },
            onError: (event: any) => {
              const message = EMBED_BLOCKED.has(event.data)
                ? "This video's owner disabled playback outside YouTube."
                : 'That video could not be played.';
              optsRef.current.onError?.(message);
            },
          },
        });
      })
      .catch((err: Error) => optsRef.current.onError?.(err.message));

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* player may already be gone */
      }
      playerRef.current = null;
    };
  }, []);

  const load = useCallback((videoId: string) => {
    const player = playerRef.current;
    if (!player?.loadVideoById) {
      pendingRef.current = videoId;
      return;
    }
    if (optsRef.current.autoplay) player.loadVideoById(videoId);
    else player.cueVideoById(videoId);
  }, []);

  const toggle = useCallback(() => {
    const player = playerRef.current;
    if (!player?.getPlayerState) return;
    if (player.getPlayerState() === window.YT?.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
  }, []);

  const applyVolume = useCallback((value: number) => {
    playerRef.current?.setVolume?.(value);
  }, []);

  const seek = useCallback((deltaSeconds: number) => {
    const player = playerRef.current;
    if (!player?.getCurrentTime) return;
    player.seekTo(Math.max(0, player.getCurrentTime() + deltaSeconds), true);
  }, []);

  return { mountRef, ready, playing, load, toggle, applyVolume, seek };
}
