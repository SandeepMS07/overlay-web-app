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
  /** Answer in the first person as the user, from their own documents. */
  speakAsMe: boolean;
  /**
   * The user's own name, used only by first-person mode. Without it a model
   * asked to speak as "you" has no identity to anchor to and will invent one.
   */
  me: string;
  /** Which top-level panel is showing. */
  tab: 'chat' | 'browser' | 'docs';
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
  speakAsMe: false,
  // Blank by default: this is the one genuinely personal field in the file,
  // and nobody else's install should ship with a name in it.
  me: '',
  tab: 'chat',
  provider: 'anthropic',
  cloudProvider: 'anthropic',
  models: {},
};
