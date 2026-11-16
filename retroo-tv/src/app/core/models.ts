/**
 * TypeScript mirrors of the backend DTOs (see gemini.md §4). Keep in sync with com.retroo.web.dto.*.
 */

export type DecadeSlug = '60s' | '70s' | '80s' | '90s' | '2000s' | '2010s' | 'now';

export interface Decade {
  slug: DecadeSlug;
  label: string;
  songCount: number;
  ytMusicUrl: string;
}

export interface Song {
  id: number;
  videoId: string;
  title: string;
  artist: string;
  decade: DecadeSlug;
  /** 'hi' Bollywood / 'en' Hollywood — absent for songs from a shared playlist. */
  lang?: 'hi' | 'en';
  releaseYear?: number;
  thumbnailUrl?: string;
}

export interface SharedPlaylist {
  id: number;
  displayName: string;
  playlistUrl: string;
  playlistName: string;
  note?: string;
  createdAt: string;
}

export interface SharePlaylistRequest {
  displayName: string;
  playlistUrl: string;
  playlistName: string;
  note?: string;
}

export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  last: boolean;
}

export interface ListenerCount {
  count: number;
}

/** Normalised error every API call rejects with (built by problemDetailInterceptor). */
export interface ApiError {
  status: number;
  title: string;
  detail: string;
  /** Field name → message, present for 400 validation failures. */
  fieldErrors: Record<string, string>;
  retryAfterSeconds?: number;
}

// ---- Jam sessions (gemini.md §8) ---------------------------------------------------------------------------

/** Open: listed, anyone with the code joins. Private: unlisted, needs an invite link or the host's OK. */
export type JamVisibility = 'OPEN' | 'PRIVATE';

export interface JamSummary {
  code: string;
  name: string;
  hostName: string;
  memberCount: number;
  createdAt: string;
  expiresAt: string;
  visibility: JamVisibility;
}

export interface PlaybackState {
  song: Song;
  playing: boolean;
  positionSec: number;
  /** Server epoch millis when positionSec was true. */
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  kind: 'TEXT' | 'PLAYLIST' | 'SYSTEM';
  /** Absent for SYSTEM messages. */
  author?: string;
  text: string;
  playlistUrl?: string;
  sentAt: number;
}

export interface JamSnapshot extends JamSummary {
  extended: boolean;
  members: string[];
  playback: PlaybackState | null;
  chat: ChatMessage[];
  serverTime: number;
  /** True when this is a private jam seen from outside: no members, chat or playback — ask to join. */
  locked: boolean;
}

export interface CreateJamResponse {
  jam: JamSnapshot;
  hostToken: string;
  /** Secret part of the private invite link (/jam/CODE#k=…); host-only. */
  inviteToken: string;
}

/** Someone waiting to be let into a private jam (shown to the host). */
export interface JoinRequest {
  id: string;
  name: string;
}

/** Personal answer to "ask to join", on /user/queue/jam-access. */
export interface JamAccess {
  type: 'APPROVED' | 'DECLINED';
  code: string;
  /** APPROVED: this guest's own key from now on. */
  pass?: string;
  jam?: JamSnapshot;
}

export type JamEvent =
  | { type: 'STATE'; payload: PlaybackState; serverTime: number }
  | { type: 'CHAT'; payload: ChatMessage; serverTime: number }
  | { type: 'MEMBERS'; payload: { members: string[]; memberCount: number }; serverTime: number }
  | { type: 'EXTENDED'; payload: JamSnapshot; serverTime: number }
  | { type: 'ENDING_SOON'; payload: { expiresAt: string }; serverTime: number }
  | { type: 'ENDED'; payload: { reason: 'EXPIRED' | 'HOST_ENDED' }; serverTime: number }
  | { type: 'REQUESTS'; payload: { requests: JoinRequest[] }; serverTime: number }
  | { type: 'VISIBILITY'; payload: { visibility: JamVisibility }; serverTime: number };

export interface JamError {
  code: 'RATE_LIMITED' | 'JAM_FULL' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID';
  message: string;
}

export type JamControlAction = 'LOAD' | 'PLAY' | 'PAUSE' | 'SEEK';
