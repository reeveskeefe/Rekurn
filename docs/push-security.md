# Secure Push

`rekurn push` is designed around authenticated HTTPS API remotes.

```bash
rekurn login
rekurn remote set https://api.example.com/<owner-id>/<repo-name>
rekurn push origin main
```

Security controls:

- Bearer-token authentication is required.
- Remote URLs must use HTTPS.
- Embedded credentials in remote URLs are rejected.
- Localhost HTTP is allowed only with `REKURN_ALLOW_INSECURE_REMOTE=1`.
- Object uploads are content-addressed and hash-verified by the server.
- Ref updates use compare-and-swap so stale pushes are rejected.
- Optional signed push certificates bind the pusher, ref, old hash, new hash, timestamp, and nonce.

Enable signed push certificates:

```bash
rekurn config signing-key ~/.rekurn/keys/push-ed25519
rekurn push origin main
```

The signing key must be a 64-character Ed25519 secret key seed in hex. Keep it in an OS-protected secret store or a private file outside the repository.
