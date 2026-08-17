import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProviderId } from '@/lib/providers';

/**
 * Single-user local persistence. Electron passes its userData directory as
 * APP_DATA_DIR; running `next dev` on its own falls back to ./.data so the
 * backend works without Electron.
 */
const dataDir = process.env.APP_DATA_DIR || path.join(process.cwd(), '.data');

export type Track = {
  id: string;
  videoId: string;
  title: string;
  author?: string;
  thumbnail?: string;
  addedAt: number;
};

export type Settings = {
  opacity: number;
  clickThrough: boolean;
  alwaysOnTop: boolean;
  volume: number;
  autoplay: boolean;
  compact: boolean;
  lastVideoId: string | null;
  /** Which panel the overlay shows. Chat is the default. */
  mode: 'chat' | 'video';
  provider: ProviderId;
  /** Per-provider model override; blank falls back to the provider default. */
  models: Partial<Record<ProviderId, string>>;
};

export const DEFAULT_SETTINGS: Settings = {
  // Semi-transparent by default so whatever sits behind the overlay stays
  // readable through it.
  opacity: 0.6,
  clickThrough: false,
  alwaysOnTop: true,
  volume: 60,
  autoplay: true,
  compact: false,
  lastVideoId: null,
  mode: 'chat',
  provider: 'anthropic',
  models: {},
};

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    // turbopackIgnore keeps the bundler from tracing the entire project just
    // because dataDir is resolved at runtime.
    const raw = await fs.readFile(path.join(/* turbopackIgnore: true */ dataDir, file), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const target = path.join(/* turbopackIgnore: true */ dataDir, file);
  // Write-then-rename so a crash mid-write cannot truncate the existing file.
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, target);
}

export async function getLibrary(): Promise<Track[]> {
  const tracks = await readJson<Track[]>('library.json', []);
  return Array.isArray(tracks) ? tracks : [];
}

export async function saveLibrary(tracks: Track[]): Promise<void> {
  await writeJson('library.json', tracks);
}

export async function getSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>('settings.json', {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await writeJson('settings.json', next);
  return next;
}

export function getDataDir(): string {
  return dataDir;
}
