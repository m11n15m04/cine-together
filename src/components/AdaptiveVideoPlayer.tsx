import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Download,
  ExternalLink,
  Maximize,
  Minimize,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Share2,
  ShieldAlert,
  Sparkles,
  Subtitles,
  Timer,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import Hls from 'hls.js';
import { FloatingReaction, MediaItem, PlayerProviderType, QualityTier } from '../types';
import { calculateAdaptiveBitrate } from '../utils/streamEngine';
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
  onTriggerCountdown?: () => void;
  onTriggerDownload: (item: MediaItem, quality: QualityTier) => void;
  onTriggerShare: (item: MediaItem, timestampFormatted: string) => void;
  onClose?: () => void;
  compact?: boolean;
}

const SUBTITLE_CUES = [
  'Signal locked from CineTogether synchronized cinema relay...',
  'Notice the rain reflections across the Kyoto temple courtyard.',
  'Telemetry confirms chronological alignment across both screens.',
  'Hold position—acoustic resonance approaching the main theme.',
  'Different places. One screen. Shared moments.',
];

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
  onTriggerCountdown,
  onTriggerDownload,
  onTriggerShare,
  onClose,
  compact = false,
}) => {
  // Determine if a verified genuine studio source is available for this title
  const hasAuthorizedStudioSource = Boolean(
    item.authorizedPlaybackSource ||
      item.hlsUrl ||
      (item.streamUrl &&
        item.streamUrl.startsWith('http') &&
        !item.streamUrl.includes('/api/media/stream/')) ||
      item.playbackStatus === 'synced-ready'
  );

  // Preferred initial provider
  const initialProvider: PlayerProviderType = hasAuthorizedStudioSource
    ? 'synced-studio'
    : 'nxsha-embed';

  const [providerType, setProviderType] = useState<PlayerProviderType>(initialProvider);
  const [selectedSeason, setSelectedSeason] = useState<number>(season || 1);
  const [selectedEpisode, setSelectedEpisode] = useState<number>(episode || 1);

  // Video playback states
  const [isPlaying, setIsPlaying] = useState<boolean>(externalIsPlaying ?? false);
  const [currentTime, setCurrentTime] = useState<number>(externalTimeSeconds ?? 0);
  const [duration, setDuration] = useState<number>(item.durationMinutes * 60 || 7200);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [subtitlesOn, setSubtitlesOn] = useState<boolean>(false);
  const [qualityPref, setQualityPref] = useState<QualityTier | 'auto'>('auto');
  const [bandwidthMbps, setBandwidthMbps] = useState<number>(24.6);
  const [isDataSaver, setIsDataSaver] = useState<boolean>(false);

  // Video element and container states
  const [isVideoLoading, setIsVideoLoading] = useState<boolean>(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Iframe states
  const [iframeLoading, setIframeLoading] = useState<boolean>(true);
  const [showEmbedFallbackCard, setShowEmbedFallbackCard] = useState<boolean>(false);

  // Features and dialogs
  const [quickRecapText, setQuickRecapText] = useState<string | null>(null);
  const [recapLoading, setRecapLoading] = useState<boolean>(false);
  const [downloadTriggered, setDownloadTriggered] = useState<boolean>(false);
  const [countdownValue, setCountdownValue] = useState<number | null>(null);

  // Refs
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const isSyncingFromExternal = useRef<boolean>(false);

  // Resolved video stream URL
  const activeVideoSource = useMemo(() => {
    if (item.hlsUrl) return item.hlsUrl;
    if (item.authorizedPlaybackSource) return item.authorizedPlaybackSource;
    if (
      item.streamUrl &&
      item.streamUrl.startsWith('http') &&
      !item.streamUrl.includes('/api/media/stream/')
    ) {
      return item.streamUrl;
    }
    return '';
  }, [item.hlsUrl, item.authorizedPlaybackSource, item.streamUrl]);

  // MediaProviderAdapter instantiation
  const adapter = useMemo(
    () =>
      createMediaProviderAdapter({
        providerType,
        streamUrl: activeVideoSource || item.streamUrl,
        mediaType: item.mediaType,
        tmdbId: item.tmdbId,
        season: selectedSeason,
        episode: selectedEpisode,
        durationMinutes: item.durationMinutes,
        openOnProviderUrl: item.nxshaWatchUrl,
      }),
    [
      providerType,
      activeVideoSource,
      item.streamUrl,
      item.mediaType,
      item.tmdbId,
      selectedSeason,
      selectedEpisode,
      item.durationMinutes,
      item.nxshaWatchUrl,
    ]
  );

  const capabilities = adapter.getCapabilities();
  const abrDecision = calculateAdaptiveBitrate(bandwidthMbps, qualityPref, isDataSaver);

  // Sync state if item changes
  useEffect(() => {
    if (!hasAuthorizedStudioSource && providerType === 'synced-studio') {
      setProviderType('nxsha-embed');
    }
    setVideoError(null);
    setIsVideoLoading(true);
    setIframeLoading(true);
  }, [item.id, hasAuthorizedStudioSource]);

  useEffect(() => {
    if (typeof season === 'number' && season !== selectedSeason) {
      setSelectedSeason(season);
    }
    if (typeof episode === 'number' && episode !== selectedEpisode) {
      setSelectedEpisode(episode);
    }
  }, [season, episode]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Initialize and attach Hls.js or Native HTML5 Video
  useEffect(() => {
    if (providerType !== 'synced-studio') {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const videoEl = videoRef.current;
    if (!videoEl || !activeVideoSource) {
      setIsVideoLoading(false);
      return;
    }

    setIsVideoLoading(true);
    setVideoError(null);

    // Clean up previous HLS instance if any
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHlsSource =
      activeVideoSource.includes('.m3u8') ||
      activeVideoSource.includes('mux.dev') ||
      item.hlsUrl === activeVideoSource;

    if (isHlsSource) {
      if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        // Native Safari / iOS HLS support
        videoEl.src = activeVideoSource;
      } else if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90,
        });
        hlsRef.current = hls;
        hls.loadSource(activeVideoSource);
        hls.attachMedia(videoEl);

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                setVideoError(`HLS stream playback failed: ${data.details || 'Network error'}`);
                setIsVideoLoading(false);
                break;
            }
          }
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsVideoLoading(false);
          setVideoError(null);
        });
      } else {
        setVideoError('Your browser does not support HLS adaptive video streaming.');
        setIsVideoLoading(false);
      }
    } else {
      // Direct MP4 / WebM stream
      videoEl.src = activeVideoSource;
    }

    // Attach adapter for room lifecycle
    adapter.initializePlayer(videoEl);

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      adapter.destroy();
    };
  }, [providerType, activeVideoSource, retryNonce]);

  // Synchronize with authoritative Watch Party WebSocket state
  useEffect(() => {
    if (providerType !== 'synced-studio') return;
    const video = videoRef.current;
    if (!video) return;

    if (typeof externalIsPlaying === 'boolean' && externalIsPlaying !== isPlaying) {
      isSyncingFromExternal.current = true;
      setIsPlaying(externalIsPlaying);
      if (externalIsPlaying) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
      setTimeout(() => {
        isSyncingFromExternal.current = false;
      }, 300);
    }
  }, [externalIsPlaying, providerType]);

  useEffect(() => {
    if (providerType !== 'synced-studio') return;
    const video = videoRef.current;
    if (!video) return;

    if (
      typeof externalTimeSeconds === 'number' &&
      Math.abs(video.currentTime - externalTimeSeconds) > 2.0
    ) {
      isSyncingFromExternal.current = true;
      video.currentTime = externalTimeSeconds;
      setCurrentTime(externalTimeSeconds);
      setTimeout(() => {
        isSyncingFromExternal.current = false;
      }, 300);
    }
  }, [externalTimeSeconds, providerType]);

  // Format seconds into HH:MM:SS or MM:SS
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

  // Video event handlers
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video) {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
      setIsVideoLoading(false);
      setVideoError(null);
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video) {
      setCurrentTime(video.currentTime);
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
    setIsVideoLoading(false);
    if (!isSyncingFromExternal.current) {
      onPlaybackChange?.(true, videoRef.current?.currentTime || currentTime);
    }
  };

  const handlePause = () => {
    setIsPlaying(false);
    if (!isSyncingFromExternal.current) {
      onPlaybackChange?.(false, videoRef.current?.currentTime || currentTime);
    }
  };

  const handleVideoError = () => {
    const video = videoRef.current;
    const err = video?.error;
    let msg = 'Failed to load video stream.';
    if (err) {
      switch (err.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          msg = 'Playback aborted by the client.';
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          msg = 'Network connection lost while loading video.';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          msg = 'Video decoding failed.';
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          msg = 'The video format or authorized source URL is not supported.';
          break;
      }
    }
    setVideoError(msg);
    setIsVideoLoading(false);
  };

  const handleTogglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch((err) => {
        console.warn('Playback play request rejected:', err);
      });
    } else {
      video.pause();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(e.target.value);
    setCurrentTime(nextTime);
    if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
    }
    onPlaybackChange?.(isPlaying, nextTime);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVolume(v);
    if (videoRef.current) {
      videoRef.current.volume = v;
      videoRef.current.muted = v === 0;
    }
    setIsMuted(v === 0);
  };

  const handleToggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    video.muted = nextMuted;
    if (!nextMuted && volume === 0) {
      setVolume(0.5);
      video.volume = 0.5;
    }
  };

  const handleToggleFullscreen = () => {
    const container = playerContainerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleRetryPlayback = () => {
    setVideoError(null);
    setIsVideoLoading(true);
    setRetryNonce((prev) => prev + 1);
  };

  const startManualCountdown = () => {
    onTriggerCountdown?.();
    setCountdownValue(3);
    const timer = window.setInterval(() => {
      setCountdownValue((prev) => {
        if (prev === null || prev <= 1) {
          window.clearInterval(timer);
          if (videoRef.current && videoRef.current.paused) {
            videoRef.current.play().catch(() => {});
          } else if (providerType === 'synced-studio') {
            setIsPlaying(true);
            onPlaybackChange?.(true, currentTime);
          }
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleRequestQuickRecap = async () => {
    setRecapLoading(true);
    try {
      const resp = await fetch('/api/gemini/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          description: item.description,
          genres: item.genres,
          query: `Give a 2-sentence scene recap up to timestamp ${formatTime(currentTime)} without spoilers.`,
        }),
      });
      const data = await resp.json();
      setQuickRecapText(data.analysis || 'Scene context synthesized.');
    } catch {
      setQuickRecapText(
        `Up to ${formatTime(currentTime)} in ${item.title}: Key narrative tensions converge without spoilers for the upcoming sequence.`
      );
    } finally {
      setRecapLoading(false);
    }
  };

  const activeSubtitle = SUBTITLE_CUES[Math.floor(currentTime / 6) % SUBTITLE_CUES.length];
  const embedUrl = adapter.getEmbedUrl();
  const providerWatchUrl = adapter.getOpenOnProviderUrl();

  return (
    <div
      ref={playerContainerRef}
      className={`bg-slate-950/95 border border-violet-500/20 rounded-2xl overflow-hidden text-slate-100 shadow-2xl flex flex-col ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none border-none' : ''
      }`}
    >
      {/* Top Player Capability, Source Selector & Episode Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-900/90 border-b border-slate-800/80 shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <span className="font-display font-semibold text-base text-white truncate">
            {item.title}
          </span>

          {/* Source Status & Capability Badge */}
          <span
            data-testid="playback-capability-badge"
            className={`px-2.5 py-0.5 rounded-md text-[11px] font-mono border flex items-center gap-1.5 ${
              providerType === 'synced-studio' && hasAuthorizedStudioSource
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                providerType === 'synced-studio' && hasAuthorizedStudioSource
                  ? 'bg-emerald-400'
                  : 'bg-amber-400'
              }`}
            />
            {providerType === 'synced-studio' && hasAuthorizedStudioSource
              ? 'Verified Studio Stream · Auto-Sync'
              : 'External Frame · Manual Sync'}
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
          {/* Player Mode Switcher */}
          <div
            className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800"
            role="group"
            aria-label="Playback Mode Selector"
          >
            <button
              type="button"
              disabled={!hasAuthorizedStudioSource}
              onClick={() => {
                setProviderType('synced-studio');
                setShowEmbedFallbackCard(false);
              }}
              title={
                hasAuthorizedStudioSource
                  ? 'Stream synchronized high-quality video with frame-accurate room controls'
                  : 'Authorized studio video stream is not configured for this title'
              }
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                providerType === 'synced-studio'
                  ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold shadow-sm'
                  : hasAuthorizedStudioSource
                  ? 'text-slate-400 hover:text-white'
                  : 'text-slate-600 opacity-40 cursor-not-allowed'
              }`}
            >
              Synced Studio Stream
            </button>

            <button
              type="button"
              onClick={() => setProviderType('nxsha-embed')}
              disabled={isOfflineMode}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                providerType === 'nxsha-embed'
                  ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-white disabled:opacity-40'
              }`}
            >
              External Embed (/embed)
            </button>
          </div>

          {/* Open on Provider Fallback Link */}
          <a
            href={providerWatchUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="open-on-provider-fallback"
            title="Open official streaming page directly on provider website"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:text-white bg-violet-600/20 hover:bg-violet-600/35 border border-violet-500/30 rounded-xl transition-colors whitespace-nowrap shrink-0"
          >
            <span>Open Provider</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Cross-Origin External Player Sync Limitation Notice */}
      {providerType === 'nxsha-embed' && (
        <div
          data-testid="external-sync-limitation-banner"
          className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-200 shrink-0"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              External cross-origin player active. WebSocket lockstep is disabled for third-party
              iframes. Use 3-2-1 Room Countdown to coordinate.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={startManualCountdown}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-100 font-semibold transition-colors"
            >
              <Timer className="w-3.5 h-3.5" />
              <span>3-2-1 Countdown</span>
            </button>
            <button
              type="button"
              onClick={() => setShowEmbedFallbackCard((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-violet-400" />
              <span>{showEmbedFallbackCard ? 'Show Frame' : 'Embed Blocked?'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Video Viewport */}
      <div
        className={`relative bg-black w-full flex-1 ${
          isFullscreen
            ? 'h-full'
            : compact
            ? 'aspect-video max-h-[380px]'
            : 'aspect-video max-h-[540px]'
        } flex items-center justify-center overflow-hidden`}
      >
        {providerType === 'synced-studio' ? (
          <>
            {/* Genuine HTML5 Video Element */}
            {hasAuthorizedStudioSource ? (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onWaiting={() => setIsVideoLoading(true)}
                  onCanPlay={() => setIsVideoLoading(false)}
                  onError={handleVideoError}
                  onClick={handleTogglePlay}
                  className="w-full h-full object-contain cursor-pointer"
                />

                {/* Loading / Buffering Spinner */}
                {isVideoLoading && !videoError && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none z-10 space-y-3">
                    <RefreshCw className="w-10 h-10 text-violet-400 animate-spin" />
                    <p className="text-xs font-mono text-slate-300 tracking-wider uppercase">
                      Buffering Authorized Studio Stream...
                    </p>
                  </div>
                )}

                {/* Video Error State with Retry Button */}
                {videoError && (
                  <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-4 z-20">
                    <AlertCircle className="w-12 h-12 text-rose-400" />
                    <div className="space-y-1 max-w-md">
                      <h3 className="text-base font-display font-bold text-white">
                        Playback Stream Error
                      </h3>
                      <p className="text-xs text-rose-200/90 leading-relaxed">{videoError}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleRetryPlayback}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Retry Stream</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setProviderType('nxsha-embed')}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition-colors"
                      >
                        <span>Switch to External Embed</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Big Center Play Icon when paused */}
                {!isPlaying && !isVideoLoading && !videoError && (
                  <button
                    type="button"
                    onClick={handleTogglePlay}
                    aria-label="Resume Video Playback"
                    className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[1px] transition-opacity cursor-pointer group"
                  >
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                      <Play className="w-7 h-7 fill-current ml-0.5" />
                    </div>
                  </button>
                )}

                {/* Subtitle Cue Overlay */}
                {subtitlesOn && (
                  <div className="absolute bottom-14 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-lg bg-slate-950/90 text-slate-100 text-sm font-medium text-center max-w-xl pointer-events-none border border-slate-800/80 shadow-lg z-10">
                    {activeSubtitle}
                  </div>
                )}
              </>
            ) : (
              /* No Authorized Studio Source Available */
              <div className="w-full h-full p-8 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center text-center space-y-4">
                <ShieldAlert className="w-12 h-12 text-amber-400" />
                <div className="space-y-1.5 max-w-lg">
                  <h3 className="text-lg font-display font-bold text-white">
                    Studio Source Unavailable for "{item.title}"
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    This title does not have a verified, authorized Studio Stream configured. To
                    prevent displaying synthetic waveforms or unverified media, please switch to the
                    External Provider Embed or open the official streaming platform.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setProviderType('nxsha-embed')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold text-xs shadow-lg transition-transform hover:scale-105"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Watch via External Embed</span>
                  </button>
                  <a
                    href={providerWatchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs shadow-lg"
                  >
                    <span>Open on Provider</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            )}
          </>
        ) : showEmbedFallbackCard || item.playbackStatus === 'metadata-only' ? (
          /* External Embed Blocked Fallback Screen */
          <div className="w-full h-full p-8 bg-gradient-to-br from-slate-950 via-violet-950/30 to-slate-950 flex flex-col items-center justify-center text-center space-y-4">
            <ShieldAlert className="w-12 h-12 text-violet-400" />
            <div className="space-y-1.5 max-w-lg">
              <h3 className="text-lg font-display font-bold text-white">
                {item.playbackStatus === 'metadata-only'
                  ? `Upcoming / Discovery Title (${item.title})`
                  : `External Provider Direct Watch (${item.title})`}
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {item.playbackStatus === 'metadata-only'
                  ? `"${item.title}" is listed in the discovery catalog with official release year ${item.year}. No authorized streaming broadcast is currently playable.`
                  : `Third-party iframe playback may be restricted by browser tracking protection, Content-Security-Policy (CSP), or X-Frame-Options headers. Open the stream directly on the provider's official portal.`}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href={providerWatchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-slate-950 font-semibold text-xs shadow-lg hover:bg-slate-200 transition-colors"
              >
                <span>Open on Provider Page</span>
                <ExternalLink className="w-4 h-4" />
              </a>
              {hasAuthorizedStudioSource && (
                <button
                  type="button"
                  onClick={() => {
                    setProviderType('synced-studio');
                    setShowEmbedFallbackCard(false);
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold text-xs shadow-lg"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Switch to Synced Studio Player</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Active External Embed Iframe with Full Permissions */
          <div className="w-full h-full relative flex flex-col">
            {iframeLoading && (
              <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center space-y-3 z-10 pointer-events-none">
                <RefreshCw className="w-8 h-8 text-violet-400 animate-spin" />
                <p className="text-xs font-mono text-slate-300">
                  Connecting to External Provider...
                </p>
              </div>
            )}
            <iframe
              src={embedUrl}
              title={`${item.title} Embed Player`}
              onLoad={() => setIframeLoading(false)}
              onError={() => {
                setIframeLoading(false);
                setShowEmbedFallbackCard(true);
              }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
              className="w-full h-full border-0 bg-black"
            />
          </div>
        )}

        {/* Manual 3-2-1 Countdown Overlay */}
        {countdownValue !== null && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center z-30 pointer-events-none">
            <div className="text-xs uppercase tracking-widest text-violet-300 font-semibold mb-2">
              Press Play Together In
            </div>
            <div className="text-7xl font-display font-bold text-white animate-pulse">
              {countdownValue}
            </div>
          </div>
        )}

        {/* Floating Emoji Reactions Overlay */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
          {floatingReactions.map((r) => (
            <div
              key={r.id}
              style={{ left: `${r.xPercent}%` }}
              className="absolute bottom-10 animate-bounce flex flex-col items-center"
            >
              <span className="text-3xl drop-shadow-lg">{r.emoji}</span>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-950/85 text-slate-200 border border-white/10">
                {r.userName}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Scrubber & Comprehensive Transport Controls (Synced Studio Mode) */}
      {providerType === 'synced-studio' && hasAuthorizedStudioSource && (
        <div className="p-4 bg-slate-900/95 border-t border-slate-800/80 space-y-3 shrink-0">
          {/* Progress Timeline Scrubber */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono tabular-nums text-slate-300 w-14">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              aria-label="Seek video timeline"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500 hover:accent-violet-400"
            />
            <span className="text-xs font-mono tabular-nums text-slate-400 w-14 text-right">
              {formatTime(duration)}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Play, Volume, Subtitles, Recap Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleTogglePlay}
                aria-label={isPlaying ? 'Pause video' : 'Play video'}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold text-xs rounded-xl transition-all whitespace-nowrap shrink-0 shadow-md"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span>{isPlaying ? 'Pause' : 'Play'}</span>
              </button>

              {!isPlaying && (
                <button
                  type="button"
                  onClick={startManualCountdown}
                  aria-label="Start synchronized 3-2-1 countdown"
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-violet-500/30 text-violet-200 font-semibold text-xs rounded-xl transition-all whitespace-nowrap shrink-0 shadow-sm"
                  title="Count down 3-2-1 and play together"
                >
                  <Timer className="w-3.5 h-3.5 text-violet-400" />
                  <span>3-2-1 Start</span>
                </button>
              )}

              {/* Volume Slider and Mute Toggle */}
              <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1.5 rounded-xl border border-slate-700/60">
                <button
                  type="button"
                  onClick={handleToggleMute}
                  aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
                  className="text-slate-300 hover:text-white transition-colors"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-violet-300" />
                  )}
                </button>
                <input
                  type="range"
                  aria-label="Volume Slider"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
              </div>

              {/* Subtitles Toggle */}
              <button
                type="button"
                onClick={() => setSubtitlesOn(!subtitlesOn)}
                aria-label="Toggle Subtitles"
                className={`p-2 rounded-xl transition-colors ${
                  subtitlesOn
                    ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white'
                }`}
              >
                <Subtitles className="w-4 h-4" />
              </button>

              {/* AI Scene Context Recap */}
              <button
                type="button"
                onClick={handleRequestQuickRecap}
                disabled={recapLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                <span>{recapLoading ? 'Summarizing...' : 'Scene Recap'}</span>
              </button>

              {/* Fullscreen Button */}
              <button
                type="button"
                onClick={handleToggleFullscreen}
                aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                className="p-2 text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 rounded-xl transition-colors"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>

            {/* Quality, Data Saver, Download & Share */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800">
                <Wifi className="w-3.5 h-3.5 text-violet-400" />
                <label htmlFor={`abr-select-${item.id}`} className="sr-only">
                  Adaptive Bitrate Quality
                </label>
                <select
                  id={`abr-select-${item.id}`}
                  aria-label="Adaptive Bitrate Quality"
                  value={qualityPref}
                  onChange={(e) => setQualityPref(e.target.value as QualityTier | 'auto')}
                  className="bg-transparent text-xs font-mono text-slate-200 focus:outline-none cursor-pointer"
                >
                  <option value="auto" className="bg-slate-900">
                    Auto ABR ({abrDecision.selectedQuality})
                  </option>
                  <option value="4K UHD" className="bg-slate-900">
                    4K UHD · 18.4 Mbps
                  </option>
                  <option value="1080p FHD" className="bg-slate-900">
                    1080p FHD · 6.8 Mbps
                  </option>
                  <option value="720p HD" className="bg-slate-900">
                    720p HD · 3.2 Mbps
                  </option>
                  <option value="480p Saver" className="bg-slate-900">
                    480p Saver · 1.1 Mbps
                  </option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => setIsDataSaver(!isDataSaver)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap shrink-0 ${
                  isDataSaver
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {isDataSaver ? 'Data Saver: ON' : 'Data Saver: OFF'}
              </button>

              <button
                type="button"
                onClick={() => {
                  onTriggerDownload(item, abrDecision.selectedQuality);
                  setDownloadTriggered(true);
                  setTimeout(() => setDownloadTriggered(false), 2500);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                {downloadTriggered ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Saved Offline</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Offline ({abrDecision.selectedQuality})</span>
                  </>
                )}
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

          {/* Telemetry and Link Speed */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
            <div className="flex items-center gap-3">
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-mono tabular-nums">
                {capabilities.providerLabel} · {abrDecision.reason}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor={`bw-slider-${item.id}`} className="text-xs text-slate-400">
                Link Speed:
              </label>
              <input
                id={`bw-slider-${item.id}`}
                type="range"
                min={1}
                max={40}
                step={0.5}
                value={bandwidthMbps}
                onChange={(e) => setBandwidthMbps(Number(e.target.value))}
                className="w-24 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
              />
              <span className="font-mono tabular-nums text-slate-300 w-16 text-right">
                {bandwidthMbps.toFixed(1)} Mbps
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
      )}
    </div>
  );
};
