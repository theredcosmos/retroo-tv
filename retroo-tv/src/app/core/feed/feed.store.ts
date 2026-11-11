import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, tap } from 'rxjs';
import { RetrooApi } from '../api/retroo-api.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SharePlaylistRequest, SharedPlaylist } from '../models';

const FEED_SIZE = 40;

/**
 * State of the shared-playlist feed.
 *
 * Initial page comes from REST; afterwards new entries arrive over WebSocket. The share dialog also inserts the
 * entry it just created (so the sharer sees it instantly even if the socket is reconnecting). Because the same
 * entry can therefore arrive twice, `upsert` de-duplicates by id — the client-side mirror of the server's
 * idempotency rules.
 */
@Injectable({ providedIn: 'root' })
export class FeedStore {
  private readonly api = inject(RetrooApi);

  readonly items = signal<SharedPlaylist[]>([]);
  readonly loading = signal(true);
  /** Id of the most recently pushed entry, used for a brief highlight animation. */
  readonly freshId = signal<number | null>(null);

  constructor() {
    const realtime = inject(RealtimeService);
    realtime.playlistShared$.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((p) => this.upsert(p));
  }

  load(): void {
    this.loading.set(true);
    this.api.playlists(0, FEED_SIZE).subscribe({
      next: (page) => {
        this.items.set(page.content);
        this.loading.set(false);
      },
      error: () => this.loading.set(false), // feed is decorative — fail quietly, the TV still works
    });
  }

  share(request: SharePlaylistRequest): Observable<SharedPlaylist> {
    return this.api.sharePlaylist(request).pipe(tap((p) => this.upsert(p)));
  }

  private upsert(p: SharedPlaylist): void {
    if (this.items().some((i) => i.id === p.id)) return;
    this.items.update((list) => [p, ...list].slice(0, FEED_SIZE));
    this.freshId.set(p.id);
  }
}
