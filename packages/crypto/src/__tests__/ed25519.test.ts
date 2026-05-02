import { describe, it, expect } from 'vitest'
import { generateKeypair, derivePublicKey, sign, verifySignature } from '../ed25519.js'

describe('generateKeypair', () => {
  it('returns 64-char hex public and secret keys', () => {
    const { publicKey, secretKey } = generateKeypair()
    expect(publicKey).toHaveLength(64)
    expect(publicKey).toMatch(/^[0-9a-f]{64}$/)
    expect(secretKey).toHaveLength(64)
    expect(secretKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique keypairs each time', () => {
    const kp1 = generateKeypair()
    const kp2 = generateKeypair()
    expect(kp1.secretKey).not.toBe(kp2.secretKey)
    expect(kp1.publicKey).not.toBe(kp2.publicKey)
  })
})

describe('derivePublicKey', () => {
  it('derives the same public key as generateKeypair', () => {
    const { publicKey, secretKey } = generateKeypair()
    expect(derivePublicKey(secretKey)).toBe(publicKey)
  })
})

describe('sign / verifySignature', () => {
  it('produces a valid 128-char hex signature', () => {
    const { secretKey } = generateKeypair()
    const message = Buffer.from('commit body hash')
    const sig = sign(message, secretKey)
    expect(sig).toHaveLength(128)
    expect(sig).toMatch(/^[0-9a-f]{128}$/)
  })

  it('signature verifies correctly', () => {
    const { publicKey, secretKey } = generateKeypair()
    const message = Buffer.from('rekurn-commit\ntree abc\nparent def\n\ninitial commit')
    const sig = sign(message, secretKey)
    expect(verifySignature(message, sig, publicKey)).toBe(true)
  })

  it('rejects a tampered message', () => {
    const { publicKey, secretKey } = generateKeypair()
    const message = Buffer.from('original message')
    const tampered = Buffer.from('tampered message')
    const sig = sign(message, secretKey)
    expect(verifySignature(tampered, sig, publicKey)).toBe(false)
  })

  it('rejects a signature from a different keypair', () => {
    const kp1 = generateKeypair()
    const kp2 = generateKeypair()
    const message = Buffer.from('hello')
    const sig = sign(message, kp1.secretKey)
    expect(verifySignature(message, sig, kp2.publicKey)).toBe(false)
  })

  it('returns false for malformed signature', () => {
    const { publicKey } = generateKeypair()
    const message = Buffer.from('hello')
    expect(verifySignature(message, 'a'.repeat(128), publicKey)).toBe(false)
  })
})
