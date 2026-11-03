# Telemetry

Anonymous usage telemetry for the Cedar CLI and `create-cedar-app`.

See the [Telemetry docs](https://cedarjs.com/docs/telemetry) for what's sent,
when, and how to turn it off.

## Recording

CLI commands and plugins record attributes and errors for the current CLI
run:

```ts
import {
  recordTelemetryAttributes,
  recordTelemetryError,
} from '@cedarjs/cli-helpers/telemetry'

recordTelemetryAttributes({ command: 'generate page', force: true })
recordTelemetryError(error)
```

Records are published on the `cedar:telemetry` diagnostics channel. They do
nothing unless the CLI is collecting telemetry, which it does unless it's
been disabled. Only record values that can't identify a user or their
project: command names, flags and fixed option values, never names, paths or
hosts.

## Sending

When the CLI run finishes, `shutdownTelemetry()` (from
`@cedarjs/telemetry/cli`) writes one event to `.cedar/telemetry/` and starts
a background process that sends it as JSON to `https://telemetry.cedarjs.com`.

## Troubleshooting

`CEDAR_VERBOSE_TELEMETRY=1` prints each event as it's sent, and any error from
sending it. `CEDAR_REDIRECT_TELEMETRY=<url>` sends events to another server.
