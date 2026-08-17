const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Accepts anything a user is likely to paste: a full watch URL, youtu.be
 * short link, /embed/ or /shorts/ path, or a bare 11-character video id.
 * Returns null when nothing usable is found.
 */
export function parseVideoId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (ID_PATTERN.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value.startsWith('http') ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return ID_PATTERN.test(id) ? id : null;
  }

  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null;

  const v = url.searchParams.get('v');
  if (v && ID_PATTERN.test(v)) return v;

  const segments = url.pathname.split('/').filter(Boolean);
  const marker = segments.findIndex((s) => ['embed', 'shorts', 'live', 'v'].includes(s));
  if (marker !== -1) {
    const id = segments[marker + 1];
    if (id && ID_PATTERN.test(id)) return id;
  }

  return null;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}
