# Security Best Practices

- Store API tokens in environment variables or an OS secret store. Do not commit tokens.
- Keep `.rekurn/config` out of public screenshots when it contains deploy hooks.
- Use HTTPS API origins and HTTPS deploy hooks in production.
- `rekurn push` rejects non-HTTPS remotes unless `REKURN_ALLOW_INSECURE_REMOTE=1` is set for localhost development.
- Configure `rekurn config signing-key <path>` to attach Ed25519 signed push certificates to ref updates.
- Deploy hooks should be revocable and scoped to a single environment when the provider supports it.
- Object upload validates content hashes before storage.
- Ref updates and deploy configuration require repository write access.
- Public unauthenticated endpoints are rate-limited by middleware.
- SDK errors are sanitized and do not expose local filesystem paths.
