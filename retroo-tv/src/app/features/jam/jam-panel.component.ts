import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JamStore } from '../../core/jam/jam.store';
import { ToastService } from '../../core/ui/toast.service';
import { PlayerStore } from '../../core/player/player.store';
import { ChatMessage } from '../../core/models';

/**
 * Right-hand column: the jam lobby (start a jam / join a live one / accept an invite link) or, inside a jam,
 * the session header (code, members, countdown, host actions) and the chat.
 *
 * Template-driven forms (ngModel) are enough here — two single-field inputs with simple length limits; the
 * server enforces the real rules and reports problems as toasts / jam-errors.
 */
@Component({
  selector: 'app-jam-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './jam-panel.component.html',
  styleUrl: './jam-panel.component.scss',
})
export class JamPanelComponent {
  protected readonly jam = inject(JamStore);
  private readonly toast = inject(ToastService);
  private readonly player = inject(PlayerStore);
  private readonly chatList = viewChild<ElementRef<HTMLElement>>('chatList');

  protected newJamName = '';
  protected message = '';
  protected readonly showMembers = signal(false);

  protected readonly timeLeft = computed(() => {
    const s = Math.floor(this.jam.msLeft() / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
  protected readonly nameValid = computed(() => this.jam.displayName().trim().length > 0);

  constructor() {
    // Keep the chat scrolled to the newest message.
    effect(() => {
      this.jam.chat();
      const el = this.chatList()?.nativeElement;
      if (el) setTimeout(() => (el.scrollTop = el.scrollHeight));
    });
  }

  protected create(): void {
    if (!this.nameValid()) {
      this.toast.show('Enter your name first.', 'error');
      return;
    }
    if (!this.newJamName.trim()) return;
    void this.jam.create(this.newJamName).then(() => (this.newJamName = ''));
  }

  protected send(input: HTMLInputElement): void {
    if (!this.message.trim()) return;
    this.jam.sendChat(this.message);
    this.message = '';
    // ngModel writes the new value asynchronously; clear the DOM now so fast typists don't append to the old text.
    input.value = '';
  }

  protected async copyInvite(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.jam.inviteLink());
      this.toast.show('Invite link copied — send it to your friends!');
    } catch {
      this.toast.show(this.jam.inviteLink());
    }
  }

  /** Host only: put a playlist someone shared in chat on everyone's TV (guests follow via STATE events). */
  protected playOnTv(m: ChatMessage): void {
    if (!m.playlistUrl) return;
    void this.player.playPlaylist({
      id: 0,
      displayName: m.author ?? 'a guest',
      playlistUrl: m.playlistUrl,
      playlistName: 'Shared in the jam',
      createdAt: new Date(m.sentAt).toISOString(),
    });
    this.jam.drawerOpen.set(false);
  }

  protected minutesLeft(expiresAt: string): number {
    return Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 60_000));
  }

  protected time(epochMs: number): string {
    return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
