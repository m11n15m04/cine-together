import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
delete process.env.AUTHORIZED_MEDIA_SOURCES_JSON;
delete process.env.AUTHORIZED_MEDIA_HOSTS;
const { getAuthorizedMediaSource, parseAuthorizedMediaSources } = await import('./mediaSources.ts');

test('metadata-only media remains unavailable without a configured authorized source', () => {
  assert.equal(getAuthorizedMediaSource('film-1'), null);
});

test('media source configuration enforces explicit host allowlists and file types', () => {
  const mp4 = JSON.stringify({ 'film-1': { type: 'mp4', url: 'https://media.example.test/film.mp4' } });
  assert.throws(() => parseAuthorizedMediaSources(mp4, ''), /AUTHORIZED_MEDIA_HOSTS must be set/);

  assert.throws(() => parseAuthorizedMediaSources(
    JSON.stringify({ 'film-1': { type: 'hls', url: 'https://media.example.test/film.mp4' } }), 'example.test',
  ), /must use a \.m3u8 URL/);

  assert.throws(() => parseAuthorizedMediaSources(
    JSON.stringify({ 'film-1': { type: 'mp4', url: 'https://unapproved.invalid/film.mp4' } }), 'example.test',
  ), /host or URL credential that is not allowed/);
});

test('authorized MP4 and HLS sources are returned only for allowlisted hosts', () => {
  const sources = parseAuthorizedMediaSources(JSON.stringify({
    'film-1': { type: 'mp4', url: 'https://media.example.test/film.mp4' },
    'episode-1': { type: 'hls', url: 'https://cdn.example.test/episode.m3u8' },
  }), 'example.test');
  assert.equal(sources.get('film-1')?.type, 'mp4');
  assert.equal(sources.get('episode-1')?.type, 'hls');
});
