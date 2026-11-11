import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { problemDetailInterceptor } from './core/api/problem-detail.interceptor';
import { ThemeService } from './core/ui/theme.service';

/**
 * Application-wide providers (the standalone replacement for AppModule).
 *
 * - Zoneless change detection: no zone.js patching of every async API. The UI is driven entirely by signals,
 *   so Angular knows exactly what changed — smaller bundle, fewer wasted checks, and callbacks from the YouTube
 *   iframe API (which run outside any zone) update the view without NgZone.run().
 * - HttpClient with the fetch backend and a functional interceptor that normalises RFC 7807 errors.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(withFetch(), withInterceptors([problemDetailInterceptor])),
    // Apply the saved theme during bootstrap, before the first paint of the app.
    provideAppInitializer(() => void inject(ThemeService)),
  ],
};
