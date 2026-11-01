export interface NxshaEmbedRequest {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
  language?: string;
}

const NXSHA_EMBED_URL = 'https://nxsha.screenscape.me/embed';

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Build a URL for Nxsha's published player interface; this does not verify playback availability. */
export function buildNxshaEmbedUrl(request: NxshaEmbedRequest): string | null {
  if (!isPositiveSafeInteger(request.tmdbId)) return null;
  if (request.mediaType !== 'movie' && request.mediaType !== 'tv') return null;

  const params = new URLSearchParams();
  params.set('tmdb', String(request.tmdbId));
  params.set('type', request.mediaType);

  if (request.mediaType === 'tv') {
    if (!isPositiveSafeInteger(request.season) || !isPositiveSafeInteger(request.episode)) return null;
    params.set('s', String(request.season));
    params.set('e', String(request.episode));
  }

  if (request.language !== undefined) {
    const language = request.language.trim();
    if (language.length > 32) return null;
    if (language) params.set('lan', language);
  }

  return `${NXSHA_EMBED_URL}?${params.toString()}`;
}
