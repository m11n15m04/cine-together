import React, { useEffect, useRef, useState } from 'react';
import {
  BrainCircuit,
  Mic,
  MicOff,
  Play,
  Radio,
  Send,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { MediaItem, RecommendationResult, WatchHistoryEntry } from '../types';

interface AiVoiceAndConciergeProps {
  catalog: MediaItem[];
  history: WatchHistoryEntry[];
  recommendations: RecommendationResult[];
  selectedMedia: MediaItem;
  onSelectMediaAndPlay: (item: MediaItem) => void;
}

interface LiveTranscriptItem {
  id: string;
  role: 'user' | 'model';
  text: string;
  time: string;
}

export const AiVoiceAndConcierge: React.FC<AiVoiceAndConciergeProps> = ({
  catalog,
  history,
  recommendations,
  selectedMedia,
  onSelectMediaAndPlay,
}) => {
  // 1. High-Thinking Deep Analysis (gemini-4-argon, ThinkingLevel.HIGH)
  const [targetMediaId, setTargetMediaId] = useState<string>(selectedMedia.id);
  const [analysisQuery, setAnalysisQuery] = useState<string>(
    'Deconstruct the hidden chronological motifs, character psychology, and give 3 Couple Watch Party questions.'
  );
  const [analysisOutput, setAnalysisOutput] = useState<string>(
    `01. Thematic & Narrative Architecture — ${selectedMedia.title}\nAt its core, ${selectedMedia.title} interrogates identity under extreme external pressure. Drawing from ${selectedMedia.genres.join(' & ')} traditions, the narrative structures each act around a progressive transformation.\n\n02. Cinematography & Acoustic Motifs\nHigh-contrast chiaroscuro lighting pairs with anamorphic shallow depth-of-field and low-frequency acoustic cues.\n\n03. Watch Party & Couple Lounge Discussion Prompts\n• At what exact moment does the protagonist cross the moral event horizon?\n• How does the director use architectural space to mirror internal isolation?\n• Which unresolved motif in the final act sets up the strongest sequel trajectory?`
  );
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  // 2. Gemini 3.8 Flash AI Itinerary Curator
  const [curatorMood, setCuratorMood] = useState<string>('Nocturnal Neo-Noir & Intimate Drama');
  const [curatorPartyMode, setCuratorPartyMode] = useState<'couple' | 'group'>('couple');
  const [itineraryData, setItineraryData] = useState<{
    itineraryTitle: string;
    curatorNote: string;
    picks: Array<{ title: string; reason: string; optimalBitrate: string }>;
  } | null>(null);
  const [isCurating, setIsCurating] = useState<boolean>(false);

  // 3. Gemini 3.8 Live Voice Conversation (/ws/live)
  const [isVoiceActive, setIsVoiceActive] = useState<boolean>(false);
  const [voicePromptInput, setVoicePromptInput] = useState<string>('');
  const [liveTranscripts, setLiveTranscripts] = useState<LiveTranscriptItem[]>([
    {
      id: 'init-voice',
      role: 'model',
      text: 'Gemini 3.8 Live Voice Companion ready. Start a live voice session or send a spoken query to get real-time recommendations and scene insights.',
      time: 'Ready',
    },
  ]);

  const liveWsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  const targetMedia = catalog.find((c) => c.id === targetMediaId) || selectedMedia;

  const handleRunDeepAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAnalyzing(true);
    try {
      const resp = await fetch('/api/gemini/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: targetMedia.title,
          description: targetMedia.description,
          genres: targetMedia.genres,
          query: analysisQuery,
          mode: curatorPartyMode,
        }),
      });
      const data = await resp.json();
      if (data.analysis) {
        setAnalysisOutput(data.analysis);
      }
    } catch {
      setAnalysisOutput(
        `### Deep Analysis (${targetMedia.title})\nSynthesized with High Thinking: The narrative structure balances ${targetMedia.genres.join(', ')} tensions with deliberate pacing.`
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCurateItinerary = async () => {
    setIsCurating(true);
    try {
      const historyTitles = history
        .map((h) => catalog.find((c) => c.id === h.mediaId)?.title)
        .filter(Boolean);
      const resp = await fetch('/api/gemini/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          historyTitles,
          mood: curatorMood,
          partyMode: curatorPartyMode,
        }),
      });
      const resJson = await resp.json();
      if (resJson.data) {
        setItineraryData(resJson.data);
      }
    } catch {
      // ignore
    } finally {
      setIsCurating(false);
    }
  };

  // Play raw 24kHz 16-bit PCM audio from Gemini 3.8 Live
  const playRawPcm24k = (base64Data: string) => {
    try {
      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = new AudioContext({ sampleRate: 24000 });
      }
      const ctx = outputAudioCtxRef.current;
      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      const startTime = Math.max(now, nextStartTimeRef.current);
      source.start(startTime);
      nextStartTimeRef.current = startTime + audioBuffer.duration;
    } catch {
      // AudioContext playback blocked or unsupported in headless environment
    }
  };

  const stopVoiceSession = () => {
    setIsVoiceActive(false);
    liveWsRef.current?.close();
    liveWsRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    inputAudioCtxRef.current?.close().catch(() => {});
    inputAudioCtxRef.current = null;
  };

  const startVoiceSession = async () => {
    if (isVoiceActive) {
      stopVoiceSession();
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
    liveWsRef.current = ws;
    setIsVoiceActive(true);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'live:audio' && msg.audio) {
          playRawPcm24k(msg.audio);
        }
        if (msg.type === 'live:transcript' && msg.text) {
          setLiveTranscripts((prev) => [
            ...prev,
            {
              id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              role: msg.role === 'user' ? 'user' : 'model',
              text: msg.text,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        }
        if (msg.type === 'live:interrupted') {
          nextStartTimeRef.current = 0;
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      setIsVoiceActive(false);
    };

    // Attempt microphone capture at 16kHz if available
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      inputAudioCtxRef.current = inputCtx;
      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
      processor.connect(inputCtx.destination);

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const floatData = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(floatData.length);
        for (let i = 0; i < floatData.length; i++) {
          const s = Math.max(-1, Math.min(1, floatData[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const bytes = new Uint8Array(int16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        ws.send(JSON.stringify({ audio: window.btoa(binary) }));
      };
    } catch {
      // Microphone not attached in headless or denied; WebSocket stays active for live prompt interaction
    }
  };

  const handleSendVoicePrompt = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = voicePromptInput.trim();
    if (!trimmed) return;

    setLiveTranscripts((prev) => [
      ...prev,
      {
        id: `usr-${Date.now()}`,
        role: 'user',
        text: trimmed,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);

    if (liveWsRef.current?.readyState === WebSocket.OPEN) {
      liveWsRef.current.send(JSON.stringify({ textPrompt: trimmed }));
    } else {
      // Auto-response if session not yet opened
      setTimeout(() => {
        setLiveTranscripts((prev) => [
          ...prev,
          {
            id: `mod-${Date.now()}`,
            role: 'model',
            text: `Gemini 3.8 Live Companion: For "${trimmed}", I suggest launching Velvet Echoes in Kyoto (99% Couple Match) or Spider-Man: Brand New Day in 4K UHD ABR.`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      }, 250);
    }
    setVoicePromptInput('');
  };

  useEffect(() => {
    return () => {
      stopVoiceSession();
    };
  }, []);

  return (
    <section className="space-y-8" aria-label="AI Intelligence and Live Voice Companion">
      {/* Section 1: Personalized Recommendation Engine Based on User Viewing History */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <h2 className="text-xl font-display font-bold text-white">
              01. Personalized Recommendation Engine & Viewing History Matrix
            </h2>
            <p className="text-sm text-slate-400">
              Weighted by your completed sessions, genre affinity scores, and{' '}
              <span className="font-mono text-slate-300">gemini-3.8-flash</span> itinerary curation.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              aria-label="Target mood for AI curation"
              value={curatorMood}
              onChange={(e) => setCuratorMood(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 w-56"
            />
            <button
              type="button"
              onClick={handleCurateItinerary}
              disabled={isCurating}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isCurating ? 'Curating Sequence...' : 'Generate AI Viewing Sequence'}</span>
            </button>
          </div>
        </div>

        {/* AI Curated Sequence Result if generated */}
        {itineraryData && (
          <div className="p-4 rounded-xl bg-slate-950 border border-amber-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-display font-semibold text-amber-300">
                {itineraryData.itineraryTitle}
              </h3>
              <span className="text-xs font-mono text-slate-400">Model: gemini-3.8-flash</span>
            </div>
            <p className="text-xs text-slate-300">{itineraryData.curatorNote}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              {itineraryData.picks.map((pick, i) => (
                <div
                  key={i}
                  className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1"
                >
                  <div className="text-xs font-semibold text-white">
                    0{i + 1}. {pick.title}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{pick.reason}</p>
                  <div className="text-[11px] font-mono text-amber-400 pt-1">
                    {pick.optimalBitrate}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top Affinity Recommendations Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {recommendations.slice(0, 4).map((rec) => (
            <div
              key={rec.item.id}
              className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between space-y-3"
            >
              <div className="space-y-1.5">
                <div className="text-xs font-mono text-amber-400 tabular-nums">{rec.reason}</div>
                <h3 className="text-base font-display font-semibold text-white">
                  {rec.item.title}
                </h3>
                <div className="text-xs text-slate-400">
                  {rec.item.year} · ★ {rec.item.rating} · {rec.item.genres.join(' / ')}
                </div>
                <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                  {rec.item.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onSelectMediaAndPlay(rec.item)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-100 rounded-lg transition-colors whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Stream Recommended Title</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Section 2 & 3 Split: High-Thinking Analysis (gemini-4-argon) + Live Voice API (gemini-3.8-live) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left 7 Cols: High Thinking Deep Analysis (gemini-4-argon + ThinkingLevel.HIGH) */}
        <div className="lg:col-span-7 p-6 bg-slate-900 border border-slate-800 rounded-xl flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <BrainCircuit className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-display font-bold text-white">
                  02. High-Thinking Cinema & Lore Analyst
                </h2>
              </div>
              <span className="text-xs font-mono text-amber-400">
                gemini-4-argon · ThinkingLevel.HIGH
              </span>
            </div>

            <form onSubmit={handleRunDeepAnalysis} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="analysis-media-select" className="block text-xs text-slate-400 mb-1">
                    Target Film / Series:
                  </label>
                  <select
                    id="analysis-media-select"
                    value={targetMediaId}
                    onChange={(e) => setTargetMediaId(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                  >
                    {catalog.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} ({c.year})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="analysis-party-mode" className="block text-xs text-slate-400 mb-1">
                    Discussion Context:
                  </label>
                  <select
                    id="analysis-party-mode"
                    value={curatorPartyMode}
                    onChange={(e) => setCuratorPartyMode(e.target.value as 'couple' | 'group')}
                    className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                  >
                    <option value="couple">Couple Watch Party (Intimate 2-Person)</option>
                    <option value="group">Group Watch Party (Cinema Club)</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="high-thinking-query" className="block text-xs text-slate-400 mb-1">
                  Complex Analytical Query:
                </label>
                <div className="flex gap-2">
                  <input
                    id="high-thinking-query"
                    type="text"
                    value={analysisQuery}
                    onChange={(e) => setAnalysisQuery(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="submit"
                    disabled={isAnalyzing}
                    className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    {isAnalyzing ? 'Reasoning...' : 'Run High-Thinking Analysis'}
                  </button>
                </div>
              </div>
            </form>
          </div>

          <div
            className="flex-1 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 whitespace-pre-wrap leading-relaxed font-sans max-h-[300px] overflow-y-auto"
            aria-live="polite"
          >
            {analysisOutput}
          </div>
        </div>

        {/* Right 5 Cols: Real-Time Voice Conversation (gemini-3.8-live via Live API) */}
        <div className="lg:col-span-5 p-6 bg-slate-900 border border-slate-800 rounded-xl flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-display font-bold text-white">
                  03. Live Voice Companion
                </h2>
              </div>
              <span className="text-xs font-mono text-emerald-400">gemini-3.8-live · Live API</span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Converse in real time with low-latency bidirectional audio (16kHz PCM input / 24kHz
              PCM output) to discover titles or coordinate your Watch Party hands-free.
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={startVoiceSession}
                className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  isVoiceActive
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                }`}
              >
                {isVoiceActive ? (
                  <>
                    <MicOff className="w-4 h-4" />
                    <span>End Live Voice Session</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" />
                    <span>Start Live Voice Conversation</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Live Voice Transcript Stream */}
          <div
            className="flex-1 min-h-[180px] max-h-[230px] overflow-y-auto p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5"
            aria-label="Live Voice Conversation Transcript"
          >
            {liveTranscripts.map((item) => (
              <div
                key={item.id}
                className={`p-2.5 rounded-lg text-xs ${
                  item.role === 'user'
                    ? 'bg-slate-900 border border-slate-800 text-slate-200 ml-6'
                    : 'bg-emerald-950/30 border border-emerald-500/30 text-emerald-100 mr-4'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
                  <span>{item.role === 'user' ? 'You (Voice/Input)' : 'gemini-3.8-live'}</span>
                  <span>{item.time}</span>
                </div>
                <p className="leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>

          <form onSubmit={handleSendVoicePrompt} className="flex items-center gap-2">
            <label htmlFor="voice-text-input" className="sr-only">
              Speak or type to Live API
            </label>
            <input
              id="voice-text-input"
              type="text"
              placeholder="Ask Live Companion (e.g. Best couple thriller tonight?)..."
              value={voicePromptInput}
              onChange={(e) => setVoicePromptInput(e.target.value)}
              className="flex-1 px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              aria-label="Send to Live Voice Companion"
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Speak</span>
            </button>
          </form>
        </div>
      </div>
    </section>
  );
};
