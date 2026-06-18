# Workflow

- After making code changes, verify by running: prettier, eslint, unit tests, and tsc on changed files before considering the change complete. Confidence: 0.80
- Add tests one at a time, verifying each passes before adding the next test. Confidence: 0.70
- Maintain backwards compatibility in semver minor releases; no mandatory breaking changes. Confidence: 0.75
- When uncertain whether a command/pattern works across package managers or platforms, test it empirically on the user's machine rather than deferring to existing patterns or speculating about edge cases. "Is this PM-agnostic?" is a question to answer by running the command, not by trusting prior assumptions. Confidence: 0.75
- Users never regenerate Cedar apps from templates. CedarJS guides them through manual updates and provides codemods to help them upgrade. Don't assume changes to template files will reach existing apps. Assume instead that they need migration paths. Confidence: 0.85
- Don't give up on a debugging task after a few failed attempts. The user expects continued investigation and tries the next viable angle (different config option, plugin API, build artifact inspection, runtime logging) rather than declaring the bug a known-issue and skipping tests. Persist through a "this needs a separate PR" decision unless the user explicitly agrees to punt. Confidence: 0.85
