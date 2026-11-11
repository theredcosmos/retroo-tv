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

  createJam(name: string, hostName: string): Observable<CreateJamResponse> {
    return this.http.post<CreateJamResponse>(`${this.base}/jams`, { name, hostName });
  }

  jams(): Observable<JamSummary[]> {
    return this.http.get<JamSummary[]>(`${this.base}/jams`);
  }

  jam(code: string): Observable<JamSnapshot> {
    return this.http.get<JamSnapshot>(`${this.base}/jams/${encodeURIComponent(code)}`);
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
