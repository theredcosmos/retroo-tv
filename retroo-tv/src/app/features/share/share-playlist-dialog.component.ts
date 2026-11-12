import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { FeedStore } from '../../core/feed/feed.store';
import { JamStore } from '../../core/jam/jam.store';
import { ApiError } from '../../core/models';
import { ToastService } from '../../core/ui/toast.service';

const NAME_KEY = 'retroo.displayName';

/**
 * Client-side mirror of the server's YouTubeLinkParser: a YouTube host and a `list=` parameter.
 * This is for instant feedback only — the server re-validates, because client checks can always be bypassed.
 */
export function youtubePlaylistValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = (control.value ?? '').trim();
  if (!value) return null; // `required` reports emptiness
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const hostOk = /^(music\.|www\.|m\.)?youtube\.com$|^youtu\.be$/i.test(url.hostname);
    const list = url.searchParams.get('list');
    return hostOk && list && /^[\w-]{2,64}$/.test(list) ? null : { ytPlaylist: true };
  } catch {
    return { ytPlaylist: true };
  }
}

/**
 * "Share your playlist" button + modal form.
 *
 * - Native <dialog> with showModal(): focus trapping, Esc-to-close, inert background and top-layer rendering come
 *   from the browser for free (no overlay library).
 * - Typed reactive form (NonNullableFormBuilder) with sync validators matching the server's limits.
 * - Server errors are mapped back: 400 field errors onto controls, 409/429 into a form-level message.
 * - The display name is remembered in localStorage (wrapped in try/catch — storage can be disabled).
 */
@Component({
  selector: 'app-share-playlist-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  templateUrl: './share-playlist-dialog.component.html',
  styleUrl: './share-playlist-dialog.component.scss',
})
export class SharePlaylistDialogComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly feed = inject(FeedStore);
  private readonly toast = inject(ToastService);
  protected readonly jam = inject(JamStore);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);
  /** "Also play it in a jam" — wording follows the user's jam role (see JamStore.playlistToJam). */
  protected readonly toJam = signal(false);
  protected readonly jamOptionLabel = computed(() =>
    this.jam.isHost()
      ? 'Play it for everyone in my jam'
      : this.jam.inJam()
        ? 'Suggest it in the jam chat'
        : 'Start a jam session with it',
  );

  protected readonly form = this.fb.group({
    displayName: [readName(), [Validators.required, Validators.maxLength(40)]],
    playlistUrl: ['', [Validators.required, Validators.maxLength(500), youtubePlaylistValidator]],
    playlistName: ['', [Validators.required, Validators.maxLength(80)]],
    note: ['', [Validators.maxLength(140)]],
  });

  protected open(): void {
    this.formError.set(null);
    this.toJam.set(this.jam.inJam());
    this.dialog().nativeElement.showModal();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  /** Click on the backdrop (the <dialog> element itself, outside the panel) closes it. */
  protected onDialogClick(e: MouseEvent): void {
    if (e.target === this.dialog().nativeElement) this.close();
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.formError.set(null);
    const value = this.form.getRawValue();

    this.feed.share({ ...value, note: value.note.trim() || undefined }).subscribe({
      next: (created) => {
        saveName(value.displayName);
        this.submitting.set(false);
        this.form.reset({ displayName: value.displayName, playlistUrl: '', playlistName: '', note: '' });
        this.close();
        if (this.toJam()) {
          if (!this.jam.displayName().trim()) this.jam.setName(value.displayName);
          this.jam.playlistToJam(created);
        } else {
          this.toast.show('Thanks! Your playlist is on the wall 🎶');
        }
      },
      error: (err: ApiError) => {
        this.submitting.set(false);
        this.applyServerErrors(err);
      },
    });
  }

  private applyServerErrors(err: ApiError): void {
    for (const [field, message] of Object.entries(err.fieldErrors)) {
      this.form.get(field)?.setErrors({ server: message });
    }
    if (err.status === 429 && err.retryAfterSeconds) {
      const minutes = Math.ceil(err.retryAfterSeconds / 60);
      this.formError.set(`You're sharing too fast — try again in ${minutes} min.`);
    } else if (!Object.keys(err.fieldErrors).length) {
      this.formError.set(err.detail);
    }
  }

  protected errorFor(name: keyof typeof this.form.controls): string | null {
    const c = this.form.controls[name];
    if (!c.touched || !c.errors) return null;
    if (c.errors['required']) return 'Required';
    if (c.errors['maxlength']) return `Max ${c.errors['maxlength'].requiredLength} characters`;
    if (c.errors['ytPlaylist']) return 'Paste a YouTube Music playlist link (it contains “list=”)';
    if (c.errors['server']) return c.errors['server'];
    return 'Invalid';
  }
}

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage disabled — remembering the name is only a convenience */
  }
}
