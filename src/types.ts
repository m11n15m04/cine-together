export const BRAND_CONFIG = {
  name: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_NAME) || 'CineTogether',
  tagline: 'Different places. One screen. Shared moments.',
};

export type QualityTier = '4K UHD' | '1080p FHD' | '720p HD' | '480p Saver';

export type MediaCategory = 'movie' | 'tv' | 'anime';

export type PlatformOrigin =
  | 'Unverified'
  | 'CineTogether Originals'
  | 'Nxsha Originals'
  | 'Netflix'
  | 'Prime Video'
  | 'Disney+'
  | 'Crunchyroll'
  | 'Max';

export type RoomMode = 'couple' | 'group';

export type RoomLifecycleState =
  | 'waiting'      // Waiting for partner / friends
  | 'joined'       // Partner joined
  | 'selecting'    // Selecting a movie
  | 'ready'        // Ready to watch
  | 'playing'      // Playing
  | 'paused'       // Paused
  | 'reconnecting' // Reconnecting
  | 'ended';       // Session ended

export type RoomThemeId =
  | 'rose-nebula'
  | 'midnight-violet'
  | 'starlight-indigo'
  | 'velvet-crimson'
  | 'aurora-emerald';

export type PlayerProviderType = 'synced-studio' | 'authorized-external';

export type PlaybackCapabilityStatus =
  | 'synced-ready'
  | 'embed-only'
  | 'external-watch'
  | 'metadata-only';

export interface TvEpisodeItem {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview: string;
  durationMinutes: number;
  airDate: string;
  stillUrl?: string;
}

export interface TvSeasonDetail {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate?: string;
  posterUrl?: string;
  episodes: TvEpisodeItem[];
}

export interface MediaItem {
  id: string;
  providerId?: string;
  tmdbId: number;
  title: string;
  originalTitle?: string;
  mediaType: MediaCategory;
  platform: PlatformOrigin;
  releaseDate: string;
  year: string;
  rating: number;
  durationMinutes: number;
  seasons?: number;
  episodes?: number;
  genres: string[];
  language: string;
  description: string;
  posterUrl?: string;
  backdropUrl?: string;
  sectionHeading?: string;
  sourceProvider?: string;
  playbackStatus?: PlaybackCapabilityStatus;
  authorizedSourceType?: 'mp4' | 'hls' | 'external';
  authorizedProviderUrl?: string;
  accentColor: string;
  secondaryColor: string;
  director: string;
  cast: string[];
  isTrending?: boolean;
  isPopularThisWeek?: boolean;
  isRecentlyAdded?: boolean;
  isNewEpisode?: boolean;
  coupleScore?: number;
  groupNightScore?: number;
}


export interface WatchHistoryEntry {
  mediaId: string;
  watchedAt: string;
  progressSeconds: number;
  durationSeconds: number;
  completed: boolean;
  genres: string[];
  platform: PlatformOrigin;
  roomType?: 'solo' | 'couple' | 'group';
}

export interface RecommendationResult {
  item: MediaItem;
  affinityScore: number;
  reason: string;
}

export interface OfflineDownloadItem {
  mediaId: string;
  title: string;
  mediaType: MediaCategory;
  quality: QualityTier;
  sizeMB: number;
  downloadedAt: string;
  streamUrl: string;
  blobAvailable: boolean;
  progress: number;
  status: 'downloading' | 'completed' | 'paused';
  accentColor: string;
  secondaryColor: string;
  year: string;
  durationMinutes: number;
}

export interface PartyMember {
  id: string;
  name: string;
  avatarColor?: string;
  role: 'host' | 'moderator' | 'partner' | 'guest' | 'member';
  isOnline?: boolean;
  joinedAt: string;
  mood?: string;
  micMuted?: boolean;
  camEnabled?: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  videoTimestampSeconds?: number;
  type: 'chat' | 'reaction' | 'system' | 'heartbeat';
}

export interface RoomVoteItem {
  id: string;
  mediaId: string;
  mediaTitle: string;
  voterId: string;
  voterName: string;
}

export interface FloatingReaction {
  id: string;
  userId: string;
  userName: string;
  emoji: string;
  xPercent: number;
  createdAt: number;
}

export interface WatchRoomSummary {
  id: string;
  roomCode: string;
  roomType: RoomMode;
  title: string;
  description: string;
  hostUserId: string;
  currentMediaId: string;
  currentMediaType: MediaCategory;
  currentSeason: number;
  currentEpisode: number;
  isPrivate: boolean;
  hasPassword?: boolean;
  maxParticipants: number;
  collaborativeControls: boolean;
  roomTheme: RoomThemeId;
  status: RoomLifecycleState;
  memberCount: number;
  createdAt: string;
}

export interface PartyPlaybackState {
  roomId: string;
  roomCode?: string;
  roomName: string;
  mode: RoomMode;
  mediaId: string;
  mediaType?: MediaCategory;
  season?: number;
  episode?: number;
  isPlaying: boolean;
  currentTimeSeconds: number;
  playbackRate: number;
  revision: number;
  updatedAtMs: number;
  hostId: string;
  collaborativeControls: boolean;
  isLocked: boolean;
  roomTheme: RoomThemeId;
  lifecycleState: RoomLifecycleState;
  members: PartyMember[];
  messages: ChatMessage[];
  votes: RoomVoteItem[];
  couplePulseCount: number;
  couplePartnerNote: string;
}

export interface WatchlistEntry {
  id: string;
  mediaId: string;
  mediaTitle: string;
  mediaType: MediaCategory;
  posterUrl: string;
  year: string;
  rating: number;
  addedAt: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  preferredTheme: RoomThemeId;
  isGuest: boolean;
}

export interface SocialBroadcastPost {
  id: string;
  authorName: string;
  authorHandle: string;
  mediaId: string;
  mediaTitle: string;
  ClipTimestamp: string;
  caption: string;
  platformTarget: 'Community Feed' | 'X / Twitter' | 'Discord' | 'Telegram' | 'Couple Note';
  likes: number;
  createdAt: string;
}

export interface PushNotificationItem {
  id: string;
  title: string;
  body: string;
  category: 'episode' | 'trending' | 'party' | 'security';
  mediaId?: string;
  createdAt: string;
  read: boolean;
}

export interface SecurityPrivacySettings {
  e2eHistoryEncryption: boolean;
  incognitoSession: boolean;
  drmWatermarkProtection: boolean;
  strictCoupleRoomPin: string;
  autoClearCacheHours: number;
  dnsOverHttpsSource: boolean;
}
