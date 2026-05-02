import { ed25519 } from '@noble/curves/ed25519'
import { bufferToHex, hexToBuffer } from './hash.js'

export interface Keypair {
  /** 32-byte Ed25519 public key encoded as a 64-char hex string. */
  publicKey: string
  /** 32-byte Ed25519 private key seed encoded as a 64-char hex string. */
  secretKey: string
}

/**
 * Generate a fresh Ed25519 keypair.
 * The secret key is a 32-byte random seed.
 */
export function generateKeypair(): Keypair {
  const secretKeyBytes = ed25519.utils.randomPrivateKey()
  const publicKeyBytes = ed25519.getPublicKey(secretKeyBytes)
  return {
    secretKey: bufferToHex(secretKeyBytes),
    publicKey: bufferToHex(publicKeyBytes),
  }
}

/**
 * Derive the public key from a secret key seed (hex string).
 */
export function derivePublicKey(secretKeyHex: string): string {
  const secretKeyBytes = hexToBuffer(secretKeyHex)
  return bufferToHex(ed25519.getPublicKey(secretKeyBytes))
}

/**
 * Sign a message with an Ed25519 secret key.
 *
 * @param message  Raw bytes to sign (typically a commit body hash).
 * @param secretKeyHex  64-char hex-encoded 32-byte seed.
 * @returns 128-char hex-encoded 64-byte signature.
 */
export function sign(message: Buffer, secretKeyHex: string): string {
  const secretKeyBytes = hexToBuffer(secretKeyHex)
  const signature = ed25519.sign(message, secretKeyBytes)
  return bufferToHex(signature)
}

/**
 * Verify an Ed25519 signature.
 *
 * @param message  The original message bytes.
 * @param signatureHex  128-char hex-encoded signature.
 * @param publicKeyHex  64-char hex-encoded public key.
 * @returns true if the signature is valid.
 */
export function verifySignature(
  message: Buffer,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    const signature = hexToBuffer(signatureHex)
    const publicKey = hexToBuffer(publicKeyHex)
    return ed25519.verify(signature, message, publicKey)
  } catch {
    return false
  }
}
