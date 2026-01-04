# Package Watching in Dev Mode - Documentation Index

## 📚 Documentation Overview

This directory contains comprehensive documentation for the package watching feature in `yarn cedar dev`. All documents are prefixed with `DEV_PACKAGES_WATCH_`.

## 🗂️ Document Index

### 1. Implementation Documents

#### [DEV_PACKAGES_WATCH_PLAN.md](./DEV_PACKAGES_WATCH_PLAN.md)
**Original implementation plan with task checklist**
- Complete step-by-step implementation tasks
- Checkboxes for tracking progress
- Success criteria
- Files to create/modify
- **Status:** ✅ Steps 1-4 Complete (Implementation done)

#### [DEV_PACKAGES_WATCH_IMPLEMENTATION.md](./DEV_PACKAGES_WATCH_IMPLEMENTATION.md)
**Detailed implementation summary**
- What was implemented
- How it works
- Architecture decisions
- Usage examples
- Testing checklist
- **Status:** ✅ Complete reference document

### 2. Testing Documents

#### [DEV_PACKAGES_WATCH_TESTING_PLAN.md](./DEV_PACKAGES_WATCH_TESTING_PLAN.md) ⭐ **START HERE FOR TESTING**
**Comprehensive automated testing plan**
- 6 phases of testing (unit, integration, validation, utilities, edge cases, errors)
- Detailed task checklist with empty checkboxes
- Mock strategy and test patterns
- Test file structure
- Coverage goals (>90% lines)
- **Status:** 📋 Ready for implementation

#### [DEV_PACKAGES_WATCH_TESTING_SUMMARY.md](./DEV_PACKAGES_WATCH_TESTING_SUMMARY.md)
**High-level testing overview**
- Summary of all test phases
- Coverage plan
- Quick reference for what needs testing
- Success criteria
- **Status:** 📋 Planning complete

#### [DEV_PACKAGES_WATCH_TESTING_QUICKREF.md](./DEV_PACKAGES_WATCH_TESTING_QUICKREF.md)
**Quick reference guide for writing tests**
- Mock templates
- Test templates
- Common patterns
- Debugging tips
- Quick wins to start with
- **Status:** 🔧 Ready to use

## 🚀 Quick Start

### For Implementation (Already Complete ✅)
1. Read [DEV_PACKAGES_WATCH_IMPLEMENTATION.md](./DEV_PACKAGES_WATCH_IMPLEMENTATION.md)
2. Review implementation in these files:
   - `cedar/packages/cli/src/commands/dev/watchPackagesTask.js`
   - `cedar/packages/cli/src/commands/dev.ts`
   - `cedar/packages/cli/src/commands/devHandler.ts`

### For Testing (Next Steps 📋)
1. Start with [DEV_PACKAGES_WATCH_TESTING_QUICKREF.md](./DEV_PACKAGES_WATCH_TESTING_QUICKREF.md)
2. Follow Phase 1 in [DEV_PACKAGES_WATCH_TESTING_PLAN.md](./DEV_PACKAGES_WATCH_TESTING_PLAN.md)
3. Create: `cedar/packages/cli/src/commands/dev/__tests__/watchPackagesTask.test.js`

## 📋 Current Status

### ✅ Implementation Complete
- [x] watchPackagesTask.js created
- [x] dev.ts updated with validation
- [x] devHandler.ts integrated package watching
- [x] All diagnostics passing
- [x] No breaking changes

### 📋 Testing In Progress
- [ ] Phase 1: watchPackagesTask unit tests
- [ ] Phase 2: Dev command integration tests
- [ ] Phase 3: Validation tests
- [ ] Phase 4: Test utilities
- [ ] Phase 5: Edge cases
- [ ] Phase 6: Error scenarios

## 🎯 Feature Summary

**What it does:**
Automatically watches and rebuilds workspace packages during `yarn cedar dev` so that changes to shared code are picked up by both API and web sides in real-time.

**Key Features:**
- ✅ Automatic detection of workspace packages
- ✅ Watches packages by default when they exist
- ✅ Initial build before starting watchers
- ✅ Filters packages without watch scripts
- ✅ Concurrent watching with color-coded output
- ✅ Graceful error handling

**Usage:**
```bash
# Watch everything (includes packages automatically)
yarn cedar dev

# Watch only api and web (no packages)
yarn cedar dev api web

# Watch specific packages
yarn cedar dev @org/my-package

# Watch api with specific packages
yarn cedar dev api packages/my-package
```

## 📁 File Structure

