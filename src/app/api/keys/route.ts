import { NextResponse } from 'next/server';
import { isProviderId } from '@/lib/providers';
import { clearKey, configuredProviders, setKey } from '@/lib/secrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reports which providers have a key — never the keys themselves. */
export async function GET() {
  return NextResponse.json({ configured: await configuredProviders() });
}

export async function POST(request: Request) {
  const { provider, key } = (await request.json()) as { provider?: string; key?: string };

  if (!isProviderId(provider)) {
    return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
  }
  if (typeof key !== 'string' || !key.trim()) {
    return NextResponse.json({ error: 'Paste a key first.' }, { status: 400 });
  }

  await setKey(provider, key);
  return NextResponse.json({ configured: await configuredProviders() });
}

export async function DELETE(request: Request) {
  const provider = new URL(request.url).searchParams.get('provider');

  if (!isProviderId(provider)) {
    return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
  }

  await clearKey(provider);
  return NextResponse.json({ configured: await configuredProviders() });
}
