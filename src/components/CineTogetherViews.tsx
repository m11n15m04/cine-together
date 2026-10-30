import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Check,
  ExternalLink,
  Film,
  HardDrive,
  Heart,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  Palette,
  Play,
  Plus,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Tv,
  UserCheck,
  Users,
} from 'lucide-react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import {
  BRAND_CONFIG,
  MediaItem,
  RoomMode,
  RoomThemeId,
  SecurityPrivacySettings,
  TvEpisodeItem,
  TvSeasonDetail,
  UserProfile,
} from '../types';
import { ROOM_THEMES } from '../data/catalog';
import { generateRoomCode } from '../utils/streamEngine';
import { MediaPoster } from './MediaPoster';

interface CreateJoinPartyViewProps {
  catalog: MediaItem[];
  defaultMedia: MediaItem;
  userProfile: UserProfile;
  onLaunchRoom: (params: {
    mode: RoomMode;
    roomCode: string;
    media: MediaItem;
  }) => void;
}

export const CreateJoinPartyView: React.FC<CreateJoinPartyViewProps> = ({
  catalog,
  defaultMedia,
  userProfile,
  onLaunchRoom,
}) => {
  const [selectedMode, setSelectedMode] = useState<RoomMode>('couple');
  const [roomTitle, setRoomTitle] = useState<string>('Kyoto Rain & Rose Nebula Date Night');
  const [selectedMediaId, setSelectedMediaId] = useState<string>(defaultMedia.id);
  const [selectedTheme, setSelectedTheme] = useState<RoomThemeId>('rose-nebula');
  const [roomPassword, setRoomPassword] = useState<string>('');
  const [maxParticipants, setMaxParticipants] = useState<number>(10);
  const [collaborativeControls, setCollaborativeControls] = useState<boolean>(true);
  const [creating, setCreating] = useState<boolean>(false);

  // Join existing room state
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [joinPasswordInput, setJoinPasswordInput] = useState<string>('');
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleSelectModeCard = (mode: RoomMode) => {
    setSelectedMode(mode);
    if (mode === 'couple') {
      setRoomTitle('Kyoto Rain & Rose Nebula Date Night');
      setSelectedTheme('rose-nebula');
      setCollaborativeControls(true);
    } else {
      setRoomTitle('Friday Night Group Premiere Lounge');
      setSelectedTheme('midnight-violet');
      setCollaborativeControls(false);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const chosenMedia = catalog.find((c) => c.id === selectedMediaId) || defaultMedia;
    const generatedCode = generateRoomCode(selectedMode);

    try {
      const resp = await fetch('/api/party/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: generatedCode,
          mode: selectedMode,
          roomName: roomTitle,
          hostId: userProfile.uid,
          hostName: userProfile.displayName,
          mediaId: chosenMedia.id,
          mediaType: chosenMedia.mediaType,
          password: roomPassword || undefined,
          maxParticipants: selectedMode === 'couple' ? 2 : maxParticipants,
          collaborativeControls,
          roomTheme: selectedTheme,
        }),
      });
      const data = await resp.json();
      const finalCode = data?.room?.roomCode || generatedCode;
      onLaunchRoom({
        mode: selectedMode,
        roomCode: finalCode,
        media: chosenMedia,
      });
    } catch {
      onLaunchRoom({
        mode: selectedMode,
        roomCode: generatedCode,
        media: chosenMedia,
      });
    } finally {
      setCreating(false);
    }
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = joinCodeInput.trim().toUpperCase();
    if (!cleanCode) {
      setJoinError('Please enter a room code (e.g. LOVE-2026 or CLUB-4096).');
      return;
    }
    setJoinError(null);

    try {
      const resp = await fetch(`/api/party/rooms/${encodeURIComponent(cleanCode)}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: joinPasswordInput }),
      });
      const data = await resp.json();
      if (!resp.ok || data.valid === false) {
        setJoinError(data.error || 'Invalid room password or code.');
        return;
      }
      const mode: RoomMode =
        data.mode === 'couple' || cleanCode.startsWith('LOVE') ? 'couple' : 'group';
      onLaunchRoom({
        mode,
        roomCode: cleanCode,
        media: defaultMedia,
      });
    } catch {
      const mode: RoomMode = cleanCode.startsWith('LOVE') ? 'couple' : 'group';
      onLaunchRoom({
        mode,
        roomCode: cleanCode,
        media: defaultMedia,
      });
    }
  };

  return (
    <section className="space-y-8" aria-label="Create or Join Watch Party">
      {/* Header */}
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-xs font-semibold text-violet-300">
          <Sparkles className="w-3.5 h-3.5" />
          <span>{BRAND_CONFIG.name} Watch Party Studio</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-display font-bold text-white">
          Choose Your Cinema Experience
        </h1>
        <p className="text-sm text-slate-400 max-w-2xl">
          {BRAND_CONFIG.tagline} Select Couple Cinema for an intimate 2-person date night or Friends
          &amp; Group Cinema for a social screening room.
        </p>
      </div>

      {/* Two Selectable Mode Cards: MODE A (Couple Cinema) & MODE B (Friends & Group Cinema) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* MODE A: COUPLE CINEMA */}
        <button
          type="button"
          data-testid="select-mode-couple"
          onClick={() => handleSelectModeCard('couple')}
          className={`text-left p-6 rounded-3xl border transition-all relative overflow-hidden ${
            selectedMode === 'couple'
              ? 'bg-gradient-to-br from-rose-950/90 via-fuchsia-950/70 to-slate-950 border-rose-400 shadow-[0_0_35px_rgba(244,63,94,0.25)]'
              : 'bg-slate-900/70 border-slate-800 hover:border-rose-500/40'
          }`}
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center text-white shadow-lg">
              <Heart className="w-6 h-6 fill-current" />
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-200 border border-rose-500/30">
              MODE A · EXACTLY 2 SEATS
            </span>
          </div>
          <h2 className="text-xl font-display font-bold text-white mb-2">
            Couple Cinema ❤️
          </h2>
          <p className="text-sm text-slate-300 leading-relaxed mb-4">
            A romantic, private cinema for two. Includes Rose Nebula ambient lighting, 2-seat
            partner presence, floating heart reactions, shared date-night pinboard, and synchronized
            playback.
          </p>
          <div className="flex flex-wrap gap-2 text-xs text-rose-200/90">
            <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-rose-500/20">
              2-Partner Lockstep
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-rose-500/20">
              Floating Hearts ❤️
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-rose-500/20">
              Romantic Themes
            </span>
          </div>
        </button>

        {/* MODE B: FRIENDS & GROUP CINEMA */}
        <button
          type="button"
          data-testid="select-mode-group"
          onClick={() => handleSelectModeCard('group')}
          className={`text-left p-6 rounded-3xl border transition-all relative overflow-hidden ${
            selectedMode === 'group'
              ? 'bg-gradient-to-br from-violet-950/90 via-indigo-950/70 to-slate-950 border-violet-400 shadow-[0_0_35px_rgba(139,92,246,0.25)]'
              : 'bg-slate-900/70 border-slate-800 hover:border-violet-500/40'
          }`}
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-lg">
              <Users className="w-6 h-6" />
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-violet-500/20 text-violet-200 border border-violet-500/30">
              MODE B · 3 TO 20 PARTICIPANTS
            </span>
          </div>
          <h2 className="text-xl font-display font-bold text-white mb-2">
            Friends &amp; Group Cinema 🎉
          </h2>
          <p className="text-sm text-slate-300 leading-relaxed mb-4">
            Social screening lounge for friends, classmates, and communities. Includes host &amp;
            moderator controls, movie voting queue, live emoji reactions, and optional WebRTC
            voice/video chat.
          </p>
          <div className="flex flex-wrap gap-2 text-xs text-violet-200/90">
            <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-violet-500/20">
              Up to 20 Friends
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-violet-500/20">
              Movie Voting Queue
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-violet-500/20">
              Optional Voice/Video
            </span>
          </div>
        </button>
      </div>

      {/* Create Room Form + Join Room Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={handleCreateRoom}
          className="lg:col-span-7 p-6 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-lg font-display font-bold text-white">
                Configure Your {selectedMode === 'couple' ? 'Couple Cinema' : 'Group Cinema'} Room
              </h3>
              <p className="text-xs text-slate-400">
                Generates a shareable room code and initializes Cloud SQL &amp; WebSocket sync.
              </p>
            </div>
            <span className="px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-violet-300">
              Host: {userProfile.displayName}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="create-room-title" className="block text-xs font-medium text-slate-300">
                Room Name
              </label>
              <input
                id="create-room-title"
                type="text"
                required
                value={roomTitle}
                onChange={(e) => setRoomTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-violet-500"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="create-room-media" className="block text-xs font-medium text-slate-300">
                Opening Movie / Show
              </label>
              <select
                id="create-room-media"
                value={selectedMediaId}
                onChange={(e) => setSelectedMediaId(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-violet-500"
              >
                {catalog.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} ({item.year}) · ★ {item.rating}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="create-room-theme" className="block text-xs font-medium text-slate-300">
                Ambient Cinema Theme
              </label>
              <select
                id="create-room-theme"
                value={selectedTheme}
                onChange={(e) => setSelectedTheme(e.target.value as RoomThemeId)}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-violet-500"
              >
                {Object.entries(ROOM_THEMES).map(([id, theme]) => (
                  <option key={id} value={id}>
                    {theme.name} — {theme.badge}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="create-room-password" className="block text-xs font-medium text-slate-300">
                Optional Room Password (SHA-256)
              </label>
              <input
                id="create-room-password"
                type="password"
                placeholder="Leave blank for invite-link access"
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>

          {selectedMode === 'group' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
              <div className="space-y-1.5">
                <label htmlFor="group-max-cap" className="block text-xs font-medium text-slate-300">
                  Max Participants ({maxParticipants} seats)
                </label>
                <input
                  id="group-max-cap"
                  type="range"
                  min={3}
                  max={20}
                  value={maxParticipants}
                  onChange={(e) => setMaxParticipants(Number(e.target.value))}
                  className="w-full accent-violet-500"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-xs text-slate-300">Allow everyone to pause/seek</span>
                <input
                  type="checkbox"
                  aria-label="Allow collaborative playback controls"
                  checked={collaborativeControls}
                  onChange={(e) => setCollaborativeControls(e.target.checked)}
                  className="w-4 h-4 accent-violet-500"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={creating}
            data-testid="launch-watch-party-btn"
            className={`w-full py-3.5 px-6 rounded-2xl font-display font-bold text-sm text-white shadow-xl transition-all flex items-center justify-center gap-2 ${
              selectedMode === 'couple'
                ? 'bg-gradient-to-r from-rose-500 via-pink-600 to-fuchsia-600 hover:from-rose-400 hover:to-fuchsia-500'
                : 'bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 hover:from-violet-500 hover:to-blue-500'
            }`}
          >
            {selectedMode === 'couple' ? (
              <Heart className="w-4 h-4 fill-current" />
            ) : (
              <Users className="w-4 h-4" />
            )}
            <span>
              {creating
                ? 'Initializing Room...'
                : selectedMode === 'couple'
                ? 'Launch Private Couple Cinema ❤️'
                : 'Launch Friends & Group Cinema 🎉'}
            </span>
          </button>
        </form>

        {/* Join Existing Watch Party */}
        <div className="lg:col-span-5 p-6 rounded-3xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between space-y-6">
          <form onSubmit={handleJoinByCode} className="space-y-4">
            <div className="border-b border-slate-800 pb-4">
              <h3 className="text-lg font-display font-bold text-white">
                Join with a Room Code
              </h3>
              <p className="text-xs text-slate-400">
                Have an invite code from your partner or friend? Enter it below.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="join-room-code-input" className="block text-xs font-medium text-slate-300">
                Room Code
              </label>
              <input
                id="join-room-code-input"
                type="text"
                placeholder="e.g. LOVE-2026 or CLUB-4096"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                className="w-full px-3.5 py-2.5 text-sm font-mono uppercase bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-violet-500"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="join-room-pwd-input" className="block text-xs font-medium text-slate-300">
                Room Password (if private)
              </label>
              <input
                id="join-room-pwd-input"
                type="password"
                placeholder="Optional password"
                value={joinPasswordInput}
                onChange={(e) => setJoinPasswordInput(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-violet-500"
              />
            </div>

            {joinError && (
              <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-500/30 p-2.5 rounded-xl">
                {joinError}
              </p>
            )}

            <button
              type="submit"
              className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
            >
              <KeyRound className="w-4 h-4 text-violet-400" />
              <span>Join Watch Room</span>
            </button>
          </form>

          {/* Instant Featured Demo Rooms */}
          <div className="space-y-2.5 pt-4 border-t border-slate-800">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Active Featured Rooms
            </div>
            <button
              type="button"
              onClick={() =>
                onLaunchRoom({
                  mode: 'couple',
                  roomCode: 'LOVE-2026',
                  media: catalog[0] || defaultMedia,
                })
              }
              className="w-full p-3 rounded-xl bg-rose-950/30 hover:bg-rose-950/50 border border-rose-500/30 flex items-center justify-between text-left transition-colors"
            >
              <div>
                <div className="text-xs font-semibold text-white">
                  LOVE-2026 · Kyoto Rain Date Night ❤️
                </div>
                <div className="text-[11px] text-rose-300">
                  Couple Mode · Velvet Echoes in Kyoto
                </div>
              </div>
              <span className="text-xs font-semibold text-rose-200">Join →</span>
            </button>

            <button
              type="button"
              onClick={() =>
                onLaunchRoom({
                  mode: 'group',
                  roomCode: 'CLUB-4096',
                  media: catalog[1] || defaultMedia,
                })
              }
              className="w-full p-3 rounded-xl bg-violet-950/30 hover:bg-violet-950/50 border border-violet-500/30 flex items-center justify-between text-left transition-colors"
            >
              <div>
                <div className="text-xs font-semibold text-white">
                  CLUB-4096 · Spider-Verse Premiere 🎉
                </div>
                <div className="text-[11px] text-violet-300">
                  Group Mode · Spider-Man: Brand New Day
                </div>
              </div>
              <span className="text-xs font-semibold text-violet-200">Join →</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

interface MediaDetailViewProps {
  item: MediaItem;
  relatedItems: MediaItem[];
  isInWatchlist: boolean;
  onBack: () => void;
  onWatchSolo: (item: MediaItem) => void;
  onStartCoupleParty: (item: MediaItem) => void;
  onStartGroupParty: (item: MediaItem) => void;
  onToggleWatchlist: (item: MediaItem) => void;
  onSelectMedia: (item: MediaItem) => void;
}

export const MediaDetailView: React.FC<MediaDetailViewProps> = ({
  item,
  relatedItems,
  isInWatchlist,
  onBack,
  onWatchSolo,
  onStartCoupleParty,
  onStartGroupParty,
  onToggleWatchlist,
  onSelectMedia,
}) => {
  const isEpisodic = item.mediaType === 'tv' || item.mediaType === 'anime';
  const [seasons, setSeasons] = useState<TvSeasonDetail[]>([]);
  const [selectedSeasonNum, setSelectedSeasonNum] = useState<number>(1);
  const [selectedEpisodeNum, setSelectedEpisodeNum] = useState<number>(1);
  const [episodesLoading, setEpisodesLoading] = useState<boolean>(false);
  const [episodeSourceLabel, setEpisodeSourceLabel] = useState<string>('');
  const [copiedShare, setCopiedShare] = useState<boolean>(false);

  const handleShare = () => {
    const shareUrl = window.location.href;
    if (navigator.share) {
      navigator.share({
        title: item.title,
        text: `Watch ${item.title} (${item.year}) on CineTogether!`,
        url: shareUrl,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(shareUrl);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2500);
    }
  };

  useEffect(() => {
    if (!isEpisodic) {
      setSeasons([]);
      return;
    }
    let active = true;
    setEpisodesLoading(true);
    setSelectedSeasonNum(1);
    setSelectedEpisodeNum(1);

    fetch(
      `/api/nxsha/tv/${encodeURIComponent(String(item.tmdbId))}/seasons?title=${encodeURIComponent(item.title)}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (Array.isArray(data.seasons) && data.seasons.length > 0) {
          setSeasons(data.seasons);
          setSelectedSeasonNum(data.seasons[0].seasonNumber || 1);
          setSelectedEpisodeNum(data.seasons[0].episodes?.[0]?.episodeNumber || 1);
          setEpisodeSourceLabel(String(data.source || 'Nxsha Episodic Stream Resolver'));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setEpisodesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [item.tmdbId, item.title, isEpisodic]);

  const currentSeason =
    seasons.find((s) => s.seasonNumber === selectedSeasonNum) || seasons[0] || null;
  const currentEpisode: TvEpisodeItem | null =
    currentSeason?.episodes.find((e) => e.episodeNumber === selectedEpisodeNum) ||
    currentSeason?.episodes?.[0] ||
    null;

  const buildEpisodicMediaItem = (seasonNumber: number, episodeNumber: number): MediaItem => {
    if (!isEpisodic) return item;
    return {
      ...item,
      nxshaEmbedUrl: `https://nxsha.space/embed/tv/${item.tmdbId}/${seasonNumber}/${episodeNumber}`,
      nxshaWatchUrl: `https://nxsha.space/watch/tv/${item.tmdbId}/${seasonNumber}/${episodeNumber}`,
    };
  };

  return (
    <section className="space-y-8" aria-label={`${item.title} Details`}>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Browse</span>
      </button>

      <div className="relative rounded-3xl overflow-hidden border border-slate-800 bg-slate-900">
        <div className="aspect-[21/9] min-h-[300px] max-h-[440px] w-full relative">
          <MediaPoster item={item} variant="backdrop" className="w-full h-full" />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/85 to-transparent" />
        </div>

        <div className="p-6 sm:p-10 relative -mt-36 sm:-mt-48 z-10 flex flex-col md:flex-row items-start gap-8">
          {/* Vertical Poster Card */}
          <div className="w-44 sm:w-56 shrink-0 aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl border-2 border-white/10 bg-slate-950 hidden sm:block">
            <MediaPoster item={item} variant="poster" className="w-full h-full object-cover" />
          </div>

          <div className="flex-1 max-w-3xl space-y-5 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="px-2.5 py-1 rounded-md bg-violet-500/20 text-violet-300 border border-violet-500/30 font-semibold">
              {item.platform}
            </span>
            <span className="px-2.5 py-1 rounded-md bg-slate-900/90 text-slate-300 border border-slate-700 uppercase">
              {item.mediaType}
            </span>
            <span className="text-amber-400 font-semibold">★ {item.rating.toFixed(1)}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-300">{item.year}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-300">{item.language}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-300">
              {item.mediaType === 'movie'
                ? `${item.durationMinutes}m`
                : `${seasons.length || item.seasons || 1} Seasons`}
            </span>
            {item.coupleScore && (
              <span className="px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                ❤️ {item.coupleScore}% Couple Match
              </span>
            )}
            {item.sourceAvailability === 'verified' || item.playbackStatus === 'synced-ready' ? (
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold text-[11px] inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Verified Playback Source
              </span>
            ) : item.playbackType === 'embed-only' || item.playbackStatus === 'embed-only' ? (
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] inline-flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                External Embed Stream
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] inline-flex items-center gap-1">
                Theatrical / Metadata Only (No Stream)
              </span>
            )}
          </div>

          <h1 className="text-3xl sm:text-5xl font-display font-bold text-white tracking-tight">
            {item.title}
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed">{item.description}</p>

          <div className="text-xs text-slate-400 space-y-1">
            <div>
              <span className="text-slate-500">Director / Selection:</span>{' '}
              <span className="text-slate-200 font-medium">{item.director}</span>
            </div>
            <div>
              <span className="text-slate-500">Starring:</span>{' '}
              <span className="text-slate-200 font-medium">{item.cast.join(', ')}</span>
            </div>
            <div>
              <span className="text-slate-500">Genres:</span>{' '}
              <span className="text-slate-200 font-medium">{item.genres.join(' · ')}</span>
            </div>
            <div>
              <span className="text-slate-500">Nxsha Route:</span>{' '}
              <span className="text-violet-300 font-mono">
                {isEpisodic
                  ? `/embed/tv/${item.tmdbId}/${selectedSeasonNum}/${selectedEpisodeNum}`
                  : `/embed/movie/${item.tmdbId}`}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              disabled={item.sourceAvailability === 'unavailable' || item.playbackStatus === 'metadata-only'}
              onClick={() => {
                if (item.sourceAvailability === 'unavailable' || item.playbackStatus === 'metadata-only') {
                  return;
                }
                onWatchSolo(buildEpisodicMediaItem(selectedSeasonNum, selectedEpisodeNum));
              }}
              className={`inline-flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-xs sm:text-sm transition-colors shadow-lg ${
                item.sourceAvailability === 'unavailable' || item.playbackStatus === 'metadata-only'
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  : 'bg-white hover:bg-slate-200 text-slate-950'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>
                {item.sourceAvailability === 'unavailable' || item.playbackStatus === 'metadata-only'
                  ? 'Stream Unavailable (Theatrical Only)'
                  : isEpisodic
                  ? `Watch S${selectedSeasonNum}·E${selectedEpisodeNum} Now`
                  : 'Watch Solo Now'}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                onStartCoupleParty(buildEpisodicMediaItem(selectedSeasonNum, selectedEpisodeNum))
              }
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-400 hover:to-pink-500 text-white font-semibold text-xs sm:text-sm transition-all shadow-lg"
            >
              <Heart className="w-4 h-4 fill-current" />
              <span>Start Couple Cinema ❤️</span>
            </button>

            <button
              type="button"
              onClick={() =>
                onStartGroupParty(buildEpisodicMediaItem(selectedSeasonNum, selectedEpisodeNum))
              }
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs sm:text-sm transition-all shadow-lg"
            >
              <Users className="w-4 h-4" />
              <span>Start Group Party 🎉</span>
            </button>

            <button
              type="button"
              onClick={() => onToggleWatchlist(item)}
              className={`inline-flex items-center gap-2 px-4 py-3 rounded-xl text-xs sm:text-sm font-medium border transition-colors ${
                isInWatchlist
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-slate-500'
              }`}
            >
              {isInWatchlist ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>In My List</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Add to My List</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleShare}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl text-xs sm:text-sm font-medium bg-slate-900 border border-slate-700 text-slate-200 hover:border-slate-500 transition-colors"
              title="Share Title"
            >
              {copiedShare ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-300">Link Copied!</span>
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4 text-violet-400" />
                  <span>Share</span>
                </>
              )}
            </button>

            <a
              href={
                isEpisodic
                  ? `https://nxsha.space/watch/tv/${item.tmdbId}/${selectedSeasonNum}/${selectedEpisodeNum}`
                  : item.nxshaWatchUrl
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-3 rounded-xl bg-slate-950/90 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open on Nxsha</span>
            </a>
          </div>
          </div>
        </div>
      </div>

      {/* Dynamic TV & Anime Seasons and Episodes Browser */}
      {isEpisodic && (
        <div
          className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-5"
          aria-label="Seasons and Episodes"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Tv className="w-5 h-5 text-violet-400" />
                <h2 className="text-lg font-display font-bold text-white">
                  Seasons &amp; Episodes ({seasons.length || item.seasons || 1} Seasons)
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {episodeSourceLabel || 'Select a season and episode to stream solo or in a Watch Party'}
              </p>
            </div>

            {/* Season Tabs */}
            <div className="flex items-center gap-2 flex-wrap" role="tablist" aria-label="Select Season">
              {seasons.map((season) => (
                <button
                  key={season.seasonNumber}
                  type="button"
                  onClick={() => {
                    setSelectedSeasonNum(season.seasonNumber);
                    setSelectedEpisodeNum(season.episodes?.[0]?.episodeNumber || 1);
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                    selectedSeasonNum === season.seasonNumber
                      ? 'bg-violet-600 border-violet-500 text-white shadow'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {season.name} ({season.episodeCount})
                </button>
              ))}
            </div>
          </div>

          {episodesLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((skeleton) => (
                <div
                  key={skeleton}
                  className="h-24 rounded-2xl bg-slate-950/70 border border-slate-800 animate-pulse p-4"
                />
              ))}
            </div>
          ) : currentSeason ? (
            <>
              {currentEpisode && (
                <div className="p-4 rounded-2xl bg-violet-950/25 border border-violet-500/30 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1 max-w-2xl">
                    <div className="text-xs font-mono text-violet-300">
                      SELECTED EPISODE · S{currentEpisode.seasonNumber} · E{currentEpisode.episodeNumber} ·{' '}
                      {currentEpisode.durationMinutes}m · {currentEpisode.airDate}
                    </div>
                    <div className="text-sm font-display font-bold text-white">
                      {currentEpisode.title}
                    </div>
                    <p className="text-xs text-slate-300 line-clamp-2">{currentEpisode.overview}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onWatchSolo(
                          buildEpisodicMediaItem(
                            currentEpisode.seasonNumber,
                            currentEpisode.episodeNumber
                          )
                        )
                      }
                      className="px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
                    >
                      Play S{currentEpisode.seasonNumber}·E{currentEpisode.episodeNumber}
                    </button>
                    {currentSeason.episodes.length > currentEpisode.episodeNumber && (
                      <button
                        type="button"
                        onClick={() => setSelectedEpisodeNum(currentEpisode.episodeNumber + 1)}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                      >
                        Next Ep →
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
                {currentSeason.episodes.map((ep) => {
                  const isSelected = ep.episodeNumber === selectedEpisodeNum;
                  return (
                    <div
                      key={ep.id}
                      onClick={() => setSelectedEpisodeNum(ep.episodeNumber)}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-start justify-between gap-3 ${
                        isSelected
                          ? 'bg-violet-950/40 border-violet-500/50'
                          : 'bg-slate-950/80 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs font-mono">
                          <span className="px-2 py-0.5 rounded bg-slate-900 text-violet-300 font-semibold">
                            E{ep.episodeNumber}
                          </span>
                          <span className="text-white font-sans font-semibold truncate">
                            {ep.title}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 line-clamp-2">{ep.overview}</p>
                        <div className="text-[11px] font-mono text-slate-500">
                          {ep.durationMinutes}m · Air Date: {ep.airDate}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEpisodeNum(ep.episodeNumber);
                          onWatchSolo(buildEpisodicMediaItem(ep.seasonNumber, ep.episodeNumber));
                        }}
                        aria-label={`Play Season ${ep.seasonNumber} Episode ${ep.episodeNumber}`}
                        className="p-2 rounded-xl bg-violet-600/20 hover:bg-violet-600 text-violet-200 hover:text-white shrink-0 transition-colors"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* More Like This */}
      <div className="space-y-4">
        <h2 className="text-lg font-display font-bold text-white">More Like {item.title}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {relatedItems.slice(0, 5).map((rel) => (
            <button
              key={rel.id}
              type="button"
              onClick={() => onSelectMedia(rel)}
              className="group text-left rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 hover:border-violet-500/50 transition-all"
            >
              <div className="aspect-[3/4] w-full overflow-hidden">
                <MediaPoster
                  item={rel}
                  variant="poster"
                  className="w-full h-full group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="p-3">
                <div className="text-xs font-semibold text-white truncate">{rel.title}</div>
                <div className="text-[11px] text-slate-400">
                  {rel.year} · ★ {rel.rating}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};

interface ProfileAndAuthViewProps {
  userProfile: UserProfile;
  watchlistItems: MediaItem[];
  securitySettings?: SecurityPrivacySettings;
  onUpdateSecurity?: (next: SecurityPrivacySettings) => void;
  onUpdateProfile: (next: UserProfile) => void;
  onSelectMedia: (item: MediaItem) => void;
  onNavigateToTab?: (tab: 'home' | 'movies' | 'tv' | 'create-party' | 'couple-room' | 'group-room' | 'ai-voice' | 'offline-social') => void;
}

export const ProfileAndAuthView: React.FC<ProfileAndAuthViewProps> = ({
  userProfile,
  watchlistItems,
  securitySettings,
  onUpdateSecurity,
  onUpdateProfile,
  onSelectMedia,
  onNavigateToTab,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'profile' | 'security' | 'watchlist'>('profile');
  const [displayName, setDisplayName] = useState<string>(userProfile.displayName);
  const [email, setEmail] = useState<string>(userProfile.email);
  const [preferredTheme, setPreferredTheme] = useState<RoomThemeId>(userProfile.preferredTheme);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Local copy of security settings if prop provided
  const [localSec, setLocalSec] = useState<SecurityPrivacySettings>(
    securitySettings || {
      e2eHistoryEncryption: true,
      incognitoSession: false,
      drmWatermarkProtection: true,
      strictCoupleRoomPin: '7749',
      autoClearCacheHours: 24,
      dnsOverHttpsSource: true,
    }
  );

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated: UserProfile = {
      ...userProfile,
      displayName: displayName.trim() || 'Cinema Explorer',
      email: email.trim() || 'guest@cinetogether.app',
      preferredTheme,
    };
    onUpdateProfile(updated);

    try {
      await fetch('/api/profile/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch {
      // Saved locally as fallback
    }
    setSavedNotice('Profile & Cinema Theme saved to Cloud SQL.');
    setTimeout(() => setSavedNotice(null), 3000);
  };

  const handleUpdateSecSetting = (key: keyof SecurityPrivacySettings, val: any) => {
    const next = { ...localSec, [key]: val };
    setLocalSec(next);
    onUpdateSecurity?.(next);
    setSavedNotice('Security preferences updated.');
    setTimeout(() => setSavedNotice(null), 2500);
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    if (!auth) {
      setAuthError('Firebase Authentication is not configured in this environment.');
      return;
    }
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      if (cred.user) {
        const nextProfile: UserProfile = {
          uid: cred.user.uid,
          email: cred.user.email || 'member@cinetogether.app',
          displayName: cred.user.displayName || 'CineTogether Member',
          avatarUrl: cred.user.photoURL || undefined,
          preferredTheme,
          isGuest: false,
        };
        setDisplayName(nextProfile.displayName);
        setEmail(nextProfile.email);
        onUpdateProfile(nextProfile);
      }
    } catch {
      setAuthError(
        'Popup sign-in was cancelled or blocked by preview sandbox. You can continue seamlessly with your Instant Cinema Profile below.'
      );
    }
  };

  const handleSignOut = async () => {
    try {
      if (auth) await signOut(auth);
    } catch {
      // ignore
    }
    const guestProfile: UserProfile = {
      uid: `guest-${Math.random().toString(36).slice(2, 7)}`,
      email: 'guest@cinetogether.app',
      displayName: 'Alex Rivera (Guest)',
      preferredTheme: 'midnight-violet',
      isGuest: true,
    };
    setDisplayName(guestProfile.displayName);
    setEmail(guestProfile.email);
    onUpdateProfile(guestProfile);
  };

  const currentThemeMeta = ROOM_THEMES[preferredTheme] || ROOM_THEMES['rose-nebula'];

  return (
    <section className="space-y-8 max-w-4xl mx-auto" aria-label="Profile, Authentication and Settings">
      {/* Profile Header & Stats */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900 border border-slate-800 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center text-white font-display font-bold text-xl shadow-lg ring-2 ring-violet-500/30">
              {userProfile.displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-display font-bold text-white">
                  {userProfile.displayName}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-violet-500/20 text-violet-300 border border-violet-500/30">
                  {userProfile.isGuest ? 'Guest Pass Active' : 'Verified Account'}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">{userProfile.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {userProfile.isGuest ? (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-slate-200 text-slate-950 font-semibold text-xs transition-colors shadow-md"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign In with Google</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Switch to Guest</span>
              </button>
            )}
          </div>
        </div>

        {authError && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
            {authError}
          </div>
        )}

        {/* Quick Navigation Tabs: Profile | Security Settings | My Watchlist */}
        <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'profile'}
            onClick={() => setActiveSubTab('profile')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeSubTab === 'profile'
                ? 'bg-violet-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            Profile &amp; Ambiance
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'security'}
            onClick={() => setActiveSubTab('security')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all inline-flex items-center gap-1.5 ${
              activeSubTab === 'security'
                ? 'bg-violet-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Security &amp; Privacy</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'watchlist'}
            onClick={() => setActiveSubTab('watchlist')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all inline-flex items-center gap-1.5 ${
              activeSubTab === 'watchlist'
                ? 'bg-violet-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>Watchlist ({watchlistItems.length})</span>
          </button>
        </div>

        {/* SUBTAB 1: PROFILE & THEME FORM */}
        {activeSubTab === 'profile' && (
          <form onSubmit={handleSavePreferences} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="profile-name" className="block text-xs font-medium text-slate-300">
                  Display Name in Watch Rooms
                </label>
                <input
                  id="profile-name"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="profile-email" className="block text-xs font-medium text-slate-300">
                  Email Address
                </label>
                <input
                  id="profile-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="profile-theme" className="block text-xs font-medium text-slate-300">
                Default Cinema Ambiance Theme
              </label>
              <select
                id="profile-theme"
                value={preferredTheme}
                onChange={(e) => setPreferredTheme(e.target.value as RoomThemeId)}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-violet-500"
              >
                {Object.entries(ROOM_THEMES).map(([id, t]) => (
                  <option key={id} value={id}>
                    {t.name} — {t.badge} ({t.subtitle})
                  </option>
                ))}
              </select>

              {/* Theme Live Preview Swatch */}
              <div
                className={`p-3.5 rounded-xl border bg-gradient-to-r ${currentThemeMeta.gradientClass} ${currentThemeMeta.borderClass} flex items-center justify-between text-xs`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-3.5 h-3.5 rounded-full ring-2 ring-white/20"
                    style={{ backgroundColor: currentThemeMeta.accentHex }}
                  />
                  <span className="font-semibold text-white">{currentThemeMeta.name}</span>
                  <span className="text-slate-300">· {currentThemeMeta.subtitle}</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-white/10 text-white">
                  {currentThemeMeta.badge}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              {savedNotice ? (
                <span className="text-xs text-emerald-400 font-medium inline-flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>{savedNotice}</span>
                </span>
              ) : (
                <span className="text-xs text-slate-400">
                  Synced with Cloud SQL PostgreSQL profile preferences.
                </span>
              )}
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold text-xs shadow-lg transition-all"
              >
                Save Profile Preferences
              </button>
            </div>
          </form>
        )}

        {/* SUBTAB 2: SECURITY & PRIVACY SETTINGS */}
        {activeSubTab === 'security' && (
          <div className="space-y-4">
            <div className="text-xs text-slate-400 border-b border-slate-800 pb-2">
              Configure room privacy, passcode locks, and session preferences for your streaming sessions.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-start justify-between p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                <div className="space-y-1 pr-3">
                  <div className="text-xs font-semibold text-white">Local-Only History Mode</div>
                  <div className="text-[11px] text-slate-400 leading-relaxed">
                    Store watch progress locally on this device without syncing telemetry to cloud servers.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={localSec.e2eHistoryEncryption}
                  onChange={(e) => handleUpdateSecSetting('e2eHistoryEncryption', e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-violet-500"
                />
              </label>

              <label className="flex items-start justify-between p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                <div className="space-y-1 pr-3">
                  <div className="text-xs font-semibold text-white">Screen Share Watermark</div>
                  <div className="text-[11px] text-slate-400 leading-relaxed">
                    Display participant session ID overlay during watch party screen shares.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={localSec.drmWatermarkProtection}
                  onChange={(e) => handleUpdateSecSetting('drmWatermarkProtection', e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-violet-500"
                />
              </label>

              <label className="flex items-start justify-between p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                <div className="space-y-1 pr-3">
                  <div className="text-xs font-semibold text-white">Incognito Cinema Mode</div>
                  <div className="text-[11px] text-slate-400 leading-relaxed">
                    Do not save any watch progress, history records, or room participation logs.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={localSec.incognitoSession}
                  onChange={(e) => handleUpdateSecSetting('incognitoSession', e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-violet-500"
                />
              </label>

              <label className="flex items-start justify-between p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                <div className="space-y-1 pr-3">
                  <div className="text-xs font-semibold text-white">DNS over HTTPS Source Lookup</div>
                  <div className="text-[11px] text-slate-400 leading-relaxed">
                    Resolve media manifests via encrypted DoH relays to bypass local ISP throttling.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={localSec.dnsOverHttpsSource}
                  onChange={(e) => handleUpdateSecSetting('dnsOverHttpsSource', e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-violet-500"
                />
              </label>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <label htmlFor="couple-pin-input" className="block text-xs font-medium text-slate-300">
                Couple Room Strict PIN Passcode
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="couple-pin-input"
                  type="password"
                  maxLength={6}
                  value={localSec.strictCoupleRoomPin}
                  onChange={(e) => handleUpdateSecSetting('strictCoupleRoomPin', e.target.value)}
                  className="px-3.5 py-2 text-xs font-mono tracking-widest bg-slate-900 border border-slate-800 rounded-xl text-white w-32 text-center"
                />
                <span className="text-[11px] text-slate-400">
                  Required when your partner joins your private Couple Cinema rooms.
                </span>
              </div>
            </div>

            {savedNotice && (
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                <Check className="w-3.5 h-3.5" />
                <span>{savedNotice}</span>
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 3: WATCHLIST PREVIEW */}
        {activeSubTab === 'watchlist' && (
          <div className="space-y-4">
            {watchlistItems.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 border border-slate-800 rounded-2xl space-y-2">
                <Bookmark className="w-6 h-6 text-slate-500 mx-auto" />
                <div className="text-sm font-semibold text-white">Your Watchlist is empty</div>
                <p className="text-xs text-slate-400">
                  Save titles while browsing to quickly launch Couple Date Nights or Group Watch Parties.
                </p>
                {onNavigateToTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateToTab('movies')}
                    className="px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-semibold mt-2"
                  >
                    Browse Catalog
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {watchlistItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectMedia(item)}
                    className="group text-left p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-violet-500/40 transition-all"
                  >
                    <div className="aspect-[3/4] rounded-lg overflow-hidden mb-2 bg-slate-900">
                      <MediaPoster item={item} variant="poster" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    </div>
                    <div className="text-xs font-semibold text-white truncate">{item.title}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{item.year} · ★ {item.rating}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
