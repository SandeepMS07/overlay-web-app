import { describeHttpError } from '@/lib/chat';
import { getKey } from '@/lib/secrets';

/**
 * Speech to text.
 *
 * OpenAI is the only one of the three providers this app supports that accepts
 * the recorder's WebM/Opus audio as-is. Gemini's inline-audio endpoint takes
 * wav/mp3/ogg/flac but not WebM, and Claude has no audio input at all — so
 * dictation needs a ChatGPT key even when answers come from another provider.
 *
 * OPENAI_BASE_URL points this at any OpenAI-compatible endpoint, the same way
 * lib/chat.ts does, so a local Whisper server works here too.
 */
const OPENAI_BASE = process.env.OPENAI_BASE_URL?.replace(/\/+$/, '') || 'https://api.openai.com/v1';

const MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

/**
 * A whisper.cpp server started with an OpenAI-shaped path, e.g.
 *   whisper-server -m ggml-small.en.bin --port 8178 \
 *     --request-path /v1 --inference-path /audio/transcriptions --convert
 *
 * Tried first when reachable: it keeps audio — including other people's voices
 * in a meeting — on this machine, and needs no API credit. Falling back to
 * OpenAI only happens when nothing is listening locally.
 */
const LOCAL_WHISPER = process.env.WHISPER_BASE_URL?.replace(/\/+$/, '') || 'http://127.0.0.1:8178/v1';

async function postAudio(base: string, audio: File, key: string | null, signal?: AbortSignal) {
  const form = new FormData();
  form.append('file', audio, audio.name || 'speech.wav');
  form.append('model', MODEL);
  form.append('response_format', 'json');
  return fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    signal,
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    body: form,
  });
}

/** True when a local whisper server answers. */
export async function localTranscriberReady(): Promise<boolean> {
  try {
    // Any response at all — including a 404 or 400 — proves something is bound.
    await fetch(`${LOCAL_WHISPER}/audio/transcriptions`, {
      method: 'GET',
      signal: AbortSignal.timeout(700),
    });
    return true;
  } catch {
    return false;
  }
}

/** Thrown when the request can never succeed as configured — a 400, not a 502. */
export class TranscribeConfigError extends Error {}

export async function transcribe(audio: File, signal?: AbortSignal): Promise<string> {
  // Local first: no credit, no upload of anyone's voice.
  try {
    const local = await postAudio(LOCAL_WHISPER, audio, null, signal);
    if (local.ok) {
      const data = (await local.json()) as { text?: string };
      return (data.text ?? '').trim();
    }
  } catch {
    /* nothing listening locally — fall through to the hosted API */
  }

  const key = await getKey('openai');
  if (!key) {
    throw new TranscribeConfigError(
      'No transcription available. Either start a local whisper server (see the ' +
        'README) or add a ChatGPT key — of the hosted providers only OpenAI ' +
        'accepts this audio format.'
    );
  }

  const res = await postAudio(OPENAI_BASE, audio, key, signal);
  if (!res.ok) throw new Error(await describeHttpError(res, 'Transcription'));

  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}
