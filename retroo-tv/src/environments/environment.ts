/**
 * Production build settings. Empty base URLs mean "same origin": nginx serves the SPA and reverse-proxies
 * /api and /ws to the Spring Boot container, so the browser never makes a cross-origin call.
 */
export const environment = {
  production: true,
  apiBaseUrl: '',
  /** Resolved at runtime from window.location so http→ws and https→wss both work. */
  wsPath: '/ws',
};
