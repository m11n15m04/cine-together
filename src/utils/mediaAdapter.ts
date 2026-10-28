import { BRAND_CONFIG, MediaCategory, PlayerProviderType } from '../types';
import { buildNxshaEmbedUrl } from './streamEngine';

export type PlaybackAdapterEventType = 'play' | 'pause' | 'seek' | 'timeupdate' | 'ended';

export interface PlaybackAdapterEvent {
  type: PlaybackAdapterEventType;
  currentTimeSeconds: number;
  durationSeconds: number;
  playbackRate: number;
}

export interface PlaybackCapabilities {
  providerLabel: string;
  canEmbedInFrame: boolean;
  supportsProgrammaticSync: boolean;
  supportsSeekAndTimeEvents: boolean;
  requiresManualCoordination: boolean;
  openOnProviderUrl: string;
}

/**
 * Dedicated MediaProviderAdapter interface decoupling UI and room synchronization
 * from specific playback backends (Programmatic HTML5 Studio Stream vs. External Provider).
 */
export interface MediaProviderAdapter {
  readonly providerType: PlayerProviderType;
  readonly supportsProgrammaticSync: boolean;
  readonly syncLimitationNotice: string | null;

  getCapabilities(): PlaybackCapabilities;
  getEmbedUrl(): string;
  getOpenOnProviderUrl(): string;
  initializePlayer(element: HTMLVideoElement | HTMLIFrameElement | null): void;
  play(): Promise<void>;
  pause(): void;
  seekTo(seconds: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  onPlaybackEvent(callback: (event: PlaybackAdapterEvent) => void): () => void;
  destroy(): void;
}

/**
 * Adapter 1: Programmatic HTML5 Studio Stream Adapter
 * Supports full frame-accurate play/pause/seekTo/getCurrentTime/getDuration synchronization
 * across Couple Cinema and Group Cinema rooms via WebSockets.
 */
export class SyncedStudioVideoAdapter implements MediaProviderAdapter {
  public readonly providerType: PlayerProviderType = 'synced-studio';
  public readonly supportsProgrammaticSync = true;
  public readonly syncLimitationNotice = null;

  private videoEl: HTMLVideoElement | null = null;
  private streamUrl: string;
  private openOnProviderUrl: string;
  private fallbackDurationSeconds: number;
  private simulatedCurrentTime = 0;
  private isPlayingState = false;
  private listeners: Set<(event: PlaybackAdapterEvent) => void> = new Set();
  private cleanupFns: Array<() => void> = [];

  constructor(streamUrl: string, durationMinutes = 120, openOnProviderUrl = 'https://nxsha.space') {
    this.streamUrl = streamUrl;
    this.openOnProviderUrl = openOnProviderUrl;
    this.fallbackDurationSeconds = Math.max(60, durationMinutes * 60);
  }

  getCapabilities(): PlaybackCapabilities {
    return {
      providerLabel: 'CineTogether Synced Studio Player',
      canEmbedInFrame: true,
      supportsProgrammaticSync: true,
      supportsSeekAndTimeEvents: true,
      requiresManualCoordination: false,
      openOnProviderUrl: this.openOnProviderUrl,
    };
  }

  getEmbedUrl(): string {
    return this.streamUrl;
  }

  getOpenOnProviderUrl(): string {
    return this.openOnProviderUrl;
  }

  initializePlayer(element: HTMLVideoElement | HTMLIFrameElement | null): void {
    this.destroy();
    if (!element || !(element instanceof HTMLVideoElement)) {
      return;
    }
    this.videoEl = element;

    const emit = (type: PlaybackAdapterEventType) => {
      const current = this.getCurrentTime();
      const duration = this.getDuration();
      const rate = this.videoEl?.playbackRate || 1;
      for (const listener of this.listeners) {
        listener({
          type,
          currentTimeSeconds: current,
          durationSeconds: duration,
          playbackRate: rate,
        });
      }
    };

    const onPlay = () => {
      this.isPlayingState = true;
      emit('play');
    };
    const onPause = () => {
      this.isPlayingState = false;
      emit('pause');
    };
    const onSeeked = () => emit('seek');
    const onTimeUpdate = () => {
      if (this.videoEl && Number.isFinite(this.videoEl.currentTime)) {
        this.simulatedCurrentTime = this.videoEl.currentTime;
      }
      emit('timeupdate');
    };
    const onEnded = () => {
      this.isPlayingState = false;
      emit('ended');
    };

    this.videoEl.addEventListener('play', onPlay);
    this.videoEl.addEventListener('pause', onPause);
    this.videoEl.addEventListener('seeked', onSeeked);
    this.videoEl.addEventListener('timeupdate', onTimeUpdate);
    this.videoEl.addEventListener('ended', onEnded);

    this.cleanupFns.push(() => {
      if (!this.videoEl) return;
      this.videoEl.removeEventListener('play', onPlay);
      this.videoEl.removeEventListener('pause', onPause);
      this.videoEl.removeEventListener('seeked', onSeeked);
      this.videoEl.removeEventListener('timeupdate', onTimeUpdate);
      this.videoEl.removeEventListener('ended', onEnded);
    });
  }

  async play(): Promise<void> {
    this.isPlayingState = true;
    if (this.videoEl) {
      try {
        await this.videoEl.play();
      } catch {
        // Autoplay restriction fallback handled gracefully by UI
      }
    }
  }

