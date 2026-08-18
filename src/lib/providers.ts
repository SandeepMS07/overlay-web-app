export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'local';

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  /** Default model; every provider also accepts a free-text model override. */
  defaultModel: string;
  /** Where the user gets a key (or a model), shown in the settings panel. */
  keyUrl: string;
  keyHint: string;
  /** False for providers that run on this machine and need no credential. */
  requiresKey: boolean;
  /** True when the provider runs locally and never reaches the internet. */
  offline: boolean;
};

/**
 * Model IDs are a starting point, not a fixed list — each provider ships new
 * ones constantly, so the UI lets you type any model your account can use.
 */
export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Claude',
    defaultModel: 'claude-opus-5',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyHint: 'sk-ant-…',
    requiresKey: true,
    offline: false,
  },
  openai: {
    id: 'openai',
    label: 'ChatGPT',
    defaultModel: 'gpt-5.6-terra',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-…',
    requiresKey: true,
    offline: false,
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    defaultModel: 'gemini-3.7-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
    requiresKey: true,
    offline: false,
  },
  local: {
    id: 'local',
    label: 'Local',
    // Whatever you have pulled — `ollama list` prints the valid names.
    defaultModel: 'qwen3:30b-a3b',
    keyUrl: 'https://ollama.com/library',
    keyHint: 'no key needed',
    requiresKey: false,
    offline: true,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

/** The providers that talk to somebody else's server. */
export const CLOUD_PROVIDER_IDS = PROVIDER_IDS.filter((id) => !PROVIDERS[id].offline);

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && value in PROVIDERS;
}

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};
