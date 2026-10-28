import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Bookmark,
  Check,
  Compass,
  Database,
  Download,
  ExternalLink,
  Film,
  Flame,
  Globe,
  HardDrive,
  Heart,
  Layers,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Sun,
  Tv,
  User,
  Users,
} from 'lucide-react';
import {
  INITIAL_CATALOG,
  INITIAL_NOTIFICATIONS,
  INITIAL_SOCIAL_POSTS,
  INITIAL_WATCH_HISTORY,
} from './data/catalog';
import {
  BRAND_CONFIG,
  MediaItem,
  OfflineDownloadItem,
  PushNotificationItem,
  QualityTier,
  RoomMode,
  SecurityPrivacySettings,
  SocialBroadcastPost,
  UserProfile,
  WatchHistoryEntry,
} from './types';
import {
  computePersonalizedRecommendations,
  deduplicateAndMergeCatalog,
  estimateOfflineSizeMB,
  filterAndSearchCatalog,
  paginateCatalog,
} from './utils/streamEngine';
import { MediaPoster } from './components/MediaPoster';
import { AdaptiveVideoPlayer } from './components/AdaptiveVideoPlayer';
import { WatchPartyWorkspace } from './components/WatchPartyWorkspace';
import { AiVoiceAndConcierge } from './components/AiVoiceAndConcierge';
import { OfflineAndSocialWorkspace } from './components/OfflineAndSocialWorkspace';
import {
  CreateJoinPartyView,
  MediaDetailView,
  ProfileAndAuthView,
} from './components/CineTogetherViews';

type ActiveTab =
  | 'home'
  | 'movies'
  | 'tv'
  | 'anime'
  | 'my-list'
  | 'watch-parties'
  | 'create-party'
  | 'couple-room'
  | 'group-room'
  | 'media-detail'
  | 'profile'
  | 'ai-voice'
  | 'offline-social';

const PLATFORMS = [
  'All Platforms',
  'CineTogether Originals',
  'Nxsha Originals',
  'Netflix',
  'Prime Video',
  'Disney+',
  'Crunchyroll',
  'Max',
];

const LANGUAGES = [
  'All Languages',
  'English',
  'Japanese',
  'Korean',
  'French',
  'Spanish',
  'Hindi',
];

const GENRE_FILTERS = [
  'All Genres',
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Crime',
  'Drama',
  'Fantasy',
  'Horror',
  'Mystery',
  'Romance',
  'Sci-Fi',
  'Thriller',
];

