import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { PlayerStore } from './core/player/player.store';
import { ThemeService } from './core/ui/theme.service';
import { DecadeSlug } from './core/models';
import { HeaderComponent } from './features/header/header.component';
import { CrtTvComponent } from './features/tv/crt-tv.component';
import { PlaylistFeedComponent } from './features/feed/playlist-feed.component';
import { DecadeBarComponent } from './features/decade-bar/decade-bar.component';
import { NowPlayingBarComponent } from './features/now-playing/now-playing-bar.component';
import { SharePlaylistDialogComponent } from './features/share/share-playlist-dialog.component';
import { ToastHostComponent } from './features/toast-host.component';
import { RoomComponent } from './features/room/room.component';
import { JamDrawerComponent } from './features/jam/jam-drawer.component';
import { AmbientComponent } from './features/ambient/ambient.component';
import { FilmGrainComponent } from './features/ambient/film-grain.component';
import { ThemePickerComponent } from './features/header/theme-picker.component';

const DECADE_KEYS: DecadeSlug[] = ['60s', '70s', '80s', '90s', '2000s', '2010s', 'now'];

/**
 * Root component = page layout + global keyboard shortcuts. It owns no business state; everything lives in
 * PlayerStore / FeedStore, so each feature component can be developed and tested in isolation.
 *
 * Layout (desktop) — symmetric so the TV is centred; jams open in a drawer from the header:
 *   ┌ header: listeners · RETROO TV · YT Music link ┐
 *   │ feed (left)        CRT TV (centre)             │
 *   │                    decade bar                  │
 *   └                    now-playing bar     scenes ▲┘
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HeaderComponent,
    CrtTvComponent,
    PlaylistFeedComponent,
    DecadeBarComponent,
    NowPlayingBarComponent,
    SharePlaylistDialogComponent,
    ToastHostComponent,
    RoomComponent,
    JamDrawerComponent,
    AmbientComponent,
    FilmGrainComponent,
    ThemePickerComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly player = inject(PlayerStore);
  private readonly theme = inject(ThemeService);

  /** Space = play/pause · N = next · P = previous · M = mute · S = shuffle playlist · T = next theme · 1–7 = decades. */
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    // Key events can target the document itself (extensions, synthetic events): only Elements have closest().
    const target = e.target instanceof Element ? e.target : null;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (target?.closest('input, textarea, select, dialog, [contenteditable="true"]')) return;

    const key = e.key.toLowerCase();
    if (key === ' ' && !(target instanceof HTMLButtonElement)) {
      e.preventDefault();
      this.player.togglePlay();
    } else if (key === 'n') {
      void this.player.next();
    } else if (key === 'p') {
      void this.player.previous();
    } else if (key === 'm') {
      this.player.toggleMute();
    } else if (key === 's') {
      this.player.toggleShuffle();
    } else if (key === 't') {
      this.theme.cycle();
    } else if (/^[1-7]$/.test(key)) {
      void this.player.selectDecade(DECADE_KEYS[Number(key) - 1]);
    }
  }
}
