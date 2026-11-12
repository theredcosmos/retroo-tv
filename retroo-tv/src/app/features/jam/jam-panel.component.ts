import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JamStore } from '../../core/jam/jam.store';
import { ToastService } from '../../core/ui/toast.service';
import { PlayerStore } from '../../core/player/player.store';
import { ChatMessage } from '../../core/models';

/**
 * A jam code typed or pasted in any reasonable form: "k7q2xm", "K7Q 2XM", or a whole invite link
 * ("https://…/jam/K7Q2XM"). Returns the 6-character code, or null if there isn't one.
 */
export function parseJamCode(input: string): string | null {
  const text = input.trim();
  const fromLink = /\/jam\/([A-Za-z0-9]{6})(?![A-Za-z0-9])/.exec(text);
  if (fromLink) return fromLink[1].toUpperCase();
  const bare = text.replace(/[\s-]/g, '');
  return /^[A-Za-z0-9]{6}$/.test(bare) ? bare.toUpperCase() : null;
}

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

  protected readonly newJamName = signal('');
  /** Create form: open (listed, anyone with the code) or private (invite link / host's OK). */
  protected readonly newJamPrivate = signal(false);
  protected message = '';
  protected readonly showMembers = signal(false);
  /** "Join with a code" field: the lobby can't list every jam, so anyone with a code or link can still get in. */
  protected readonly joinCode = signal('');
  protected readonly parsedCode = computed(() => parseJamCode(this.joinCode()));

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
    // "Play in jam" from the feed / share dialog: suggest the playlist's name as the jam name.
    effect(() => {
      const p = this.jam.pendingPlaylist();
      if (p && !untracked(this.newJamName).trim()) this.newJamName.set(p.playlistName.slice(0, 40));
    });
  }

  protected create(): void {
    if (!this.nameValid()) {
      this.toast.show('Enter your name first.', 'error');
      return;
    }
    if (!this.newJamName().trim()) return;
    void this.jam.create(this.newJamName(), this.newJamPrivate() ? 'PRIVATE' : 'OPEN').then(() => {
      if (this.jam.inJam()) this.newJamName.set('');
    });
  }

  protected joinByCode(): void {
    if (!this.nameValid()) {
      this.toast.show('Enter your name first.', 'error');
      return;
    }
    const code = this.parsedCode();
    if (!code) {
      this.toast.show('Jam codes are 6 letters or numbers, like K7Q2XM.', 'error');
      return;
    }
    void this.jam.join(code).then(() => {
      if (this.jam.inJam()) this.joinCode.set('');
    });
  }

  protected send(input: HTMLInputElement): void {
    if (!this.message.trim()) return;
    this.jam.sendChat(this.message);
    this.message = '';
    // ngModel writes the new value asynchronously; clear the DOM now so fast typists don't append to the old text.
    input.value = '';
  }

  protected async copyInvite(): Promise<void> {
    const link = await this.jam.shareLink();
    const privateHost = this.jam.isPrivate() && this.jam.isHost();
    await this.copy(link, privateHost
      ? 'Private invite link copied — whoever has it joins straight in.'
      : this.jam.isPrivate()
        ? 'Link copied — people with it can ask the host to join.'
        : 'Invite link copied — send it to your friends!');
  }

  protected async newInviteLink(): Promise<void> {
    await this.copy(await this.jam.newInviteLink(), 'New invite link copied — old links no longer work.');
  }

  protected toggleVisibility(): void {
    void this.jam.setVisibility(this.jam.isPrivate() ? 'OPEN' : 'PRIVATE');
  }

  private async copy(text: string, message: string): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.toast.show(message);
    } catch {
      this.toast.show(text);
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
