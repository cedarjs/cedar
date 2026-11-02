---
description: What anonymous usage data the Cedar CLI sends, and how to turn it off
---

# Telemetry

The Cedar CLI and `create-cedar-app` send anonymous usage data to
`https://telemetry.cedarjs.com`, a server run by the Cedar project. It's used
to see how many projects use Cedar, which versions, platforms and commands are
in use, and which commands fail. It's never sent to a third party.

The data is anonymous. Nothing in it identifies you, your machine or your
project: no names, paths, hostnames, file contents or command arguments are
sent.

## How to turn it off

Set the `CEDAR_DISABLE_TELEMETRY` environment variable, for example in your
shell profile or your CI configuration:

```bash
export CEDAR_DISABLE_TELEMETRY=1
```

To turn it off for a single command, pass `--telemetry false` (or
`--no-telemetry`):

```bash
yarn cedar build --telemetry false
yarn create cedar-app my-app --no-telemetry
```

## When it's sent

Every run of a `cedar` CLI command creates one event when the command
finishes. Long running commands, like `cedar dev`, create their event after
five minutes. The event is written to `.cedar/telemetry/` in your project and
sent by a background process, so the CLI never waits on the network. Events
that can't be sent are retried the next time you run a command.

The newest eight events stay in `.cedar/telemetry/`, so you can see exactly
what was sent. Sent events have a `_` prefix in their file name.

`create-cedar-app` sends one event when it finishes creating an app.

## What's sent

Here's an example event for `yarn cedar generate page Payroll /payroll`:

```json
{
  "type": "command",
  "uid": "2f7c8c50-5f3e-4d43-9a8a-4c6f2d0f6a1e",
  "timestamp": "2026-10-26T12:00:00.000Z",
  "command": "generate page [name] [path]",
  "durationMs": 1534,
  "attributes": { "force": false, "typescript": true, "stories": true },
  "cedarVersion": "7.1.0",
  "environment": {
    "osType": "macOS",
    "osVersion": "15.2",
    "shell": "zsh",
    "nodeVersion": "24.11.0",
    "yarnVersion": "4.14.1",
    "npmVersion": "11.6.1",
    "vscodeVersion": "1.110.1",
    "cpuCount": 12,
    "memoryGb": 36,
    "ci": false,
    "cedarCi": false
  },
  "project": {
    "complexity": "22.7.3.11.23",
    "sides": ["web", "api"],
    "experiments": ["opentelemetry"]
  }
}
```

| Field          | Description                                                                                                                                                                                                                                                                                                                         |
| :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`         | `command` for a `cedar` CLI command, `create` for `create-cedar-app`                                                                                                                                                                                                                                                                |
| `uid`          | A random ID stored in `.cedar/telemetry.txt`. It's replaced with a new random ID every 24 hours, so events from the same project can be grouped within a day, but not across days. It's never derived from anything about you or your machine                                                                                       |
| `timestamp`    | When the command started                                                                                                                                                                                                                                                                                                            |
| `command`      | The command that ran, like `generate page [name] [path] --force`. Command and option names come from the command's definition, and every value you type is replaced by a placeholder named after its argument or option. For `exec`, options your script defines are left out. Missing when the CLI couldn't parse the command line |
| `durationMs`   | How long the command took, in milliseconds                                                                                                                                                                                                                                                                                          |
| `attributes`   | The flags and option values the command uses, like `force` or `typescript`. Only booleans, numbers and fixed option values are recorded: never names, paths, hosts or other values you type                                                                                                                                         |
| `error`        | Only included when the command failed. The first line of the error message. Paths, URLs, hosts, email addresses and the command line of a failed command are replaced by placeholders such as `[path]` and `[command]`. Other words in the message are kept                                                                         |
| `cedarVersion` | The version of the Cedar CLI, or of `create-cedar-app`                                                                                                                                                                                                                                                                              |
| `environment`  | Your OS type and version, the name of your shell, the versions of Node.js, Yarn, npm and VS Code, CPU count, memory in GB, `NODE_ENV`, whether the command ran in CI, and whether it ran in Gitpod                                                                                                                                  |
| `project`      | Not included for `create` events. `complexity` counts your routes, prerendered routes, services, cells and pages. `sides` lists your project's sides, and `experiments` the `[experimental]` sections in `cedar.toml`                                                                                                               |

## Troubleshooting

To see each event as it's sent, and any error from sending it, set
`CEDAR_VERBOSE_TELEMETRY`:

```bash
CEDAR_VERBOSE_TELEMETRY=1 yarn cedar info
```

To send events to your own server instead, for example while working on
Cedar's telemetry, set `CEDAR_REDIRECT_TELEMETRY` to its URL. Each event is
sent as the JSON body of a `POST` request.
