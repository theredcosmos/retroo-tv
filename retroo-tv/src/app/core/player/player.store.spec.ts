import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { Subject, of, delay } from 'rxjs';
import { CHANNEL_STATIC_MS, PlayerStore, SIGNAL_LOSS_MS } from './player.store';
import { StaticHissService } from './static-hiss.service';
import { RetrooApi } from '../api/retroo-api.service';
import { YouTubePlayerService } from './youtube-player.service';
import { Song } from '../models';

const song = (videoId: string, decade: Song['decade'] = '90s'): Song => ({
  id: 1, videoId, title: videoId, artist: 'a', decade,
});

/** Fake YouTube adapter: records what was loaded, no iframe involved. */
class FakeYouTube {
  loaded: string[] = [];
  state = signal<'unstarted' | 'playing'>('unstarted');
  currentTime = signal(0);
  duration = signal(0);
  muted = signal(false);
  ended$ = new Subject<void>();
  unplayable$ = new Subject<number>();
  load = async (id: string) => void this.loaded.push(id);
  cue = async () => {};
  mount = async () => {};
  play() {}
  pause() {}
  wantsPlaying() { return this.state() === 'playing'; }
  seekTo(_seconds: number) {}
  toggleMute() {}
}

describe('PlayerStore', () => {
  let store: PlayerStore;
  let yt: FakeYouTube;
  let api: jasmine.SpyObj<RetrooApi>;

  beforeEach(() => {
    api = jasmine.createSpyObj<RetrooApi>('RetrooApi', ['randomSong', 'decades']);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: RetrooApi, useValue: api },
        { provide: YouTubePlayerService, useClass: FakeYouTube },
        { provide: StaticHissService, useValue: { start() {}, stop() {} } },
      ],
    });
    store = TestBed.inject(PlayerStore);
    yt = TestBed.inject(YouTubePlayerService) as unknown as FakeYouTube;
  });

  it('plays a random song from the selected decade', fakeAsync(() => {
    api.randomSong.and.returnValue(of(song('hTWKbfoikeg')));
    store.selectDecade('90s');
    tick(CHANNEL_STATIC_MS + 100);
    expect(api.randomSong).toHaveBeenCalledWith('90s', 'hi', []);
    expect(yt.loaded).toEqual(['hTWKbfoikeg']);
    expect(store.status()).toBe('on');
  }));

  it('only the latest of several rapid channel changes reaches the player', fakeAsync(() => {
    api.randomSong.and.callFake((decade) =>
      of(song(decade === '60s' ? 'slow6060606' : 'fast8080808')).pipe(delay(decade === '60s' ? 900 : 10)),
    );
    store.selectDecade('60s');
    store.selectDecade('80s');
    tick(CHANNEL_STATIC_MS + 1000);
    expect(yt.loaded).toEqual(['fast8080808']);
    expect(store.activeDecade()).toBe('80s');
  }));

  it('excludes the current song when skipping to the next one', fakeAsync(() => {
    api.randomSong.and.returnValues(of(song('first000000')), of(song('second00000')));
    store.selectDecade('90s');
    tick(CHANNEL_STATIC_MS + 100);
    store.next();
    tick(CHANNEL_STATIC_MS + 100);
    expect(api.randomSong.calls.mostRecent().args).toEqual(['90s', 'hi', ['first000000']]);
  }));

  it('shows an error after too many unplayable videos in a row', fakeAsync(() => {
    api.randomSong.and.returnValue(of(song('blocked0000')));
    store.selectDecade('90s');
    tick(CHANNEL_STATIC_MS + 100);
    for (let i = 0; i < 6; i++) {
      yt.unplayable$.next(150);
      tick(CHANNEL_STATIC_MS + 100);
    }
    expect(store.status()).toBe('error');
  }));

  it('waits longer between songs (signal loss) than for a channel change', fakeAsync(() => {
    api.randomSong.and.returnValues(of(song('first000000')), of(song('second00000')));
    store.selectDecade('90s');
    tick(CHANNEL_STATIC_MS + 100);

    yt.ended$.next(); // song finished on its own
    expect(store.transition()).toBe('signal-loss');
    tick(CHANNEL_STATIC_MS + 100);
    expect(yt.loaded).toEqual(['first000000']); // still showing static
    tick(SIGNAL_LOSS_MS - CHANNEL_STATIC_MS);
    expect(yt.loaded).toEqual(['first000000', 'second00000']);
  }));

  describe('jam guest (follow mode)', () => {
    it('ignores local intents while following the host', fakeAsync(() => {
      api.randomSong.and.returnValue(of(song('first000000')));
      store.selectDecade('90s');
      tick(CHANNEL_STATIC_MS + 100);
      api.randomSong.calls.reset();

      store.setFollowMode(true);
      store.next();
      store.selectDecade('60s');
      tick(CHANNEL_STATIC_MS + 100);
      expect(api.randomSong).not.toHaveBeenCalled();
      expect(store.canControl()).toBeFalse();
    }));

    it("loads the host's song and seeks to the host's position", fakeAsync(() => {
      store.awaitingGesture.set(false);
      store.setFollowMode(true);
      const seek = spyOn(yt, 'seekTo');
      const now = Date.now();
      store.applyRemote(
        { song: song('hostSong001', '80s'), playing: true, positionSec: 30, updatedAt: now - 10_000 },
        0,
      );
      tick(CHANNEL_STATIC_MS + 100);
      expect(yt.loaded).toEqual(['hostSong001']);
      expect(store.activeDecade()).toBe('80s');
      // 30 s + ~10 s (+ the static time) since the host's update → seek near 41.5 s
      const target = seek.calls.mostRecent().args[0];
      expect(target).toBeGreaterThan(39);
      expect(target).toBeLessThan(45);
    }));
  });

  it('rotates Bollywood, Bollywood, Hollywood and excludes recent songs', fakeAsync(() => {
    let n = 0;
    api.randomSong.and.callFake(() => of(song(`song${String(++n).padStart(7, '0')}`)));
    store.selectDecade('90s');
    tick(CHANNEL_STATIC_MS + 100);
    for (let i = 0; i < 5; i++) {
      store.next();
      tick(CHANNEL_STATIC_MS + 100);
    }
    const langs = api.randomSong.calls.all().map((c) => c.args[1]);
    expect(langs).toEqual(['hi', 'hi', 'en', 'hi', 'hi', 'en']);
    const lastExclude = api.randomSong.calls.mostRecent().args[2] as string[];
    expect(lastExclude).toEqual(['song0000001', 'song0000002', 'song0000003', 'song0000004', 'song0000005']);
  }));
});
