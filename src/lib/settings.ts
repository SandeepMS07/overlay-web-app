import type { ProviderId } from '@/lib/providers';

/**
 * The settings shape and its defaults, kept free of any Node imports so the
 * client can share them with the server. lib/store.ts adds the filesystem
 * persistence on top; importing that from a client component would drag
 * `node:fs` into the browser bundle.
 */
export type Settings = {
  opacity: number;
  clickThrough: boolean;
  alwaysOnTop: boolean;
  /** Auto-hide the toolbar until the cursor reaches the top of the window. */
  compact: boolean;
  provider: ProviderId;
  /** Per-provider model override; blank falls back to the provider default. */
  models: Partial<Record<ProviderId, string>>;
};

export const DEFAULT_SETTINGS: Settings = {
  // Just off opaque: readable at a glance, with a hint of what is behind it.
  opacity: 0.95,
  clickThrough: false,
  alwaysOnTop: true,
  compact: false,
  provider: 'anthropic',
  models: {},
};
