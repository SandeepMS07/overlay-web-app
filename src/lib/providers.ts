export type ProviderId = 'anthropic' | 'openai' | 'gemini';

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  /** Default model; every provider also accepts a free-text model override. */
  defaultModel: string;
  /** Where the user gets a key, shown in the settings panel. */
  keyUrl: string;
  keyHint: string;
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
  },
  openai: {
    id: 'openai',
    label: 'ChatGPT',
    defaultModel: 'gpt-4o',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-…',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    defaultModel: 'gemini-2.0-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && value in PROVIDERS;
}

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};
