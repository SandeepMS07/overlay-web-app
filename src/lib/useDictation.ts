'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type DictationState = 'idle' | 'recording' | 'transcribing';

type Options = {
  /** Called with the transcript once a take has been recognised. */
  onText: (text: string) => void;
  onError: (message: string) => void;
};

// Chromium only encodes WebM for audio-only recordings; this is a fallback
// chain rather than a preference.
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Below this a take is silence or a mis-click, not speech worth billing for. */
const MIN_BYTES = 1200;

/**
 * Records the default input device and turns it into text.
 *
 * getUserMedia with a bare `audio: true` follows whatever the OS has set as the
 * default microphone, so the built-in laptop mic is used unless the user has
 * chosen another one system-wide. Tracks are stopped after every take —
 * otherwise the OS keeps showing its mic-in-use indicator between questions.
 */
export function useDictation({ onText, onError }: Options) {
  const [state, setState] = useState<DictationState>('idle');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);

  // Held in a ref so the recorder's own handlers always see the current
  // callbacks without having to tear the recording down on every re-render.
  const cbRef = useRef({ onText, onError });
  useEffect(() => {
    cbRef.current = { onText, onError };
  }, [onText, onError]);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;

    const mimeType = pickMimeType();
    if (!mimeType) {
      cbRef.current.onError('This build cannot record audio.');
      return;
    }

    // macOS gates the microphone at the OS level, which is a separate grant
    // from Chromium's own permission — ask for it before opening the device.
    const granted = await window.overlay?.requestMicrophone();
    if (granted === false) {
      cbRef.current.onError(
        'Microphone access is off. Enable it in System Settings › Privacy & Security › Microphone.'
      );
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const name = (err as Error)?.name;
      cbRef.current.onError(
        name === 'NotAllowedError'
          ? 'Microphone access was denied.'
          : name === 'NotFoundError'
            ? 'No microphone found.'
            : 'Could not open the microphone.'
      );
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    discardRef.current = false;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      discardRef.current = true;
      releaseMic();
      setState('idle');
      cbRef.current.onError('The recording failed.');
    };

    recorder.onstop = () => {
      const chunks = chunksRef.current;
      chunksRef.current = [];
      releaseMic();

      if (discardRef.current) {
        setState('idle');
        return;
      }

      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size < MIN_BYTES) {
        setState('idle');
        cbRef.current.onError('Did not catch that — hold the mic a moment longer.');
        return;
      }

      setState('transcribing');
      void (async () => {
        try {
          const form = new FormData();
          form.append('audio', blob, 'speech.webm');
          const res = await fetch('/api/transcribe', { method: 'POST', body: form });
          const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };

          if (!res.ok) {
            cbRef.current.onError(data.error ?? 'Could not transcribe that.');
            return;
          }
          const text = (data.text ?? '').trim();
          if (text) cbRef.current.onText(text);
          else cbRef.current.onError('Did not catch that — try again.');
        } catch {
          cbRef.current.onError('Could not reach the local backend.');
        } finally {
          setState('idle');
        }
      })();
    };

    recorder.start();
    setState('recording');
  }, [releaseMic]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    stop();
  }, [stop]);

  const toggle = useCallback(() => {
    if (state === 'transcribing') return;
    if (recorderRef.current) stop();
    else void start();
  }, [start, state, stop]);

  // Never leave the microphone open if the panel goes away mid-take.
  useEffect(() => releaseMic, [releaseMic]);

  return { state, toggle, cancel };
}
