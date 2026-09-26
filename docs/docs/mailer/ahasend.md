# Mailer - Handler - AhaSend

## Prerequisites

We assume you have the basic boilerplate for Cedar Mailer present. We also
assume that you have signed up with [AhaSend](https://ahasend.com/), verified a
sending domain, and have an API key with permission to send messages, along with
your account ID.

## Setup

We should install this handler package as a production dependency of the API
side. We can do this with the following command:

```bash
yarn workspace api add @cedarjs/mailer-handler-ahasend
```

After this you should be able to import this handler into your
`api/src/lib/mailer.ts` file and create an instance of this handler with your
API key and account ID.

```typescript
import { AhaSendMailHandler } from '@cedarjs/mailer-handler-ahasend'

// ...

export const mailer = new Mailer({
  handling: {
    handlers: {
      // ...
      ahasend: new AhaSendMailHandler({
        apiKey: process.env.AHASEND_API_KEY,
        accountId: process.env.AHASEND_ACCOUNT_ID,
      }),
    },
    // ...
  },
  // ...
})
```

The handler accepts every option of the `AhaSendClient` from
[`@ahasend/sdk`](https://github.com/AhaSend/ahasend-ts), such as `timeoutMs` and
`retry`. By default the client retries failed requests up to three times and
reuses one idempotency key across those retries. AhaSend stores the outcome of
every request it accepts or rejects for 24 hours and replays it when a retry
uses the same key, so such a retry does not queue the email again. Server
errors are not stored, so a retry after a server error can still deliver the
email twice.

If you need access to the underlying AhaSend client to perform more specific
behavior the SDK exposes you can always access this using the `internal`
function on this AhaSend handler.

```typescript
const ahasendHandler = mailer.handlers.ahasend
const ahasendClient = ahasendHandler.internal().client
```

## Usage

You should be able to use this newly configured handler like any other previous
handler and it should require no changes to your mailer code.

Each email is sent as a single message that all `to`, `cc` and `bcc` recipients
share, with `bcc` recipients hidden from the others. AhaSend allows at most 50
recipients per email.

You can pass AhaSend specific options as the third argument to `mailer.send()`:

```typescript
await mailer.send(
  WelcomeEmail({ name: user.name }),
  { to: user.email, subject: 'Welcome!' },
  {
    tags: ['welcome'],
    idempotencyKey: `welcome-${user.id}`,
  }
)
```

The available options are `tags`, `sandbox`, `sandbox_result`, `tracking`,
`retention`, `schedule` and `idempotencyKey`. See the
[AhaSend API reference](https://ahasend.com/docs/api-reference) for what each of
them does. `sandbox: true` is useful for testing your setup, because AhaSend
accepts the email without delivering it.

### Attachments

Every attachment needs a filename, either set as `filename` or taken from
`path`. The attachment's content type is derived from the file extension. String
`content` is sent as UTF-8 text, and `Buffer` content is sent as binary data. A
`path` can be a local file or an `http(s)` URL.

## Error Handling

`mailer.send()` rejects when AhaSend does not accept the email, for example
because of an invalid API key, an unverified sender domain, or a network failure
that persists through the client's retries. The error from the AhaSend SDK is
available as the `cause` of the thrown error.

AhaSend reports a result for each recipient. `mailer.send()` also rejects when
AhaSend accepts none of the recipients, with the per-recipient results as the
`cause` of the thrown error.

When AhaSend accepts some recipients and rejects others, for example because
they are on your suppression list, `mailer.send()` resolves. The email has
already been queued for the accepted recipients, so retrying the send would
deliver it to them a second time. The result's `messageID` is the ID of the
first accepted recipient's message, and `handlerInformation` contains the result
for every recipient:

```typescript
const result = await mailer.send(/* ... */)

// handlerInformation is typed as unknown by the mailer, so narrow it first
const recipients = (result.handlerInformation as SendMessageResponse).data
const rejected = recipients.filter((recipient) => recipient.status === 'error')
```

`SendMessageResponse` is exported by `@ahasend/sdk`.
