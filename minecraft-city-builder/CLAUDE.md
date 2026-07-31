# Working on Minecraft City Builder

**Read [SPEC.md](SPEC.md) in full at the start of every session.** It is the
persistent project brief and takes precedence over anything inferred from the
code. Check [MILESTONES.md](MILESTONES.md) for current state and report status
against the milestone list before starting work.

Non-negotiables from the spec:

- **Strict milestone gating.** Do not start milestone N+1 until the owner has
  accepted N in-game. Do not build systems in parallel.
- **Acceptance is the owner's call, not Claude Code's.** Claude Code cannot see
  the output. Mark milestones "built, awaiting acceptance" — never "passed".
- **Module and typology data is platform-neutral JSON** (SPEC.md §4.1), compiled
  to `.mcstructure` at build time. Only `packs/city_builder_bp/scripts/` may
  contain Bedrock-specific assumptions.
- **Fixed dimensions** (SPEC.md §4.2): interiors 7×11 and 7×7, facade bays 5
  wide, floor height 4. Do not vary them.
- **Pin `format_version` and script module versions.** Bedrock schema drift is a
  tracked risk; see the version table in README.md.
- **Respect §7 (out of scope for v1).** Log tempting extras as v2 candidates.

Run `node tools/build.mjs --check` before committing. It catches the manifest
and texture-reference mistakes that make a pack fail to load silently.

This project lives in a directory of an otherwise unrelated repository; it has
no dependency on and shares no tooling with the surrounding codebase.
