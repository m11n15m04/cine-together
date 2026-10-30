import { PushNotificationItem, RoomThemeId, SocialBroadcastPost } from '../types';

export const ROOM_THEMES: Record<
  RoomThemeId,
  {
    name: string;
    subtitle: string;
    badge: string;
    gradientClass: string;
    borderClass: string;
    accentHex: string;
    glowHex: string;
  }
> = {
  'rose-nebula': {
    name: 'Rose Nebula',
    subtitle: 'Romantic crimson, rose-gold & deep midnight violet',
    badge: 'Couple Favorite',
    gradientClass: 'from-rose-950/80 via-fuchsia-950/60 to-slate-950',
    borderClass: 'border-rose-500/30',
    accentHex: '#f43f5e',
    glowHex: '#ec4899',
  },
  'midnight-violet': {
    name: 'Midnight Violet',
    subtitle: 'Aetho-inspired electric violet & royal indigo',
    badge: 'Signature',
    gradientClass: 'from-violet-950/80 via-indigo-950/60 to-slate-950',
    borderClass: 'border-violet-500/30',
    accentHex: '#8b5cf6',
    glowHex: '#6366f1',
  },
  'starlight-indigo': {
    name: 'Starlight Indigo',
    subtitle: 'Deep cosmos blue with electric cyan highlights',
    badge: 'Group Cinema',
    gradientClass: 'from-indigo-950/80 via-blue-950/60 to-slate-950',
    borderClass: 'border-indigo-500/30',
    accentHex: '#6366f1',
    glowHex: '#38bdf8',
  },
  'velvet-crimson': {
    name: 'Velvet Theater',
    subtitle: 'Classic grand screening room with warm ruby glow',
    badge: 'Premiere',
    gradientClass: 'from-red-950/80 via-rose-950/60 to-slate-950',
    borderClass: 'border-red-500/30',
    accentHex: '#ef4444',
    glowHex: '#f97316',
  },
  'aurora-emerald': {
    name: 'Aurora Borealis',
    subtitle: 'Serene northern lights teal & midnight obsidian',
    badge: 'Chill Night',
    gradientClass: 'from-emerald-950/80 via-teal-950/60 to-slate-950',
    borderClass: 'border-emerald-500/30',
    accentHex: '#10b981',
    glowHex: '#14b8a6',
  },
};

export const INITIAL_NOTIFICATIONS: PushNotificationItem[] = [];

export const INITIAL_SOCIAL_POSTS: SocialBroadcastPost[] = [];
