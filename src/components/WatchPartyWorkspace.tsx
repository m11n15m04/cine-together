import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Crown,
  Heart,
  Lock,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  Palette,
  Radio,
  Send,
  Shield,
  ThumbsUp,
  Unlock,
  UserMinus,
  Users,
  Video,
  VideoOff,
  Vote,
} from 'lucide-react';
import {
  FloatingReaction,
  MediaItem,
  PartyPlaybackState,
  QualityTier,
  RoomLifecycleState,
  RoomThemeId,
} from '../types';
import { ROOM_THEMES } from '../data/catalog';
import {
  classifyPlaybackDrift,
  evaluateWatchPartySync,
  shouldAcceptSyncRevision,
} from '../utils/streamEngine';
import { AdaptiveVideoPlayer } from './AdaptiveVideoPlayer';
import { apiFetch, getActorToken, getRoomAccessToken, saveRoomAccessToken } from '../lib/api';

interface WatchPartyWorkspaceProps {
  catalog: MediaItem[];
  selectedMedia: MediaItem;
  initialMode: 'group' | 'couple';
  initialRoomCode?: string;
  userDisplayName?: string;
  onSelectMedia: (item: MediaItem) => void;
  onTriggerDownload: (item: MediaItem, quality: QualityTier) => void;
  onTriggerShare: (item: MediaItem, timestampFormatted: string) => void;
  onLeaveRoom?: () => void;
}

const LIFECYCLE_LABELS: Record<RoomLifecycleState, string> = {
  waiting: 'Waiting for partner',
  joined: 'Partner joined',
  selecting: 'Selecting a movie',
  ready: 'Ready to watch',
  playing: 'Playing',
  paused: 'Paused',
  reconnecting: 'Reconnecting',
  ended: 'Session ended',
};

const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🔥'];

