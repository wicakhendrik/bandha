export class HttpError extends Error {
  /** `extra` is merged into the JSON body next to `error` (e.g. a machine-readable `code`). */
  constructor(public readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503, message: string, public readonly extra?: Record<string, unknown>) {
    super(message);
  }
}
