- fix(dbAuth): Reject unverified WebAuthn assertions in `webAuthnAuthenticate`

`DbAuthHandler.webAuthnAuthenticate()` issued the login cookies and returned
200 whether or not the assertion signature matched the stored public key.
`SimpleWebAuthn`'s `verifyAuthenticationResponse()` throws for most failure
modes, but a signature mismatch comes back as `{ verified: false }` with no
error — so an unverified assertion was answered with a valid session for the
credential's owner.

It now throws a `WebAuthnError` before anything is issued, matching how
`webAuthnRegister()` already handles its own `verified` check. The only
information an attacker needs to reach the affected path is a credential ID
for the victim; those are not secret in the WebAuthn model.