export const WatchPartyWorkspace: React.FC<WatchPartyWorkspaceProps> = ({
  catalog,
  selectedMedia,
  initialMode,
  initialRoomCode,
  userDisplayName = 'Alex Rivera',
  onSelectMedia,
  onTriggerDownload,
  onTriggerShare,
  onLeaveRoom,
}) => {
  const [partyMode, setPartyMode] = useState<'group' | 'couple'>(initialMode);
  const [roomId, setRoomId] = useState<string>(initialRoomCode || '');
  const [memberName, setMemberName] = useState<string>(userDisplayName);
  const [chatInput, setChatInput] = useState<string>('');
  const [coupleNoteInput, setCoupleNoteInput] = useState<string>('');
  const [copiedInvite, setCopiedInvite] = useState<boolean>(false);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [sidebarTab, setSidebarTab] = useState<'chat' | 'votes' | 'roster'>('chat');
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [roomError, setRoomError] = useState<string | null>(null);

  // Optional WebRTC Voice/Video state for Group & Couple rooms
  const [rtcJoined, setRtcJoined] = useState<boolean>(false);
  const [micMuted, setMicMuted] = useState<boolean>(true);
  const [camEnabled, setCamEnabled] = useState<boolean>(false);
  const [pushToTalkActive, setPushToTalkActive] = useState<boolean>(false);
  const [roomCatalogSearch, setRoomCatalogSearch] = useState<string>('');
  const [roomSearchResults, setRoomSearchResults] = useState<MediaItem[]>([]);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [roomState, setRoomState] = useState<PartyPlaybackState>({
    roomId: initialRoomCode || '',
    roomCode: initialRoomCode || '',
    roomName: 'Connecting to watch room…',
    mode: initialMode,
    mediaId: selectedMedia.id,
    mediaType: selectedMedia.mediaType,
    season: 1,
    episode: 1,
    isPlaying: false,
    currentTimeSeconds: 0,
    playbackRate: 1,
    revision: 1,
    updatedAtMs: Date.now(),
    hostId: '',
    collaborativeControls: initialMode === 'couple',
    isLocked: false,
    roomTheme: initialMode === 'couple' ? 'rose-nebula' : 'midnight-violet',
    lifecycleState: 'waiting',
    members: [],
    messages: [],
    votes: [],
    couplePulseCount: 0,
    couplePartnerNote: '',
  });

  const wsRef = useRef<WebSocket | null>(null);
  const memberIdRef = useRef<string>('');
  const lastRevisionRef = useRef<number>(0);

  useEffect(() => {
    setPartyMode(initialMode);
    if (initialRoomCode) {
      setRoomId(initialRoomCode.toUpperCase());
    } else {
      setRoomId('');
    }
  }, [initialMode, initialRoomCode]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = 0;
    let retryDelay = 1000;
    let socket: WebSocket | null = null;

    if (!roomId) {
      setWsConnected(false);
      setRoomError('Create a room or open a valid room invitation first.');
      return;
    }

    const connect = async () => {
      try {
        const actorToken = await getActorToken({ allowGuest: true, displayName: memberName });
        if (!actorToken || cancelled) return;
        let accessToken = getRoomAccessToken(roomId);
        if (!accessToken) {
          const verify = await apiFetch(`/api/party/rooms/${encodeURIComponent(roomId)}/verify`, {
            method: 'POST', body: JSON.stringify({ password: '' }),
          }, { allowGuest: true, displayName: memberName });
          const result = await verify.json();
          if (!verify.ok || typeof result.roomAccessToken !== 'string') throw new Error(result.error || 'Open this room through its invite code and password.');
          accessToken = result.roomAccessToken as string;
          saveRoomAccessToken(roomId, accessToken);
        }
        if (!accessToken) throw new Error('A room invitation is required.');
        if (cancelled) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(`${protocol}//${window.location.host}/ws/party`);
        wsRef.current = socket;
        socket.onopen = () => {
          setWsConnected(false);
          socket?.send(JSON.stringify({ type: 'auth', token: actorToken }));
        };
        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'auth:ok') {
              memberIdRef.current = String(data.actor?.id || '');
              socket?.send(JSON.stringify({ type: 'room:join', roomId, memberName, roomAccessToken: accessToken }));
              setRoomError(null);
              return;
            }
            if (data.type === 'room:error') {
              setRoomError(String(data.error || 'Room action restricted'));
              return;
            }
            if (data.type === 'room:kicked') {
              setRoomError('The room host removed you from this room.');
              socket?.close(4003, 'Removed by host');
              return;
            }
            if (data.type === 'room:reaction' && data.reaction) {
              const incomingReaction: FloatingReaction = data.reaction;
              setFloatingReactions((prev) => [...prev.slice(-12), incomingReaction]);
              setTimeout(() => setFloatingReactions((prev) => prev.filter((r) => r.id !== incomingReaction.id)), 3200);
              if (data.room) setRoomState(data.room);
              return;
            }
            if (data.type === 'room:state' && data.room) {
              const incoming: PartyPlaybackState = data.room;
              if (!shouldAcceptSyncRevision(lastRevisionRef.current, incoming.revision || 1)) return;
              lastRevisionRef.current = incoming.revision || 1;
              setRoomState(incoming);
              setWsConnected(true);
              if (incoming.couplePartnerNote) setCoupleNoteInput(incoming.couplePartnerNote);
              const matchedMedia = catalog.find((c) => c.id === incoming.mediaId);
              if (matchedMedia && matchedMedia.id !== selectedMedia.id) onSelectMedia(matchedMedia);
            }
          } catch { /* Ignore malformed server events. */ }
        };
        socket.onclose = (event) => {
          setWsConnected(false);
          if (cancelled || event.code === 1008 || event.code === 4003) return;
          retryTimer = window.setTimeout(() => { retryDelay = Math.min(15_000, retryDelay * 2); void connect(); }, retryDelay);
        };
        socket.onerror = () => setWsConnected(false);
      } catch (error) {
        setWsConnected(false);
        setRoomError(error instanceof Error ? error.message : 'Could not connect to the watch room.');
      }
    };

    void connect();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      socket?.close(1000, 'Room view closed');
      if (wsRef.current === socket) wsRef.current = null;
    };
  }, [roomId, partyMode, memberName]);

  // Clean up local WebRTC media tracks on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    const q = roomCatalogSearch.trim();
    if (!q) {
      setRoomSearchResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      fetch(`/api/nxsha/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data) => {
          if (!active) return;
          if (Array.isArray(data.items)) {
            setRoomSearchResults(data.items.slice(0, 30));
          }
        })
        .catch(() => {});
    }, 260);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [roomCatalogSearch]);

  const handleSwitchMode = (nextMode: 'group' | 'couple') => {
    if (nextMode !== partyMode) setRoomError('Room type is set when the host creates the room.');
  };

  const handlePlaybackChange = (isPlaying: boolean, currentTimeSeconds: number) => {
    setRoomState((prev) => ({
      ...prev,
      isPlaying,
      currentTimeSeconds,
      lifecycleState: isPlaying ? 'playing' : 'paused',
      updatedAtMs: Date.now(),
    }));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'playback:update',
          isPlaying,
          currentTimeSeconds,
          mediaId: selectedMedia.id,
        })
      );
    }
  };

  const handleEpisodeChange = (season: number, episode: number) => {
    setRoomState((prev) => ({
      ...prev,
      season,
      episode,
    }));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'playback:update',
          season,
          episode,
          mediaId: selectedMedia.id,
        })
      );
    }
  };

  const handleUpdateRoomSettings = (updates: {
    collaborativeControls?: boolean;
    isLocked?: boolean;
    roomTheme?: RoomThemeId;
    lifecycleState?: RoomLifecycleState;
    newHostId?: string;
  }) => {
    setRoomState((prev) => ({
      ...prev,
      ...updates,
    }));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'room:settings',
          ...updates,
        })
      );
    }
  };

  const handleKickMember = (targetId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'member:kick',
          targetId,
        })
      );
    }
  };

  const handleSendReaction = (emoji: string) => {
    const optimistic: FloatingReaction = {
      id: `local-react-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      userId: memberIdRef.current,
      userName: memberName,
      emoji,
      xPercent: Math.floor(20 + Math.random() * 60),
      createdAt: Date.now(),
    };
    setFloatingReactions((prev) => [...prev.slice(-12), optimistic]);
    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== optimistic.id));
    }, 3200);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: emoji === '❤️' && partyMode === 'couple' ? 'couple:pulse' : 'reaction:send',
          emoji,
          senderName: memberName,
        })
      );
    } else {
      setRoomState((prev) => ({
        ...prev,
        couplePulseCount: prev.couplePulseCount + 1,
      }));
    }
  };

  const handleCastVote = (item: MediaItem) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'vote:cast',
          mediaId: item.id,
          mediaTitle: item.title,
          voterName: memberName,
        })
      );
    } else {
      setRoomState((prev) => {
        const exists = prev.votes.some(
          (v) => v.mediaId === item.id && v.voterId === memberIdRef.current
        );
        return {
          ...prev,
          votes: exists
            ? prev.votes.filter(
                (v) => !(v.mediaId === item.id && v.voterId === memberIdRef.current)
              )
            : [
                ...prev.votes,
                {
                  id: `v-${Date.now()}`,
                  mediaId: item.id,
                  mediaTitle: item.title,
                  voterId: memberIdRef.current,
                  voterName: memberName,
                },
              ],
        };
      });
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'chat:send',
          senderName: memberName,
          text: trimmed,
          videoTimestampSeconds: roomState.currentTimeSeconds,
          messageType: 'chat',
        })
      );
    } else {
      setRoomState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: `local-${Date.now()}`,
            senderId: memberIdRef.current,
            senderName: memberName,
            text: trimmed,
            timestamp: 'Now',
            videoTimestampSeconds: Math.round(prev.currentTimeSeconds),
            type: 'chat',
          },
        ],
      }));
    }
    setChatInput('');
  };

  const handleSaveCoupleNote = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'couple:note',
          note: coupleNoteInput,
        })
      );
    }
  };

  const handleCopyInvite = () => {
    const url = `${window.location.origin}/?room=${roomState.roomCode || roomId}&mode=${partyMode}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2500);
  };

  const handleToggleVoiceVideoLounge = async () => {
    if (rtcJoined) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      setRtcJoined(false);
      setCamEnabled(false);
      setMicMuted(true);
      return;
    }

    setRtcJoined(true);
    setMicMuted(false);
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      }
    } catch {
      // Permission declined or no hardware device in preview; keep simulated WebRTC voice pill active
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'member:media-state',
          micMuted: false,
          camEnabled: false,
        })
      );
    }
  };

  const handleToggleMic = () => {
    const nextMuted = !micMuted;
    setMicMuted(nextMuted);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !nextMuted;
      });
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'member:media-state',
          micMuted: nextMuted,
          camEnabled,
        })
      );
    }
  };

  const handleToggleCam = async () => {
    const nextCam = !camEnabled;
    setCamEnabled(nextCam);
    if (nextCam && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: !micMuted,
          video: { width: 320, height: 180 },
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch {
        // Fallback if camera unavailable
      }
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'member:media-state',
          micMuted,
          camEnabled: nextCam,
        })
      );
    }
  };

  const syncMetrics = evaluateWatchPartySync(
    roomState,
    {
      isPlaying: roomState.isPlaying,
      currentTimeSeconds: roomState.currentTimeSeconds,
      nowMs: Date.now(),
    },
    2.0
  );
  const driftTier = classifyPlaybackDrift(syncMetrics.driftSeconds);
  const activeTheme = ROOM_THEMES[roomState.roomTheme || 'rose-nebula'] || ROOM_THEMES['rose-nebula'];

  // Tally votes by mediaId across active search results or top catalog items
  const activePool = roomCatalogSearch.trim()
    ? roomSearchResults.length > 0
      ? roomSearchResults
      : catalog.filter((c) =>
          c.title.toLowerCase().includes(roomCatalogSearch.trim().toLowerCase())
        )
    : catalog.slice(0, 40);

  const voteCounts = activePool.map((item) => {
    const count = (roomState.votes || []).filter((v) => v.mediaId === item.id).length;
    const votedByMe = (roomState.votes || []).some(
      (v) => v.mediaId === item.id && v.voterId === memberIdRef.current
    );
    return { item, count, votedByMe };
  });

  return (
    <section
      className={`space-y-6 p-4 sm:p-6 rounded-3xl bg-gradient-to-br ${activeTheme.gradientClass} border ${activeTheme.borderClass} shadow-2xl transition-all duration-500`}
      aria-label="CineTogether Watch Room"
    >
      {/* Top Room Banner: Mode, Lifecycle Status, Theme & Invite Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5 bg-slate-950/80 backdrop-blur-xl border border-white/10 rounded-2xl">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                partyMode === 'couple'
                  ? 'bg-rose-500/20 text-rose-200 border border-rose-500/40'
                  : 'bg-violet-500/20 text-violet-200 border border-violet-500/40'
              }`}
            >
              {partyMode === 'couple' ? (
                <>
                  <Heart className="w-3.5 h-3.5 text-rose-400 fill-current" />
                  <span>Couple Cinema ❤️</span>
                </>
              ) : (
                <>
                  <Users className="w-3.5 h-3.5 text-violet-400" />
                  <span>Friends & Group Cinema 🎉</span>
                </>
              )}
            </span>

            <h2 className="text-lg sm:text-xl font-display font-bold text-white">
              {roomState.roomName}
            </h2>

            <span className="px-2.5 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-xs font-mono text-violet-300">
              Code: {roomState.roomCode || roomState.roomId}
            </span>

            <span
              data-testid="room-lifecycle-badge"
              className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-xs font-medium text-emerald-300"
            >
              {LIFECYCLE_LABELS[roomState.lifecycleState || 'ready']}
            </span>
          </div>

          <p className="text-xs sm:text-sm text-slate-300 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {wsConnected ? 'Live WebSocket Sync' : 'Local Room Sync'} · Revision #
              {roomState.revision || 1}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">
              Drift {syncMetrics.driftSeconds.toFixed(2)}s ({driftTier})
            </span>
            <span aria-hidden="true">·</span>
            <span>Theme: {activeTheme.name}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Switch between Couple Cinema & Group Cinema */}
          <div
            className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-xl"
            role="group"
            aria-label="Select Watch Party Mode"
          >
            <button
              type="button"
              onClick={() => handleSwitchMode('couple')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                partyMode === 'couple'
                  ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Heart className="w-3.5 h-3.5" />
              <span>Couple Mode</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode('group')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                partyMode === 'group'
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Group Mode</span>
            </button>
          </div>

          {/* Room Theme Selector */}
          <div className="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1.5 rounded-xl border border-slate-800">
            <Palette className="w-3.5 h-3.5 text-violet-400" />
            <label htmlFor="room-theme-select" className="sr-only">
              Room Ambient Theme
            </label>
            <select
              id="room-theme-select"
              aria-label="Room Ambient Theme"
              value={roomState.roomTheme || 'rose-nebula'}
              onChange={(e) =>
                handleUpdateRoomSettings({ roomTheme: e.target.value as RoomThemeId })
              }
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              {Object.entries(ROOM_THEMES).map(([id, t]) => (
                <option key={id} value={id} className="bg-slate-900">
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleCopyInvite}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white/10 hover:bg-white/15 text-white border border-white/15 rounded-xl transition-colors whitespace-nowrap shrink-0"
          >
            {copiedInvite ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Invite Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Invite Link</span>
              </>
            )}
          </button>

          {onLeaveRoom && (
            <button
              type="button"
              onClick={() => {
                handleUpdateRoomSettings({ lifecycleState: 'ended' });
                onLeaveRoom();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-rose-950/60 hover:bg-rose-900/70 text-rose-200 border border-rose-500/30 rounded-xl transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Leave</span>
            </button>
          )}
        </div>
      </div>

      {roomError && (
        <div className="px-4 py-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-xs text-rose-200">
          {roomError}
        </div>
      )}

      {/* Couple Cinema 2-Seat Intimate Presence Bar OR Group Cinema Controls Bar */}
      {partyMode === 'couple' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1].map((slotIdx) => {
            const occupant = roomState.members[slotIdx];
            return (
              <div
                key={slotIdx}
                className="p-3.5 rounded-2xl bg-slate-950/75 border border-rose-500/25 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rose-500 to-fuchsia-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
                    {occupant ? occupant.name.charAt(0).toUpperCase() : '?'}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white">
                      {occupant
                        ? occupant.name
                        : 'Seat 2 · Waiting for Partner...'}
                    </div>
                    <div className="text-[11px] text-rose-300/90 font-mono">
                      {occupant
                        ? `${occupant.role === 'host' ? 'Partner 1 (Host)' : 'Partner 2'} · ${occupant.mood || 'In Sync ❤️'}`
                        : `Share room code ${roomState.roomCode || roomId}`}
                    </div>
                  </div>
                </div>
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    occupant ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400 animate-pulse'
                  }`}
                />
              </div>
            );
          })}

          {/* Couple Lifecycle State & Quick Heartbeat Bar */}
          <div className="p-3.5 rounded-2xl bg-slate-950/75 border border-rose-500/25 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-rose-200">
                {roomState.couplePulseCount} Shared Heartbeats ❤️
              </div>
              <div className="text-[11px] text-slate-400">
                Both partners can control playback
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleSendReaction('❤️')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-400 hover:to-pink-500 text-white text-xs font-semibold shadow-lg transition-all"
            >
              <Heart className="w-3.5 h-3.5 fill-current" />
              <span>Send Heart</span>
            </button>
          </div>
        </div>
      ) : (
        /* Group Cinema Moderation & WebRTC Voice/Video Bar */
        <div className="p-4 rounded-2xl bg-slate-950/80 border border-violet-500/25 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-200">
              <Shield className="w-4 h-4 text-violet-400" />
              <span>Group Controls:</span>
            </span>

            <button
              type="button"
              onClick={() =>
                handleUpdateRoomSettings({
                  collaborativeControls: !roomState.collaborativeControls,
                })
              }
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                roomState.collaborativeControls
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200'
                  : 'bg-slate-900 border-slate-700 text-slate-300'
              }`}
            >
              {roomState.collaborativeControls
                ? 'Collaborative Playback: ON'
                : 'Host-Only Playback: ON'}
            </button>

            <button
              type="button"
              onClick={() => handleUpdateRoomSettings({ isLocked: !roomState.isLocked })}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                roomState.isLocked
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                  : 'bg-slate-900 border-slate-700 text-slate-300'
              }`}
            >
              {roomState.isLocked ? (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Room Locked</span>
                </>
              ) : (
                <>
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Room Open ({roomState.members.length}/20)</span>
                </>
              )}
            </button>
          </div>

          {/* Optional WebRTC Audio / Video Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleToggleVoiceVideoLounge}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                rtcJoined
                  ? 'bg-emerald-600 text-white'
                  : 'bg-violet-600/25 hover:bg-violet-600/35 text-violet-200 border border-violet-500/40'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>{rtcJoined ? 'Voice Lounge Connected' : 'Join Optional Voice/Video'}</span>
            </button>

            {rtcJoined && (
              <>
                <button
                  type="button"
                  onClick={handleToggleMic}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium border ${
                    micMuted
                      ? 'bg-slate-900 border-slate-700 text-slate-400'
                      : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  }`}
                >
                  {micMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  <span>{micMuted ? 'Muted' : 'Mic Live'}</span>
                </button>

                <button
                  type="button"
                  onMouseDown={() => {
                    setPushToTalkActive(true);
                    if (micMuted) handleToggleMic();
                  }}
                  onMouseUp={() => {
                    setPushToTalkActive(false);
                    if (!micMuted) handleToggleMic();
                  }}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-mono border ${
                    pushToTalkActive
                      ? 'bg-violet-600 text-white border-violet-400'
                      : 'bg-slate-900 border-slate-700 text-slate-300'
                  }`}
                >
                  Hold PTT
                </button>

                <button
                  type="button"
                  onClick={handleToggleCam}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium border ${
                    camEnabled
                      ? 'bg-violet-500/20 border-violet-500/40 text-violet-200'
                      : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                >
                  {camEnabled ? (
                    <Video className="w-3.5 h-3.5" />
                  ) : (
                    <VideoOff className="w-3.5 h-3.5" />
                  )}
                  <span>{camEnabled ? 'Cam On' : 'Cam Off'}</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main 2-Column Split: Synchronized Player + Live Room Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-8 flex flex-col justify-between space-y-4">
          <AdaptiveVideoPlayer
            item={selectedMedia}
            externalIsPlaying={roomState.isPlaying}
            externalTimeSeconds={roomState.currentTimeSeconds}
            season={roomState.season || 1}
            episode={roomState.episode || 1}
            floatingReactions={floatingReactions}
            onEpisodeChange={handleEpisodeChange}
            onPlaybackChange={handlePlaybackChange}
            onTriggerDownload={onTriggerDownload}
            onTriggerShare={onTriggerShare}
          />

          {/* Quick Emoji Reactions & Feature Switcher Bar */}
          <div className="p-4 bg-slate-950/85 border border-white/10 rounded-2xl flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-slate-400 mr-1">React Live:</span>
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleSendReaction(emoji)}
                  aria-label={`Send ${emoji} reaction`}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-base transition-transform active:scale-125"
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <label htmlFor="party-media-select" className="text-xs text-slate-400">
                Room Movie:
              </label>
              <select
                id="party-media-select"
                aria-label="Select Watch Party Title"
                value={selectedMedia.id}
                onChange={(e) => {
                  const found = catalog.find((c) => c.id === e.target.value);
                  if (found) {
                    onSelectMedia(found);
                    handlePlaybackChange(false, 0);
                  }
                }}
                className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-violet-500"
              >
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.year}) · ★ {c.rating}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Right Column: Multi-Tab Room Sidebar (Chat | Next Movie Voting | Roster & Controls) */}
        <div className="lg:col-span-4 bg-slate-950/90 border border-white/10 rounded-2xl p-4 sm:p-5 flex flex-col justify-between space-y-4">
          {/* Sidebar Navigation Tabs */}
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setSidebarTab('chat')}
                className={`py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  sidebarTab === 'chat'
                    ? 'bg-violet-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Chat ({roomState.messages.length})
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('votes')}
                className={`py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  sidebarTab === 'votes'
                    ? 'bg-violet-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Next Movie ({(roomState.votes || []).length})
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('roster')}
                className={`py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  sidebarTab === 'roster'
                    ? 'bg-violet-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Members ({roomState.members.length})
              </button>
            </div>

            {/* Optional Local Camera Preview when enabled */}
            {camEnabled && (
              <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-violet-500/30 aspect-video max-h-28">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-1.5 left-2 px-2 py-0.5 rounded bg-slate-950/80 text-[10px] text-slate-200">
                  {memberName} (Camera Active)
                </span>
              </div>
            )}

            {/* Shared Couple Note Pinboard in Couple Mode */}
            {partyMode === 'couple' && sidebarTab === 'chat' && (
              <div className="p-3 rounded-xl bg-rose-950/25 border border-rose-500/30 space-y-2">
                <label
                  htmlFor="couple-shared-note"
                  className="block text-[11px] font-medium text-rose-200"
                >
                  Shared Date-Night Pinboard:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="couple-shared-note"
                    type="text"
                    value={coupleNoteInput}
                    onChange={(e) => setCoupleNoteInput(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-xs bg-slate-900/90 border border-rose-500/30 rounded-lg text-slate-100 focus:outline-none focus:border-rose-400"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCoupleNote}
                    className="px-2.5 py-1.5 text-xs font-medium bg-rose-600/80 hover:bg-rose-500 text-white rounded-lg shrink-0"
                  >
                    Pin
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Tab 1: Live Chat Messages */}
          {sidebarTab === 'chat' && (
            <>
              <div
                className="flex-1 min-h-[240px] max-h-[310px] overflow-y-auto space-y-2.5 pr-1"
                aria-label="Watch Party Chat Messages"
              >
                {roomState.messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-4 text-xs text-slate-500">
                    <MessageSquare className="w-5 h-5 mb-1.5 text-slate-600" />
                    <p>No messages yet. Say hello or tap an emoji reaction!</p>
                  </div>
                ) : (
                  roomState.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`p-2.5 rounded-xl border text-xs ${
                        msg.type === 'heartbeat'
                          ? 'bg-rose-950/40 border-rose-500/30 text-rose-200'
                          : msg.type === 'system'
                          ? 'bg-violet-950/30 border-violet-500/20 text-violet-200'
                          : 'bg-slate-900/90 border-slate-800 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1 font-mono tabular-nums">
                        <span className="font-semibold text-slate-200">{msg.senderName}</span>
                        <span>
                          @{Math.floor((msg.videoTimestampSeconds || 0) / 60)}:
                          {String((msg.videoTimestampSeconds || 0) % 60).padStart(2, '0')} ·{' '}
                          {msg.timestamp}
                        </span>
                      </div>
                      <p className="leading-relaxed">{msg.text}</p>
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={handleSendMessage}
                className="space-y-2 pt-2 border-t border-slate-800"
              >
                <div className="flex items-center gap-2">
                  <label htmlFor="party-member-name" className="text-xs text-slate-400 shrink-0">
                    Display Name:
                  </label>
                  <input
                    id="party-member-name"
                    type="text"
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                    className="flex-1 px-2.5 py-1 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="party-chat-input" className="sr-only">
                    Type a Watch Party message
                  </label>
                  <input
                    id="party-chat-input"
                    type="text"
                    placeholder={
                      partyMode === 'couple'
                        ? 'Whisper to your partner...'
                        : 'Message the group room...'
                    }
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-violet-500"
                  />
                  <button
                    type="submit"
                    aria-label="Send chat message"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold text-xs rounded-xl transition-all whitespace-nowrap shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                </div>
              </form>
            </>
          )}

          {/* Tab 2: "Next Movie?" Voting Queue + Full Catalog Search */}
          {sidebarTab === 'votes' && (
            <div className="flex-1 min-h-[280px] max-h-[360px] overflow-y-auto space-y-2.5 pr-1">
              <div className="text-xs text-slate-400 flex items-center justify-between pb-1">
                <span>Search or vote on what the room watches next:</span>
                <Vote className="w-4 h-4 text-violet-400" />
              </div>
              <input
                type="search"
                value={roomCatalogSearch}
                onChange={(e) => setRoomCatalogSearch(e.target.value)}
                placeholder="Search any movie, TV series, or anime..."
                aria-label="Search catalog inside watch room"
                className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-violet-500"
              />
              {voteCounts
                .sort((a, b) => b.count - a.count)
                .map(({ item, count, votedByMe }) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{item.title}</div>
                      <div className="text-[11px] text-slate-400">
                        {item.year} · {item.genres.slice(0, 2).join(', ')} · ★ {item.rating}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCastVote(item)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                          votedByMe
                            ? 'bg-violet-600 border-violet-400 text-white'
                            : 'bg-slate-950 border-slate-700 text-slate-300 hover:text-white'
                        }`}
                      >
                        <ThumbsUp className="w-3 h-3" />
                        <span>{count}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectMedia(item);
                          handlePlaybackChange(true, 0);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200"
                      >
                        Load
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Tab 3: Room Roster & Host Moderation */}
          {sidebarTab === 'roster' && (
            <div className="flex-1 min-h-[280px] max-h-[360px] overflow-y-auto space-y-2.5 pr-1">
              <div className="text-xs text-slate-400 pb-1">
                Active Participants ({roomState.members.length}{' '}
                {partyMode === 'couple' ? '/ 2 Couple Seats' : '/ 20 Max'}):
              </div>
              {roomState.members.map((m) => (
                <div
                  key={m.id}
                  className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      style={{ backgroundColor: m.avatarColor || '#8b5cf6' }}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    >
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                        <span>{m.name}</span>
                        {m.role === 'host' && (
                          <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {m.role} · {m.mood || 'Watching'}
                      </div>
                    </div>
                  </div>

                  {partyMode === 'group' && m.role !== 'host' && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title="Transfer Host Role"
                        onClick={() => handleUpdateRoomSettings({ newHostId: m.id })}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-amber-300"
                      >
                        Make Host
                      </button>
                      <button
                        type="button"
                        title="Remove Participant"
                        onClick={() => handleKickMember(m.id)}
                        className="p-1 rounded bg-rose-950/60 hover:bg-rose-900 text-rose-300"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
