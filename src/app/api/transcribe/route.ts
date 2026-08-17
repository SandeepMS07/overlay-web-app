import { NextResponse } from 'next/server';
import { TranscribeConfigError, transcribe } from '@/lib/transcribe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Whisper's own upload ceiling; reject earlier so the user gets a real message. */
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected an audio upload.' }, { status: 400 });
  }

  const audio = form.get('audio');
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: 'No audio in the request.' }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'That recording is too long. Keep it under about 20 minutes.' },
      { status: 413 }
    );
  }

  try {
    return NextResponse.json({ text: await transcribe(audio) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not transcribe that.';
    return NextResponse.json(
      { error: message },
      { status: err instanceof TranscribeConfigError ? 400 : 502 }
    );
  }
}
