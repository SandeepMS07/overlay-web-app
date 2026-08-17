import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';

/**
 * Single-user local persistence. Electron passes its userData directory as
 * APP_DATA_DIR; running `next dev` on its own falls back to ./.data so the
 * backend works without Electron.
 *
 * API keys deliberately do not live here — see lib/secrets.ts.
 */
const dataDir = process.env.APP_DATA_DIR || path.join(process.cwd(), '.data');

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

export async function getSettings(): Promise<Settings> {
  const stored = await readJson<Record<string, unknown>>('settings.json', {});

  // Keep only fields the current Settings shape defines, so keys left behind by
  // removed features (the old video player's volume/autoplay/lastVideoId) are
  // dropped rather than carried forward on the next save.
  const known: Partial<Settings> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (key in stored) (known as Record<string, unknown>)[key] = stored[key];
  }

  return { ...DEFAULT_SETTINGS, ...known };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await writeJson('settings.json', next);
  return next;
}

export function getDataDir(): string {
  return dataDir;
}