```
cedar/
├── packages/cli/src/commands/
│   ├── dev/
│   │   ├── watchPackagesTask.js           ✅ NEW - Phase 1
│   │   └── __tests__/
│   │       ├── watchPackagesTask.test.js  📋 TODO - Phase 1
│   │       ├── devTestUtils.ts            📋 TODO - Phase 4
│   │       └── devValidation.test.ts      📋 TODO - Phase 3
│   ├── dev.ts                              ✅ UPDATED
│   ├── devHandler.ts                       ✅ UPDATED
│   └── __tests__/
│       └── dev.test.ts                     📋 UPDATE - Phase 2
│
└── DEV_PACKAGES_WATCH_*.md                 ✅ DOCUMENTATION
```

## 🧪 Testing Priority

### High Priority (Start Here)
1. **watchPackagesTask unit tests** - Core functionality
2. **Dev command integration** - Ensures it all works together
3. **Error handling tests** - Robustness

### Medium Priority
4. **Validation tests** - Command-line arguments
5. **Edge cases** - Unusual scenarios

### Lower Priority
6. **Test utilities** - DRY up test code (refactor)

## 📊 Coverage Goals

| Metric | Target | Status |
|--------|--------|--------|
| Line Coverage | > 90% | 📋 Pending |
| Branch Coverage | > 85% | 📋 Pending |
| Function Coverage | > 95% | 📋 Pending |

## 🔗 Related Files

### Implementation Files
- `cedar/packages/cli/src/commands/dev/watchPackagesTask.js` (new)
- `cedar/packages/cli/src/commands/dev.ts` (modified)
- `cedar/packages/cli/src/commands/devHandler.ts` (modified)

### Similar Existing Files (Reference)
- `cedar/packages/cli/src/commands/build/buildPackagesTask.js`
- `cedar/packages/cli/src/commands/build/__tests__/buildPackagesTask.test.js`
- `cedar/packages/cli/src/commands/__tests__/dev.test.ts`

## 💡 Tips

### For Understanding the Implementation
- Read implementation docs in order (Plan → Implementation)
- Compare with `buildPackagesTask.js` to see patterns
- Check existing `dev.test.ts` for test patterns

### For Writing Tests
- Start with the Quick Reference guide
- Copy existing test patterns
- Use the provided mock templates
- Run tests frequently (`yarn test --watch`)

### For Debugging
- Check diagnostics: `yarn test --coverage`
- Look at similar tests in the codebase
- Use console.log for mock inspection
- Run single test: `yarn test -t "test name"`

## 🎓 Learning Resources

### Understanding the Feature
1. Read: [DEV_PACKAGES_WATCH_IMPLEMENTATION.md](./DEV_PACKAGES_WATCH_IMPLEMENTATION.md)
2. Explore: Implementation files listed above
3. Compare: With build command implementation

### Writing Tests
1. Quick Start: [DEV_PACKAGES_WATCH_TESTING_QUICKREF.md](./DEV_PACKAGES_WATCH_TESTING_QUICKREF.md)
2. Full Plan: [DEV_PACKAGES_WATCH_TESTING_PLAN.md](./DEV_PACKAGES_WATCH_TESTING_PLAN.md)
3. Examples: Existing test files in `__tests__/` directories

## 🤝 Contributing

When adding tests:
1. Follow the phases in the testing plan
2. Check off tasks as you complete them
3. Ensure tests pass before moving to next phase
4. Keep coverage above target metrics
5. Follow existing code style and patterns

## 📝 Notes

- **No feature flag required** - Feature is always available
- **No breaking changes** - Backward compatible
- **Default behavior** - Packages watched automatically when present
- **Documentation updates** - Held for later (not in this iteration)

## ✨ Next Actions

**If you're implementing tests:**
1. Open [DEV_PACKAGES_WATCH_TESTING_QUICKREF.md](./DEV_PACKAGES_WATCH_TESTING_QUICKREF.md)
2. Create `watchPackagesTask.test.js`
3. Start with the "Quick Wins" section
4. Follow Phase 1 checklist

**If you're reviewing the implementation:**
1. Read [DEV_PACKAGES_WATCH_IMPLEMENTATION.md](./DEV_PACKAGES_WATCH_IMPLEMENTATION.md)
2. Check the implementation files
3. Try it out: `yarn cedar dev` in a project with packages

---

**Questions?** Refer to the specific documents above or check existing test files for patterns.

**Ready to test?** Start with Phase 1 in the testing plan! 🚀