'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Always-on listening with voice-activity detection.
 *
 * Rather than recording blindly and cutting on a timer, this watches the input
 * level and cuts a segment when speech stops. That matters for two reasons: a
 * segment that ends mid-sentence transcribes badly, and sending silence wastes
 * a transcription round trip.
 *
 * Audio is captured as raw PCM through the Web Audio API instead of
 * MediaRecorder, because the same samples are needed for both jobs — measuring
 * loudness for the VAD, and building the WAV that gets transcribed.
 */
type Options = {
  /** A finished utterance, already transcribed. */
  onUtterance: (text: string) => void;
  onError: (message: string) => void;
};

/** Speech is considered over after this much continuous quiet. */
const SILENCE_MS = 900;
/** Ignore blips: a segment shorter than this is a cough or a keystroke. */
const MIN_SPEECH_MS = 600;
/** Cut anyway past this, so one long monologue still gets transcribed. */
const MAX_SEGMENT_MS = 20_000;
/** RMS above this counts as speech. Tuned for room audio, not a close mic. */
const SPEECH_RMS = 0.012;

const TARGET_RATE = 16_000;

/** Downsample to 16 kHz mono and wrap in a WAV container — what Whisper wants. */
function encodeWav(samples: Float32Array, inputRate: number): Blob {
  const ratio = inputRate / TARGET_RATE;
  const outLength = Math.floor(samples.length / ratio);
  const pcm = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    // Average the source window rather than point-sampling, which would alias.
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    const value = end > start ? sum / (end - start) : 0;
    const clamped = Math.max(-1, Math.min(1, value));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(buffer, 44).set(pcm);

  return new Blob([buffer], { type: 'audio/wav' });
}

export function useListening({ onUtterance, onError }: Options) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);

  const bufRef = useRef<Float32Array[]>([]);
  const speechRef = useRef(false);
  const lastVoiceRef = useRef(0);
  const startedRef = useRef(0);

  const cbRef = useRef({ onUtterance, onError });
  useEffect(() => {
    cbRef.current = { onUtterance, onError };
  }, [onUtterance, onError]);

  const transcribe = useCallback(async (wav: Blob) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('audio', wav, 'speech.wav');
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) {
        cbRef.current.onError(data.error ?? 'Could not transcribe that.');
        return;
      }
      const text = (data.text ?? '').trim();
      // Whisper emits these for silence and background noise.
      if (text && !/^[\s.,!?-]*$/.test(text) && !/^\[.*\]$/.test(text)) {
        cbRef.current.onUtterance(text);
      }
    } catch {
      cbRef.current.onError('Could not reach the local backend.');
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(() => {
    nodeRef.current?.disconnect();
    ctxRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    nodeRef.current = null;
    ctxRef.current = null;
    streamRef.current = null;
    bufRef.current = [];
    speechRef.current = false;
    setSpeaking(false);
    setListening(false);
  }, []);

  const start = useCallback(async () => {
    if (ctxRef.current) return;

    const granted = await window.overlay?.requestMicrophone();
    if (granted === false) {
      cbRef.current.onError('Microphone access is off. Enable it in System Settings.');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Noise suppression off: it is tuned for a close talker and chews up
        // the quieter, further-away speech this is meant to pick up.
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      });
    } catch {
      cbRef.current.onError('Could not open the microphone.');
      return;
    }

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);

    const flush = () => {
      const frames = bufRef.current;
      bufRef.current = [];
      speechRef.current = false;
      setSpeaking(false);
      if (frames.length === 0) return;

      const total = frames.reduce((n, f) => n + f.length, 0);
      if ((total / ctx.sampleRate) * 1000 < MIN_SPEECH_MS) return;

      const merged = new Float32Array(total);
      let offset = 0;
      for (const f of frames) {
        merged.set(f, offset);
        offset += f.length;
      }
      void transcribe(encodeWav(merged, ctx.sampleRate));
    };

    node.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);

      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      const now = performance.now();

      if (rms > SPEECH_RMS) {
        if (!speechRef.current) {
          speechRef.current = true;
          startedRef.current = now;
          setSpeaking(true);
        }
        lastVoiceRef.current = now;
      }

      // Keep a little pre-roll so the first syllable is not clipped.
      if (speechRef.current || rms > SPEECH_RMS * 0.6) {
        bufRef.current.push(new Float32Array(input));
      }
      if (bufRef.current.length > 400) bufRef.current.shift();

      if (speechRef.current) {
        const quietFor = now - lastVoiceRef.current;
        const runFor = now - startedRef.current;
        if (quietFor > SILENCE_MS || runFor > MAX_SEGMENT_MS) flush();
      }
    };

    source.connect(node);
    // ScriptProcessor only runs while connected to a destination; a zero gain
    // keeps the room audio from being played back out of the speakers.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);

    streamRef.current = stream;
    ctxRef.current = ctx;
    nodeRef.current = node;
    setListening(true);
  }, [transcribe]);

  const toggle = useCallback(() => {
    if (ctxRef.current) stop();
    else void start();
  }, [start, stop]);

  useEffect(() => stop, [stop]);

  return { listening, speaking, busy, toggle };
}
