import React, { useState } from 'react';
import { Film } from 'lucide-react';
import { MediaItem } from '../types';

interface MediaPosterProps {
  item: MediaItem;
  variant?: 'poster' | 'backdrop';
  className?: string;
}

/** Shows provider artwork when present and a neutral placeholder when TMDB has none. */
export const MediaPoster: React.FC<MediaPosterProps> = ({
  item,
  variant = 'poster',
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);
  const imageUrl = variant === 'backdrop'
    ? item.backdropUrl || item.posterUrl
    : item.posterUrl || item.backdropUrl;
  const accessibleTitle = item.year ? item.title + ' (' + item.year + ')' : item.title;

  return (
    <div
      className={'relative overflow-hidden select-none bg-slate-950 ' + className}
      role="img"
      aria-label={accessibleTitle + ' artwork'}
    >
      {imageUrl && !imgError ? (
        <img
          src={imageUrl}
          alt={accessibleTitle}
          loading="lazy"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover block"
        />
      ) : (
        <div className="w-full h-full min-h-24 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-900 to-slate-950 text-slate-500">
          <Film className="w-8 h-8" aria-hidden="true" />
          <span className="text-[10px] uppercase tracking-wider">No artwork available</span>
        </div>
      )}
    </div>
  );
};
