---
name: Feature request
about: Suggest a new unit, nutrient, calculation rule, or capability
title: "[feature]: "
labels: enhancement
assignees: ""
---

**Package affected**

- [ ] `@vetwo/units` (generic — units, dimensions, core `Quantity` API)
- [ ] `@vetwo/nutrition-units` (domain — nutrients, basis conversion, solver integration)
- [ ] A new domain package (e.g. chemistry, finance) — describe below

**Is this domain-specific or generic?**
<!--
If your request teaches the engine about a specific field (nutrition,
chemistry, finance...), it likely belongs in a domain package, not
@vetwo/units. See CONTRIBUTING.md → "The one rule that matters most".
-->

**Describe what you want to add**
<!-- e.g. "Add a `mol` atomic unit and a `L` (liter) unit for a future chemistry package." -->

**Example usage**

```ts
// show how you'd expect to call it once implemented
```

**Why isn't this achievable with the current API?**
<!-- e.g. via CalculationRuleRegistry, registerAtomic(), or TargetUnitRegistry.override() -->

**Additional context**
