import React, { useRef } from 'react';
import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  Play,
  Plus,
  Sparkles,
  Users,
} from 'lucide-react';
import { MediaItem } from '../types';
import { MediaPoster } from './MediaPoster';

interface MovieCardProps {
  item: MediaItem;
  isInWatchlist: boolean;
  onOpenDetails: (item: MediaItem) => void;
  onStartWatching: (item: MediaItem) => void;
  onToggleWatchlist: (item: MediaItem) => void;
  onStartCoupleParty: (item: MediaItem) => void;
  onStartGroupParty: (item: MediaItem) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({
  item,
  isInWatchlist,
  onOpenDetails,
  onStartWatching,
  onToggleWatchlist,
  onStartCoupleParty,
  onStartGroupParty,
}) => {
  const primaryGenre = item.genres[0] || (item.mediaType === 'anime' ? 'Anime' : 'Cinema');

  return (
    <article
      className="group relative w-[175px] sm:w-[200px] shrink-0 rounded-2xl bg-slate-900/90 border border-slate-800/80 hover:border-violet-500/50 flex flex-col justify-between overflow-hidden transition-all duration-300 hover:-translate-y-1.5 shadow-lg hover:shadow-violet-950/30"
      aria-label={`${item.title} (${item.year})`}
    >
      {/* Poster Media Area */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`View details for ${item.title}`}
        onClick={() => onOpenDetails(item)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenDetails(item);
          }
        }}
        className="relative aspect-[2/3] w-full overflow-hidden cursor-pointer bg-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      >
        <MediaPoster
          item={item}
          variant="poster"
          className="w-full h-full group-hover:scale-105 transition-transform duration-500"
        />

        {/* Top Floating Badges */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <span className="px-2 py-0.5 rounded-md bg-slate-950/85 backdrop-blur-md border border-white/10 text-[10px] font-mono uppercase text-violet-300 font-semibold shadow">
            {item.mediaType}
          </span>
          {item.playbackStatus === 'synced-ready' && (
            <span
              title="Verified Synchronized Playback"
              className="px-1.5 py-0.5 rounded-md bg-emerald-950/85 backdrop-blur-md border border-emerald-500/40 text-[9px] font-mono text-emerald-300 font-bold"
            >
              SYNC
            </span>
          )}
        </div>

        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-slate-950/85 backdrop-blur-md border border-white/10 text-[11px] font-mono text-amber-400 font-semibold shadow">
          ★ {item.rating.toFixed(1)}
        </div>

        {/* Subtle Scrim gradient */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent pointer-events-none" />
      </div>

      {/* Info Body */}
      <div className="p-3.5 space-y-1.5 flex-1 flex flex-col justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
            <span>{item.year}</span>
            <span>·</span>
            <span className="truncate max-w-[90px]">{primaryGenre}</span>
            <span>·</span>
            <span className="truncate max-w-[60px]">{item.language}</span>
          </div>

          <h3
            tabIndex={0}
            role="link"
            aria-label={`${item.title} (${item.year})`}
            onClick={() => onOpenDetails(item)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenDetails(item);
              }
            }}
            className="text-sm font-display font-bold text-white hover:text-violet-300 focus:text-violet-300 focus:outline-none focus-visible:underline cursor-pointer truncate transition-colors leading-snug"
            title={item.title}
          >
            {item.title}
          </h3>
        </div>

        {/* Action Controls */}
        <div className="pt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onStartWatching(item)}
              className="flex-1 py-1.5 px-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors shadow-md"
              title="Watch now"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Watch</span>
            </button>

            <button
              type="button"
              onClick={() => onToggleWatchlist(item)}
              aria-label={isInWatchlist ? `Remove ${item.title} from Watchlist` : `Add ${item.title} to Watchlist`}
              title={isInWatchlist ? 'In Watchlist' : 'Add to Watchlist'}
              className={`p-1.5 rounded-xl border transition-colors ${
                isInWatchlist
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
              }`}
            >
              {isInWatchlist ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* Watch Party Quick Buttons */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onStartCoupleParty(item)}
              title="Start Couple Watch Party ❤️"
              className="flex-1 py-1 px-2 rounded-lg bg-rose-500/15 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/30 text-[10px] font-semibold inline-flex items-center justify-center gap-1 transition-all"
            >
              <Heart className="w-3 h-3 fill-current text-rose-400" />
              <span>Couple</span>
            </button>

