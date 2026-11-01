import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import type { MediaItem } from '../src/types.ts';
import { NxshaWatchModal, type NxshaPlaybackRequest } from '../src/components/NxshaWatchModal.tsx';
import { buildNxshaEmbedUrl } from '../src/utils/nxshaEmbed.ts';

const movieRequest: NxshaPlaybackRequest = {
  item: {
    id: 'tmdb:movie:603',
    tmdbId: 603,
    title: 'The Matrix',
    mediaType: 'movie',
  } as MediaItem,
};

function createDomGlobals(dom: JSDOM): () => void {
  const values: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  };
}

test('Nxsha embed URLs use the published host and required movie and episode parameters', () => {
  const movieUrl = buildNxshaEmbedUrl({ tmdbId: 603, mediaType: 'movie', language: 'eng' });
  assert.ok(movieUrl);
  const movie = new URL(movieUrl);
  assert.equal(movie.origin, 'https://nxsha.screenscape.me');
  assert.equal(movie.pathname, '/embed');
  assert.deepEqual([...movie.searchParams], [['tmdb', '603'], ['type', 'movie'], ['lan', 'eng']]);

  const tvUrl = buildNxshaEmbedUrl({
    tmdbId: 1396,
    mediaType: 'tv',
    season: 2,
    episode: 5,
    language: 'hindi',
  });
  assert.ok(tvUrl);
  const tv = new URL(tvUrl);
  assert.deepEqual([...tv.searchParams], [
    ['tmdb', '1396'], ['type', 'tv'], ['s', '2'], ['e', '5'], ['lan', 'hindi'],
  ]);
});

test('Nxsha URL builder rejects missing TMDB IDs and invalid TV episode coordinates', () => {
  assert.equal(buildNxshaEmbedUrl({ tmdbId: 0, mediaType: 'movie' }), null);
  assert.equal(buildNxshaEmbedUrl({ tmdbId: 1.5, mediaType: 'movie' }), null);
  assert.equal(buildNxshaEmbedUrl({ tmdbId: 1396, mediaType: 'tv', episode: 1 }), null);
  assert.equal(buildNxshaEmbedUrl({ tmdbId: 1396, mediaType: 'tv', season: 0, episode: 1 }), null);
  assert.equal(buildNxshaEmbedUrl({ tmdbId: 1396, mediaType: 'tv', season: 1, episode: -1 }), null);
});

test('Watch Now opens, changes language, handles player failure, and removes the iframe on close', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const restoreGlobals = createDomGlobals(dom);
  const { createRoot } = await import('react-dom/client');
  const rootElement = dom.window.document.getElementById('root');
  assert.ok(rootElement);
  const root = createRoot(rootElement);

  function Harness() {
    const [request, setRequest] = useState<NxshaPlaybackRequest | null>(null);
    const [language, setLanguage] = useState('eng');
    return React.createElement(React.Fragment, null,
      React.createElement('button', { type: 'button', onClick: () => setRequest(movieRequest) }, 'Play'),
      request && React.createElement(NxshaWatchModal, {
        request,
        language,
        onLanguageChange: setLanguage,
        onClose: () => setRequest(null),
      }),
    );
  }

  try {
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => {
      dom.window.document.querySelector('button')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert.ok(dom.window.document.querySelector('[role="dialog"]'));
    let iframe = dom.window.document.querySelector('iframe');
    assert.ok(iframe);
    assert.equal(iframe.src, 'https://nxsha.screenscape.me/embed?tmdb=603&type=movie&lan=eng');

    await act(async () => {
      const select = dom.window.document.querySelector('select');
      assert.ok(select);
      Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')?.set?.call(select, 'hindi');
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    iframe = dom.window.document.querySelector('iframe');
    assert.ok(iframe);
    assert.equal(new URL(iframe.src).searchParams.get('lan'), 'hindi');

    await act(async () => {
      iframe?.dispatchEvent(new dom.window.ErrorEvent('error', { bubbles: true, cancelable: true }));
    });
    assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent || '', /did not confirm availability/);

    await act(async () => {
      dom.window.document.querySelector('[aria-label="Close Watch Now player"]')
        ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
    assert.equal(dom.window.document.querySelector('iframe'), null);
  } finally {
    await act(async () => root.unmount());
    restoreGlobals();
  }
});

test('Watch Now shows a fallback and does not create an iframe for an invalid TMDB ID', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const restoreGlobals = createDomGlobals(dom);
  const { createRoot } = await import('react-dom/client');
  const rootElement = dom.window.document.getElementById('root');
  assert.ok(rootElement);
  const root = createRoot(rootElement);
  const invalidRequest: NxshaPlaybackRequest = {
    item: { ...movieRequest.item, tmdbId: 0 },
  };

  try {
    await act(async () => root.render(React.createElement(NxshaWatchModal, {
      request: invalidRequest,
      language: 'eng',
      onLanguageChange: () => {},
      onClose: () => {},
    })));
    assert.equal(dom.window.document.querySelector('iframe'), null);
    assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent || '', /valid TMDB ID is required/);
  } finally {
    await act(async () => root.unmount());
    restoreGlobals();
  }
});
