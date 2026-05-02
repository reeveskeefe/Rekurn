import { describe, it, expect } from 'vitest'
import { sha256, sha256Buffer, hexToBuffer, bufferToHex, safeEqual } from '../hash.js'

describe('sha256', () => {
  it('returns a 64-char hex string', () => {
    const hash = sha256('hello world')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces the known SHA-256 of "hello world"', () => {
    expect(sha256('hello world')).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    )
  })

  it('accepts a Buffer', () => {
    const buf = Buffer.from('hello world')
    expect(sha256(buf)).toBe(sha256('hello world'))
  })

  it('produces different hashes for different inputs', () => {
    expect(sha256('foo')).not.toBe(sha256('bar'))
  })

  it('is deterministic', () => {
    expect(sha256('test')).toBe(sha256('test'))
  })
})

describe('sha256Buffer', () => {
  it('returns a 32-byte Buffer', () => {
    const buf = sha256Buffer('hello')
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBe(32)
  })

  it('matches the hex version', () => {
    expect(bufferToHex(sha256Buffer('hello'))).toBe(sha256('hello'))
  })
})

describe('hexToBuffer / bufferToHex', () => {
  it('round-trips correctly', () => {
    const original = 'deadbeefcafe1234'
    expect(bufferToHex(hexToBuffer(original))).toBe(original)
  })

  it('throws on odd-length hex', () => {
    expect(() => hexToBuffer('abc')).toThrow()
  })
})

describe('safeEqual', () => {
  it('returns true for equal buffers', () => {
    const a = Buffer.from('secret')
    const b = Buffer.from('secret')
    expect(safeEqual(a, b)).toBe(true)
  })

  it('returns false for different buffers', () => {
    const a = Buffer.from('secret1')
    const b = Buffer.from('secret2')
    expect(safeEqual(a, b)).toBe(false)
  })

  it('returns false for different lengths', () => {
    expect(safeEqual(Buffer.from('abc'), Buffer.from('abcd'))).toBe(false)
  })
})
