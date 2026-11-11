import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { ApiError } from '../models';

/**
 * Functional HTTP interceptor: converts every failed response into one predictable {@link ApiError} shape,
 * whether the server sent an RFC 7807 problem document, a proxy sent an HTML 502 page, or the network failed
 * (status 0). Components then only ever deal with ApiError — no `instanceof HttpErrorResponse` checks.
 */
export const problemDetailInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(catchError((err: unknown) => throwError(() => toApiError(err))));

export function toApiError(err: unknown): ApiError {
  if (!(err instanceof HttpErrorResponse)) {
    return { status: -1, title: 'Error', detail: String(err), fieldErrors: {} };
  }
  if (err.status === 0) {
    return { status: 0, title: 'Offline', detail: 'Cannot reach the Retroo TV server.', fieldErrors: {} };
  }
  const body = typeof err.error === 'object' && err.error !== null ? err.error : {};
  const retryAfter = Number(err.headers?.get('Retry-After'));
  return {
    status: err.status,
    title: body.title ?? err.statusText ?? 'Error',
    detail: body.detail ?? 'Something went wrong.',
    fieldErrors: body.errors ?? {},
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  };
}
