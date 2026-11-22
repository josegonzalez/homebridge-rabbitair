import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const BLOCK = 16;

/** Thrown when an access token is not 32 hex characters. */
export class InvalidTokenError extends Error {
  constructor() {
    super('token must be 32 hex characters (16 bytes)');
    this.name = 'InvalidTokenError';
  }
}

/** Decodes a 32 character hex access token into its 16 byte AES key. */
export function parseToken(token: string): Buffer {
  if (!/^[0-9a-fA-F]{32}$/.test(token)) {
    throw new InvalidTokenError();
  }
  return Buffer.from(token, 'hex');
}

/**
 * Encrypts a message with AES-128-CBC and PKCS#7 padding under a random IV.
 * The wire format is the ciphertext followed by the IV.
 */
export function encrypt(key: Buffer, message: Buffer): Buffer {
  const iv = randomBytes(BLOCK);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([cipher.update(message), cipher.final(), iv]);
}

/** Reverses {@link encrypt}. Throws when the message is malformed. */
export function decrypt(key: Buffer, message: Buffer): Buffer {
  if (message.length < 2 * BLOCK || message.length % BLOCK !== 0) {
    throw new Error(`invalid encrypted message length ${message.length}`);
  }
  const iv = message.subarray(message.length - BLOCK);
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(message.subarray(0, message.length - BLOCK)), decipher.final()]);
}
