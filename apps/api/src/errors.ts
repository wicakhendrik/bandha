export class HttpError extends Error {
  constructor(public readonly status: 400 | 401 | 404 | 409, message: string) {
    super(message);
  }
}
