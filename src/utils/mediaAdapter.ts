import type { MediaCategory, PlayerProviderType } from '../types.ts';

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

export class SyncedStudioVideoAdapter implements MediaProviderAdapter {
  readonly providerType: PlayerProviderType = 'synced-studio';
  readonly supportsProgrammaticSync = true;
  readonly syncLimitationNotice = null;
  private videoEl: HTMLVideoElement | null = null;
  private readonly streamUrl: string;
  private readonly providerUrl: string;
  private readonly fallbackDurationSeconds: number;
  private currentTimeSeconds = 0;
  private listeners = new Set<(event: PlaybackAdapterEvent) => void>();
  private cleanupFns: Array<() => void> = [];

  constructor(streamUrl: string, durationMinutes = 120, providerUrl = '') {
    this.streamUrl = streamUrl;
    this.providerUrl = providerUrl;
    this.fallbackDurationSeconds = Math.max(60, durationMinutes * 60);
  }
  getCapabilities(): PlaybackCapabilities {
    return { providerLabel: 'Authorized Synced Player', canEmbedInFrame: false, supportsProgrammaticSync: true, supportsSeekAndTimeEvents: true, requiresManualCoordination: false, openOnProviderUrl: this.providerUrl };
  }
  getEmbedUrl(): string { return this.streamUrl; }
  getOpenOnProviderUrl(): string { return this.providerUrl; }
  initializePlayer(element: HTMLVideoElement | HTMLIFrameElement | null): void {
    this.destroy();
    if (!element || typeof HTMLVideoElement === 'undefined' || !(element instanceof HTMLVideoElement)) return;
    this.videoEl = element;
    const emit = (type: PlaybackAdapterEventType) => {
      this.currentTimeSeconds = Number.isFinite(element.currentTime) ? element.currentTime : this.currentTimeSeconds;
      const event = { type, currentTimeSeconds: this.currentTimeSeconds, durationSeconds: this.getDuration(), playbackRate: element.playbackRate || 1 };
      for (const listener of this.listeners) listener(event);
    };
    const events: Array<[PlaybackAdapterEventType, string]> = [['play', 'play'], ['pause', 'pause'], ['seek', 'seeked'], ['timeupdate', 'timeupdate'], ['ended', 'ended']];
    for (const [type, eventName] of events) {
      const handler = () => emit(type);
      element.addEventListener(eventName, handler);
      this.cleanupFns.push(() => element.removeEventListener(eventName, handler));
    }
  }
  async play(): Promise<void> {
    if (!this.videoEl || !this.streamUrl) throw new Error('No authorized video source is available.');
    await this.videoEl.play();
  }
  pause(): void { this.videoEl?.pause(); }
  seekTo(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    this.currentTimeSeconds = Math.max(0, seconds);
    if (!this.videoEl) return;
    const max = Number.isFinite(this.videoEl.duration) && this.videoEl.duration > 0 ? this.videoEl.duration : this.fallbackDurationSeconds;
    this.videoEl.currentTime = Math.max(0, Math.min(max, seconds));
  }
  getCurrentTime(): number { return this.videoEl?.currentTime || this.currentTimeSeconds; }
  getDuration(): number {
    const duration = this.videoEl?.duration;
    return duration && Number.isFinite(duration) ? duration : this.fallbackDurationSeconds;
  }
  onPlaybackEvent(callback: (event: PlaybackAdapterEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  destroy(): void { for (const cleanup of this.cleanupFns) cleanup(); this.cleanupFns = []; this.videoEl = null; }
}

export class AuthorizedExternalAdapter implements MediaProviderAdapter {
  readonly providerType: PlayerProviderType = 'authorized-external';
  readonly supportsProgrammaticSync = false;
  readonly syncLimitationNotice = 'This authorized provider does not expose a synchronization API. Open it separately and use the room countdown for manual coordination.';
  constructor(private readonly providerUrl: string, private readonly durationSeconds = 7200) {}
  getCapabilities(): PlaybackCapabilities { return { providerLabel: 'Authorized External Provider', canEmbedInFrame: false, supportsProgrammaticSync: false, supportsSeekAndTimeEvents: false, requiresManualCoordination: true, openOnProviderUrl: this.providerUrl }; }
  getEmbedUrl(): string { return ''; }
  getOpenOnProviderUrl(): string { return this.providerUrl; }
  initializePlayer(_element: HTMLVideoElement | HTMLIFrameElement | null): void {}
  async play(): Promise<void> {}
  pause(): void {}
  seekTo(_seconds: number): void {}
  getCurrentTime(): number { return 0; }
  getDuration(): number { return this.durationSeconds; }
  onPlaybackEvent(_callback: (event: PlaybackAdapterEvent) => void): () => void { return () => {}; }
  destroy(): void {}
}

export function createMediaProviderAdapter(options: {
  providerType: PlayerProviderType;
  streamUrl?: string;
  mediaType: MediaCategory;
  season?: number;
  episode?: number;
  durationMinutes?: number;
  openOnProviderUrl?: string;
}): MediaProviderAdapter {
  if (options.providerType === 'authorized-external') {
    return new AuthorizedExternalAdapter(options.openOnProviderUrl || '', (options.durationMinutes || 120) * 60);
  }
  return new SyncedStudioVideoAdapter(options.streamUrl || '', options.durationMinutes || 120, options.openOnProviderUrl || '');
}
