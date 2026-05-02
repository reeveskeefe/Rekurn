import { createHash } from 'crypto'

/**
 * Compute the SHA-256 hash of data and return a 64-char lowercase hex string.
 */
export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Compute the SHA-256 hash of data and return a raw Buffer (32 bytes).
 */
export function sha256Buffer(data: Buffer | string): Buffer {
  return createHash('sha256').update(data).digest()
}

/**
 * Decode a hex string to a Buffer.
 */
export function hexToBuffer(hex: string): Buffer {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string: odd length')
  return Buffer.from(hex, 'hex')
}

/**
 * Encode a Buffer or Uint8Array to a lowercase hex string.
 */
export function bufferToHex(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('hex')
}

/**
 * Encode a Buffer to a base64url string (URL-safe, no padding).
 */
export function bufferToBase64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64url')
}

/**
 * Decode a base64url string to a Buffer.
 */
export function base64urlToBuffer(str: string): Buffer {
  return Buffer.from(str, 'base64url')
}

/**
 * Constant-time buffer comparison to prevent timing attacks.
 */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!
  }
  return diff === 0
}
