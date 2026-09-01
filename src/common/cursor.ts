import { AppError } from './problem';

export interface CursorPayload {
  c: string;
  id: number;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(raw: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as CursorPayload;

    if (typeof parsed.c !== 'string' || typeof parsed.id !== 'number') {
      throw new Error('bad cursor shape');
    }

    return parsed;
  } catch {
    throw new AppError(400, 'The cursor could not be decoded — it is opaque and belongs to the server.', {
      code: 'invalid-cursor',
    });
  }
}