const YEAR_FILTERS = ['All Years', '2026', '2025', '2024', '2023', '2022', '2021', '2020'];

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [catalog, setCatalog] = useState<MediaItem[]>(INITIAL_CATALOG);
  const [catalogLoading, setCatalogLoading] = useState<boolean>(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogBackendPage, setCatalogBackendPage] = useState<number>(1);
  const [catalogBackendHasMore, setCatalogBackendHasMore] = useState<boolean>(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState<boolean>(false);

  // Independent feeds for homepage sections
  const [trendingFeed, setTrendingFeed] = useState<MediaItem[]>([]);
  const [popularMoviesFeed, setPopularMoviesFeed] = useState<MediaItem[]>([]);
  const [popularTvFeed, setPopularTvFeed] = useState<MediaItem[]>([]);
  const [trendingLoading, setTrendingLoading] = useState<boolean>(false);
  const [popularMoviesLoading, setPopularMoviesLoading] = useState<boolean>(false);
  const [popularTvLoading, setPopularTvLoading] = useState<boolean>(false);

  // Server health state
  const [providerHealth, setProviderHealth] = useState<{
    tmdbReachable: boolean;
    nxshaReachable: boolean;
    authType?: string;
  } | null>(null);

  // Server search feedback
  const [serverSearchMetadata, setServerSearchMetadata] = useState<{
    totalResults: number;
    providers: string[];
    query: string;
  } | null>(null);

  const [nxshaSourceLabel, setNxshaSourceLabel] = useState<string>(
    'CineTogether Unified Live Catalog (TMDB + Nxsha + Studio)'
  );
  const [isDemoData, setIsDemoData] = useState<boolean>(false);

  // Active Watch Room Code & Mode
  const [activeRoomCode, setActiveRoomCode] = useState<string>('LOVE-2026');
  const [activeRoomMode, setActiveRoomMode] = useState<RoomMode>('couple');

  // User Profile (persisted in localStorage + Cloud SQL)
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    try {
      const saved = window.localStorage.getItem('cinetogether_profile');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return {
      uid: `usr-${Math.random().toString(36).slice(2, 8)}`,
      email: 'alex@cinetogether.app',
      displayName: 'Alex Rivera',
      preferredTheme: 'rose-nebula',
      isGuest: true,
    };
  });

  // Theme & Enhanced Night Viewing Mode
  const [themeMode, setThemeMode] = useState<'oled-dark' | 'daylight'>('oled-dark');

  // Search & Discovery Filters + Pagination
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [liveSearchLoading, setLiveSearchLoading] = useState<boolean>(false);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'movie' | 'tv' | 'anime'>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('All Platforms');
  const [languageFilter, setLanguageFilter] = useState<string>('All Languages');
  const [genreFilter, setGenreFilter] = useState<string>('All Genres');
  const [yearFilter, setYearFilter] = useState<string>('All Years');
  const [sortBy, setSortBy] = useState<'popularity' | 'rating' | 'release' | 'title'>('popularity');
  const [catalogPage, setCatalogPage] = useState<number>(1);
  const PAGE_SIZE = 24;

  // Active Media & Inline Theater Modal State
  const [selectedMedia, setSelectedMedia] = useState<MediaItem>(INITIAL_CATALOG[0]);
  const [isTheaterOpen, setIsTheaterOpen] = useState<boolean>(false);

  // User Watch History & My List (Watchlist)
  const [watchHistory, setWatchHistory] = useState<WatchHistoryEntry[]>(INITIAL_WATCH_HISTORY);
  const [likedIds, setLikedIds] = useState<string[]>(['nx-204988', 'nx-969681', 'nx-278']);

  // Offline Vault Downloads
  const [downloads, setDownloads] = useState<OfflineDownloadItem[]>([
    {
      mediaId: 'nx-204988',
      title: 'Velvet Echoes in Kyoto',
      mediaType: 'tv',
      quality: '4K UHD',
      sizeMB: 1456,
      downloadedAt: 'Today, 21:05',
      streamUrl: '/api/media/stream/nx-204988',
      blobAvailable: true,
      progress: 100,
      status: 'completed',
      accentColor: '#ec4899',
      secondaryColor: '#3b0764',
      year: '2026',
      durationMinutes: 52,
    },
    {
      mediaId: 'nx-969681',
      title: 'Spider-Man: Brand New Day',
      mediaType: 'movie',
      quality: '1080p FHD',
      sizeMB: 1562,
      downloadedAt: 'Today, 20:15',
      streamUrl: '/api/media/stream/nx-969681',
      blobAvailable: true,
      progress: 100,
      status: 'completed',
      accentColor: '#8b5cf6',
      secondaryColor: '#1e1b4b',
      year: '2026',
      durationMinutes: 142,
    },
  ]);
  const [isOfflineSimulated, setIsOfflineSimulated] = useState<boolean>(false);

  // Social Broadcast Posts & Toast Feedback
  const [socialPosts, setSocialPosts] = useState<SocialBroadcastPost[]>(INITIAL_SOCIAL_POSTS);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Security & Privacy Settings
  const [securitySettings, setSecuritySettings] = useState<SecurityPrivacySettings>({
    e2eHistoryEncryption: true,
    incognitoSession: false,
    drmWatermarkProtection: true,
    strictCoupleRoomPin: '7749',
    autoClearCacheHours: 24,
    dnsOverHttpsSource: true,
  });

  // Push Notifications
  const [notifications, setNotifications] =
    useState<PushNotificationItem[]>(INITIAL_NOTIFICATIONS);
  const [showNotifPopover, setShowNotifPopover] = useState<boolean>(false);

  // Parse URL route or invite query params (?room=LOVE-2026&mode=couple or /room/couple/LOVE-2026) on mount
  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      const modeParam = params.get('mode');
      const path = window.location.pathname;

      if (roomParam) {
        const cleanCode = roomParam.trim().toUpperCase();
        const mode: RoomMode =
          modeParam === 'couple' || cleanCode.startsWith('LOVE') ? 'couple' : 'group';
        setActiveRoomCode(cleanCode);
        setActiveRoomMode(mode);
        setActiveTab(mode === 'couple' ? 'couple-room' : 'group-room');
        return;
      }

      if (path.startsWith('/room/couple/')) {
        const code = path.replace('/room/couple/', '').trim().toUpperCase() || 'LOVE-2026';
        setActiveRoomCode(code);
        setActiveRoomMode('couple');
        setActiveTab('couple-room');
      } else if (path.startsWith('/room/group/')) {
        const code = path.replace('/room/group/', '').trim().toUpperCase() || 'CLUB-4096';
        setActiveRoomCode(code);
        setActiveRoomMode('group');
        setActiveTab('group-room');
      } else if (path === '/create-party' || path === '/join') {
        setActiveTab('create-party');
      } else if (path === '/movies') {
        setCategoryFilter('movie');
        setActiveTab('movies');
      } else if (path === '/tv') {
        setCategoryFilter('tv');
        setActiveTab('tv');
      } else if (path === '/anime') {
        setCategoryFilter('anime');
        setActiveTab('anime');
      } else if (path === '/watchlist') {
        setActiveTab('my-list');
      } else if (path === '/profile' || path === '/auth') {
        setActiveTab('profile');
      }
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  // Load unified catalog & independent feeds (trending, popular movies, popular TV) + health
  const loadInitialFeeds = () => {
    setCatalogLoading(true);
    setCatalogError(null);

    // 0. Check Catalog Health
    fetch('/api/health/catalog')
      .then((r) => r.json())
      .then((data) => {
        if (data.providers) {
          setProviderHealth({
            tmdbReachable: Boolean(data.providers.tmdb?.reachable),
            nxshaReachable: Boolean(data.providers.nxsha?.reachable),
            authType: data.providers.tmdb?.authType,
          });
        }
      })
      .catch(() => {});

    // 1. Unified Catalog Feed (page 1)
    fetch('/api/catalog/feed?section=all&page=1&pageSize=36')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.items) && data.items.length > 0) {
          setCatalog((prev) => deduplicateAndMergeCatalog(data.items, prev));
          setNxshaSourceLabel(data.source || 'CineTogether Unified Live Catalog');
          setIsDemoData(Boolean(data.isDemoFallback));
          setCatalogBackendPage(1);
          setCatalogBackendHasMore(Boolean(data.hasMore));
        }
      })
      .catch(() => {
        setCatalogError('Could not load live catalog. Check network or retry.');
      })
      .finally(() => {
        setCatalogLoading(false);
      });

    // 2. Independent TMDB Trending Feed
    setTrendingLoading(true);
    fetch('/api/catalog/feed?section=trending&page=1&pageSize=12')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.items)) {
          setTrendingFeed(data.items);
        }
      })
      .catch(() => {})
      .finally(() => setTrendingLoading(false));

    // 3. Independent TMDB Popular Movies Feed
    setPopularMoviesLoading(true);
    fetch('/api/catalog/feed?section=popular-movies&page=1&pageSize=12')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.items)) {
          setPopularMoviesFeed(data.items);
        }
      })
      .catch(() => {})
      .finally(() => setPopularMoviesLoading(false));

    // 4. Independent TMDB Popular TV Feed
    setPopularTvLoading(true);
    fetch('/api/catalog/feed?section=popular-tv&page=1&pageSize=12')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.items)) {
          setPopularTvFeed(data.items);
        }
      })
      .catch(() => {})
      .finally(() => setPopularTvLoading(false));
  };

  useEffect(() => {
    loadInitialFeeds();

    fetch(`/api/watchlist?userId=${encodeURIComponent(userProfile.uid)}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.items) && data.items.length > 0) {
          const dbIds = data.items.map((i: { mediaId: string }) => i.mediaId);
          setLikedIds((prev) => Array.from(new Set([...prev, ...dbIds])));
        }
      })
      .catch(() => {});
  }, [userProfile.uid]);

  // Handle Dynamic "Load More" from backend provider
  const handleLoadMoreCatalog = async () => {
    if (catalogLoadingMore) return;
    setCatalogLoadingMore(true);

    const section =
      categoryFilter === 'movie'
        ? 'popular-movies'
        : categoryFilter === 'tv'
        ? 'popular-tv'
        : 'all';
    const nextPage = catalogBackendPage + 1;

    try {
      const resp = await fetch(
        `/api/catalog/feed?section=${section}&page=${nextPage}&pageSize=24`
      );
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.items) && data.items.length > 0) {
          setCatalog((prev) => deduplicateAndMergeCatalog(prev, data.items));
          setCatalogBackendPage(nextPage);
          setCatalogBackendHasMore(Boolean(data.hasMore));
          setCatalogPage((prev) => prev + 1);
        } else {
          setCatalogBackendHasMore(false);
        }
      }
    } catch {
      // Keep existing items, allow retry
    } finally {
      setCatalogLoadingMore(false);
    }
  };

  // Debounced server-backed multi-provider search against /api/catalog/search?q=...
  useEffect(() => {
    const trimmed = searchQuery.trim();
    setCatalogPage(1);
    if (trimmed.length < 2) {
      setLiveSearchLoading(false);
      setServerSearchMetadata(null);
      return;
    }

    let active = true;
    setLiveSearchLoading(true);
    const timer = setTimeout(() => {
      fetch(
        `/api/catalog/search?q=${encodeURIComponent(trimmed)}&type=${
          categoryFilter === 'all' ? 'all' : categoryFilter
        }`
      )
        .then((r) => r.json())
        .then((data) => {
          if (!active) return;
          if (Array.isArray(data.items)) {
            setCatalog((prev) => deduplicateAndMergeCatalog(data.items, prev));
            setServerSearchMetadata({
              totalResults: data.totalResults ?? data.items.length,
              providers: data.providers || ['tmdb', 'nxsha'],
              query: trimmed,
            });
          }
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLiveSearchLoading(false);
        });
    }, 280);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, categoryFilter]);

  const navigateToTab = (tab: ActiveTab, customPath?: string) => {
    setActiveTab(tab);
    if (tab === 'movies') setCategoryFilter('movie');
    else if (tab === 'tv') setCategoryFilter('tv');
    else if (tab === 'anime') setCategoryFilter('anime');
    else if (tab === 'home') setCategoryFilter('all');

    try {
      const targetUrl =
        customPath ||
        (tab === 'home'
          ? '/'
          : tab === 'movies'
          ? '/movies'
          : tab === 'tv'
          ? '/tv'
          : tab === 'anime'
          ? '/anime'
          : tab === 'my-list'
          ? '/watchlist'
          : tab === 'create-party' || tab === 'watch-parties'
          ? '/create-party'
          : tab === 'couple-room'
          ? `/room/couple/${activeRoomCode}`
          : tab === 'group-room'
          ? `/room/group/${activeRoomCode}`
          : tab === 'profile'
          ? '/profile'
          : '/');
      window.history.pushState({}, '', targetUrl);
    } catch {
      // ignore in restricted iframe contexts
    }
  };

  const triggerBanner = (msg: string) => {
    setStatusBanner(msg);
    setTimeout(() => {
      setStatusBanner((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  // Filtered catalog & Paginated Slice
  const filteredCatalog = useMemo(() => {
    return filterAndSearchCatalog(
      catalog,
      searchQuery,
      categoryFilter,
      platformFilter,
      0,
      {
        genre: genreFilter,
        year: yearFilter,
        language: languageFilter,
        sortBy,
      }
    );
  }, [
    catalog,
    searchQuery,
    categoryFilter,
    platformFilter,
    genreFilter,
    yearFilter,
    languageFilter,
    sortBy,
  ]);

  const paginatedCatalog = useMemo(
    () => paginateCatalog(filteredCatalog, catalogPage, PAGE_SIZE),
    [filteredCatalog, catalogPage]
  );

  const recommendations = useMemo(
    () => computePersonalizedRecommendations(catalog, watchHistory, likedIds),
    [catalog, watchHistory, likedIds]
  );

  const coupleFavorites = useMemo(
    () =>
      [...catalog].sort((a, b) => (b.coupleScore || 85) - (a.coupleScore || 85)).slice(0, 4),
    [catalog]
  );

  const groupNightFavorites = useMemo(
    () =>
      [...catalog]
        .sort((a, b) => (b.groupNightScore || 85) - (a.groupNightScore || 85))
        .slice(0, 4),
    [catalog]
  );

  const popularThisWeek = useMemo(
    () => catalog.filter((c) => c.isPopularThisWeek || c.rating >= 8.7).slice(0, 4),
    [catalog]
  );

  const recentlyAdded = useMemo(
    () => catalog.filter((c) => c.isRecentlyAdded).slice(0, 4),
    [catalog]
  );

  const myWatchlistItems = useMemo(
    () => catalog.filter((c) => likedIds.includes(c.id)),
    [catalog, likedIds]
  );

  const handleStartWatching = (item: MediaItem) => {
    setSelectedMedia(item);
    setIsTheaterOpen(true);
    setActiveTab('home');

    if (!securitySettings.incognitoSession) {
      setWatchHistory((prev) => {
        const filtered = prev.filter((h) => h.mediaId !== item.id);
        return [
          {
            mediaId: item.id,
            watchedAt: new Date().toISOString(),
            progressSeconds: 300,
            durationSeconds: (item.durationMinutes || 110) * 60,
            completed: false,
            genres: item.genres,
            platform: item.platform,
            roomType: 'solo',
          },
          ...filtered,
        ];
      });

      fetch('/api/sessions/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userProfile.uid,
          mediaId: item.id,
          mediaTitle: item.title,
          mediaType: item.mediaType,
          roomType: 'solo',
          progressSeconds: 300,
          durationSeconds: (item.durationMinutes || 110) * 60,
        }),
      }).catch(() => {});
    }
  };

  const handleOpenMediaDetail = (item: MediaItem) => {
    setSelectedMedia(item);
    navigateToTab('media-detail', `/media/${item.mediaType}/${item.id}`);
  };

  const handleDownloadMedia = (item: MediaItem, quality: QualityTier = '1080p FHD') => {
    const sizeMB = estimateOfflineSizeMB(item.durationMinutes, quality);
    setDownloads((prev) => {
      const exists = prev.some((d) => d.mediaId === item.id);
      if (exists) {
        return prev.map((d) =>
          d.mediaId === item.id ? { ...d, quality, sizeMB, status: 'completed', progress: 100 } : d
        );
      }
      return [
        {
          mediaId: item.id,
          title: item.title,
          mediaType: item.mediaType,
          quality,
          sizeMB,
          downloadedAt: 'Just now',
          streamUrl: item.streamUrl,
          blobAvailable: true,
          progress: 100,
          status: 'completed',
          accentColor: item.accentColor,
          secondaryColor: item.secondaryColor,
          year: item.year,
          durationMinutes: item.durationMinutes,
        },
        ...prev,
      ];
    });
    triggerBanner(`Downloaded "${item.title}" (${quality} · ${sizeMB} MB) to Offline Vault.`);
  };

  const handleRemoveDownload = (mediaId: string) => {
    setDownloads((prev) => prev.filter((d) => d.mediaId !== mediaId));
    triggerBanner('Removed title from Offline Vault.');
  };

  const handleQuickShare = (item: MediaItem, timestampFormatted: string) => {
    const newPost: SocialBroadcastPost = {
      id: `post-${Date.now()}`,
      authorName: userProfile.displayName,
      authorHandle: `@${userProfile.displayName.toLowerCase().replace(/\s+/g, '_')}`,
      mediaId: item.id,
      mediaTitle: item.title,
      ClipTimestamp: timestampFormatted,
      caption: `Watching ${item.title} at ${timestampFormatted} on ${BRAND_CONFIG.name}! Join our Watch Party.`,
      platformTarget: 'Community Feed',
      likes: 1,
      createdAt: 'Just now',
    };
    setSocialPosts((prev) => [newPost, ...prev]);
    triggerBanner(`Shared "${item.title}" moment (@${timestampFormatted}) to Community Feed.`);
  };

  const handleToggleWatchlist = async (item: MediaItem) => {
    const alreadyLiked = likedIds.includes(item.id);
    setLikedIds((prev) =>
      alreadyLiked ? prev.filter((id) => id !== item.id) : [...prev, item.id]
    );
    triggerBanner(
      alreadyLiked
        ? `Removed "${item.title}" from My List.`
        : `Saved "${item.title}" to My List (Cloud SQL Synced).`
    );

    try {
      await fetch('/api/watchlist/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userProfile.uid,
          mediaId: item.id,
          mediaTitle: item.title,
          mediaType: item.mediaType,
          posterUrl: `/poster/${item.id}`,
          year: item.year,
          rating: item.rating,
        }),
      });
    } catch {
      // Optimistic state preserved
    }
  };

  const unreadNotifCount = notifications.filter((n) => !n.read).length;
  const isDark = themeMode === 'oled-dark';

  return (
    <div
      className={`min-h-screen transition-colors pb-20 md:pb-12 ${
        isDark
          ? 'bg-[#070913] text-slate-100'
          : 'bg-[#0f172a] text-slate-100 sepia-[0.06]'
      }`}
    >
      {/* Persistent Streaming-Service Navigation Bar */}
      <header
        className={`sticky top-0 z-40 flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 border-b backdrop-blur-xl ${
          isDark
            ? 'bg-[#070913]/90 border-violet-500/15 text-slate-100'
            : 'bg-slate-900/95 border-violet-500/25 text-slate-100'
        }`}
      >
        {/* Brand Identity */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigateToTab('home', '/');
          }}
          className="flex items-center gap-2.5 shrink-0"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-rose-500 flex items-center justify-center text-white font-display font-bold text-sm shadow-md">
            CT
          </div>
          <div>
            <span className="text-lg font-display font-bold tracking-tight bg-gradient-to-r from-white via-violet-200 to-rose-200 bg-clip-text text-transparent">
              {BRAND_CONFIG.name}
            </span>
          </div>
        </a>

        {/* Persistent Navigation Links: Home | Movies | TV Shows | Anime | My List | Watch Parties */}
        <nav
          aria-label="Primary Streaming Navigation"
          className="hidden lg:flex items-center gap-5 text-xs font-medium"
        >
          {(
            [
              { id: 'home', label: 'Home' },
              { id: 'movies', label: 'Movies' },
              { id: 'tv', label: 'TV Shows' },
              { id: 'anime', label: 'Anime' },
              { id: 'my-list', label: `My List (${likedIds.length})` },
              { id: 'couple-room', label: 'Couple Cinema ❤️' },
              { id: 'group-room', label: 'Group Cinema 🎉' },
              { id: 'ai-voice', label: 'AI Companion' },
              { id: 'offline-social', label: 'Offline & Social' },
            ] as const
          ).map((navItem) => {
            const isActive = activeTab === navItem.id;
            return (
              <button
                key={navItem.id}
                type="button"
                onClick={() => navigateToTab(navItem.id)}
                className={`transition-colors whitespace-nowrap shrink-0 pb-1 ${
                  isActive
                    ? 'text-violet-300 border-b-2 border-violet-400 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {navItem.label}
              </button>
            );
          })}
        </nav>

        {/* Prominent "Create Watch Party" CTA + Profile Button */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            data-testid="nav-create-watch-party"
            onClick={() => navigateToTab('create-party', '/create-party')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-violet-600 via-fuchsia-600 to-rose-500 hover:from-violet-500 hover:to-rose-400 rounded-xl shadow-lg transition-all whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Create Watch Party</span>
          </button>

          <button
            type="button"
            onClick={() => navigateToTab('profile', '/profile')}
            aria-label="User Profile and Preferences"
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 transition-colors"
          >
            <User className="w-4 h-4 text-violet-300" />
          </button>
        </div>
      </header>

      {/* Secondary Discovery & Utility Bar (Instant Search, Demo/Live Indicator, Night Mode, Push Alerts) */}
      <div className="border-b border-slate-800/80 bg-slate-950/75 px-4 sm:px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Instant Search Input */}
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <label htmlFor="global-catalog-search" className="sr-only">
              Search movies, series, anime, directors, or genres
            </label>
            <input
              id="global-catalog-search"
              type="search"
              placeholder="Instant search: titles, genres, directors, languages..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (
                  activeTab !== 'home' &&
                  activeTab !== 'movies' &&
                  activeTab !== 'tv' &&
                  activeTab !== 'anime'
                ) {
                  setActiveTab('home');
                }
              }}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-800 bg-slate-900/90 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Clear Demo / Live Data Indicator */}
            <span
              data-testid="catalog-source-indicator"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isDemoData ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
              />
              <span>{isDemoData ? 'Demo Catalog + Cloud SQL Active' : nxshaSourceLabel}</span>
            </span>

            {/* Dark Mode / Ambient Contrast Toggle */}
            <button
              type="button"
              onClick={() =>
                setThemeMode((prev) => (prev === 'oled-dark' ? 'daylight' : 'oled-dark'))
              }
              aria-label="Toggle Dark Mode for Enhanced Night Viewing"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-xl border border-slate-800 bg-slate-900 text-slate-200 hover:border-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              {isDark ? (
                <>
                  <Moon className="w-3.5 h-3.5 text-violet-400" />
                  <span>Cinema Dark</span>
                </>
              ) : (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span>Warm Dim</span>
                </>
              )}
            </button>

            {/* Push Notifications Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowNotifPopover(!showNotifPopover)}
                aria-label={`Push Notifications (${unreadNotifCount} unread)`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-xl border border-slate-800 bg-slate-900 text-slate-200 hover:border-slate-700 transition-colors whitespace-nowrap shrink-0"
              >
                <Bell className="w-3.5 h-3.5 text-violet-400" />
                <span className="font-mono tabular-nums">Alerts ({unreadNotifCount})</span>
              </button>

              {showNotifPopover && (
                <div className="absolute right-0 mt-2 w-80 p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl z-50 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-xs font-semibold text-white">
                      CineTogether Notifications
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
                      }}
                      className="text-[11px] text-violet-400 hover:underline"
                    >
                      Mark All Read
                    </button>
                  </div>
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between font-medium text-white">
                        <span>{n.title}</span>
                        <span className="text-[10px] font-mono text-slate-400">{n.createdAt}</span>
                      </div>
                      <p className="text-[11px] text-slate-400">{n.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Toast Notification Banner */}
      {statusBanner && (
        <div
          role="status"
          className="bg-gradient-to-r from-violet-600 via-fuchsia-600 to-rose-600 text-white px-6 py-2 text-xs font-semibold text-center flex items-center justify-center gap-2 shadow-md"
        >
          <Check className="w-4 h-4" />
          <span>{statusBanner}</span>
        </div>
      )}

      {/* Main Content Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
        {/* Inline Solo Adaptive Video Player Drawer */}
        {isTheaterOpen && activeTab === 'home' && (
          <section aria-label="Active Cinema Theater" className="space-y-4">
            <AdaptiveVideoPlayer
              item={selectedMedia}
              isOfflineMode={isOfflineSimulated}
              onTriggerDownload={handleDownloadMedia}
              onTriggerShare={handleQuickShare}
              onClose={() => setIsTheaterOpen(false)}
            />
          </section>
        )}

        {/* BROWSE VIEWS: HOME / MOVIES / TV SHOWS / ANIME */}
        {(activeTab === 'home' ||
          activeTab === 'movies' ||
          activeTab === 'tv' ||
          activeTab === 'anime') && (
          <div className="space-y-12">
            {/* Large Cinematic Hero Banner */}
            {!isTheaterOpen && (
              <section
                aria-label="Featured Release Spotlight"
                className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch bg-gradient-to-br from-slate-900 via-[#121026] to-slate-950 border border-violet-500/20 rounded-3xl overflow-hidden shadow-2xl"
              >
                <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-between space-y-6">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
                      <span className="px-2.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-semibold">
                        {selectedMedia.platform}
                      </span>
                      <span className="text-amber-400 font-semibold">
                        ★ {selectedMedia.rating.toFixed(1)}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-300">{selectedMedia.year}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-300">{selectedMedia.language}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-rose-300">
                        ❤️ {selectedMedia.coupleScore || 95}% Couple Match
                      </span>
                    </div>

                    <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-white tracking-tight">
                      {selectedMedia.title}
                    </h1>

                    <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
                      {selectedMedia.description}
                    </p>

                    <div className="text-xs text-slate-400">
                      <span>Directed by {selectedMedia.director}</span>
                      <span className="mx-2">·</span>
                      <span>Starring {selectedMedia.cast.join(', ')}</span>
                      <span className="mx-2">·</span>
                      <span>{selectedMedia.genres.join(' / ')}</span>
                    </div>
                  </div>

                  {/* Hero CTAs */}
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => handleStartWatching(selectedMedia)}
                      className="inline-flex items-center gap-2 px-5 py-3 text-xs sm:text-sm font-semibold bg-white hover:bg-slate-200 text-slate-950 rounded-xl transition-colors whitespace-nowrap shrink-0 shadow-lg"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Watch Solo</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveRoomMode('couple');
                        setActiveRoomCode('LOVE-2026');
                        navigateToTab('couple-room', '/room/couple/LOVE-2026');
                      }}
                      className="inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-semibold bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-400 hover:to-pink-500 text-white rounded-xl transition-all whitespace-nowrap shrink-0 shadow-lg"
                    >
                      <Heart className="w-4 h-4 fill-current" />
                      <span>Couple Cinema ❤️</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveRoomMode('group');
                        setActiveRoomCode('CLUB-4096');
                        navigateToTab('group-room', '/room/group/CLUB-4096');
                      }}
                      className="inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-semibold bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-xl transition-all whitespace-nowrap shrink-0 shadow-lg"
                    >
                      <Users className="w-4 h-4" />
                      <span>Group Cinema 🎉</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleWatchlist(selectedMedia)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-3 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-xl transition-colors whitespace-nowrap shrink-0"
                    >
                      {likedIds.includes(selectedMedia.id) ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-400" />
                          <span>In My List</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          <span>My List</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenMediaDetail(selectedMedia)}
                      className="px-3.5 py-3 text-xs font-medium bg-slate-950/80 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl transition-colors"
                    >
                      Details
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-5 relative min-h-[260px] lg:min-h-full">
                  <MediaPoster
                    item={selectedMedia}
                    variant="backdrop"
                    className="w-full h-full object-cover"
                  />
                </div>
              </section>
            )}

            {/* Catalog Health & Provider Connectivity Status */}
            {providerHealth && (
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <Database className="w-4 h-4 text-violet-400" />
                  <span className="text-slate-300 font-medium">Live Providers:</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-[11px] ${
                        providerHealth.tmdbReachable
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                      TMDB v3 ({providerHealth.tmdbReachable ? 'Online · Live Sync' : 'Degraded'})
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-[11px] ${
                        providerHealth.nxshaReachable
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      Nxsha Stream ({providerHealth.nxshaReachable ? 'Online · Multi-Section' : 'Degraded'})
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-slate-400 font-mono text-[11px]">
                  <span>Total Dynamic Titles: {catalog.length}</span>
                </div>
              </div>
            )}

            {/* Error Banner with Retry */}
            {catalogError && (
              <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-500/40 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5 text-xs text-rose-200">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{catalogError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => loadInitialFeeds()}
                  className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shrink-0"
                >
                  Retry Loading
                </button>
              </div>
            )}

            {/* Category, Genre, Year, Language & Sort Filter Bar */}
            <section aria-label="Catalog Filter Controls" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div
                  className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl"
                  role="group"
                  aria-label="Filter by Media Category"
                >
                  {(
                    [
                      { id: 'all', label: `All Titles (${catalog.length})` },
                      {
                        id: 'movie',
                        label: `Movies (${catalog.filter((c) => c.mediaType === 'movie').length})`,
                      },
                      {
                        id: 'tv',
                        label: `TV Series (${catalog.filter((c) => c.mediaType === 'tv').length})`,
                      },
                      {
                        id: 'anime',
                        label: `Anime (${catalog.filter((c) => c.mediaType === 'anime').length})`,
                      },
                    ] as const
                  ).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setCategoryFilter(cat.id);
                        setCatalogPage(1);
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                        categoryFilter === cat.id
                          ? 'bg-violet-600 text-white font-semibold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* Genre, Release Year, Language & Sort Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Filter by Genre"
                    value={genreFilter}
                    onChange={(e) => {
                      setGenreFilter(e.target.value);
                      setCatalogPage(1);
                    }}
                    className="px-2.5 py-1.5 text-xs rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-violet-500"
                  >
                    {GENRE_FILTERS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Filter by Release Year"
                    value={yearFilter}
                    onChange={(e) => {
                      setYearFilter(e.target.value);
                      setCatalogPage(1);
                    }}
                    className="px-2.5 py-1.5 text-xs rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-violet-500"
                  >
                    {YEAR_FILTERS.map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Filter by Language"
                    value={languageFilter}
                    onChange={(e) => {
                      setLanguageFilter(e.target.value);
                      setCatalogPage(1);
                    }}
                    className="px-2.5 py-1.5 text-xs rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-violet-500"
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Sort Catalog By"
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(
                        e.target.value as 'popularity' | 'rating' | 'release' | 'title'
                      )
                    }
                    className="px-2.5 py-1.5 text-xs rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-violet-500"
                  >
                    <option value="popularity">Sort: Popularity</option>
                    <option value="rating">Sort: Highest Rating</option>
                    <option value="release">Sort: Newest Release</option>
                    <option value="title">Sort: Title (A–Z)</option>
                  </select>
                </div>
              </div>
            </section>

            {/* Row 1: Dynamic Catalog & Search Results Grid */}
            <section aria-label="Trending Movies and Shows" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-xl font-display font-bold text-white">
                    {searchQuery
                      ? `Search Results for "${searchQuery}"`
                      : categoryFilter === 'movie'
                      ? 'All Movies Catalog'
                      : categoryFilter === 'tv'
                      ? 'All TV Series Catalog'
                      : categoryFilter === 'anime'
                      ? 'All Anime Series & Films'
                      : 'Complete Nxsha Media Catalog'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    Showing {paginatedCatalog.visibleItems.length} of {filteredCatalog.length}{' '}
                    matching titles (Total Indexed: {catalog.length}) ·{' '}
                    {liveSearchLoading
                      ? 'Searching live Nxsha index...'
                      : catalogLoading
                      ? 'Refreshing catalog...'
                      : nxshaSourceLabel}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {(searchQuery ||
                    categoryFilter !== 'all' ||
                    genreFilter !== 'All Genres' ||
                    yearFilter !== 'All Years' ||
                    languageFilter !== 'All Languages') && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setCategoryFilter('all');
                        setPlatformFilter('All Platforms');
                        setGenreFilter('All Genres');
                        setYearFilter('All Years');
                        setLanguageFilter('All Languages');
                        setCatalogPage(1);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-violet-300 hover:text-white"
                    >
                      Reset Filters
                    </button>
                  )}
                </div>
              </div>

              {filteredCatalog.length === 0 ? (
                <div className="p-10 text-center bg-slate-900/80 border border-slate-800 rounded-2xl space-y-3">
                  <p className="text-sm font-medium text-slate-200">
                    No titles matched your current filters.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setCategoryFilter('all');
                      setPlatformFilter('All Platforms');
                      setGenreFilter('All Genres');
                      setYearFilter('All Years');
                      setLanguageFilter('All Languages');
                      setCatalogPage(1);
                    }}
                    className="px-4 py-2 text-xs font-semibold bg-violet-600 text-white rounded-xl"
                  >
                    Reset All Filters
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {paginatedCatalog.visibleItems.map((item) => {
                      const isLiked = likedIds.includes(item.id);
                      return (
                        <article
                          key={item.id}
                          className="group bg-slate-900/90 border border-slate-800/90 hover:border-violet-500/40 rounded-2xl overflow-hidden flex flex-col justify-between transition-all hover:-translate-y-1 shadow-lg"
                        >
                          <div>
                            <div
                              onClick={() => handleOpenMediaDetail(item)}
                              className="relative aspect-[3/4] w-full overflow-hidden cursor-pointer"
                            >
                              <MediaPoster
                                item={item}
                                variant="poster"
                                className="w-full h-full group-hover:scale-105 transition-transform duration-500"
                              />
                              <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-slate-950/85 border border-white/10 text-[10px] font-mono uppercase text-violet-200">
                                {item.mediaType}
                              </div>
                              <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-slate-950/85 border border-white/10 text-[11px] font-mono text-amber-400">
                                ★ {item.rating.toFixed(1)}
                              </div>
                            </div>

                            <div className="p-4 space-y-2">
                              <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                                <span className="truncate">{item.platform}</span>
                                <span>·</span>
                                <span>{item.year}</span>
                                <span>·</span>
                                <span>{item.language}</span>
                              </div>

                              <h3
                                onClick={() => handleOpenMediaDetail(item)}
                                className="text-base font-display font-bold text-white leading-snug cursor-pointer hover:text-violet-300 transition-colors"
                              >
                                {item.title}
                              </h3>

                              <div className="text-xs text-slate-400">
                                {item.genres.join(' · ')} ·{' '}
                                {item.mediaType === 'movie'
                                  ? `${item.durationMinutes}m`
                                  : `${item.seasons || 1}S`}
                              </div>

                              <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                                {item.description}
                              </p>
                            </div>
                          </div>

                          <div className="p-4 pt-0 space-y-2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleStartWatching(item)}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-xl transition-all whitespace-nowrap"
                              >
                                <Play className="w-3.5 h-3.5 fill-current" />
                                <span>Watch</span>
                              </button>

                              <button
                                type="button"
                                title="Start Couple Cinema with this title"
                                onClick={() => {
                                  setSelectedMedia(item);
                                  setActiveRoomMode('couple');
                                  navigateToTab('couple-room', '/room/couple/LOVE-2026');
                                }}
                                aria-label={`Start Couple Watch Party for ${item.title}`}
                                className="p-2 bg-rose-500/15 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/30 rounded-xl transition-colors"
                              >
                                <Heart className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                title="Start Group Party with this title"
                                onClick={() => {
                                  setSelectedMedia(item);
                                  setActiveRoomMode('group');
                                  navigateToTab('group-room', '/room/group/CLUB-4096');
                                }}
                                aria-label={`Start Group Watch Party for ${item.title}`}
                                className="p-2 bg-violet-500/15 hover:bg-violet-600 text-violet-300 hover:text-white border border-violet-500/30 rounded-xl transition-colors"
                              >
                                <Users className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleWatchlist(item)}
                                aria-label={
                                  isLiked
                                    ? `Remove ${item.title} from My List`
                                    : `Add ${item.title} to My List`
                                }
                                className={`p-2 rounded-xl border transition-colors ${
                                  isLiked
                                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                                }`}
                              >
                                {isLiked ? (
                                  <Check className="w-3.5 h-3.5" />
                                ) : (
                                  <Plus className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  {/* Progressive Catalog Pagination ("Load More") */}
                  {(paginatedCatalog.hasMore || catalogBackendHasMore) && (
                    <div className="pt-4 flex flex-col items-center gap-2">
                      {catalogLoadingMore ? (
                        <div className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-slate-900 border border-violet-500/40 text-xs sm:text-sm font-semibold text-violet-300">
                          <RefreshCw className="w-4 h-4 animate-spin text-violet-400" />
                          <span>Loading more live titles from TMDB &amp; Nxsha...</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          data-testid="load-more-catalog"
                          onClick={() => {
                            if (paginatedCatalog.hasMore) {
                              setCatalogPage((prev) => prev + 1);
                            } else {
                              handleLoadMoreCatalog();
                            }
                          }}
                          className="px-6 py-3 rounded-2xl bg-slate-900 hover:bg-violet-600 border border-violet-500/40 text-xs sm:text-sm font-semibold text-white transition-all shadow-lg inline-flex items-center gap-2"
                        >
                          <Layers className="w-4 h-4" />
                          <span>
                            Load More Titles ({paginatedCatalog.visibleItems.length} of{' '}
                            {filteredCatalog.length} shown · Backend Page {catalogBackendPage})
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>

            {/* Row 2: Continue Watching */}
            {activeTab === 'home' && watchHistory.length > 0 && (
              <section aria-label="Continue Watching" className="space-y-4">
                <div>
                  <h2 className="text-xl font-display font-bold text-white">
                    Continue Watching
                  </h2>
                  <p className="text-xs text-slate-400">
                    Pick up right where you or your watch room left off
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {watchHistory.slice(0, 3).map((entry) => {
                    const media = catalog.find((c) => c.id === entry.mediaId) || catalog[0];
                    const pct = Math.min(
                      100,
                      Math.round((entry.progressSeconds / (entry.durationSeconds || 3600)) * 100)
                    );
                    return (
                      <div
                        key={entry.mediaId}
                        className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between space-y-3"
                      >
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span className="font-semibold text-white">{media.title}</span>
                          <span className="font-mono text-violet-300">{pct}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            style={{ width: `${pct}%` }}
                            className="h-full bg-gradient-to-r from-violet-500 to-rose-500"
                          />
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[11px] text-slate-400">
                            {entry.roomType === 'couple'
                              ? '❤️ Couple Session'
                              : entry.roomType === 'group'
                              ? '🎉 Group Session'
                              : 'Solo Stream'}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleStartWatching(media)}
                            className="text-xs font-semibold text-violet-300 hover:text-white"
                          >
                            Resume →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Row 2B: Official TMDB Weekly Trending Feed */}
            {activeTab === 'home' && trendingFeed.length > 0 && (
              <section aria-label="Trending This Week" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-display font-bold text-white flex items-center gap-2">
                      <Flame className="w-5 h-5 text-amber-400" />
                      <span>Trending This Week (Official TMDB)</span>
                    </h2>
                    <p className="text-xs text-slate-400">
                      Live global rankings directly from TMDB API v3 · Updated hourly
                    </p>
                  </div>
                  <span className="text-xs font-mono text-amber-400">🔥 TMDB Live Rank</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {trendingFeed.slice(0, 4).map((item) => (
                    <div
                      key={`trending-${item.id}`}
                      className="p-4 rounded-2xl bg-slate-900/90 border border-amber-500/20 hover:border-amber-500/40 flex flex-col justify-between space-y-3 transition-all hover:-translate-y-1 shadow-lg"
                    >
                      <div className="space-y-2">
                        <div
                          onClick={() => handleOpenMediaDetail(item)}
                          className="relative aspect-[16/9] w-full rounded-xl overflow-hidden cursor-pointer"
                        >
                          <MediaPoster item={item} variant="backdrop" className="w-full h-full" />
                          <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-slate-950/80 text-[10px] font-mono text-amber-300 uppercase">
                            {item.mediaType}
                          </div>
                          <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-slate-950/80 text-[11px] font-mono text-amber-400">
                            ★ {item.rating.toFixed(1)}
                          </div>
                        </div>
                        <h3
                          onClick={() => handleOpenMediaDetail(item)}
                          className="text-sm font-display font-bold text-white hover:text-amber-300 cursor-pointer truncate"
                        >
                          {item.title}
                        </h3>
                        <p className="text-xs text-slate-400 line-clamp-2">{item.description}</p>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleStartWatching(item)}
                          className="flex-1 py-1.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Watch</span>
                        </button>
                        <button
                          type="button"
                          title="Start Couple Watch Party"
                          onClick={() => {
                            setSelectedMedia(item);
                            setActiveRoomMode('couple');
                            navigateToTab('couple-room', '/room/couple/LOVE-2026');
                          }}
                          className="p-1.5 bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white rounded-xl transition-colors"
                        >
                          <Heart className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Row 2C: Official TMDB Popular Movies */}
            {activeTab === 'home' && popularMoviesFeed.length > 0 && (
              <section aria-label="Popular Movies" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-display font-bold text-white flex items-center gap-2">
                      <Film className="w-5 h-5 text-violet-400" />
                      <span>Popular Movies (Official TMDB)</span>
                    </h2>
                    <p className="text-xs text-slate-400">
                      Top feature films streamed worldwide with synchronized playback
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryFilter('movie');
                      setActiveTab('movies');
                    }}
                    className="text-xs font-semibold text-violet-400 hover:underline"
                  >
                    View All Movies →
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {popularMoviesFeed.slice(0, 4).map((item) => (
                    <div
                      key={`pop-movie-${item.id}`}
                      className="p-4 rounded-2xl bg-slate-900/90 border border-violet-500/20 hover:border-violet-500/40 flex flex-col justify-between space-y-3 transition-all hover:-translate-y-1 shadow-lg"
                    >
                      <div className="space-y-2">
                        <div
                          onClick={() => handleOpenMediaDetail(item)}
                          className="relative aspect-[16/9] w-full rounded-xl overflow-hidden cursor-pointer"
                        >
                          <MediaPoster item={item} variant="backdrop" className="w-full h-full" />
                          <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-slate-950/80 text-[10px] font-mono text-violet-300">
                            {item.durationMinutes}m
                          </div>
                          <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-slate-950/80 text-[11px] font-mono text-amber-400">
                            ★ {item.rating.toFixed(1)}
                          </div>
                        </div>
                        <h3
                          onClick={() => handleOpenMediaDetail(item)}
                          className="text-sm font-display font-bold text-white hover:text-violet-300 cursor-pointer truncate"
                        >
                          {item.title}
                        </h3>
                        <p className="text-xs text-slate-400 line-clamp-2">{item.description}</p>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleStartWatching(item)}
                          className="flex-1 py-1.5 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Watch</span>
                        </button>
                        <button
                          type="button"
                          title="Start Group Watch Party"
                          onClick={() => {
                            setSelectedMedia(item);
                            setActiveRoomMode('group');
                            navigateToTab('group-room', '/room/group/CLUB-4096');
                          }}
                          className="p-1.5 bg-indigo-500/20 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded-xl transition-colors"
                        >
                          <Users className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Row 2D: Official TMDB Popular TV Series */}
            {activeTab === 'home' && popularTvFeed.length > 0 && (
              <section aria-label="Popular TV Shows" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-display font-bold text-white flex items-center gap-2">
                      <Tv className="w-5 h-5 text-pink-400" />
                      <span>Popular TV Series (Official TMDB)</span>
                    </h2>
                    <p className="text-xs text-slate-400">
                      Bingeable multi-season series with episodic stream resolvers
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryFilter('tv');
                      setActiveTab('tv');
                    }}
                    className="text-xs font-semibold text-pink-400 hover:underline"
                  >
                    View All TV Series →
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {popularTvFeed.slice(0, 4).map((item) => (
                    <div
                      key={`pop-tv-${item.id}`}
                      className="p-4 rounded-2xl bg-slate-900/90 border border-pink-500/20 hover:border-pink-500/40 flex flex-col justify-between space-y-3 transition-all hover:-translate-y-1 shadow-lg"
                    >
                      <div className="space-y-2">
                        <div
                          onClick={() => handleOpenMediaDetail(item)}
                          className="relative aspect-[16/9] w-full rounded-xl overflow-hidden cursor-pointer"
                        >
                          <MediaPoster item={item} variant="backdrop" className="w-full h-full" />
                          <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-slate-950/80 text-[10px] font-mono text-pink-300">
                            {item.seasons || 1} Seasons
                          </div>
                          <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-slate-950/80 text-[11px] font-mono text-amber-400">
                            ★ {item.rating.toFixed(1)}
                          </div>
                        </div>
                        <h3
                          onClick={() => handleOpenMediaDetail(item)}
                          className="text-sm font-display font-bold text-white hover:text-pink-300 cursor-pointer truncate"
                        >
                          {item.title}
                        </h3>
                        <p className="text-xs text-slate-400 line-clamp-2">{item.description}</p>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleOpenMediaDetail(item)}
                          className="flex-1 py-1.5 px-3 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <span>Explore Episodes</span>
                        </button>
                        <button
                          type="button"
                          title="Start Couple Watch Party"
                          onClick={() => {
                            setSelectedMedia(item);
                            setActiveRoomMode('couple');
                            navigateToTab('couple-room', '/room/couple/LOVE-2026');
                          }}
                          className="p-1.5 bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white rounded-xl transition-colors"
                        >
                          <Heart className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Row 3: Couple Night Recommendations ❤️ */}
            {activeTab === 'home' && (
              <section aria-label="Couple Night Recommendations" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-display font-bold text-white">
                      Couple Night Recommendations ❤️
                    </h2>
                    <p className="text-xs text-slate-400">
                      Curated for two participants with Rose Nebula ambiance and synchronized hearts
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigateToTab('couple-room', '/room/couple/LOVE-2026')}
                    className="text-xs font-semibold text-rose-400 hover:underline"
                  >
                    Enter Couple Cinema →
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {coupleFavorites.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 rounded-2xl bg-gradient-to-br from-rose-950/35 via-slate-900 to-slate-950 border border-rose-500/25 flex flex-col justify-between space-y-3"
                    >
                      <div className="space-y-1.5">
                        <div className="text-xs font-mono text-rose-300">
                          ❤️ {item.coupleScore}% Couple Match · {item.genres[0]}
                        </div>
                        <h3 className="text-base font-display font-bold text-white">
                          {item.title}
                        </h3>
                        <p className="text-xs text-slate-400 line-clamp-2">{item.description}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMedia(item);
                          setActiveRoomMode('couple');
                          navigateToTab('couple-room', '/room/couple/LOVE-2026');
                        }}
                        className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-400 hover:to-pink-500 text-white rounded-xl transition-all"
                      >
                        <Heart className="w-3.5 h-3.5 fill-current" />
                        <span>Start Couple Room</span>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Row 4: Group Movie Night Recommendations 🎉 */}
            {activeTab === 'home' && (
              <section aria-label="Group Movie Night Recommendations" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-display font-bold text-white">
                      Group Movie Night Picks 🎉
                    </h2>
                    <p className="text-xs text-slate-400">
                      High-energy crowd-pleasers for 3–20 friends with live reactions and voting
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigateToTab('group-room', '/room/group/CLUB-4096')}
                    className="text-xs font-semibold text-violet-400 hover:underline"
                  >
                    Enter Group Cinema →
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {groupNightFavorites.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 rounded-2xl bg-gradient-to-br from-violet-950/35 via-slate-900 to-slate-950 border border-violet-500/25 flex flex-col justify-between space-y-3"
                    >
                      <div className="space-y-1.5">
                        <div className="text-xs font-mono text-violet-300">
                          🎉 {item.groupNightScore || 94}% Crowd Score · {item.genres[0]}
                        </div>
                        <h3 className="text-base font-display font-bold text-white">
                          {item.title}
                        </h3>
                        <p className="text-xs text-slate-400 line-clamp-2">{item.description}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMedia(item);
                          setActiveRoomMode('group');
                          navigateToTab('group-room', '/room/group/CLUB-4096');
                        }}
                        className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-xl transition-all"
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span>Start Group Room</span>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Row 5: Popular This Week & Recently Added */}
            {activeTab === 'home' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                  <h3 className="text-base font-display font-bold text-white flex items-center gap-2">
                    <Flame className="w-4 h-4 text-amber-400" />
                    <span>Popular This Week</span>
                  </h3>
                  <div className="space-y-2">
                    {popularThisWeek.map((item, idx) => (
                      <div
                        key={item.id}
                        className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xs font-mono text-violet-400 font-bold">
                            #{idx + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate">
                              {item.title}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {item.platform} · ★ {item.rating}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenMediaDetail(item)}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 shrink-0"
                        >
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                  <h3 className="text-base font-display font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-400" />
                    <span>Recently Added &amp; Recommended For You</span>
                  </h3>
                  <div className="space-y-2">
                    {recommendations.slice(0, 4).map((rec) => (
                      <div
                        key={rec.item.id}
                        className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">
                            {rec.item.title}
                          </div>
                          <div className="text-[11px] text-violet-300 truncate">{rec.reason}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleStartWatching(rec.item)}
                          className="px-2.5 py-1 rounded-lg bg-violet-600/30 hover:bg-violet-600 text-xs text-violet-100 shrink-0"
                        >
                          Watch
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MY LIST (WATCHLIST) VIEW */}
        {activeTab === 'my-list' && (
          <section className="space-y-6" aria-label="My Watchlist">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-display font-bold text-white">
                  My Watchlist ({myWatchlistItems.length})
                </h1>
                <p className="text-xs text-slate-400">
                  Synced with Cloud SQL PostgreSQL · Launch any saved title directly into a Couple
                  or Group Watch Party.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigateToTab('create-party', '/create-party')}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
              >
                + Create Watch Party from List
              </button>
            </div>

            {myWatchlistItems.length === 0 ? (
              <div className="p-12 rounded-3xl bg-slate-900/80 border border-slate-800 text-center space-y-3">
                <Bookmark className="w-8 h-8 text-slate-500 mx-auto" />
                <h2 className="text-base font-display font-bold text-white">
                  Your Watchlist is Empty
                </h2>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Explore the catalog and click &ldquo;+ My List&rdquo; on any movie, series, or
                  anime to save it for your next Couple Night or Group Watch Party.
                </p>
                <button
                  type="button"
                  onClick={() => navigateToTab('home', '/')}
                  className="px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-semibold"
                >
                  Browse Movies &amp; Shows
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {myWatchlistItems.map((item) => (
                  <div
                    key={item.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col justify-between"
                  >
                    <div className="aspect-[3/4] w-full">
                      <MediaPoster item={item} variant="poster" className="w-full h-full" />
                    </div>
                    <div className="p-4 space-y-3">
                      <div>
                        <h3 className="text-sm font-display font-bold text-white">{item.title}</h3>
                        <p className="text-xs text-slate-400">
                          {item.year} · ★ {item.rating}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedMedia(item);
                            setActiveRoomMode('couple');
                            navigateToTab('couple-room', '/room/couple/LOVE-2026');
                          }}
                          className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                        >
                          Couple ❤️
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedMedia(item);
                            setActiveRoomMode('group');
                            navigateToTab('group-room', '/room/group/CLUB-4096');
                          }}
                          className="flex-1 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
                        >
                          Group 🎉
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleWatchlist(item)}
                          className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* CREATE OR JOIN WATCH PARTY MODE SELECTOR */}
        {(activeTab === 'create-party' || activeTab === 'watch-parties') && (
          <CreateJoinPartyView
            catalog={catalog}
            defaultMedia={selectedMedia}
            userProfile={userProfile}
            onLaunchRoom={({ mode, roomCode, media }) => {
              setSelectedMedia(media);
              setActiveRoomMode(mode);
              setActiveRoomCode(roomCode);
              navigateToTab(
                mode === 'couple' ? 'couple-room' : 'group-room',
                `/room/${mode}/${roomCode}`
              );
            }}
          />
        )}

        {/* ACTIVE COUPLE CINEMA ROOM OR GROUP CINEMA ROOM */}
        {(activeTab === 'couple-room' || activeTab === 'group-room') && (
          <WatchPartyWorkspace
            catalog={catalog}
            selectedMedia={selectedMedia}
            initialMode={activeTab === 'couple-room' ? 'couple' : 'group'}
            initialRoomCode={
              activeRoomCode || (activeTab === 'couple-room' ? 'LOVE-2026' : 'CLUB-4096')
            }
            userDisplayName={userProfile.displayName}
            onSelectMedia={(item) => setSelectedMedia(item)}
            onTriggerDownload={handleDownloadMedia}
            onTriggerShare={handleQuickShare}
            onLeaveRoom={() => navigateToTab('home', '/')}
          />
        )}

        {/* MEDIA DETAIL VIEW */}
        {activeTab === 'media-detail' && (
          <MediaDetailView
            item={selectedMedia}
            relatedItems={catalog.filter((c) => c.id !== selectedMedia.id)}
            isInWatchlist={likedIds.includes(selectedMedia.id)}
            onBack={() => navigateToTab('home', '/')}
            onWatchSolo={handleStartWatching}
            onStartCoupleParty={(item) => {
              setSelectedMedia(item);
              setActiveRoomMode('couple');
              navigateToTab('couple-room', '/room/couple/LOVE-2026');
            }}
            onStartGroupParty={(item) => {
              setSelectedMedia(item);
              setActiveRoomMode('group');
              navigateToTab('group-room', '/room/group/CLUB-4096');
            }}
            onToggleWatchlist={handleToggleWatchlist}
            onSelectMedia={(item) => setSelectedMedia(item)}
          />
        )}

        {/* PROFILE & AUTH VIEW */}
        {activeTab === 'profile' && (
          <ProfileAndAuthView
            userProfile={userProfile}
            watchlistItems={myWatchlistItems}
            onUpdateProfile={(next) => {
              setUserProfile(next);
              try {
                window.localStorage.setItem('cinetogether_profile', JSON.stringify(next));
              } catch {
                // ignore
              }
            }}
            onSelectMedia={handleOpenMediaDetail}
          />
        )}

        {/* AI COMPANION & CURATOR VIEW */}
        {activeTab === 'ai-voice' && (
          <AiVoiceAndConcierge
            catalog={catalog}
            history={watchHistory}
            recommendations={recommendations}
            selectedMedia={selectedMedia}
            onSelectMediaAndPlay={(item) => {
              setSelectedMedia(item);
              setActiveTab('home');
              setIsTheaterOpen(true);
            }}
          />
        )}

        {/* OFFLINE VAULT & SOCIAL VIEW */}
        {activeTab === 'offline-social' && (
          <OfflineAndSocialWorkspace
            catalog={catalog}
            downloads={downloads}
            isOfflineSimulated={isOfflineSimulated}
            onToggleOfflineSimulation={() => setIsOfflineSimulated(!isOfflineSimulated)}
            onDownloadMedia={handleDownloadMedia}
            onRemoveDownload={handleRemoveDownload}
            onPlayDownloaded={(mediaId) => {
              const found = catalog.find((c) => c.id === mediaId) || catalog[0];
              setSelectedMedia(found);
              setActiveTab('home');
              setIsTheaterOpen(true);
            }}
            socialPosts={socialPosts}
            onCreateSocialPost={(post) => {
              setSocialPosts((prev) => [
                {
                  ...post,
                  id: `post-${Date.now()}`,
                  likes: 1,
                  createdAt: 'Just now',
                },
                ...prev,
              ]);
              triggerBanner(`Shared "${post.mediaTitle}" moment to ${post.platformTarget}.`);
            }}
            onLikeSocialPost={(postId) => {
              setSocialPosts((prev) =>
                prev.map((p) => (p.id === postId ? { ...p, likes: p.likes + 1 } : p))
              );
            }}
            securitySettings={securitySettings}
            onUpdateSecurity={setSecuritySettings}
            notifications={notifications}
            onMarkAllNotificationsRead={() =>
              setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
            }
          />
        )}
      </main>

      {/* Editorial Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-8 border-t border-slate-800/80 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="font-semibold text-white">{BRAND_CONFIG.name}</span> — &ldquo;
          {BRAND_CONFIG.tagline}&rdquo; · Synchronized Couple &amp; Group Cinema Platform
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => navigateToTab('create-party', '/create-party')}
            className="hover:text-white"
          >
            Create Watch Party
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => navigateToTab('couple-room', '/room/couple/LOVE-2026')}
            className="hover:text-white"
          >
            Couple Cinema ❤️
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => navigateToTab('group-room', '/room/group/CLUB-4096')}
            className="hover:text-white"
          >
            Group Cinema 🎉
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => navigateToTab('my-list', '/watchlist')}
            className="hover:text-white"
          >
            My List ({likedIds.length})
          </button>
        </div>
      </footer>

      {/* Mobile Bottom Navigation Bar (<1024px) */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-5 items-center h-14 px-1"
      >
        <button
          type="button"
          onClick={() => navigateToTab('home', '/')}
          className={`min-h-[44px] flex flex-col items-center justify-center text-[10px] font-medium ${
            activeTab === 'home' ? 'text-violet-400' : 'text-slate-400'
          }`}
        >
          <Compass className="w-4 h-4 mb-0.5" />
          <span>Home</span>
        </button>
        <button
          type="button"
          onClick={() => navigateToTab('create-party', '/create-party')}
          className={`min-h-[44px] flex flex-col items-center justify-center text-[10px] font-medium ${
            activeTab === 'create-party' ? 'text-violet-400' : 'text-slate-400'
          }`}
        >
          <Sparkles className="w-4 h-4 mb-0.5" />
          <span>Create</span>
        </button>
        <button
          type="button"
          onClick={() => navigateToTab('couple-room', '/room/couple/LOVE-2026')}
          className={`min-h-[44px] flex flex-col items-center justify-center text-[10px] font-medium ${
            activeTab === 'couple-room' ? 'text-rose-400' : 'text-slate-400'
          }`}
        >
          <Heart className="w-4 h-4 mb-0.5" />
          <span>Couple</span>
        </button>
        <button
          type="button"
          onClick={() => navigateToTab('group-room', '/room/group/CLUB-4096')}
          className={`min-h-[44px] flex flex-col items-center justify-center text-[10px] font-medium ${
            activeTab === 'group-room' ? 'text-violet-400' : 'text-slate-400'
          }`}
        >
          <Users className="w-4 h-4 mb-0.5" />
          <span>Group</span>
        </button>
        <button
          type="button"
          onClick={() => navigateToTab('my-list', '/watchlist')}
          className={`min-h-[44px] flex flex-col items-center justify-center text-[10px] font-medium ${
            activeTab === 'my-list' ? 'text-violet-400' : 'text-slate-400'
          }`}
        >
          <Bookmark className="w-4 h-4 mb-0.5" />
          <span>My List</span>
        </button>
      </nav>
    </div>
  );
}
