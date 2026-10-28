import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Download,
  ExternalLink,
  Pause,
  Play,
  Radio,
  Share2,
  ShieldAlert,
  Sparkles,
  Subtitles,
  Timer,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
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
  const [providerType, setProviderType] = useState<PlayerProviderType>('synced-studio');
  const [selectedSeason, setSelectedSeason] = useState<number>(season || 1);
  const [selectedEpisode, setSelectedEpisode] = useState<number>(episode || 1);
  const [isPlaying, setIsPlaying] = useState<boolean>(externalIsPlaying ?? true);
  const [currentTime, setCurrentTime] = useState<number>(externalTimeSeconds ?? 142);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [subtitlesOn, setSubtitlesOn] = useState<boolean>(true);
  const [qualityPref, setQualityPref] = useState<QualityTier | 'auto'>('auto');
  const [bandwidthMbps, setBandwidthMbps] = useState<number>(24.6);
  const [isDataSaver, setIsDataSaver] = useState<boolean>(false);
  const [quickRecapText, setQuickRecapText] = useState<string | null>(null);
  const [recapLoading, setRecapLoading] = useState<boolean>(false);
  const [downloadTriggered, setDownloadTriggered] = useState<boolean>(false);
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const [showEmbedFallbackCard, setShowEmbedFallbackCard] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const currentTimeRef = useRef(currentTime);
  isPlayingRef.current = isPlaying;
  currentTimeRef.current = currentTime;

  const adapter = useMemo(
    () =>
      createMediaProviderAdapter({
        providerType,
        streamUrl: item.streamUrl,
        mediaType: item.mediaType,
        tmdbId: item.tmdbId,
        season: selectedSeason,
        episode: selectedEpisode,
        durationMinutes: item.durationMinutes,
        openOnProviderUrl: item.nxshaWatchUrl,
      }),
    [
      providerType,
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
  const totalDurationSeconds = adapter.getDuration();
  const abrDecision = calculateAdaptiveBitrate(bandwidthMbps, qualityPref, isDataSaver);

  useEffect(() => {
    if (typeof season === 'number' && season !== selectedSeason) {
      setSelectedSeason(season);
    }
    if (typeof episode === 'number' && episode !== selectedEpisode) {
      setSelectedEpisode(episode);
    }
  }, [season, episode]);

  // Sync with authoritative Watch Party state when using Synced Studio Adapter
  useEffect(() => {
    if (
      adapter.supportsProgrammaticSync &&
      typeof externalIsPlaying === 'boolean' &&
      externalIsPlaying !== isPlaying
    ) {
      setIsPlaying(externalIsPlaying);
      if (externalIsPlaying) {
        adapter.play();
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
      setCurrentTime(externalTimeSeconds);
      adapter.seekTo(externalTimeSeconds);
    }
  }, [externalTimeSeconds, adapter]);

  // Advance playback timer at 1Hz for UI scrubber
  useEffect(() => {
    if (!isPlaying || !adapter.supportsProgrammaticSync) return;
    const interval = window.setInterval(() => {
      setCurrentTime((prev) => {
        const next = prev + 1 >= totalDurationSeconds ? 0 : prev + 1;
        adapter.seekTo(next);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isPlaying, totalDurationSeconds, adapter]);

  // Render deterministic cinema frame on canvas when in Synced Studio mode
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || providerType !== 'synced-studio') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let frameCount = 0;

    const drawFrame = () => {
      frameCount += isPlayingRef.current ? 1 : 0;
      const t = currentTimeRef.current + (frameCount % 60) / 60;
      const w = canvas.width;
      const h = canvas.height;

      const bgGrad = ctx.createLinearGradient(0, 0, w, h);
      bgGrad.addColorStop(0, item.secondaryColor || '#1e1b4b');
      bgGrad.addColorStop(0.55, '#090d16');
      bgGrad.addColorStop(1, '#020617');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      const sweepX = w * 0.5 + Math.sin(t * 0.45) * (w * 0.24);
      const sweepY = h * 0.44 + Math.cos(t * 0.3) * (h * 0.12);
      const glow = ctx.createRadialGradient(sweepX, sweepY, 10, sweepX, sweepY, w * 0.45);
      glow.addColorStop(0, `${item.accentColor}66`);
      glow.addColorStop(0.5, `${item.accentColor}1f`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = `${item.accentColor}44`;
      ctx.lineWidth = 1.5;
      const horizonY = h * 0.68;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(w, horizonY);
      ctx.stroke();

      const barCount = 42;
      const barWidth = w / (barCount * 1.8);
      ctx.fillStyle = `${item.accentColor}88`;
      for (let i = 0; i < barCount; i++) {
        const x = w * 0.12 + i * (barWidth * 1.6);
        const wave =
          Math.abs(Math.sin(t * 1.8 + i * 0.35) * Math.cos(t * 0.7 - i * 0.2)) * (h * 0.16) + 4;
        ctx.fillRect(x, horizonY - wave, barWidth, wave);
      }

      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, w, h * 0.08);
      ctx.fillRect(0, h * 0.92, w, h * 0.08);

      ctx.fillStyle = 'rgba(226, 232, 240, 0.7)';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.fillText(
        `CINETOGETHER SYNCED STREAM · ${abrDecision.selectedQuality} (${abrDecision.bitrateMbps} Mbps) · ${abrDecision.codec}`,
        24,
        h * 0.055
      );

      if (isPlayingRef.current) {
        animId = window.requestAnimationFrame(drawFrame);
      }
    };

    drawFrame();
    return () => {
      if (animId) window.cancelAnimationFrame(animId);
    };
  }, [
    item,
    providerType,
    isPlaying,
    abrDecision.selectedQuality,
    abrDecision.bitrateMbps,
    abrDecision.codec,
  ]);

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
    const next = !isPlaying;
    setIsPlaying(next);
    if (next) adapter.play();
    else adapter.pause();
    onPlaybackChange?.(next, currentTime);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(e.target.value);
    setCurrentTime(nextTime);
    adapter.seekTo(nextTime);
    onPlaybackChange?.(isPlaying, nextTime);
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
      setQuickRecapText(data.recap || 'Scene context synthesized.');
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
              capabilities.supportsProgrammaticSync
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
            }`}
          >
            {capabilities.supportsProgrammaticSync
              ? 'Auto-Sync Supported'
              : 'Manual Sync Only (External Frame)'}
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
          {/* MediaProviderAdapter Switcher */}
          <div
            className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800"
            role="group"
            aria-label="Media Provider Adapter"
          >
            <button
              type="button"
              onClick={() => {
                setProviderType('synced-studio');
                setShowEmbedFallbackCard(false);
              }}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                providerType === 'synced-studio'
                  ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-white'
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:text-white bg-violet-600/20 hover:bg-violet-600/35 border border-violet-500/30 rounded-xl transition-colors whitespace-nowrap shrink-0"
          >
            <span>Open on Provider</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

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
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={startManualCountdown}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-100 font-semibold transition-colors"
            >
              <Timer className="w-3.5 h-3.5" />
              <span>3-2-1 Room Countdown</span>
            </button>
            <button
              type="button"
              onClick={() => setShowEmbedFallbackCard((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-violet-400" />
              <span>{showEmbedFallbackCard ? 'Show Iframe' : 'Embed Blocked?'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Video Viewport */}
      <div
        className={`relative bg-black w-full ${
          compact ? 'aspect-video max-h-[380px]' : 'aspect-video max-h-[540px]'
        } flex items-center justify-center overflow-hidden`}
      >
        {providerType === 'synced-studio' ? (
          <>
            <canvas
              ref={canvasRef}
              width={960}
              height={540}
              data-testid="adaptive-cinema-canvas"
              onClick={handleTogglePlay}
              className="w-full h-full object-cover cursor-pointer"
            />

            {!isPlaying && (
              <button
                type="button"
                onClick={handleTogglePlay}
                aria-label="Resume Playback"
                className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] transition-opacity"
              >
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center shadow-xl">
                  <Play className="w-7 h-7 fill-current ml-0.5" />
                </div>
              </button>
            )}

            {subtitlesOn && (
              <div className="absolute bottom-12 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-lg bg-slate-950/85 text-slate-100 text-sm font-medium text-center max-w-xl pointer-events-none border border-slate-800/80">
                {activeSubtitle}
              </div>
            )}
          </>
        ) : showEmbedFallbackCard ? (
          <div className="w-full h-full p-8 bg-gradient-to-br from-slate-950 via-violet-950/30 to-slate-950 flex flex-col items-center justify-center text-center space-y-4">
            <ShieldAlert className="w-10 h-10 text-violet-400" />
            <div className="space-y-1 max-w-lg">
              <h3 className="text-lg font-display font-bold text-white">
                External Provider Fallback ({item.title})
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                If third-party iframe embedding (`{embedUrl}`) is restricted by browser privacy or
                X-Frame-Options policies, open the provider page directly in a new tab or switch to
                the built-in Synced Studio Stream to keep real-time room playback synchronization.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href={providerWatchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-slate-950 font-semibold text-xs shadow-lg"
              >
                <span>Open on Provider ({providerWatchUrl})</span>
                <ExternalLink className="w-4 h-4" />
              </a>
              <button
                type="button"
                onClick={() => {
                  setProviderType('synced-studio');
                  setShowEmbedFallbackCard(false);
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold text-xs shadow-lg"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Use Synced Studio Player</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full h-full relative flex flex-col">
            <iframe
              src={embedUrl}
              title={`${item.title} Embed Player`}
              className="w-full h-full border-0 bg-slate-950"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
            <div className="absolute bottom-3 right-3 bg-slate-950/90 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono text-slate-300 flex items-center gap-2">
              <span>Embed: {embedUrl}</span>
            </div>
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
            max={totalDurationSeconds}
            value={currentTime}
            disabled={!adapter.supportsProgrammaticSync}
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
              disabled={!adapter.supportsProgrammaticSync}
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

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-mono tabular-nums">
              {capabilities.providerLabel} ·{' '}
              {capabilities.supportsProgrammaticSync
                ? abrDecision.reason
                : 'Manual Room Coordination'}
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
    </div>
  );
};
