import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { GoogleGenAI, type LiveServerMessage, Modality } from '@google/genai';
import {
  getWatchRoomByCode,
  getWatchRoomSnapshot,
  joinRoomInDb,
  leaveRoomInDb,
  recordChatMessageInDb,
  recordReactionInDb,
  removeRoomMember,
  toggleRoomVoteInDb,
  transferRoomHost,
  updatePlaybackStateInDb,
  updateRoomSettings,
} from '../db/repository.ts';
import { verifyActorToken, type AuthActor } from '../middleware/auth.ts';
import { verifyRoomAccessToken } from '../security/tokens.ts';

interface PartySocket extends WebSocket {
  actor?: AuthActor;
  roomCode?: string;
  isAlive?: boolean;
  msgWindowStarted?: number;
  msgCount?: number;
}

const MAX_FRAME_BYTES = 64 * 1024;
const THEMES = new Set(['rose-nebula', 'midnight-violet', 'starlight-indigo', 'velvet-crimson', 'aurora-emerald']);
const EMOJIS = new Set(['❤️', '💜', '💙', '💚', '💛', '🔥', '👏', '😂', '😍', '🎉', '🍿', '✨']);

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{2,31}$/.test(code) ? code : null;
}

function canSend(ws: PartySocket): boolean {
  const now = Date.now();
  if (!ws.msgWindowStarted || now - ws.msgWindowStarted > 5000) {
    ws.msgWindowStarted = now;
    ws.msgCount = 0;
  }
  ws.msgCount = (ws.msgCount || 0) + 1;
  return ws.msgCount <= 40;
}