            <button
              type="button"
              onClick={() => onStartGroupParty(item)}
              title="Start Group Watch Party 🎉"
              className="flex-1 py-1 px-2 rounded-lg bg-indigo-500/15 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 text-[10px] font-semibold inline-flex items-center justify-center gap-1 transition-all"
            >
              <Users className="w-3 h-3 text-indigo-300" />
              <span>Group</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
};

interface HorizontalPosterCarouselProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: string;
  items: MediaItem[];
  likedIds: string[];
  isLoading?: boolean;
  onOpenDetails: (item: MediaItem) => void;
  onStartWatching: (item: MediaItem) => void;
  onToggleWatchlist: (item: MediaItem) => void;
  onStartCoupleParty: (item: MediaItem) => void;
  onStartGroupParty: (item: MediaItem) => void;
  onViewAll?: () => void;
}

export const HorizontalPosterCarousel: React.FC<HorizontalPosterCarouselProps> = ({
  title,
  subtitle,
  icon,
  badge,
  items,
  likedIds,
  isLoading = false,
  onOpenDetails,
  onStartWatching,
  onToggleWatchlist,
  onStartCoupleParty,
  onStartGroupParty,
  onViewAll,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -620 : 620;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  if (!isLoading && (!items || items.length === 0)) return null;

  return (
    <section aria-label={title} className="relative space-y-3 group/carousel">
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2.5">
          {icon && <span className="text-violet-400">{icon}</span>}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-display font-bold text-white tracking-tight">
                {title}
              </h2>
              {badge && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-violet-500/20 text-violet-300 border border-violet-500/30">
                  {badge}
                </span>
              )}
            </div>
            {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="text-xs font-semibold text-violet-400 hover:text-white transition-colors"
            >
              Explore all →
            </button>
          )}

          {/* Scroll Navigation Chevrons */}
          <div className="hidden sm:flex items-center gap-1.5 ml-2">
            <button
              type="button"
              onClick={() => scroll('left')}
              aria-label={`Scroll ${title} left`}
              className="p-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-all hover:scale-105 active:scale-95"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => scroll('right')}
              aria-label={`Scroll ${title} right`}
              className="p-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-all hover:scale-105 active:scale-95"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Horizontal Scroll Track */}
      <div
        ref={scrollRef}
        tabIndex={0}
        role="region"
        aria-label={`${title} carousel. Use Left and Right arrow keys to scroll.`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            scroll('left');
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            scroll('right');
          }
        }}
        className="flex gap-4 overflow-x-auto scrollbar-none py-2 px-1 scroll-smooth select-none focus:outline-none focus:ring-2 focus:ring-violet-500/50 rounded-2xl"
      >
        {isLoading ? (
          Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="w-[175px] sm:w-[200px] shrink-0 aspect-[2/3] rounded-2xl bg-slate-900/80 border border-slate-800/80 animate-shimmer flex flex-col justify-end p-4 space-y-2"
            >
              <div className="h-4 bg-slate-800 rounded w-3/4 animate-pulse" />
              <div className="h-3 bg-slate-800/60 rounded w-1/2 animate-pulse" />
            </div>
          ))
        ) : (
          items.map((item) => (
            <MovieCard
              key={`${item.id}-${item.tmdbId}`}
              item={item}
              isInWatchlist={likedIds.includes(item.id)}
              onOpenDetails={onOpenDetails}
              onStartWatching={onStartWatching}
              onToggleWatchlist={onToggleWatchlist}
              onStartCoupleParty={onStartCoupleParty}
              onStartGroupParty={onStartGroupParty}
            />
          ))
        )}
      </div>
    </section>
  );
};
