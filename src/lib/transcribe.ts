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

/** Thrown when the request can never succeed as configured — a 400, not a 502. */
export class TranscribeConfigError extends Error {}

export async function transcribe(audio: File, signal?: AbortSignal): Promise<string> {
  const key = await getKey('openai');
  if (!key) {
    throw new TranscribeConfigError(
      'Dictation needs a ChatGPT key — it is the only provider that accepts the ' +
        'recorder\'s audio format. Add one under ChatGPT in the key panel; answers ' +
        'can still come from Claude or Gemini.'
    );
  }

  const form = new FormData();
  // Whisper picks its decoder from the filename extension, so the name matters.
  form.append('file', audio, audio.name || 'speech.webm');
  form.append('model', MODEL);
  form.append('response_format', 'json');

  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: 'POST',
    signal,
    // No Content-Type header: fetch has to set the multipart boundary itself.
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!res.ok) throw new Error(await describeHttpError(res, 'Transcription'));

  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}
