import React, { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  AlertCircle,
  Download,
  ExternalLink,
  Pause,
  Play,
  Radio,
  Share2,
  ShieldAlert,
  Sparkles,
  Timer,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { FloatingReaction, MediaItem, PlayerProviderType, QualityTier } from '../types';
import { createMediaProviderAdapter } from '../utils/mediaAdapter';

interface AdaptiveVideoPlayerProps {
  item: MediaItem;
  isOfflineMode?: boolean;
  externalIsPlaying?: boolean;
  externalTimeSeconds?: number;
  season?: number;
  episode?: number;
  floatingReactions?: FloatingReaction[];
  onEpisodeChange?: (season: number, episode: number) => void;
  onPlaybackChange?: (isPlaying: boolean, currentTimeSeconds: number) => void;
  onPlaybackProgress?: (currentTimeSeconds: number, durationSeconds: number) => void;
  onTriggerCountdown?: () => void;
  onTriggerDownload: (item: MediaItem, quality: QualityTier) => void;
  onTriggerShare: (item: MediaItem, timestampFormatted: string) => void;
  onClose?: () => void;
  compact?: boolean;
}

export const AdaptiveVideoPlayer: React.FC<AdaptiveVideoPlayerProps> = ({
  item,
  isOfflineMode = false,
  externalIsPlaying,
  externalTimeSeconds,
  season = 1,
  episode = 1,
  floatingReactions = [],
  onEpisodeChange,
  onPlaybackChange,
  onPlaybackProgress,
  onTriggerCountdown,
  onTriggerDownload,
  onTriggerShare,
  onClose,
  compact = false,
}) => {
  const [providerType, setProviderType] = useState<PlayerProviderType>('synced-studio');
  const [selectedSeason, setSelectedSeason] = useState<number>(season || 1);
  const [selectedEpisode, setSelectedEpisode] = useState<number>(episode || 1);
  const [isPlaying, setIsPlaying] = useState<boolean>(externalIsPlaying ?? false);
  const [currentTime, setCurrentTime] = useState<number>(externalTimeSeconds ?? 0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [quickRecapText, setQuickRecapText] = useState<string | null>(null);
  const [recapLoading, setRecapLoading] = useState<boolean>(false);
  const [countdownValue, setCountdownValue] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [availability, setAvailability] = useState<{
    available: boolean;
    status: string;
    sourceType?: 'mp4' | 'hls' | 'external';
    url?: string;
    message?: string;
  } | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const lastPlaybackBroadcastRef = useRef(0);
  const lastProgressSaveRef = useRef(0);
  const playbackChangeRef = useRef(onPlaybackChange);
  const playbackProgressRef = useRef(onPlaybackProgress);
  isPlayingRef.current = isPlaying;
  playbackChangeRef.current = onPlaybackChange;
  playbackProgressRef.current = onPlaybackProgress;

  useEffect(() => {
    let active = true;
    setAvailability(null);
    setSourceError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    const query = item.mediaType === 'movie' ? '' : `?season=${selectedSeason}&episode=${selectedEpisode}`;
    fetch(`/api/media/availability/${encodeURIComponent(item.id)}${query}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Playback availability could not be checked.');
        if (active) setAvailability(result);
      })
      .catch((error) => {
        if (active) setSourceError(error instanceof Error ? error.message : 'Playback availability could not be checked.');
      });
    return () => { active = false; };
  }, [item.id, item.mediaType, selectedSeason, selectedEpisode]);

  useEffect(() => {
    if (availability?.sourceType === 'external') setProviderType('authorized-external');
    else setProviderType('synced-studio');
  }, [availability]);

  const adapter = useMemo(
    () =>
      createMediaProviderAdapter({
        providerType,
        streamUrl: availability?.sourceType === 'mp4' || availability?.sourceType === 'hls' ? availability.url : '',
        mediaType: item.mediaType,
        season: selectedSeason,
        episode: selectedEpisode,
        durationMinutes: item.durationMinutes,
        openOnProviderUrl: availability?.sourceType === 'external' ? availability.url : '',
      }),
    [
      providerType,
      availability?.url,
      availability?.sourceType,
      item.mediaType,
      selectedSeason,
      selectedEpisode,
      item.durationMinutes,
      item.id,
    ]
  );

  const capabilities = adapter.getCapabilities();
  const totalDurationSeconds = availability?.available ? adapter.getDuration() : 0;

  useEffect(() => {
    if (typeof season === 'number' && season !== selectedSeason) {
      setSelectedSeason(season);
    }
    if (typeof episode === 'number' && episode !== selectedEpisode) {
      setSelectedEpisode(episode);
    }
  }, [season, episode]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !availability?.available || !availability.url || availability.sourceType === 'external') return;
    let hls: Hls | null = null;
    if (availability.sourceType === 'hls') {
      if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = availability.url;
      else if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hls.loadSource(availability.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) setSourceError('The authorized HLS source could not be played.');
        });
      } else {
        setSourceError('This browser cannot play the configured HLS source.');
      }
    } else {
      video.src = availability.url;
    }
    adapter.initializePlayer(video);
    const unsubscribe = adapter.onPlaybackEvent((event) => {
      setCurrentTime(event.currentTimeSeconds);
      setIsPlaying(event.type === 'play' ? true : event.type === 'pause' || event.type === 'ended' ? false : isPlayingRef.current);
      if (event.type === 'play' || event.type === 'pause' || event.type === 'seek') {
        playbackChangeRef.current?.(event.type === 'play' ? true : event.type === 'pause' ? false : isPlayingRef.current, event.currentTimeSeconds);
      }
      const now = Date.now();
      if (event.type === 'timeupdate' && now - lastPlaybackBroadcastRef.current >= 2000) {
        lastPlaybackBroadcastRef.current = now;
        playbackChangeRef.current?.(isPlayingRef.current, event.currentTimeSeconds);
      }
      if (event.type === 'timeupdate' && now - lastProgressSaveRef.current >= 15_000) {
        lastProgressSaveRef.current = now;
        playbackProgressRef.current?.(event.currentTimeSeconds, event.durationSeconds);
      }
    });
    return () => {
      unsubscribe();
      adapter.destroy();
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [adapter, availability]);

  // Sync with authoritative Watch Party state using the authorized HTML video element.
  useEffect(() => {
    if (
      adapter.supportsProgrammaticSync &&
      typeof externalIsPlaying === 'boolean' &&
      externalIsPlaying !== isPlaying
    ) {
      if (externalIsPlaying) {
        void adapter.play().catch(() => setSourceError('Playback could not start on this device.'));
      } else {
        adapter.pause();
      }
    }
  }, [externalIsPlaying, adapter]);

  useEffect(() => {
    if (
      adapter.supportsProgrammaticSync &&
      typeof externalTimeSeconds === 'number' &&
      Math.abs(externalTimeSeconds - currentTime) > 2.0
    ) {
      adapter.seekTo(externalTimeSeconds);
    }
  }, [externalTimeSeconds, adapter]);

  const formatTime = (secs: number) => {
    const s = Math.max(0, Math.floor(secs));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const handleTogglePlay = () => {
    if (!availability?.available || availability.sourceType === 'external') return;
    if (isPlaying) adapter.pause();
    else void adapter.play().catch(() => setSourceError('Playback could not start on this device.'));
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(e.target.value);
    setCurrentTime(nextTime);
    adapter.seekTo(nextTime);
  };

  const startManualCountdown = () => {
    onTriggerCountdown?.();
    setCountdownValue(3);
    const timer = window.setInterval(() => {
      setCountdownValue((prev) => {
        if (prev === null || prev <= 1) {
          window.clearInterval(timer);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleRequestQuickRecap = async () => {
    setRecapLoading(true);
    try {
      const resp = await fetch('/api/gemini/quick-recap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          timestampSeconds: currentTime,
        }),
      });
      const data = await resp.json();
      setQuickRecapText(resp.ok ? (data.recap || 'Scene context is unavailable.') : (data.error || 'Scene context is unavailable.'));
    } catch {
      setQuickRecapText('Scene context is unavailable.');
    } finally {
      setRecapLoading(false);
    }
  };

  const providerWatchUrl = adapter.getOpenOnProviderUrl();

  return (
    <div className="bg-slate-950/95 border border-violet-500/20 rounded-2xl overflow-hidden text-slate-100 shadow-2xl">
      {/* Top Player Source, Capability Detection & Episode Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-900/90 border-b border-slate-800/80">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <span className="font-display font-semibold text-base text-white truncate">
            {item.title}
          </span>
          <span
            data-testid="playback-capability-badge"
            className={`px-2 py-0.5 rounded-md text-[11px] font-mono border ${
              availability?.available && availability.sourceType !== 'external'
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
            }`}
          >
            {!availability
              ? 'Checking playback availability'
              : !availability.available
              ? 'Metadata only · unavailable'
              : availability.sourceType === 'external'
              ? 'Authorized external · manual sync'
              : `Authorized ${availability.sourceType?.toUpperCase()} · room sync`}
          </span>

          {item.mediaType !== 'movie' && (
            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
              <label htmlFor={`season-select-${item.id}`} className="text-[11px] text-slate-400">
                S:
              </label>
              <select
                id={`season-select-${item.id}`}
                aria-label="Select Season"
                value={selectedSeason}
                onChange={(e) => {
                  const s = Number(e.target.value);
                  setSelectedSeason(s);
                  onEpisodeChange?.(s, selectedEpisode);
                }}
                className="bg-transparent text-xs font-mono text-violet-300 focus:outline-none cursor-pointer"
              >
                {Array.from({ length: item.seasons || 2 }, (_, i) => i + 1).map((s) => (
                  <option key={s} value={s} className="bg-slate-900">
                    S{s}
                  </option>
                ))}
              </select>
              <span className="text-slate-600">·</span>
              <label htmlFor={`ep-select-${item.id}`} className="text-[11px] text-slate-400">
                Ep:
              </label>
              <select
                id={`ep-select-${item.id}`}
                aria-label="Select Episode"
                value={selectedEpisode}
                onChange={(e) => {
                  const ep = Number(e.target.value);
                  setSelectedEpisode(ep);
                  onEpisodeChange?.(selectedSeason, ep);
                }}
                className="bg-transparent text-xs font-mono text-violet-300 focus:outline-none cursor-pointer"
              >
                {Array.from({ length: item.episodes || 10 }, (_, i) => i + 1).map((ep) => (
                  <option key={ep} value={ep} className="bg-slate-900">
                    E{ep}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {availability?.sourceType === 'external' && providerWatchUrl && (
            <a href={providerWatchUrl} target="_blank" rel="noopener noreferrer" data-testid="open-on-provider-fallback" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:text-white bg-violet-600/20 hover:bg-violet-600/35 border border-violet-500/30 rounded-xl transition-colors whitespace-nowrap shrink-0">
              <span>Open authorized provider</span><ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              Close Player
            </button>
          )}
        </div>
      </div>

      {/* Honest Cross-Origin External Player Sync Limitation & Fallback Notice */}
      {!adapter.supportsProgrammaticSync && adapter.syncLimitationNotice && (
        <div
          data-testid="external-sync-limitation-banner"
          className="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/30 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-200"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{adapter.syncLimitationNotice}</span>
          </div>
          <button type="button" onClick={startManualCountdown} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-100 font-semibold transition-colors"><Timer className="w-3.5 h-3.5" /><span>3-2-1 Room Countdown</span></button>
        </div>
      )}

      {/* Main Video Viewport */}
      <div
        className={`relative bg-black w-full ${
          compact ? 'aspect-video max-h-[380px]' : 'aspect-video max-h-[540px]'
        } flex items-center justify-center overflow-hidden`}
      >
        {availability?.available && availability.sourceType === 'external' ? (
          <div className="w-full h-full p-8 flex flex-col items-center justify-center text-center gap-4 bg-slate-950">
            <ShieldAlert className="w-10 h-10 text-amber-400" />
            <h3 className="text-lg font-display font-bold text-white">External provider playback</h3>
            <p className="text-sm text-slate-300 max-w-lg">This authorized provider runs outside CineTogether. Playback controls and synchronization remain manual.</p>
            {providerWatchUrl && <a href={providerWatchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-slate-950 font-semibold text-xs">Open authorized provider <ExternalLink className="w-4 h-4" /></a>}
          </div>
        ) : availability?.available && availability.url && (availability.sourceType === 'mp4' || availability.sourceType === 'hls') ? (
          <video ref={videoRef} data-testid="adaptive-video" className="w-full h-full object-contain bg-black" controls playsInline muted={isMuted} preload="metadata" aria-label={`Video player for ${item.title}`} />
        ) : (
          <div className="w-full h-full p-8 flex flex-col items-center justify-center text-center gap-3 bg-slate-950">
            <ShieldAlert className="w-10 h-10 text-amber-400" />
            <h3 className="text-lg font-display font-bold text-white">Unavailable for playback</h3>
            <p className="text-sm text-slate-300 max-w-lg">{sourceError || availability?.message || 'No authorized MP4 or HLS source is configured for this catalog item.'}</p>
          </div>
        )}

        {/* Manual 3-2-1 Countdown Overlay */}
        {countdownValue !== null && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center z-20 pointer-events-none">
            <div className="text-xs uppercase tracking-widest text-violet-300 font-semibold mb-2">
              Press Play Together In
            </div>
            <div className="text-6xl font-display font-bold text-white animate-pulse">
              {countdownValue}
            </div>
          </div>
        )}

        {/* Floating Emoji & Heart Reactions Overlay */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
          {floatingReactions.map((r) => (
            <div
              key={r.id}
              style={{ left: `${r.xPercent}%` }}
              className="absolute bottom-8 animate-bounce flex flex-col items-center"
            >
              <span className="text-3xl drop-shadow-lg">{r.emoji}</span>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-950/80 text-slate-200 border border-white/10">
                {r.userName}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Scrubber & Transport Controls */}
      <div className="p-4 bg-slate-900/95 border-t border-slate-800/80 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono tabular-nums text-slate-300 w-14">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            aria-label="Seek video timeline"
            min={0}
            max={Math.max(1, totalDurationSeconds)}
            value={currentTime}
            disabled={!availability?.available || availability.sourceType === 'external'}
            onChange={handleSeek}
            className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500 disabled:opacity-40"
          />
          <span className="text-xs font-mono tabular-nums text-slate-400 w-14 text-right">
            {formatTime(totalDurationSeconds)}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleTogglePlay}
              disabled={!availability?.available || availability.sourceType === 'external'}
              aria-label={isPlaying ? 'Pause video' : 'Play video'}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 disabled:opacity-40 text-white font-semibold text-xs rounded-xl transition-all whitespace-nowrap shrink-0 shadow-md"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              <span>{isPlaying ? 'Pause Sync' : 'Play Sync'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsMuted(!isMuted)}
              aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
              className="p-2 text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 rounded-xl transition-colors"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={handleRequestQuickRecap}
              disabled={recapLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-violet-400" />
              <span>{recapLoading ? 'Summarizing...' : 'Scene Recap'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled
              title="Offline downloads are not implemented for this backend."
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 text-slate-400 rounded-xl whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" /><span>Offline unavailable</span>
            </button>

            <button
              type="button"
              onClick={() => onTriggerShare(item, formatTime(currentTime))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Share Moment</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-mono tabular-nums">
              {capabilities.providerLabel} ·{' '}
              {capabilities.supportsProgrammaticSync
                ? availability?.available ? `${availability.sourceType?.toUpperCase()} source` : 'No authorized source'
                : 'Manual Room Coordination'}
            </span>
          </div>
        </div>

        {quickRecapText && (
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-mono text-violet-400">
                Scene Context · Timestamp {formatTime(currentTime)}
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{quickRecapText}</p>
            </div>
            <button
              type="button"
              onClick={() => setQuickRecapText(null)}
              className="text-xs text-slate-400 hover:text-white shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
