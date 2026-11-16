import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';

export type ThemeId = 'living' | 'rural' | 'city' | 'villa' | 'midnight' | 'neon' | 'studio' | 'noir';

/** Which room (soft, out-of-focus light composition) to draw. */
export type SceneId = 'living' | 'rural' | 'city' | 'villa' | 'neon' | 'studio';

/** Which television to draw. */
export type TvModel = 'console' | 'portable' | 'sleek' | 'cabinet' | 'gloss';

export interface ThemeOption {
  id: ThemeId;
  group: 'Rooms' | 'Minimal';
  label: string;
  description: string;
  scene: SceneId;
  tv: TvModel;
  /** Night variant of a scene (moonlight instead of sun). */
  night?: boolean;
  /** Two colours for the picker swatch. */
  swatch: [string, string];
  /** Browser UI colour (mobile address bar). */
  metaColor: string;
}

/**
 * A theme = room scene + TV model + palette. Palettes: src/themes.scss. Scenes: RoomComponent.
 * TV models: CrtTvComponent (crt-tv.models.scss).
 */
export const THEMES: readonly ThemeOption[] = [
  { id: 'living', group: 'Rooms', label: 'Sunset Lounge', description: 'Late light, teak console',
    scene: 'living', tv: 'console', swatch: ['#f2b07a', '#5d341c'], metaColor: '#1a110c' },
  { id: 'rural', group: 'Rooms', label: 'Village Afternoon', description: 'Limewash walls, portable set',
    scene: 'rural', tv: 'portable', swatch: ['#e6dcc6', '#7f9a55'], metaColor: '#2a2416' },
  { id: 'city', group: 'Rooms', label: 'City Night', description: 'Skyline bokeh, silver stereo TV',
    scene: 'city', tv: 'sleek', swatch: ['#c4c8d2', '#1d2538'], metaColor: '#0a0d16' },
  { id: 'villa', group: 'Rooms', label: 'Ivory Villa', description: 'Creamy daylight, walnut cabinet',
    scene: 'villa', tv: 'cabinet', swatch: ['#e4d5ba', '#6a4223'], metaColor: '#d9cbb0' },
  { id: 'midnight', group: 'Rooms', label: 'Midnight', description: 'Moonlight, midnight-blue set',
    scene: 'living', tv: 'console', night: true, swatch: ['#b9c8ff', '#2c3a5c'], metaColor: '#06080f' },
  { id: 'neon', group: 'Rooms', label: 'Neon Den', description: 'Violet glow, gloss black TV',
    scene: 'neon', tv: 'gloss', swatch: ['#f3a6ff', '#170828'], metaColor: '#0a0412' },
  { id: 'studio', group: 'Minimal', label: 'Studio', description: 'Charcoal, one soft spotlight',
    scene: 'studio', tv: 'console', swatch: ['#2b2a28', '#6b4429'], metaColor: '#0d0d0d' },
  { id: 'noir', group: 'Minimal', label: 'Noir', description: 'Black & white cinema',
    scene: 'studio', tv: 'gloss', swatch: ['#f0f0f0', '#0a0a0a'], metaColor: '#050505' },
];

const STORAGE_KEY = 'retroo.theme';

/**
 * Visual theme of the room and TV. Colours change with one `data-theme` attribute write (the browser repaints);
 * scene and TV model are signals the Room and TV components read. Remembered per browser in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);

  readonly themes = THEMES;
  readonly groups = ['Rooms', 'Minimal'] as const;
  readonly current = signal<ThemeId>(readStored());
  readonly option = computed(() => themeById(this.current()));
  readonly scene = computed(() => this.option().scene);
  readonly tvModel = computed(() => this.option().tv);
  readonly night = computed(() => !!this.option().night);

  constructor() {
    effect(() => {
      const t = this.option();
      const html = this.doc.documentElement;
      html.dataset['theme'] = t.id;
      html.style.colorScheme = t.id === 'villa' ? 'light' : 'dark';
      this.doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.metaColor);
      try {
        localStorage.setItem(STORAGE_KEY, t.id);
      } catch {
        /* storage blocked — theme just won't persist */
      }
    });
  }

  set(id: ThemeId): void {
    this.current.set(id);
  }

  /** Next theme in the list (keyboard shortcut T). */
  cycle(): void {
    const i = THEMES.findIndex((t) => t.id === this.current());
    this.current.set(THEMES[(i + 1) % THEMES.length].id);
  }
}

function themeById(id: ThemeId): ThemeOption {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

function readStored(): ThemeId {
  try {
    // 'ivory' was merged into 'villa' (Ivory Villa): keep people who picked it on the merged theme.
    const stored = localStorage.getItem(STORAGE_KEY);
    const v = stored === 'ivory' ? 'villa' : stored;
    return THEMES.some((t) => t.id === v) ? (v as ThemeId) : 'living';
  } catch {
    return 'living';
  }
}
