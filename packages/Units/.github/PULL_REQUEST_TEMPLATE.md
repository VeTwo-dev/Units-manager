## Summary

<!-- What does this PR change, and why? -->

## Package(s) affected

- [ ] `@vetwo/units`
- [ ] `@vetwo/nutrition-units`
- [ ] Docs / meta only

## Checklist

- [ ] `tsc --noEmit` passes with no errors across both packages
- [ ] No domain-specific code was added to `units/` (nutrition, chemistry,
      finance concepts belong in a domain package)
- [ ] No raw conversion constants were added outside `units/src/units/atomic-units.ts`
- [ ] Public API changes are reflected in the relevant `README.md`
- [ ] A `CHANGELOG.md` entry was added under `[Unreleased]` for each
      affected package
- [ ] Included a runnable check (test or verification script) for any
      calculation-logic change, including at least one case that should
      correctly throw (for dimension-safety changes)

## How was this tested?

<!-- Paste the command(s) you ran and a summary of the output. -->

## Related issues

<!-- Closes #123 -->
