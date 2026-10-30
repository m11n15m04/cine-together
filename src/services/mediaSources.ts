export type AuthorizedMediaSource =
  | { type: 'mp4' | 'hls'; url: string; host: string }
  | { type: 'external'; url: string; host: string };

type ConfiguredSource = { type: string; url: string };
const MEDIA_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;

let parsedSources: Map<string, AuthorizedMediaSource> | null = null;

function allowedHosts(raw = process.env.AUTHORIZED_MEDIA_HOSTS || ''): string[] {
  return raw
    .split(',')
    .map((host) => host.trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

function hostAllowed(host: string, allowList: string[]): boolean {
  return allowList.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function validateSource(value: unknown, id: string, allowList: string[]): AuthorizedMediaSource {
  if (!value || typeof value !== 'object') throw new Error(`Invalid authorized media source for ${id}.`);
  const source = value as ConfiguredSource;
  if (!['mp4', 'hls', 'external'].includes(source.type) || typeof source.url !== 'string') {
    throw new Error(`Invalid authorized media source for ${id}.`);
  }

  const url = new URL(source.url);
  const isLocalDevUrl = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalDevUrl)) {
    throw new Error(`Media source ${id} must use HTTPS outside local development.`);
  }
  if (url.username || url.password || !hostAllowed(url.hostname.toLowerCase(), allowList)) {
    throw new Error(`Media source ${id} uses a host or URL credential that is not allowed.`);
  }

  if (source.type === 'mp4' && !/\.mp4$/i.test(url.pathname)) {
    throw new Error(`MP4 source ${id} must use a .mp4 URL.`);
  }
  if (source.type === 'hls' && !/\.m3u8$/i.test(url.pathname)) {
    throw new Error(`HLS source ${id} must use a .m3u8 URL.`);
  }
  if (source.type === 'external' && !['https:', 'http:'].includes(url.protocol)) {
    throw new Error(`External source ${id} must use an HTTP URL.`);
  }

  return { type: source.type as AuthorizedMediaSource['type'], url: url.toString(), host: url.hostname };
}

export function getAuthorizedMediaSources(): Map<string, AuthorizedMediaSource> {
  if (parsedSources) return parsedSources;
  const raw = process.env.AUTHORIZED_MEDIA_SOURCES_JSON?.trim() || '{}';
  parsedSources = parseAuthorizedMediaSources(raw, process.env.AUTHORIZED_MEDIA_HOSTS || '');
  return parsedSources;
}

export function parseAuthorizedMediaSources(raw: string, rawHosts: string): Map<string, AuthorizedMediaSource> {
  if (Buffer.byteLength(raw) > 256_000) throw new Error('AUTHORIZED_MEDIA_SOURCES_JSON is too large.');
  let config: Record<string, unknown>;
  try { config = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error('AUTHORIZED_MEDIA_SOURCES_JSON must be valid JSON.'); }
  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error('AUTHORIZED_MEDIA_SOURCES_JSON must be an object keyed by media ID.');
  }

  const hosts = allowedHosts(rawHosts);
  const sources = new Map<string, AuthorizedMediaSource>();
  if (Object.keys(config).length > 0 && hosts.length === 0) {
    throw new Error('AUTHORIZED_MEDIA_HOSTS must be set when authorized media sources are configured.');
  }
  for (const [id, value] of Object.entries(config)) {
    if (!MEDIA_ID_PATTERN.test(id)) throw new Error(`Invalid media ID in source configuration: ${id}.`);
    sources.set(id, validateSource(value, id, hosts));
  }
  return sources;
}

export function getAuthorizedMediaSource(mediaId: string): AuthorizedMediaSource | null {
  if (!MEDIA_ID_PATTERN.test(mediaId)) return null;
  return getAuthorizedMediaSources().get(mediaId) || null;
}

export function assertMediaSourceConfiguration(): void {
  getAuthorizedMediaSources();
}
