import React, { useState } from 'react';
import { MediaItem } from '../types';

interface MediaPosterProps {
  item: MediaItem;
  variant?: 'poster' | 'backdrop';
  className?: string;
}

/**
 * Renders live TMDB/Nxsha poster or backdrop artwork when available,
 * with automatic fallback to deterministic SVG cinema artwork.
 */
export const MediaPoster: React.FC<MediaPosterProps> = ({
  item,
  variant = 'poster',
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);
  const isBackdrop = variant === 'backdrop';
  const viewBox = isBackdrop ? '0 0 1280 720' : '0 0 480 640';

  const imageUrl = isBackdrop
    ? item.backdropUrl || item.posterUrl
    : item.posterUrl || item.backdropUrl;

  // Deterministic geometric variation from tmdbId
  const seed = item.tmdbId || 1001;
  const cx = isBackdrop ? 860 + (seed % 160) : 240 + ((seed % 80) - 40);
  const cy = isBackdrop ? 280 + (seed % 120) : 240 + ((seed % 60) - 30);
  const ringRadius = isBackdrop ? 210 + (seed % 70) : 120 + (seed % 45);

  return (
    <div
      className={`relative overflow-hidden select-none bg-slate-950 ${className}`}
      role="img"
      aria-label={`${item.title} (${item.year}) cinema artwork`}
    >
      {imageUrl && !imgError ? (
        <img
          src={imageUrl}
          alt={`${item.title} (${item.year})`}
          loading="lazy"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover block"
        />
      ) : (
        <svg
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid slice"
          className="w-full h-full block"
        >
        <defs>
          <linearGradient id={`bg-${item.id}-${variant}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={item.secondaryColor} />
            <stop offset="55%" stopColor="#090d16" />
            <stop offset="100%" stopColor="#020617" />
          </linearGradient>
          <radialGradient id={`glow-${item.id}-${variant}`} cx="62%" cy="38%" r="65%">
            <stop offset="0%" stopColor={item.accentColor} stopOpacity="0.48" />
            <stop offset="55%" stopColor={item.accentColor} stopOpacity="0.12" />
            <stop offset="100%" stopColor="#020617" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`beam-${item.id}-${variant}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={item.accentColor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={item.secondaryColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Base Cinema Canvas */}
        <rect
          width={isBackdrop ? 1280 : 480}
          height={isBackdrop ? 720 : 640}
          fill={`url(#bg-${item.id}-${variant})`}
        />

        {/* Atmospheric Rim Lighting */}
        <rect
          width={isBackdrop ? 1280 : 480}
          height={isBackdrop ? 720 : 640}
          fill={`url(#glow-${item.id}-${variant})`}
        />

        {/* Architectural Light Shafts */}
        <polygon
          points={
            isBackdrop
              ? `${cx - 260},0 ${cx + 120},0 ${cx + 420},720 ${cx - 480},720`
              : `${cx - 120},0 ${cx + 80},0 ${cx + 220},640 ${cx - 220},640`
          }
          fill={`url(#beam-${item.id}-${variant})`}
        />

        {/* Orbital / Cinematic Focal Geometry */}
        <circle
          cx={cx}
          cy={cy}
          r={ringRadius}
          fill="none"
          stroke={item.accentColor}
          strokeOpacity="0.32"
          strokeWidth={isBackdrop ? '2' : '1.5'}
        />
        <circle
          cx={cx}
          cy={cy}
          r={ringRadius * 0.66}
          fill={item.accentColor}
          fillOpacity="0.14"
          stroke={item.accentColor}
          strokeOpacity="0.45"
          strokeWidth="1"
        />
        <circle
          cx={cx}
          cy={cy}
          r={ringRadius * 0.28}
          fill={item.accentColor}
          fillOpacity="0.35"
        />

        {/* Horizon Grid Lines */}
        <line
          x1="0"
          y1={isBackdrop ? 520 : 440}
          x2={isBackdrop ? 1280 : 480}
          y2={isBackdrop ? 520 : 440}
          stroke={item.accentColor}
          strokeOpacity="0.22"
          strokeWidth="1"
        />
        <line
          x1={cx}
          y1={isBackdrop ? 80 : 60}
          x2={cx}
          y2={isBackdrop ? 640 : 560}
          stroke="#f8fafc"
          strokeOpacity="0.08"
          strokeWidth="1"
        />

        {/* Subtle Editorial Watermark Frame */}
        {!isBackdrop && (
          <g>
            <text
              x="28"
              y="44"
              fill="#e2e8f0"
              fillOpacity="0.55"
              fontSize="11"
              fontFamily="JetBrains Mono, monospace"
              letterSpacing="2"
            >
              {item.platform.toUpperCase()} · {item.year}
            </text>
            <text
              x="28"
              y="598"
              fill="#94a3b8"
              fillOpacity="0.65"
              fontSize="11"
              fontFamily="JetBrains Mono, monospace"
              letterSpacing="1.5"
            >
              DIR. {item.director.toUpperCase()}
            </text>
          </g>
        )}
      </svg>
      )}

      {/* Bottom Scrim for Contrast */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/35 to-transparent pointer-events-none" />
    </div>
  );
};

