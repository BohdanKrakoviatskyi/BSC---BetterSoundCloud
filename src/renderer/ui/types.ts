export type Settings = { accent: string; compact: boolean; volume: number };
export type Profile = {
  id: number;
  username: string;
  fullName?: string;
  permalinkUrl?: string;
  avatarUrl?: string;
  city?: string;
  country?: string;
  followersCount?: number;
  trackCount?: number;
  likesCount?: number;
};
export type Page = 'likes' | 'settings' | 'track';
