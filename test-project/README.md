# README

This is a test project to use for testing changes to the framework.

Run `yarn cfw project:tarsync` in the root to copy in the latest framework
changes.

I want to find an easier way to use the framework changes that doesn't involve a
full build of the entire framework and then copying over the files.

I've tried using yarn's support for "workspace:" versions in package.jsons. But
for that to work this test project would have to be part of the root workspace.
It can't really be that though, because the test-project itself is a monorepo
with its own workspace.

I then tried using yarn's "portal:" feature that allows pointing to packages
outside of the workspace. And it works for one level deep packages. But it does
not work when the packages themselves use "workspace:" versions. Like the
`@cedarjs/core` package depends on `"@cedarjs/project-config": "workspace:"`.
yarn will say "Workspace not found".

Next on my list to try was "link:" with a package path, like
`"@cedarjs/web": "link:../../packages/web"`. That gets past the "yarn install"
step, but fails with runtime errors. "web" complains about "cross-env" not being
available, and "testing" complains about "configuration error" related to
MockRouter. I also tried linking a built tarball, but got the same error.

Finally I tried `yarn add -D ../packages/testing/cedarjs-testing.tgz` but that
installs published versions of other Cedar packages that testing depends on,
like `@cedarjs/auth`, `@cedarjs/context` etc, but I want it to use the latest
(unpublished) code in the workspace.
