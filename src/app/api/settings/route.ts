import { NextResponse } from 'next/server';
import { getSettings, saveSettings, type Settings } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await getSettings());
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as Partial<Settings>;

  // Whitelist + clamp so a bad payload can never poison the settings file.
  const patch: Partial<Settings> = {};
  if (typeof body.opacity === 'number') patch.opacity = clamp(body.opacity, 0.15, 1);
  if (typeof body.volume === 'number') patch.volume = clamp(body.volume, 0, 100);
  if (typeof body.clickThrough === 'boolean') patch.clickThrough = body.clickThrough;
  if (typeof body.alwaysOnTop === 'boolean') patch.alwaysOnTop = body.alwaysOnTop;
  if (typeof body.autoplay === 'boolean') patch.autoplay = body.autoplay;
  if (typeof body.compact === 'boolean') patch.compact = body.compact;
  if (typeof body.lastVideoId === 'string' || body.lastVideoId === null) {
    patch.lastVideoId = body.lastVideoId;
  }

  return NextResponse.json(await saveSettings(patch));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
