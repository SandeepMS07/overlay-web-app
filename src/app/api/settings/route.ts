import { NextResponse } from 'next/server';
import { isProviderId, PROVIDER_IDS, type ProviderId } from '@/lib/providers';
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
  if (body.mode === 'chat' || body.mode === 'video') patch.mode = body.mode;
  if (isProviderId(body.provider)) patch.provider = body.provider;
  if (body.models && typeof body.models === 'object') {
    const models: Partial<Record<ProviderId, string>> = {};
    for (const id of PROVIDER_IDS) {
      const value = body.models[id];
      if (typeof value === 'string') models[id] = value.slice(0, 120);
    }
    patch.models = models;
  }

  return NextResponse.json(await saveSettings(patch));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