export function attachPartyHub(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
  const paths = new WeakMap<WebSocket, string>();
  const roomSockets = new Map<string, Set<PartySocket>>();
  const connections = new Set<PartySocket>();

  const broadcast = (code: string, payload: unknown) => {
    const sockets = roomSockets.get(code);
    if (!sockets) return;
    const message = JSON.stringify(payload);
    for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.send(message);
  };

  const broadcastState = async (code: string) => {
    const room = await getWatchRoomSnapshot(code);
    if (room) broadcast(code, { type: 'room:state', room });
  };

  const detachFromRoom = async (ws: PartySocket) => {
    const code = ws.roomCode;
    const actor = ws.actor;
    if (!code || !actor) return;
    const sockets = roomSockets.get(code);
    sockets?.delete(ws);
    if (sockets?.size === 0) roomSockets.delete(code);
    const anotherConnection = [...(roomSockets.get(code) || [])].some((entry) => entry.actor?.id === actor.id);
    if (!anotherConnection) {
      await leaveRoomInDb(code, actor.id).catch(() => {});
      await broadcastState(code).catch(() => {});
    }
    ws.roomCode = undefined;
  };

  const ensureRoomHost = async (code: string, actorId: string) => {
    const room = await getWatchRoomByCode(code);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    if (room.hostUserId !== actorId) throw new Error('HOST_ONLY');
    return room;
  };

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    let url: URL;
    try { url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`); }
    catch { socket.destroy(); return; }
    if (url.pathname !== '/ws/party' && url.pathname !== '/ws/live') return;
    const origin = request.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== request.headers.host) { socket.destroy(); return; }
      } catch { socket.destroy(); return; }
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      (ws as PartySocket).isAlive = true;
      (ws as PartySocket).msgWindowStarted = Date.now();
      paths.set(ws, url.pathname);
      wss.emit('connection', ws, request);
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      const client = socket as PartySocket;
      if (!client.isAlive) { client.terminate(); continue; }
      client.isAlive = false;
      client.ping();
    }
  }, 30_000);
  heartbeat.unref();

  wss.on('connection', (rawSocket, _request: IncomingMessage) => {
    const ws = rawSocket as PartySocket;
    const pathname = paths.get(ws) || '';
    connections.add(ws);
    ws.on('pong', () => { ws.isAlive = true; });
    const authTimeout = setTimeout(() => ws.close(1008, 'Authentication timeout'), 10_000);
    authTimeout.unref();
    ws.once('message', async (firstFrame) => {
      clearTimeout(authTimeout);
      let first: any;
      try { first = JSON.parse(firstFrame.toString()); } catch { ws.close(1008, 'Authentication required'); return; }
      if (first?.type !== 'auth' || typeof first.token !== 'string' || first.token.length > 16_000) {
        ws.close(1008, 'Authentication required'); return;
      }
      try {
        const verified = await verifyActorToken(first.token);
        ws.actor = verified.actor;
        send(ws, { type: 'auth:ok', actor: { id: verified.actor.id, displayName: verified.actor.displayName, kind: verified.actor.kind } });
      } catch {
        ws.close(1008, 'Invalid or expired session'); return;
      }

      if (pathname === '/ws/live') {
        attachLiveCompanion(ws);
        return;
      }

      ws.on('message', (frame) => { void handlePartyFrame(ws, frame.toString()); });
    });

    const handlePartyFrame = async (client: PartySocket, raw: string) => {
      if (!canSend(client)) { send(client, { type: 'room:error', error: 'Too many room actions. Please slow down.' }); return; }
      if (Buffer.byteLength(raw) > MAX_FRAME_BYTES) { client.close(1009, 'Message too large'); return; }
      let msg: any;
      try { msg = JSON.parse(raw); } catch { send(client, { type: 'room:error', error: 'Invalid message.' }); return; }
      const actor = client.actor;
      if (!actor) { client.close(1008, 'Authentication required'); return; }
      try {
        if (msg.type === 'room:join') {
          const code = normalizeCode(msg.roomId);
          if (!code || typeof msg.roomAccessToken !== 'string' || !verifyRoomAccessToken(msg.roomAccessToken, actor.id, code)) {
            send(client, { type: 'room:error', error: 'A valid room invitation is required.' }); return;
          }
          const room = await getWatchRoomByCode(code);
          if (!room || room.status === 'ended') { send(client, { type: 'room:error', error: 'Watch room was not found.' }); return; }
          if (client.roomCode && client.roomCode !== code) await detachFromRoom(client);
          const name = (typeof msg.memberName === 'string' ? msg.memberName : actor.displayName || 'Cinema Guest').trim().slice(0, 48) || 'Cinema Guest';
          await joinRoomInDb({ roomCode: code, userId: actor.id, displayName: name, role: room.hostUserId === actor.id ? 'host' : 'member' });
          client.roomCode = code;
          if (!roomSockets.has(code)) roomSockets.set(code, new Set());
          roomSockets.get(code)!.add(client);
          await broadcastState(code);
          return;
        }

        const code = client.roomCode;
        if (!code) { send(client, { type: 'room:error', error: 'Join a room before sending actions.' }); return; }
        const room = await getWatchRoomByCode(code);
        if (!room) { send(client, { type: 'room:error', error: 'Watch room was not found.' }); return; }

        if (msg.type === 'playback:update') {
          const canControl = room.hostUserId === actor.id || room.collaborativeControls;
          if (!canControl) throw new Error('HOST_ONLY');
          const current = await getWatchRoomSnapshot(code);
          if (!current) throw new Error('ROOM_NOT_FOUND');
          const isPlaying = typeof msg.isPlaying === 'boolean' ? msg.isPlaying : current.isPlaying;
          const position = typeof msg.currentTimeSeconds === 'number' ? msg.currentTimeSeconds : current.currentTimeSeconds;
          const rate = typeof msg.playbackRate === 'number' ? msg.playbackRate : current.playbackRate;
          if (!Number.isFinite(position) || position < 0 || position > 86_400) throw new Error('INVALID_POSITION');
          if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) throw new Error('INVALID_RATE');
          const mediaId = typeof msg.mediaId === 'string' ? msg.mediaId.trim().slice(0, 120) : current.mediaId;
          if (!mediaId) throw new Error('INVALID_MEDIA');
          const updated = await updatePlaybackStateInDb({ roomCode: code, mediaId, mediaType: room.currentMediaType, status: isPlaying ? 'playing' : 'paused', positionSeconds: position, playbackRate: rate, hostId: room.hostUserId, revision: current.revision + 1, season: Number.isInteger(msg.season) ? Math.max(1, Math.min(99, msg.season)) : current.season, episode: Number.isInteger(msg.episode) ? Math.max(1, Math.min(9999, msg.episode)) : current.episode });
          const snapshot = await getWatchRoomSnapshot(code);
          if (snapshot && updated.revision === snapshot.revision) broadcast(code, { type: 'room:state', room: snapshot });
          return;
        }

        if (msg.type === 'room:settings' || msg.type === 'couple:note') {
          await ensureRoomHost(code, actor.id);
          const settings: Record<string, unknown> = {};
          if (msg.type === 'couple:note') settings.couplePartnerNote = typeof msg.note === 'string' ? msg.note.trim().slice(0, 240) : '';
          if (typeof msg.collaborativeControls === 'boolean') settings.collaborativeControls = msg.collaborativeControls;
          if (typeof msg.isLocked === 'boolean') settings.isLocked = msg.isLocked;
          if (typeof msg.roomTheme === 'string') {
            if (!THEMES.has(msg.roomTheme)) throw new Error('INVALID_THEME');
            settings.roomTheme = msg.roomTheme;
          }
          if (typeof msg.lifecycleState === 'string' && ['waiting', 'joined', 'selecting', 'ready', 'playing', 'paused', 'ended'].includes(msg.lifecycleState)) settings.lifecycleState = msg.lifecycleState;
          if (typeof msg.newHostId === 'string') await transferRoomHost(code, msg.newHostId.slice(0, 160));
          if (Object.keys(settings).length) await updateRoomSettings({ roomCode: code, ...settings } as Parameters<typeof updateRoomSettings>[0]);
          await broadcastState(code);
          return;
        }

        if (msg.type === 'member:kick') {
          await ensureRoomHost(code, actor.id);
          const targetId = typeof msg.targetId === 'string' ? msg.targetId.slice(0, 160) : '';
          if (!targetId || targetId === room.hostUserId) throw new Error('INVALID_MEMBER');
          await removeRoomMember(code, targetId);
          for (const peer of roomSockets.get(code) || []) {
            if (peer.actor?.id === targetId) { send(peer, { type: 'room:kicked' }); peer.close(4003, 'Removed by room host'); }
          }
          await broadcastState(code);
          return;
        }

        if (msg.type === 'chat:send') {
          const content = typeof msg.text === 'string' ? msg.text.trim() : '';
          if (!content || content.length > 500) throw new Error('INVALID_CHAT');
          await recordChatMessageInDb({ roomCode: code, senderId: actor.id, senderName: actor.displayName || 'Cinema Guest', content, messageType: 'chat', videoTimestampSeconds: Math.round(Math.max(0, Math.min(86_400, Number(msg.videoTimestampSeconds) || 0))) });
          await broadcastState(code);
          return;
        }

        if (msg.type === 'reaction:send' || msg.type === 'couple:pulse') {
          const emoji = typeof msg.emoji === 'string' && EMOJIS.has(msg.emoji) ? msg.emoji : null;
          if (!emoji) throw new Error('INVALID_REACTION');
          await recordReactionInDb({ roomCode: code, userId: actor.id, userName: actor.displayName || 'Cinema Guest', emoji });
          const snapshot = await getWatchRoomSnapshot(code);
          sendToRoom(code, { type: 'room:reaction', reaction: { id: cryptoRandomId(), userId: actor.id, userName: actor.displayName || 'Cinema Guest', emoji, xPercent: Math.floor(15 + Math.random() * 70), createdAt: Date.now() }, room: snapshot });
          return;
        }

        if (msg.type === 'vote:cast') {
          await toggleRoomVoteInDb({ roomCode: code, mediaId: bounded(msg.mediaId, 120), mediaTitle: bounded(msg.mediaTitle, 200), voterId: actor.id, voterName: actor.displayName || 'Cinema Guest' });
          await broadcastState(code);
          return;
        }

        if (msg.type === 'member:media-state') {
          // Media-device state is ephemeral and associated only with this authenticated socket.
          sendToRoom(code, { type: 'member:media-state', memberId: actor.id, micMuted: Boolean(msg.micMuted), camEnabled: Boolean(msg.camEnabled) });
          return;
        }

        if (msg.type === 'webrtc:signal') {
          const targetId = bounded(msg.targetId, 160);
          if (!targetId || !msg.signalData || JSON.stringify(msg.signalData).length > 12_000) throw new Error('INVALID_SIGNAL');
          for (const peer of roomSockets.get(code) || []) if (peer.actor?.id === targetId) send(peer, { type: 'webrtc:signal', senderId: actor.id, targetId, signalData: msg.signalData });
          return;
        }

        if (msg.type === 'room:leave') {
          await detachFromRoom(client);
          return;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'ROOM_ACTION_FAILED';
        const messages: Record<string, string> = {
          HOST_ONLY: 'Only the room host can perform this action.',
          ROOM_NOT_FOUND: 'Watch room was not found.',
          ROOM_LOCKED: 'This watch room is locked by the host.',
          ROOM_FULL: 'This watch room has reached its member limit.',
          ROOM_BANNED: 'You were removed from this room.',
          INVALID_CHAT: 'Chat messages must contain 1 to 500 characters.',
          INVALID_REACTION: 'That reaction is not supported.',
          INVALID_RATE: 'Playback rate must be between 0.5 and 2.',
          INVALID_POSITION: 'Playback position is outside the allowed range.',
        };
        send(client, { type: 'room:error', error: messages[reason] || 'Room action could not be completed.' });
      }
    };

    const sendToRoom = (code: string, payload: unknown) => broadcast(code, payload);

    ws.on('close', () => {
      connections.delete(ws);
      void detachFromRoom(ws);
    });
    ws.on('error', () => { void detachFromRoom(ws); });
  });

  function attachLiveCompanion(ws: PartySocket) {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) { send(ws, { type: 'live:status', connected: false, reason: 'AI is not configured.' }); ws.close(1013, 'AI unavailable'); return; }
    const ai = new GoogleGenAI({ apiKey: key });
    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: 'You are CineTogether\'s voice companion. Help with movie metadata and watch party setup. Do not claim that any title is available to stream unless the availability API confirms an authorized source.',
      },
      callbacks: {
        onopen: () => send(ws, { type: 'live:status', connected: true, mode: 'live' }),
        onmessage: (message: LiveServerMessage) => {
          const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audio) send(ws, { type: 'live:audio', audio });
          const output = message.serverContent?.outputTranscription?.text;
          if (output) send(ws, { type: 'live:transcript', role: 'model', text: output });
          const input = message.serverContent?.inputTranscription?.text;
          if (input) send(ws, { type: 'live:transcript', role: 'user', text: input });
          if (message.serverContent?.interrupted) send(ws, { type: 'live:interrupted', interrupted: true });
        },
        onerror: () => send(ws, { type: 'live:status', connected: false, mode: 'error' }),
      },
    });
    ws.on('message', (frame) => {
      if (!canSend(ws)) { send(ws, { type: 'live:status', connected: false, reason: 'Rate limit exceeded.' }); return; }
      try {
        const payload = JSON.parse(frame.toString());
        if (typeof payload.audio === 'string' && payload.audio.length < 96_000) {
          void sessionPromise.then((session) => session.sendRealtimeInput({ audio: { data: payload.audio, mimeType: 'audio/pcm;rate=16000' } })).catch(() => {});
        } else if (typeof payload.textPrompt === 'string' && payload.textPrompt.length <= 1000) {
          void sessionPromise.then((session) => session.sendRealtimeInput({ text: payload.textPrompt })).catch(() => {});
        }
      } catch { send(ws, { type: 'live:status', connected: false, reason: 'Invalid voice message.' }); }
    });
    ws.once('close', () => { void sessionPromise.then((session) => session.close()).catch(() => {}); });
  }

  const cryptoRandomId = () => `react-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const bounded = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';

  return {
    wss,
    close: async () => {
      clearInterval(heartbeat);
      for (const client of connections) client.close(1001, 'Server shutting down');
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
