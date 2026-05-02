/**
 * WebAuthn helpers wrapping @simplewebauthn/server.
 *
 * Challenge lifecycle:
 *   Challenges are stored in the `verifications` table with a 5-minute TTL.
 *   Identifier format: `webauthn:reg:{userId}` / `webauthn:auth:{userId}`
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server'
import { db, verifications, passkeys, users } from '@rekurn/db'
import { eq, and, gt } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

const rpName = 'Rekurn'
const rpID = () => process.env.WEBAUTHN_RP_ID ?? 'localhost'
const origin = () => process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
const CHALLENGE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ── Challenge storage ───────────────────────────────────────────────────────

async function storeChallenge(identifier: string, challenge: string) {
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS)
  const existing = await db
    .select()
    .from(verifications)
    .where(eq(verifications.identifier, identifier))
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(verifications)
      .set({ value: challenge, expiresAt, updatedAt: new Date() })
      .where(eq(verifications.identifier, identifier))
  } else {
    await db.insert(verifications).values({
      id: randomUUID(),
      identifier,
      value: challenge,
      expiresAt,
    })
  }
}

async function consumeChallenge(identifier: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(verifications)
    .where(
      and(
        eq(verifications.identifier, identifier),
        gt(verifications.expiresAt, new Date()),
      ),
    )
    .limit(1)

  if (rows.length === 0) return null

  await db.delete(verifications).where(eq(verifications.identifier, identifier))
  return rows[0].value
}

// ── Registration ────────────────────────────────────────────────────────────

export async function generateRegChallenge(userId: string, userEmail: string) {
  // Exclude credentials already registered for this user
  const existing = await db
    .select({ credentialId: passkeys.credentialId })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpID(),
    userName: userEmail,
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credentialId })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    timeout: 60_000,
  })

  await storeChallenge(`webauthn:reg:${userId}`, options.challenge)
  return options
}

export async function verifyRegChallenge(
  userId: string,
  response: RegistrationResponseJSON,
) {
  const challenge = await consumeChallenge(`webauthn:reg:${userId}`)
  if (!challenge) throw new Error('Challenge expired or not found')

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin(),
    expectedRPID: rpID(),
    requireUserVerification: true,
  })

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('WebAuthn registration verification failed')
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
  await db.insert(passkeys).values({
    id: randomUUID(),
    userId,
    credentialId: credential.id,
    // Store public key as base64url string
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    transports: credential.transports ? JSON.stringify(credential.transports) : null,
  })

  return { credentialId: credential.id }
}

// ── Authentication ──────────────────────────────────────────────────────────

export async function generateAuthChallenge(userEmail: string) {
  // Resolve user to get their passkeys (allow-list)
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, userEmail))
    .limit(1)

  const allowCredentials =
    userRows.length > 0
      ? await db
          .select({ credentialId: passkeys.credentialId })
          .from(passkeys)
          .where(eq(passkeys.userId, userRows[0].id))
      : []

  const options = await generateAuthenticationOptions({
    rpID: rpID(),
    allowCredentials: allowCredentials.map((p) => ({ id: p.credentialId })),
    userVerification: 'preferred',
    timeout: 60_000,
  })

  // Store challenge keyed by email for lookup before we know the user
  await storeChallenge(`webauthn:auth:${userEmail}`, options.challenge)
  return options
}

export async function verifyAuthChallenge(
  userEmail: string,
  response: AuthenticationResponseJSON,
) {
  const challenge = await consumeChallenge(`webauthn:auth:${userEmail}`)
  if (!challenge) throw new Error('Challenge expired or not found')

  // Look up passkey by credential ID
  const passkeyRows = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.credentialId, response.id))
    .limit(1)

  if (passkeyRows.length === 0) throw new Error('Passkey not found')
  const passkey = passkeyRows[0]

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin(),
    expectedRPID: rpID(),
    credential: {
      id: passkey.credentialId,
      publicKey: Buffer.from(passkey.publicKey, 'base64url'),
      counter: passkey.counter,
      transports: passkey.transports
        ? (JSON.parse(passkey.transports) as AuthenticatorTransportFuture[])
        : undefined,
    },
    requireUserVerification: true,
  })

  if (!verification.verified) {
    throw new Error('WebAuthn authentication verification failed')
  }

  // Update counter to prevent replay attacks
  await db
    .update(passkeys)
    .set({ counter: verification.authenticationInfo.newCounter })
    .where(eq(passkeys.id, passkey.id))

  // Return the user ID so the caller can create a session
  return { userId: passkey.userId }
}
