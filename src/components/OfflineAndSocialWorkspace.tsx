import React, { useState } from 'react';
import {
  Bell,
  Check,
  Download,
  HardDrive,
  Heart,
  Lock,
  Play,
  Share2,
  ShieldCheck,
  Trash2,
  WifiOff,
} from 'lucide-react';
import {
  MediaItem,
  OfflineDownloadItem,
  PushNotificationItem,
  QualityTier,
  SecurityPrivacySettings,
  SocialBroadcastPost,
} from '../types';
import {
  estimateOfflineSizeMB,
  formatStorageQuota,
  generatePrivacyFingerprint,
} from '../utils/streamEngine';

interface OfflineAndSocialWorkspaceProps {
  catalog: MediaItem[];
  downloads: OfflineDownloadItem[];
  isOfflineSimulated: boolean;
  onToggleOfflineSimulation: () => void;
  onDownloadMedia: (item: MediaItem, quality: QualityTier) => void;
  onRemoveDownload: (mediaId: string) => void;
  onPlayDownloaded: (mediaId: string) => void;
  socialPosts: SocialBroadcastPost[];
  onCreateSocialPost: (post: Omit<SocialBroadcastPost, 'id' | 'likes' | 'createdAt'>) => void;
  onLikeSocialPost: (postId: string) => void;
  securitySettings: SecurityPrivacySettings;
  onUpdateSecurity: (next: SecurityPrivacySettings) => void;
  notifications: PushNotificationItem[];
  onMarkAllNotificationsRead: () => void;
}

