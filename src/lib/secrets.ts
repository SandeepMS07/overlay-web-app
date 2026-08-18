import fs from 'node:fs/promises';
import path from 'node:path';
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from '@/lib/providers';

/**
 * API keys live in their own file, separate from settings.json, written with
 * owner-only permissions (0600). They are read server-side to call the provider
 * and are never sent to the browser — the UI only ever learns whether a key is
 * present, not what it is.
 *
 * This is plaintext on disk. It is the same trust model as a ~/.netrc or a CLI
 * config file: anything running as this user can read it. Do not use a key here
 * that you would not put in a dotfile.
 */
const dataDir = process.env.APP_DATA_DIR || path.join(process.cwd(), '.data');
const KEY_FILE = 'keys.json';

type KeyStore = Partial<Record<ProviderId, string>>;

async function readKeys(): Promise<KeyStore> {
  try {
    const raw = await fs.readFile(path.join(/* turbopackIgnore: true */ dataDir, KEY_FILE), 'utf8');
    const parsed = JSON.parse(raw) as KeyStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeKeys(keys: KeyStore): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const target = path.join(/* turbopackIgnore: true */ dataDir, KEY_FILE);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(keys, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, target);
  // rename preserves the temp file's mode, but be explicit in case the file
  // already existed with looser permissions.
  await fs.chmod(target, 0o600).catch(() => {});
}

/** The raw key for a provider — server-side only. Never return this to the UI. */
export async function getKey(provider: ProviderId): Promise<string | null> {
  // Local models authenticate against nothing; the caller still needs a string
  // so the Authorization header is well-formed.
  if (!PROVIDERS[provider].requiresKey) return 'local';
  const fromEnv = process.env[`${provider.toUpperCase()}_API_KEY`];
  if (fromEnv) return fromEnv;
  return (await readKeys())[provider] ?? null;
}

export async function setKey(provider: ProviderId, key: string): Promise<void> {
  const keys = await readKeys();
  const trimmed = key.trim();
  if (trimmed) keys[provider] = trimmed;
  else delete keys[provider];
  await writeKeys(keys);
}

export async function clearKey(provider: ProviderId): Promise<void> {
  const keys = await readKeys();
  delete keys[provider];
  await writeKeys(keys);
}

/** Which providers have a usable key, without revealing any of them. */
export async function configuredProviders(): Promise<ProviderId[]> {
  const keys = await readKeys();
  const ids = new Set<ProviderId>();
  for (const [id, value] of Object.entries(keys)) {
    if (value) ids.add(id as ProviderId);
  }
  for (const id of PROVIDER_IDS) {
    // A keyless provider is always "configured" — there is nothing to set up.
    if (!PROVIDERS[id].requiresKey || process.env[`${id.toUpperCase()}_API_KEY`]) ids.add(id);
  }
  return [...ids];
}
