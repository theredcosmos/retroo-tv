import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  CreateJamResponse,
  Decade,
  DecadeSlug,
  JamSnapshot,
  JamSummary,
  JamVisibility,
  PageResponse,
  SharePlaylistRequest,
  SharedPlaylist,
  Song,
} from '../models';

/**
 * Thin typed gateway to the REST API — one method per endpoint, no state, no business logic.
 * Keeping HTTP in one place means components/stores never build URLs, and tests can stub a single class.
 */
@Injectable({ providedIn: 'root' })
export class RetrooApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/api`;

  decades(): Observable<Decade[]> {
    return this.http.get<Decade[]>(`${this.base}/decades`);
  }

  songs(decade: DecadeSlug): Observable<Song[]> {
    return this.http.get<Song[]>(`${this.base}/songs`, { params: { decade } });
  }

  /** `lang` drives the 2:1 rotation; `exclude` = recently played video ids (sent comma-separated). */
  randomSong(decade: DecadeSlug, lang?: 'hi' | 'en', exclude: readonly string[] = []): Observable<Song> {
    let params = new HttpParams().set('decade', decade);
    if (lang) {
      params = params.set('lang', lang);
    }
    if (exclude.length) {
      params = params.set('exclude', exclude.join(','));
    }
    return this.http.get<Song>(`${this.base}/songs/random`, { params });
  }

  playlists(page = 0, size = 30): Observable<PageResponse<SharedPlaylist>> {
    return this.http.get<PageResponse<SharedPlaylist>>(`${this.base}/playlists`, { params: { page, size } });
  }

  sharePlaylist(request: SharePlaylistRequest): Observable<SharedPlaylist> {
    return this.http.post<SharedPlaylist>(`${this.base}/playlists`, request);
  }

  stats(): Observable<{ listeners: number; songs: number; playlists: number }> {
    return this.http.get<{ listeners: number; songs: number; playlists: number }>(`${this.base}/stats`);
  }

  // ---- jam sessions -----------------------------------------------------------------------------------------

  createJam(name: string, hostName: string, visibility: JamVisibility = 'OPEN'): Observable<CreateJamResponse> {
    return this.http.post<CreateJamResponse>(`${this.base}/jams`, { name, hostName, visibility });
  }

  jams(): Observable<JamSummary[]> {
    return this.http.get<JamSummary[]>(`${this.base}/jams`);
  }

  /** `key` (host token, invite token or pass) unlocks a private jam; without it a private jam comes back `locked`. */
  jam(code: string, key?: string | null): Observable<JamSnapshot> {
    return this.http.get<JamSnapshot>(`${this.base}/jams/${encodeURIComponent(code)}`, {
      headers: key ? { 'X-Jam-Key': key } : {},
    });
  }

  setJamVisibility(code: string, hostToken: string, visibility: JamVisibility): Observable<JamSnapshot> {
    return this.http.post<JamSnapshot>(`${this.base}/jams/${encodeURIComponent(code)}/visibility`, { visibility }, {
      headers: { 'X-Jam-Token': hostToken },
    });
  }

  jamInvite(code: string, hostToken: string): Observable<{ inviteToken: string }> {
    return this.http.get<{ inviteToken: string }>(`${this.base}/jams/${encodeURIComponent(code)}/invite`, {
      headers: { 'X-Jam-Token': hostToken },
    });
  }

  /** New invite token: every old invite link stops working (people already in stay). */
  rotateJamInvite(code: string, hostToken: string): Observable<{ inviteToken: string }> {
    return this.http.post<{ inviteToken: string }>(`${this.base}/jams/${encodeURIComponent(code)}/invite`, null, {
      headers: { 'X-Jam-Token': hostToken },
    });
  }

  extendJam(code: string, hostToken: string): Observable<JamSnapshot> {
    return this.http.post<JamSnapshot>(`${this.base}/jams/${encodeURIComponent(code)}/extend`, null, {
      headers: { 'X-Jam-Token': hostToken },
    });
  }

  endJam(code: string, hostToken: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/jams/${encodeURIComponent(code)}`, {
      headers: { 'X-Jam-Token': hostToken },
    });
  }
}
