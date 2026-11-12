import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RxStomp, RxStompState } from '@stomp/rx-stomp';
import { Observable, map, merge } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ListenerCount, SharedPlaylist } from '../models';

/**
 * One STOMP-over-WebSocket connection for the whole app.
 *
 * - `listeners`  : signal with the live "N listening" count.
 * - `connected`  : signal for the badge's dot (green = live, grey = reconnecting).
 * - `playlistShared$`: stream of feed entries pushed by the server after someone shares.
 *
 * RxStomp handles reconnection with back-off and STOMP heart-beats (so half-open TCP connections are detected
 * on both sides — the server then fires SessionDisconnectEvent and the count drops). Opening the socket is
 * itself what makes this tab count as a listener; there are no join/ping HTTP calls.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly stomp = new RxStomp();
  private readonly state = signal<RxStompState>(RxStompState.CLOSED);

  readonly listeners = signal<number | null>(null);
  readonly connected = computed(() => this.state() === RxStompState.OPEN);

  readonly playlistShared$: Observable<SharedPlaylist>;

  constructor() {
    this.stomp.configure({
      brokerURL: RealtimeService.brokerUrl(),
      reconnectDelay: 3_000,
      heartbeatIncoming: 10_000,
      heartbeatOutgoing: 10_000,
    });

    const destroyRef = inject(DestroyRef);
    this.stomp.connectionState$.pipe(takeUntilDestroyed(destroyRef)).subscribe((s) => this.state.set(s));

    // /app/listeners → one-shot current value (server @SubscribeMapping); /topic/listeners → every change.
    // watch() re-subscribes automatically after a reconnect, so we also get a fresh snapshot each time.
    merge(this.stomp.watch('/app/listeners'), this.stomp.watch('/topic/listeners'))
      .pipe(
        map((m) => (JSON.parse(m.body) as ListenerCount).count),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((count) => this.listeners.set(count));

    this.playlistShared$ = this.stomp
      .watch('/topic/playlists')
      .pipe(map((m) => JSON.parse(m.body) as SharedPlaylist));

    this.stomp.activate();
    destroyRef.onDestroy(() => void this.stomp.deactivate());
  }

  /**
   * Subscribe to any destination and get parsed JSON bodies. `watch()` is lazy and re-subscribes after every
   * reconnect; unsubscribing from the returned Observable sends STOMP UNSUBSCRIBE.
   */
  watchJson<T>(destination: string, headers?: Record<string, string>): Observable<T> {
    return this.stomp.watch(destination, headers).pipe(map((m) => JSON.parse(m.body) as T));
  }

  /** Send a JSON message to an `/app/**` destination (queued by RxStomp until the socket is open). */
  publish(destination: string, body: unknown): void {
    this.stomp.publish({ destination, body: JSON.stringify(body) });
  }

  /** Emits each time the STOMP connection (re)opens — used to re-join a jam after a network blip. */
  get connected$(): Observable<unknown> {
    return this.stomp.connected$;
  }

  /** ws://host/ws in dev (via the Angular proxy) and wss://host/ws behind HTTPS in prod. */
  private static brokerUrl(): string {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.host}${environment.wsPath}`;
  }
}
