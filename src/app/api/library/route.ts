import { NextResponse } from 'next/server';
import { getLibrary, saveLibrary, type Track } from '@/lib/store';
import { parseVideoId, thumbnailUrl, watchUrl } from '@/lib/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await getLibrary());
}

export async function POST(request: Request) {
  const { url } = (await request.json()) as { url?: string };
  const videoId = parseVideoId(url ?? '');

  if (!videoId) {
    return NextResponse.json({ error: 'Could not find a YouTube video in that link.' }, { status: 400 });
  }

  const library = await getLibrary();
  const existing = library.find((t) => t.videoId === videoId);
  if (existing) {
    return NextResponse.json({ track: existing, duplicate: true });
  }

  const meta = await fetchMetadata(videoId);
  const track: Track = {
    id: `${videoId}-${Date.now().toString(36)}`,
    videoId,
    title: meta.title ?? videoId,
    author: meta.author,
    thumbnail: meta.thumbnail ?? thumbnailUrl(videoId),
    addedAt: Date.now(),
  };

  await saveLibrary([track, ...library]);
  return NextResponse.json({ track, duplicate: false });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const library = await getLibrary();
  await saveLibrary(library.filter((t) => t.id !== id));
  return NextResponse.json({ ok: true });
}

/**
 * YouTube's oEmbed endpoint needs no API key. If it is unreachable (offline,
 * private video) we still add the track using the raw id as its title.
 */
async function fetchMetadata(videoId: string) {
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(videoId))}&format=json`;
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return {};
    const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    return { title: data.title, author: data.author_name, thumbnail: data.thumbnail_url };
  } catch {
    return {};
  }
}
