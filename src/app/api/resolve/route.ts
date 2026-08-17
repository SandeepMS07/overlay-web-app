import { NextResponse } from 'next/server';
import { parseVideoId, thumbnailUrl, watchUrl } from '@/lib/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Resolves a pasted link to a playable video plus its title, without adding it
 * to the library. Metadata is fetched server-side to avoid CORS.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('url') ?? '';
  const videoId = parseVideoId(raw);

  if (!videoId) {
    return NextResponse.json({ error: 'Could not find a YouTube video in that link.' }, { status: 400 });
  }

  let title = videoId;
  let author: string | undefined;

  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(videoId))}&format=json`;
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = (await res.json()) as { title?: string; author_name?: string };
      title = data.title ?? title;
      author = data.author_name;
    }
  } catch {
    /* offline or restricted: fall back to the bare id */
  }

  return NextResponse.json({ videoId, title, author, thumbnail: thumbnailUrl(videoId) });
}
