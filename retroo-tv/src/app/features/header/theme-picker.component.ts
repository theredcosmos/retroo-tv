import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { ThemeService, ThemeId } from '../../core/ui/theme.service';

/**
 * Scene picker: a quiet "Scene" button in the bottom-right corner of the stage, opening a menu (upward, since it
 * sits at the bottom) grouped into Rooms and Minimal. WAI-ARIA menu-button
 * pattern with `menuitemradio` items; closes on selection, Escape or an outside click. `T` cycles globally.
 */
@Component({
  selector: 'app-theme-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="trigger glass" (click)="open.set(!open())"
            aria-haspopup="menu" [attr.aria-expanded]="open()" title="Change scene (T)">
      <span class="swatch" [style.--a]="theme.option().swatch[0]" [style.--b]="theme.option().swatch[1]"></span>
      <span class="name">{{ theme.option().label }}</span>
    </button>
    @if (open()) {
      <div class="menu" role="menu" aria-label="Scenes">
        @for (g of theme.groups; track g) {
          <div class="group eyebrow">{{ g }}</div>
          @for (t of theme.themes; track t.id) {
            @if (t.group === g) {
              <button type="button" role="menuitemradio" class="item"
                      [attr.aria-checked]="theme.current() === t.id" (click)="pick(t.id)">
                <span class="swatch" [style.--a]="t.swatch[0]" [style.--b]="t.swatch[1]"></span>
                <span class="text">
                  <span class="label">{{ t.label }}</span>
                  <small>{{ t.description }}</small>
                </span>
              </button>
            }
          }
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-block; }
    .trigger {
      display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 13px 0 9px;
      border-radius: var(--radius-pill); font-size: 12px; font-weight: 500; cursor: pointer;
      transition: background var(--fast) var(--ease);
      &:hover { background: var(--hover); }
    }
    .swatch {
      flex: none; width: 16px; height: 16px; border-radius: 50%;
      background: linear-gradient(135deg, var(--a) 0 50%, var(--b) 50% 100%);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
    }
    .menu {
      position: absolute; bottom: calc(100% + 8px); right: 0; z-index: 30; width: 250px;
      max-height: calc(100dvh - 120px); overflow-y: auto; transform-origin: bottom right;
      display: grid; gap: 1px; padding: 8px; border-radius: 16px;
      background: var(--glass-strong); border: var(--hairline);
      backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
      box-shadow: 0 24px 60px -16px var(--shadow);
      animation: drop var(--fast) var(--ease);
    }
    .group { padding: 8px 10px 4px; }
    .item {
      display: flex; align-items: center; gap: 11px; padding: 8px 10px; border: 0; border-radius: 10px;
      background: transparent; text-align: left; cursor: pointer;
      &:hover, &:focus-visible { background: var(--hover); }
      &[aria-checked='true'] .label::after { content: '  ·  on'; color: var(--ink-faint); font-weight: 400; }
    }
    .text { display: grid; }
    .label { font-size: 13px; font-weight: 500; }
    small { font-size: 11px; color: var(--ink-faint); }
    @keyframes drop { from { opacity: 0; transform: translateY(4px); } }
    @media (max-width: 600px) { .name { display: none; } }
  `,
})
export class ThemePickerComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly open = signal(false);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  protected pick(id: ThemeId): void {
    this.theme.set(id);
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent): void {
    if (this.open() && !this.el.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }
}
