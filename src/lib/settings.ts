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
  /** Let the model search the web before answering. */
  webSearch: boolean;
  provider: ProviderId;
  /** The cloud provider to return to when the offline switch is turned off. */
  cloudProvider: ProviderId;
  /** Per-provider model override; blank falls back to the provider default. */
  models: Partial<Record<ProviderId, string>>;
};

export const DEFAULT_SETTINGS: Settings = {
  // Just off opaque: readable at a glance, with a hint of what is behind it.
  opacity: 0.95,
  clickThrough: false,
  alwaysOnTop: true,
  compact: false,
  // Off by default: searching costs more and adds latency, and most questions
  // in a scratch overlay do not need it.
  webSearch: false,
  provider: 'anthropic',
  cloudProvider: 'anthropic',
  models: {},
};