export const OfflineAndSocialWorkspace: React.FC<OfflineAndSocialWorkspaceProps> = ({
  catalog,
  downloads,
  isOfflineSimulated,
  onToggleOfflineSimulation,
  onDownloadMedia,
  onRemoveDownload,
  onPlayDownloaded,
  socialPosts,
  onCreateSocialPost,
  onLikeSocialPost,
  securitySettings,
  onUpdateSecurity,
  notifications,
  onMarkAllNotificationsRead,
}) => {
  const [selectedDownloadMediaId, setSelectedDownloadMediaId] = useState<string>(
    catalog[0]?.id || 'nx-1400940'
  );
  const [selectedDownloadQuality, setSelectedDownloadQuality] =
    useState<QualityTier>('1080p FHD');

  // Social Broadcast Form State
  const [shareMediaId, setShareMediaId] = useState<string>(catalog[0]?.id || 'nx-1400940');
  const [shareTimestamp, setShareTimestamp] = useState<string>('24:15');
  const [sharePlatform, setSharePlatform] =
    useState<SocialBroadcastPost['platformTarget']>('Community Feed');
  const [shareCaption, setShareCaption] = useState<string>('');
  const [broadcastSuccess, setBroadcastSuccess] = useState<boolean>(false);

  const quota = formatStorageQuota(downloads, 8192);
  const privacyFingerprint = generatePrivacyFingerprint(
    'm11n15m04@gmail.com',
    securitySettings.strictCoupleRoomPin
  );

  const handleQueueNewDownload = () => {
    const found = catalog.find((c) => c.id === selectedDownloadMediaId);
    if (found) {
      onDownloadMedia(found, selectedDownloadQuality);
    }
  };

  const handleBroadcastSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = shareCaption.trim();
    if (!trimmed) return;
    const media = catalog.find((c) => c.id === shareMediaId) || catalog[0];
    onCreateSocialPost({
      authorName: 'Alex Rivera',
      authorHandle: '@alex_nxsha',
      mediaId: media.id,
      mediaTitle: media.title,
      ClipTimestamp: shareTimestamp || '12:00',
      caption: trimmed,
      platformTarget: sharePlatform,
    });
    setShareCaption('');
    setBroadcastSuccess(true);
    setTimeout(() => setBroadcastSuccess(false), 2500);
  };

  return (
    <section className="space-y-8" aria-label="Offline Playback Vault, Social Broadcast, and Security">
      {/* 1. Offline Playback & Download Vault */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <HardDrive className="w-5 h-5 text-amber-400" />
              <h2 className="text-xl font-display font-bold text-white">
                01. Offline Playback Vault & Local Cache
              </h2>
            </div>
            <p className="text-sm text-slate-400">
              Download titles from <span className="font-mono text-slate-300">nxsha.space</span> in
              AV1/HEVC containers for uninterrupted playback without an active internet connection.
            </p>
          </div>

          <button
            type="button"
            onClick={onToggleOfflineSimulation}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              isOfflineSimulated
                ? 'bg-amber-500 text-slate-950 border-amber-400'
                : 'bg-slate-950 text-slate-200 border-slate-800 hover:border-slate-700'
            }`}
          >
            <WifiOff className="w-4 h-4" />
            <span>
              {isOfflineSimulated
                ? 'Offline Airplane Mode: ACTIVE (Playing Local Vault)'
                : 'Simulate Offline Mode'}
            </span>
          </button>
        </div>

        {/* Storage Quota & Quick Download Bar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-5 p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Encrypted IndexedDB Vault Usage</span>
              <span className="font-mono tabular-nums text-slate-200">
                {(quota.usedMB / 1024).toFixed(2)} GB / 8.00 GB ({quota.percentUsed}%)
              </span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-transform origin-left"
                style={{ transform: `scaleX(${Math.max(0.03, quota.percentUsed / 100)})` }}
              />
            </div>
            <div className="text-[11px] text-slate-400 font-mono tabular-nums">
              {quota.completedCount} titles ready for zero-network playback ·{' '}
              {(quota.availableMB / 1024).toFixed(2)} GB free
            </div>
          </div>

          <div className="lg:col-span-7 p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex-1 min-w-[180px]">
              <label htmlFor="offline-title-select" className="block text-xs text-slate-400 mb-1">
                Select Title to Download Offline:
              </label>
              <select
                id="offline-title-select"
                value={selectedDownloadMediaId}
                onChange={(e) => setSelectedDownloadMediaId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100"
              >
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.durationMinutes}m)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="offline-quality-select" className="block text-xs text-slate-400 mb-1">
                Target Bitrate / Size:
              </label>
              <select
                id="offline-quality-select"
                value={selectedDownloadQuality}
                onChange={(e) => setSelectedDownloadQuality(e.target.value as QualityTier)}
                className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 font-mono"
              >
                <option value="4K UHD">
                  4K UHD (~{estimateOfflineSizeMB(120, '4K UHD')} MB)
                </option>
                <option value="1080p FHD">
                  1080p FHD (~{estimateOfflineSizeMB(120, '1080p FHD')} MB)
                </option>
                <option value="720p HD">
                  720p HD (~{estimateOfflineSizeMB(120, '720p HD')} MB)
                </option>
                <option value="480p Saver">
                  480p Saver (~{estimateOfflineSizeMB(120, '480p Saver')} MB)
                </option>
              </select>
            </div>

            <div className="pt-4">
              <button
                type="button"
                onClick={handleQueueNewDownload}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download to Device</span>
              </button>
            </div>
          </div>
        </div>

        {/* Downloaded Items Table / Grid */}
        {downloads.length === 0 ? (
          <div className="p-8 text-center bg-slate-950 border border-slate-800 rounded-xl space-y-2">
            <p className="text-sm text-slate-300 font-medium">
              Your Offline Vault is currently empty.
            </p>
            <p className="text-xs text-slate-500">
              Select a film or episode above and click &ldquo;Download to Device&rdquo; for offline
              on-the-go viewing.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {downloads.map((dl) => (
              <div
                key={dl.mediaId}
                className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between space-y-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono text-slate-400 tabular-nums">
                    <span>
                      {dl.quality} · {dl.sizeMB} MB
                    </span>
                    <span className="text-emerald-400">
                      {dl.status === 'completed' ? 'Offline Ready' : `${dl.progress}%`}
                    </span>
                  </div>
                  <h3 className="text-base font-display font-semibold text-white">{dl.title}</h3>
                  <div className="text-xs text-slate-500 font-mono">
                    Saved {dl.downloadedAt} · {dl.durationMinutes} mins
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => onPlayDownloaded(dl.mediaId)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Play Offline</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveDownload(dl.mediaId)}
                    aria-label={`Delete offline download ${dl.title}`}
                    className="p-2 text-slate-400 hover:text-rose-400 bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2 & 3 Split: Social Sharing Broadcast + Security & Privacy Vault */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left 7 Cols: Social Sharing & Community Broadcast */}
        <div className="lg:col-span-7 p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <Share2 className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-display font-bold text-white">
                02. Social Broadcast & Community Feed
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              Share timestamped scenes across platforms
            </span>
          </div>

          <form onSubmit={handleBroadcastSubmit} className="space-y-3 p-4 bg-slate-950 border border-slate-800 rounded-xl">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="share-media-select" className="block text-xs text-slate-400 mb-1">
                  Title to Broadcast:
                </label>
                <select
                  id="share-media-select"
                  value={shareMediaId}
                  onChange={(e) => setShareMediaId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100"
                >
                  {catalog.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="share-timestamp-input" className="block text-xs text-slate-400 mb-1">
                  Clip Timestamp:
                </label>
                <input
                  id="share-timestamp-input"
                  type="text"
                  value={shareTimestamp}
                  onChange={(e) => setShareTimestamp(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-900 border border-slate-800 rounded-lg text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="share-platform-select" className="block text-xs text-slate-400 mb-1">
                  Destination Channel:
                </label>
                <select
                  id="share-platform-select"
                  value={sharePlatform}
                  onChange={(e) =>
                    setSharePlatform(e.target.value as SocialBroadcastPost['platformTarget'])
                  }
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100"
                >
                  <option value="Community Feed">Nxsha Community Feed</option>
                  <option value="Couple Note">Couple Lounge Highlight</option>
                  <option value="X / Twitter">X / Twitter</option>
                  <option value="Discord">Discord Webhook</option>
                  <option value="Telegram">Telegram Channel</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <label htmlFor="share-caption-input" className="sr-only">
                Broadcast Commentary
              </label>
              <input
                id="share-caption-input"
                type="text"
                placeholder="Write your reaction or invite friends to join at this timestamp..."
                value={shareCaption}
                onChange={(e) => setShareCaption(e.target.value)}
                className="flex-1 px-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {broadcastSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Broadcasted</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Broadcast Clip</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Community Posts Feed */}
          <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
            {socialPosts.map((post) => (
              <div
                key={post.id}
                className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-start justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-semibold text-white">{post.authorName}</span>
                    <span className="font-mono">{post.authorHandle}</span>
                    <span>·</span>
                    <span>{post.platformTarget}</span>
                    <span>·</span>
                    <span className="font-mono text-amber-400">
                      {post.mediaTitle} @{post.ClipTimestamp}
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed">{post.caption}</p>
                </div>

                <button
                  type="button"
                  onClick={() => onLikeSocialPost(post.id)}
                  aria-label={`Like broadcast by ${post.authorName}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono tabular-nums bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-300 shrink-0"
                >
                  <Heart className="w-3.5 h-3.5 text-pink-500" />
                  <span>{post.likes}</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right 5 Cols: Robust Security, Content Privacy & Push Notifications */}
        <div className="lg:col-span-5 p-6 bg-slate-900 border border-slate-800 rounded-xl flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-display font-bold text-white">
                  03. Security & Privacy Controls
                </h2>
              </div>
              <Lock className="w-4 h-4 text-slate-400" />
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400">Client Session Fingerprint:</span>
              <span className="font-mono text-emerald-400">{privacyFingerprint}</span>
            </div>

            {/* Security Toggles */}
            <div className="space-y-2.5">
              <label className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-white">
                    Private Local History Storage
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Store viewing history locally in browser storage without cloud telemetry
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={securitySettings.e2eHistoryEncryption}
                  onChange={(e) =>
                    onUpdateSecurity({
                      ...securitySettings,
                      e2eHistoryEncryption: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-amber-500"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-white">
                    Incognito Cinema Session
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Pause history logging and hide presence from public rooms
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={securitySettings.incognitoSession}
                  onChange={(e) =>
                    onUpdateSecurity({
                      ...securitySettings,
                      incognitoSession: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-amber-500"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-white">
                    Couple Lounge PIN Protection
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Require 2-seat verification PIN before joining Couple Watch Party
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={securitySettings.drmWatermarkProtection}
                  onChange={(e) =>
                    onUpdateSecurity({
                      ...securitySettings,
                      drmWatermarkProtection: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-amber-500"
                />
              </label>
            </div>
          </div>

          {/* Push Notifications Feed for New Episodes & Trending Releases */}
          <div className="space-y-2.5 pt-3 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Bell className="w-3.5 h-3.5 text-amber-400" />
                <span>Episode & Release Push Alerts</span>
              </div>
              <button
                type="button"
                onClick={onMarkAllNotificationsRead}
                className="text-[11px] text-amber-400 hover:underline"
              >
                Mark All Read
              </button>
            </div>

            <div className="space-y-2 max-h-[140px] overflow-y-auto">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`p-2.5 rounded-lg border text-xs ${
                    n.read
                      ? 'bg-slate-950/60 border-slate-800/60 text-slate-400'
                      : 'bg-slate-950 border-amber-500/40 text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between font-medium text-white mb-0.5">
                    <span>{n.title}</span>
                    <span className="text-[10px] font-mono text-slate-400">{n.createdAt}</span>
                  </div>
                  <p className="text-[11px] text-slate-400">{n.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
