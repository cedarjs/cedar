# E2E Tenancy

This script runs `yarn cedar setup tenancy` on a test project, follows the
next steps it prints, and checks that the app still builds, type-checks, lints
and passes its tests. It also adds an organizations page (`/orgs`) and an
organization's page under `OrgScope` (`/org/{orgSlug}`) for the Playwright
suite in `tasks/smoke-tests/tenancy`, and checks that running setup again
changes nothing.

## Usage

Create a test project:

```bash
yarn build:test-project ../cedar-test-project
```

Then run the script, followed by the Playwright suite:

```bash
yarn e2e:tenancy ../cedar-test-project

cd tasks/smoke-tests/tenancy
CEDAR_TEST_PROJECT_PATH=../../../../cedar-test-project npx playwright test
```

The script changes the project, so run it on a fresh one, or set up git in the
project and reset it between runs.
