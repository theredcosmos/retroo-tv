import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { toApiError } from './problem-detail.interceptor';

describe('toApiError', () => {
  it('maps an RFC 7807 validation problem with field errors', () => {
    const err = new HttpErrorResponse({
      status: 400,
      error: { title: 'Validation failed', detail: 'One or more fields are invalid.', errors: { displayName: 'is required' } },
    });
    expect(toApiError(err)).toEqual({
      status: 400,
      title: 'Validation failed',
      detail: 'One or more fields are invalid.',
      fieldErrors: { displayName: 'is required' },
      retryAfterSeconds: undefined,
    });
  });

  it('reads Retry-After on 429', () => {
    const err = new HttpErrorResponse({
      status: 429,
      headers: new HttpHeaders({ 'Retry-After': '120' }),
      error: { title: 'Too many requests', detail: 'slow down' },
    });
    expect(toApiError(err).retryAfterSeconds).toBe(120);
  });

  it('treats status 0 as offline', () => {
    expect(toApiError(new HttpErrorResponse({ status: 0 })).title).toBe('Offline');
  });

  it('survives non-JSON error bodies (e.g. an nginx 502 page)', () => {
    const e = toApiError(new HttpErrorResponse({ status: 502, statusText: 'Bad Gateway', error: '<html>' }));
    expect(e.status).toBe(502);
    expect(e.fieldErrors).toEqual({});
  });
});
