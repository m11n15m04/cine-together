import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Check,
  ExternalLink,
  Film,
  Heart,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  Palette,
  Play,
  Plus,
  Sparkles,
  Star,
  Tv,
  UserCheck,
  Users,
} from 'lucide-react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { apiFetch, clearGuestSession, saveRoomAccessToken } from '../lib/api';
import {
  BRAND_CONFIG,
  MediaItem,
  RoomMode,
  RoomThemeId,
  TvEpisodeItem,
  TvSeasonDetail,
  UserProfile,
} from '../types';
import { ROOM_THEMES } from '../data/catalog';
import { MediaPoster } from './MediaPoster';

function nxshaEmbedIdentifier(item: MediaItem): string | null {
  if (Number.isSafeInteger(item.tmdbId) && Number(item.tmdbId) > 0) return String(item.tmdbId);
  return item.imdbId && /^tt\d{7,10}$/.test(item.imdbId) ? item.imdbId : null;
}

interface CreateJoinPartyViewProps {
  catalog: MediaItem[];
  defaultMedia: MediaItem | null;
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
  const [roomTitle, setRoomTitle] = useState<string>('Private watch party');
  const [selectedMediaId, setSelectedMediaId] = useState<string>(defaultMedia?.id || '');
  const [selectedTheme, setSelectedTheme] = useState<RoomThemeId>('rose-nebula');
  const [roomPassword, setRoomPassword] = useState<string>('');
  const [maxParticipants, setMaxParticipants] = useState<number>(10);
  const [collaborativeControls, setCollaborativeControls] = useState<boolean>(true);
  const [creating, setCreating] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Join existing room state
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [joinPasswordInput, setJoinPasswordInput] = useState<string>('');
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleSelectModeCard = (mode: RoomMode) => {
    setSelectedMode(mode);
    if (mode === 'couple') {
      setRoomTitle('Private watch party');
      setSelectedTheme('rose-nebula');
      setCollaborativeControls(true);
    } else {
      setRoomTitle('Group watch party');
      setSelectedTheme('midnight-violet');
      setCollaborativeControls(false);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const chosenMedia = catalog.find((c) => c.id === selectedMediaId) || defaultMedia;
    setCreateError(null);
    if (!chosenMedia) {
      setCreateError('Nxsha catalog metadata is unavailable, so a media title cannot be selected.');
      setCreating(false);
      return;
    }

    try {
      const resp = await apiFetch('/api/party/rooms', {
        method: 'POST',
        body: JSON.stringify({
          mode: selectedMode,
          roomName: roomTitle,
          hostName: userProfile.displayName,
          mediaId: chosenMedia.id,
          mediaType: chosenMedia.mediaType,
          password: roomPassword || undefined,
          maxParticipants: selectedMode === 'couple' ? 2 : maxParticipants,
          collaborativeControls,
          roomTheme: selectedTheme,
        }),
      }, { allowGuest: true, displayName: userProfile.displayName });
      const data = await resp.json();
      if (!resp.ok || !data?.room?.roomCode || !data?.roomAccessToken) {
        throw new Error(data?.error || 'The room could not be created.');
      }
      const finalCode = data.room.roomCode as string;
      saveRoomAccessToken(finalCode, data.roomAccessToken);
      onLaunchRoom({
        mode: selectedMode,
        roomCode: finalCode,
        media: chosenMedia,
      });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'The room could not be created.');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = joinCodeInput.trim().toUpperCase();
    if (!cleanCode) {
      setJoinError('Please enter the invite code for your watch party.');
      return;
    }
    setJoinError(null);

    try {
      const resp = await apiFetch(`/api/party/rooms/${encodeURIComponent(cleanCode)}/verify`, {
        method: 'POST',
        body: JSON.stringify({ password: joinPasswordInput }),
      }, { allowGuest: true, displayName: userProfile.displayName });
      const data = await resp.json();
      if (!resp.ok || data.valid === false) {
        setJoinError(data.error || 'Invalid room password or code.');
        return;
      }
      if (!data.roomAccessToken) {
        setJoinError('The server did not return a room invitation.');
        return;
      }
      const roomMedia = catalog.find((item) => item.id === data.room?.mediaId) || defaultMedia;
      if (!roomMedia) {
        setJoinError('This room’s title is not available from the Nxsha catalog, so the media workspace cannot be opened.');
        return;
      }
      saveRoomAccessToken(cleanCode, data.roomAccessToken);
      const mode: RoomMode =
        data.mode === 'couple' || cleanCode.startsWith('LOVE') ? 'couple' : 'group';
      onLaunchRoom({
        mode,
        roomCode: cleanCode,
        media: roomMedia,
      });
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Could not verify the room.');
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
                disabled={catalog.length === 0}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-violet-500"
              >
                {catalog.length === 0 && <option value="">Nxsha catalog unavailable</option>}
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
            disabled={creating || !defaultMedia && catalog.length === 0}
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
          {createError && <p role="alert" className="text-xs text-rose-400">{createError}</p>}
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
                placeholder="Enter your invite code"
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

          {/* Rooms are only shown when backed by persisted server records. */}
          <div className="space-y-2.5 pt-4 border-t border-slate-800">
            <div className="text-xs text-slate-400">
              Enter a room code shared by its host. Rooms are created when a host starts a party.
            </div>
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
  const [episodesUnavailable, setEpisodesUnavailable] = useState<boolean>(false);

  useEffect(() => {
    if (!isEpisodic) {
      setSeasons([]);
      return;
    }
    if (!item.providerId) {
      setSeasons([]);
      setEpisodesUnavailable(true);
      setEpisodesLoading(false);
      return;
    }
    let active = true;
    setEpisodesLoading(true);
    setEpisodesUnavailable(false);
    setSelectedSeasonNum(1);
    setSelectedEpisodeNum(1);

    fetch(`/api/catalog/${encodeURIComponent(item.providerId)}/seasons`)
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (!active) return;
        if (!response.ok) {
          setEpisodesUnavailable(true);
          return;
        }
        if (Array.isArray(data.seasons) && data.seasons.length > 0) {
          setSeasons(data.seasons);
          setSelectedSeasonNum(data.seasons[0].seasonNumber || 1);
          setSelectedEpisodeNum(data.seasons[0].episodes?.[0]?.episodeNumber || 1);
          setEpisodeSourceLabel(String(data.source || 'Episode metadata'));
        }
      })
      .catch(() => { if (active) setEpisodesUnavailable(true); })
      .finally(() => {
        if (active) setEpisodesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [item.providerId, isEpisodic]);

  const currentSeason =
    seasons.find((s) => s.seasonNumber === selectedSeasonNum) || seasons[0] || null;
  const currentEpisode: TvEpisodeItem | null =
    currentSeason?.episodes.find((e) => e.episodeNumber === selectedEpisodeNum) ||
    currentSeason?.episodes?.[0] ||
    null;

  const buildEpisodicMediaItem = (seasonNumber: number, episodeNumber: number): MediaItem => {
    if (!isEpisodic) return item;
    return { ...item, id: `${item.id}:s${seasonNumber}:e${episodeNumber}` };
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

        <div className="p-6 sm:p-10 relative -mt-36 sm:-mt-48 z-10 max-w-3xl space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="px-2.5 py-1 rounded-md bg-violet-500/20 text-violet-300 border border-violet-500/30 font-semibold">
              Nxsha catalog
            </span>
            <span className="px-2.5 py-1 rounded-md bg-slate-900/90 text-slate-300 border border-slate-700 uppercase">
              {item.mediaType}
            </span>
            {Number.isFinite(item.rating) && <span className="text-amber-400 font-semibold">★ {item.rating.toFixed(1)}</span>}
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
            {nxshaEmbedIdentifier(item) ? (
              <a
                className="inline-flex text-violet-300 underline"
                href={`https://web.nxsha.space/embed/${isEpisodic ? `tv/${nxshaEmbedIdentifier(item)}/${selectedSeasonNum}/${selectedEpisodeNum}` : `movie/${nxshaEmbedIdentifier(item)}`}`}
                target="_blank"
                rel="noreferrer"
              >Open documented Nxsha player route (availability not verified)</a>
            ) : (
              <span>Documented player route unavailable: Nxsha did not supply a TMDb or IMDb identifier.</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              disabled={item.playbackStatus !== 'synced-ready' && item.playbackStatus !== 'external-watch'}
              onClick={() =>
                onWatchSolo(buildEpisodicMediaItem(selectedSeasonNum, selectedEpisodeNum))
              }
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white hover:bg-slate-200 text-slate-950 font-semibold text-xs sm:text-sm transition-colors shadow-lg"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>
                {isEpisodic
                  ? item.playbackStatus === 'synced-ready' || item.playbackStatus === 'external-watch'
                    ? `Watch S${selectedSeasonNum}·E${selectedEpisodeNum} Now`
                    : 'Playback unavailable'
                  : item.playbackStatus === 'synced-ready' || item.playbackStatus === 'external-watch'
                    ? 'Watch Solo Now'
                    : 'Playback unavailable'}
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

            {!isEpisodic && item.authorizedSourceType === 'external' && item.authorizedProviderUrl && (
              <a href={item.authorizedProviderUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3.5 py-3 rounded-xl bg-slate-950/90 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300">
                <ExternalLink className="w-3.5 h-3.5" /><span>Open authorized provider</span>
              </a>
            )}
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
                  Seasons &amp; Episodes{seasons.length ? ` (${seasons.length} seasons)` : ''}
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {episodeSourceLabel || 'Season data is loaded from the Nxsha catalog when available.'}
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
                      disabled={item.playbackStatus !== 'synced-ready' && item.playbackStatus !== 'external-watch'}
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
                      disabled={item.playbackStatus !== 'synced-ready' && item.playbackStatus !== 'external-watch'}
                        className="p-2 rounded-xl bg-violet-600/20 hover:bg-violet-600 text-violet-200 hover:text-white shrink-0 transition-colors"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : episodesUnavailable ? (
            <p role="status" className="text-sm text-amber-200">Nxsha season and episode metadata is unavailable. The catalog API is not currently documented for this request.</p>
          ) : (
            <p role="status" className="text-sm text-slate-400">No season metadata is available.</p>
          )}
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
  onUpdateProfile: (next: UserProfile) => void;
  onSelectMedia: (item: MediaItem) => void;
}

export const ProfileAndAuthView: React.FC<ProfileAndAuthViewProps> = ({
  userProfile,
  watchlistItems,
  onUpdateProfile,
  onSelectMedia,
}) => {
  const [displayName, setDisplayName] = useState<string>(userProfile.displayName);
  const [email, setEmail] = useState<string>(userProfile.email);
  const [preferredTheme, setPreferredTheme] = useState<RoomThemeId>(userProfile.preferredTheme);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

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
      if (!userProfile.isGuest) {
        const response = await apiFetch('/api/profile/preferences', {
        method: 'POST',
        body: JSON.stringify(updated),
      });
        if (!response.ok) throw new Error('Profile could not be saved to the server.');
      }
      setSavedNotice(userProfile.isGuest ? 'Preferences saved on this device.' : 'Profile preferences saved.');
    } catch {
      setSavedNotice('Preferences are saved on this device; server sync failed.');
    }
    setTimeout(() => setSavedNotice(null), 3000);
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    if (!auth) {
      setAuthError('Google sign-in is unavailable until Firebase client settings are configured.');
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
      clearGuestSession();
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

  return (
    <section className="space-y-8 max-w-4xl mx-auto" aria-label="Profile and Authentication">
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900 border border-slate-800 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center text-white font-display font-bold text-xl shadow-lg">
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
              <p className="text-xs text-slate-400 font-mono">{userProfile.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {userProfile.isGuest ? (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-slate-200 text-slate-950 font-semibold text-xs transition-colors"
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
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
            {authError}
          </div>
        )}

        <form onSubmit={handleSavePreferences} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="profile-name" className="block text-xs font-medium text-slate-300">
                Display Name in Watch Rooms
              </label>
              <input
                id="profile-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="profile-email" className="block text-xs font-medium text-slate-300">
                Email Address
              </label>
              <input
                id="profile-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="profile-theme" className="block text-xs font-medium text-slate-300">
              Default Watch Room Ambient Theme
            </label>
            <select
              id="profile-theme"
              value={preferredTheme}
              onChange={(e) => setPreferredTheme(e.target.value as RoomThemeId)}
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white"
            >
              {Object.entries(ROOM_THEMES).map(([id, t]) => (
                <option key={id} value={id}>
                  {t.name} — {t.subtitle}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between pt-2">
            {savedNotice ? (
              <span className="text-xs text-emerald-400 font-medium">{savedNotice}</span>
            ) : (
              <span className="text-xs text-slate-400">
                Synced with Cloud SQL PostgreSQL profile preferences.
              </span>
            )}
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold text-xs shadow-lg"
            >
              Save Profile Preferences
            </button>
          </div>
        </form>
      </div>
    </section>
  );
};
