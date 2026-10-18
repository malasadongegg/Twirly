/** An error whose message is safe and useful to show to the user. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'UserFacingError'
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CancelledError'
  }
}

export const isCancellation = (err: unknown): boolean =>
  err instanceof CancelledError || (err instanceof Error && (err.name === 'AbortError' || err.message === 'Cancelled'))

const ERRNO_MESSAGES: Record<string, string> = {
  ENOSPC: 'The disk is full.',
  EACCES: 'Permission denied. Twirly cannot write to this location.',
  EPERM: 'Permission denied, or the file is read-only.',
  EBUSY: 'The file is locked by another program.',
  ENOENT: 'The file no longer exists.',
  EROFS: 'The destination is read-only.',
  ENAMETOOLONG: 'The file path is too long.',
  EMFILE: 'Too many files are open. Try fewer files at once.',
}

/** Translate low-level failures (fs errno, libvips messages) into a user-facing error. */
export function toUserFacing(err: unknown): UserFacingError {
  if (err instanceof UserFacingError) return err
  const e = err as NodeJS.ErrnoException
  const raw = e?.message ?? String(err)
  if (e?.code && ERRNO_MESSAGES[e.code]) return new UserFacingError(ERRNO_MESSAGES[e.code]!, raw)
  if (/unsupported image format|bad seek|premature end|corrupt|truncated|invalid/i.test(raw))
    return new UserFacingError('The image is corrupted or in an unsupported format.', raw)
  if (/pixel limit/i.test(raw)) return new UserFacingError('The image is too large to process.', raw)
  if (/extract_area|bad extract area/i.test(raw)) return new UserFacingError('The crop area is outside the image.', raw)
  return new UserFacingError('Something went wrong while processing the file.', raw)
}
