import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink, jwt, bearer } from 'better-auth/plugins'
import { db, users, sessions, accounts, verifications } from '@rekurn/db'

// Lazy Resend instance — only initialized when RESEND_API_KEY is set so
// the server can boot without the key in development.
function getResend() {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    return null
  }
  // Dynamic require keeps the module out of the Edge Runtime bundle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Resend } = require('resend') as typeof import('resend')
  return new Resend(key)
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { users, sessions, accounts, verifications },
    usePlural: true,
  }),

  plugins: [
    magicLink({
      // 5-minute expiry for magic links
      expiresIn: 300,
      sendMagicLink: async ({ email, url }) => {
        const resend = getResend()
        if (!resend) {
          // Dev fallback — never log the URL as it acts as a credential
          console.log(`[DEV] Magic link sent to ${email} — set RESEND_API_KEY to enable real email delivery`)
          return
        }
        const from =
          process.env.RESEND_FROM_EMAIL ?? 'noreply@rekurn.com'
        await resend.emails.send({
          from,
          to: email,
          subject: 'Your Rekurn login link',
          html: `
<p>Click the link below to log in to Rekurn. It expires in 5&nbsp;minutes.</p>
<p><a href="${url}">${url}</a></p>
<p>If you didn't request this, you can safely ignore this email.</p>
          `.trim(),
        })
      },
    }),

    // Adds /api/auth/get-token endpoint (EdDSA JWT).
    jwt({
      jwt: {
        expirationTime: '15m',
      },
    }),

    // Allows Authorization: Bearer <session-token> in API requests so that
    // auth.api.getSession() works for non-browser clients (CLI, SDK).
    bearer(),
  ],

  session: {
    // Sessions last 30 days
    expiresIn: 60 * 60 * 24 * 30,
  },

  trustedOrigins: [process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'],

  // Let Better Auth know which URL it's running on for generating magic links.
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
})

export type Auth = typeof auth
