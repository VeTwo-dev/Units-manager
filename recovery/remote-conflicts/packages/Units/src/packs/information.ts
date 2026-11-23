/**
 * packs/information.ts
 * -----------------------------------------------------------------------
 * Digital-information unit pack (data only, no side effects).
 *
 * Importing this module does NOT mutate any registry. Apply explicitly:
 *
 *   import { INFORMATION_PACK } from "@vetwo/units";
 *   const registry = createRegistry({ packs: [INFORMATION_PACK] });
 *
 * Representation decision (21.26/22.10 — explicit and documented):
 * - Information is a DEDICATED dimension (`Info`), not dimensionless and
 *   not Count. `8 bit = 1 byte` converts; `8 bit = 8 (fraction)` does NOT
 *   (dimension mismatch) — information is not a pure ratio.
 * - DECIMAL SI prefixes vs BINARY prefixes are never confused:
 *   `byte` is prefixable through the normal SI ladder (kB = 1000 B,
 *   MB = 10⁶ B, …), while KiB/MiB/GiB are SEPARATE explicit units
 *   (1024ⁿ, IEC 80000-13). `kB` and `KiB` differ and must never compare
 *   equal.
 * - All units carry semantic kind "information" (propagated to kB/MB/…
 *   by the prefix engine).
 *
 * Factors: 1 byte = 8 bit exact (conventional); KiB = 1024 B exact, etc.
 * -----------------------------------------------------------------------
 */
import { Dim } from "../dimension.js";
import type { AtomicUnitDef } from "../units/atomic-units.js";
import type { UnitPack } from "../unit-system.js";

const INFO = Dim.Information;

export const INFORMATION_PACK: UnitPack = Object.freeze({
  name: "information",
  version: "1.0.0",
  displayName: "Digital information units",
  description:
    "Bit/byte with explicit decimal-vs-binary prefix separation " +
    "(IEC 80000-13). Dedicated Info dimension.",
  units: Object.freeze([
    {
      symbol: "bit",
      dimension: INFO,
      toBaseFactor: 1, // base unit of information
      label: "bit",
      metadata: {
        prefixable: true,
        system: "IEC",
        standard: "IEC 80000-13",
        category: "information",
        kind: "information",
      },
    } as AtomicUnitDef,
    {
      symbol: "byte",
      dimension: INFO,
      toBaseFactor: 8, // exact: 1 byte = 8 bit
      label: "byte",
      metadata: {
        prefixable: true,
        system: "IEC",
        standard: "IEC 80000-13",
        category: "information",
        kind: "information",
      },
    } as AtomicUnitDef,
    {
      symbol: "KiB",
      dimension: INFO,
      toBaseFactor: 8 * 1024, // exact binary kibibyte in bits
      label: "kibibyte",
      metadata: {
        system: "IEC",
        standard: "IEC 80000-13",
        category: "information",
        kind: "information",
      },
    } as AtomicUnitDef,
    {
      symbol: "MiB",
      dimension: INFO,
      toBaseFactor: 8 * 1024 * 1024,
      label: "mebibyte",
      metadata: {
        system: "IEC",
        standard: "IEC 80000-13",
        category: "information",
        kind: "information",
      },
    } as AtomicUnitDef,
    {
      symbol: "GiB",
      dimension: INFO,
      toBaseFactor: 8 * 1024 * 1024 * 1024,
      label: "gibibyte",
      metadata: {
        system: "IEC",
        standard: "IEC 80000-13",
        category: "information",
        kind: "information",
      },
    } as AtomicUnitDef,
  ]),
  aliases: Object.freeze({
    octet: "byte",
    // Single-letter alias enables SI-prefixed forms via the prefix engine
    // (kB = k + B, MB, GB, …); binary KiB/MiB/GiB stay explicit units.
    B: "byte",
  } as Record<string, string>),
  metadata: Object.freeze({ standard: "IEC 80000-13", source: "1 byte = 8 bit (conventional)" }),
});