  pause(): void {
    this.isPlayingState = false;
    if (this.videoEl) {
      try {
        this.videoEl.pause();
      } catch {
        // Ignore if not attached
      }
    }
  }

  seekTo(seconds: number): void {
    const clamped = Math.max(0, Math.min(this.getDuration(), seconds));
    this.simulatedCurrentTime = clamped;
    if (this.videoEl) {
      try {
        this.videoEl.currentTime = clamped;
      } catch {
        // Ignore if media metadata not yet loaded
      }
    }
  }

  getCurrentTime(): number {
    if (this.videoEl && Number.isFinite(this.videoEl.currentTime) && this.videoEl.currentTime > 0) {
      return this.videoEl.currentTime;
    }
    return this.simulatedCurrentTime;
  }

  getDuration(): number {
    if (
      this.videoEl &&
      Number.isFinite(this.videoEl.duration) &&
      this.videoEl.duration > 0 &&
      this.videoEl.duration !== Infinity
    ) {
      return this.videoEl.duration;
    }
    return this.fallbackDurationSeconds;
  }

  onPlaybackEvent(callback: (event: PlaybackAdapterEvent) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  destroy(): void {
    for (const fn of this.cleanupFns) {
      fn();
    }
    this.cleanupFns = [];
    this.videoEl = null;
  }
}

/**
 * Adapter 2: Nxsha External Provider Adapter
 * Constructs `/embed/movie/{mediaId}` or `/embed/tv/{mediaId}/{season}/{episode}` URLs
 * and provides direct `getOpenOnProviderUrl()` fallback (`https://nxsha.space/watch/...`)
 * when third-party iframe embedding is blocked by X-Frame-Options/CSP or unavailable.
 */
export class NxshaExternalEmbedAdapter implements MediaProviderAdapter {
  public readonly providerType: PlayerProviderType = 'nxsha-embed';
  public readonly supportsProgrammaticSync = false;
  public readonly syncLimitationNotice =
    'Sync unavailable for this external cross-origin player — use the 3-2-1 Room Countdown for manual coordination, Open on Provider if embedding is blocked, or switch to Synced Studio Stream for automatic WebSocket lockstep.';

  private mediaType: MediaCategory;
  private tmdbId: number;
  private season: number;
  private episode: number;
  private durationSeconds: number;
  private manualTimeSeconds = 0;

  constructor(
    mediaType: MediaCategory,
    tmdbId: number,
    season = 1,
    episode = 1,
    durationMinutes = 120
  ) {
    this.mediaType = mediaType;
    this.tmdbId = tmdbId;
    this.season = season;
    this.episode = episode;
    this.durationSeconds = Math.max(60, durationMinutes * 60);
  }

  getCapabilities(): PlaybackCapabilities {
    return {
      providerLabel: 'Nxsha External Provider (/embed)',
      canEmbedInFrame: true,
      supportsProgrammaticSync: false,
      supportsSeekAndTimeEvents: false,
      requiresManualCoordination: true,
      openOnProviderUrl: this.getOpenOnProviderUrl(),
    };
  }

  getEmbedUrl(): string {
    return buildNxshaEmbedUrl(
      BRAND_CONFIG.embedBaseUrl,
      this.mediaType,
      this.tmdbId,
      this.season,
      this.episode
    );
  }

  getOpenOnProviderUrl(): string {
    const cleanBase = (BRAND_CONFIG.embedBaseUrl || 'https://nxsha.space').replace(/\/+$/, '');
    if (this.mediaType === 'movie') {
      return `${cleanBase}/watch/movie/${this.tmdbId}`;
    }
    const safeSeason = Math.max(1, Math.floor(this.season || 1));
    const safeEpisode = Math.max(1, Math.floor(this.episode || 1));
    return `${cleanBase}/watch/tv/${this.tmdbId}/${safeSeason}/${safeEpisode}`;
  }

  initializePlayer(_element: HTMLVideoElement | HTMLIFrameElement | null): void {
    // Cross-origin iframe manages its own internal player lifecycle
  }

  async play(): Promise<void> {
    // Honest no-op on cross-origin iframe
  }

  pause(): void {
    // Honest no-op on cross-origin iframe
  }

  seekTo(seconds: number): void {
    this.manualTimeSeconds = Math.max(0, seconds);
  }

  getCurrentTime(): number {
    return this.manualTimeSeconds;
  }

  getDuration(): number {
    return this.durationSeconds;
  }

  onPlaybackEvent(_callback: (event: PlaybackAdapterEvent) => void): () => void {
    return () => {};
  }

  destroy(): void {
    // Clean up reference
  }
}

export function createMediaProviderAdapter(options: {
  providerType: PlayerProviderType;
  streamUrl: string;
  mediaType: MediaCategory;
  tmdbId: number;
  season?: number;
  episode?: number;
  durationMinutes?: number;
  openOnProviderUrl?: string;
}): MediaProviderAdapter {
  if (options.providerType === 'nxsha-embed') {
    return new NxshaExternalEmbedAdapter(
      options.mediaType,
      options.tmdbId,
      options.season || 1,
      options.episode || 1,
      options.durationMinutes || 120
    );
  }
  return new SyncedStudioVideoAdapter(
    options.streamUrl,
    options.durationMinutes || 120,
    options.openOnProviderUrl || 'https://nxsha.space'
  );
}
