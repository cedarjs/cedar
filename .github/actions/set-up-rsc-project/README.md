# GitHub action to create a CidarJS project with RSCs set up

This action creates a CidarJS project with Streaming SSR and RSC support set up.
It's used for RSC smoke tests.

It scaffolds the project with the `create-cedar-app` built from the current
commit (`packages/create-cedar-app/dist/create-cedar-app.js`), then runs
`experimental setup-streaming-ssr` and `experimental setup-rsc` using the
locally built CLI. Finally it runs `project:tarsync` to get the changes
introduced by the PR triggering this action into the project, and builds the
CedarJS app.

## Testing/running locally

Go into the github actions folder
`cd .github/actions`

Then run the following command to execute the action
`node set-up-rsc-project/setUpRscProjectLocally.mjs`

## Design

The main logic of the action is in the `setUpRscProject.mjs` file. To be able
to run that code both on GitHub and locally it uses dependency injection. The
injection is done by `setupRscProjectLocally.mjs` for when you want to run
the action on your own machine and by `setupRscProjectGitHub.mjs` when it's
triggered by GitHub CI.

When doing further changes to the code here it's very important to keep the
CI scripts as light on logic as possible. Ideally all logic is kept to
`setUpRscProject.mjs` so that the same logic is used both locally and on
GitHub.
