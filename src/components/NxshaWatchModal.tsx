import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import type { MediaItem } from '../types';
import { buildNxshaEmbedUrl } from '../utils/nxshaEmbed';

export interface NxshaPlaybackRequest {
  item: MediaItem;
  season?: number;
  episode?: number;
}

interface NxshaWatchModalProps {
  request: NxshaPlaybackRequest;
  language: string;
  onLanguageChange: (language: string) => void;
  onClose: () => void;
}

const LANGUAGE_OPTIONS = [
  ['eng', 'English'],
  ['hindi', 'Hindi'],
  ['french', 'French'],
] as const;

type PlayerFrameStatus = 'connecting' | 'responded' | 'unavailable';

export const NxshaWatchModal: React.FC<NxshaWatchModalProps> = ({
  request,
  language,
  onLanguageChange,
  onClose,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [frameStatus, setFrameStatus] = useState<PlayerFrameStatus>('connecting');
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [playerAttempt, setPlayerAttempt] = useState(0);

  const mediaType = request.item.mediaType === 'movie' || request.item.mediaType === 'tv'
    ? request.item.mediaType
    : null;
  const embedUrl = mediaType
    ? buildNxshaEmbedUrl({
        tmdbId: request.item.tmdbId,
        mediaType,
        season: request.season,
        episode: request.episode,
        language,
      })
    : null;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    setFrameStatus(embedUrl ? 'connecting' : 'unavailable');
    if (embedUrl) {
      timeoutRef.current = setTimeout(() => setFrameStatus('unavailable'), 15_000);
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };
  }, [embedUrl]);

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame || !embedUrl) return;
    const onFrameError = () => {
      clearTimeout(timeoutRef.current ?? undefined);
      timeoutRef.current = null;
      setFrameStatus('unavailable');
    };
    frame.addEventListener('error', onFrameError);
    return () => frame.removeEventListener('error', onFrameError);
  }, [embedUrl, playerAttempt]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const clearLoadTimeout = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  };

  const retryPlayer = () => {
    if (!embedUrl) return;
    clearLoadTimeout();
    setFrameStatus('connecting');
    timeoutRef.current = setTimeout(() => setFrameStatus('unavailable'), 15_000);
    setPlayerAttempt((attempt) => attempt + 1);
  };

  const toggleFullscreen = async () => {
    setFullscreenError(null);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (playerRef.current?.requestFullscreen) {
        await playerRef.current.requestFullscreen();
      } else {
        setFullscreenError('Fullscreen is not available in this browser.');
      }
    } catch {
      setFullscreenError('Fullscreen could not be opened. Use the player controls if available.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/90 p-2 backdrop-blur-md sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="nxsha-watch-title"
        className="max-h-[calc(100dvh-1rem)] w-full max-w-6xl overflow-y-auto rounded-2xl border border-violet-500/30 bg-slate-950 shadow-2xl shadow-black/60 sm:max-h-[calc(100dvh-2.5rem)] sm:rounded-3xl"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-[#121026] to-slate-900 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-violet-300">Watch Now · Nxsha Player</p>
            <h2 id="nxsha-watch-title" className="truncate text-base font-display font-bold text-white sm:text-xl">
              {request.item.title}
              {request.season !== undefined && request.episode !== undefined
                ? ` · S${request.season} E${request.episode}`
                : ''}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-[11px] text-slate-400 sm:text-xs">
              <span>Language</span>
              <select
                aria-label="Player language preference"
                value={language}
                onChange={(event) => onLanguageChange(event.target.value)}
                className="max-w-28 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white outline-none focus:border-violet-400"
              >
                {LANGUAGE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              disabled={!embedUrl}
              aria-label="Toggle player fullscreen"
              className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200 transition hover:border-violet-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close Watch Now player"
              className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200 transition hover:border-rose-400 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div ref={playerRef} className="relative aspect-video max-h-[calc(100dvh-11rem)] w-full bg-black">
          {embedUrl ? (
            <iframe
              key={`${embedUrl}:${playerAttempt}`}
              ref={iframeRef}
              src={embedUrl}
              title={`Nxsha player for ${request.item.title}`}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              loading="eager"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => {
                clearLoadTimeout();
                setFrameStatus('responded');
              }}
              className="absolute inset-0 h-full w-full border-0"
            />
          ) : null}
          {!embedUrl && (
            <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm font-semibold text-white">Player request is unavailable</p>
              <p className="max-w-lg text-xs leading-relaxed text-slate-300">
                A valid TMDB ID is required. TV playback also requires a valid season and episode. No player URL was sent.
              </p>
            </div>
          )}
          {embedUrl && frameStatus === 'connecting' && (
            <div role="status" className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-slate-950/85 px-3 py-2 text-[11px] text-slate-200">
              Connecting to Nxsha. Playback availability is not confirmed.
            </div>
          )}
          {embedUrl && frameStatus === 'responded' && (
            <div role="status" className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950/90 px-3 py-2 text-[11px] text-slate-200 sm:inset-x-6">
              <span>Player frame responded, but playback is unverified. If the title does not start, Nxsha may not have it or may restrict embedding.</span>
              <button type="button" onClick={retryPlayer} className="shrink-0 rounded-md border border-slate-600 px-2.5 py-1 font-semibold hover:border-violet-400">Retry player</button>
            </div>
          )}
          {embedUrl && frameStatus === 'unavailable' && (
            <div role="alert" className="absolute inset-x-3 bottom-3 rounded-xl border border-amber-400/40 bg-slate-950/95 p-3 text-xs text-slate-200 sm:inset-x-6 sm:bottom-6 sm:p-4">
              <p>The Nxsha player did not confirm availability. The title may be unavailable, or embedding may be restricted. Check your Nxsha access or try again later.</p>
              <button type="button" onClick={retryPlayer} className="mt-2 rounded-md border border-amber-300/50 px-3 py-1.5 font-semibold hover:bg-amber-300/10">Retry player</button>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-4 py-3 sm:px-6">
          <p className="max-w-3xl text-[10px] leading-relaxed text-slate-400 sm:text-xs">
            Playback is hosted by Nxsha. Constructing this embed does not confirm a stream is available or change the TMDB metadata-only status.
          </p>
          {fullscreenError && <p role="status" className="text-[11px] text-amber-300">{fullscreenError}</p>}
        </footer>
      </section>
    </div>
  );
};
