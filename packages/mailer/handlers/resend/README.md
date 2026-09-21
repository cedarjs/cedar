# Mailer - Handler - Resend

## Prerequisites

We assume you have the basic boilerplate for Cedar Mailer present. We also
assume that you have signed up with [Resend](https://resend.com/) and have
access to an API key.

## Setup

We should install this handler package as a production dependency of the API
side. We can do this with the following command:

```bash
yarn workspace api add @cedarjs/mailer-handler-resend
```

After this you should be able to import this handler into your
`api/src/lib/mailer.ts` file and create an instance of this handler with your
API key.

```typescript
import { ResendMailHandler } from '@cedarjs/mailer-handler-resend'

// ...

const handlers = {
  // ...
  resend: new ResendMailHandler({
    apiKey: process.env.RESEND_API_KEY,
  }),
  // ...
}

// ...

export const mailer = new Mailer({
  // ...
  handlers,
  // ...
})
```

If you need access to the underlying resend client to perform more specific
behaviour the SDK exposes you can always access this using the `internal`
function on this resend handler.

```typescript
const resendHandler = mailer.handlers.resend
const resendClient = resendHandler.internal().client
```

## Usage

You should be able to use this newly configured handler like any other previous
handler and it should require no changes to your mailer code.

## Error Handling

`mailer.send()` rejects when Resend does not accept the email, for example
because of an invalid API key, an unverified sender domain, or a rate limit. The
error message contains Resend's error name and message, and the error response
from Resend is available as the `cause` of the thrown error.

```typescript
try {
  await mailer.send(/* ... */)
} catch (error) {
  if (error instanceof Error) {
    // For example: { name: 'rate_limit_exceeded', message: '...' }
    console.error(error.cause)
  }
}
```
