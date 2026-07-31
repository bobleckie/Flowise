# Milestone Status

Acceptance is binary and is performed **in-game by the owner**. Nothing moves to
"passed" on Claude Code's say-so — see SPEC.md §5.

Milestone numbering was restructured in SPEC.md revision 2 when the owner
restated scope. Phase 1 is the engine; Phase 2 is the content library, which is
the actual product; Phase 3 is cities.

| Milestone | State | Notes |
|---|---|---|
| **Phase 1 — Engine** | | |
| M0 — Skeleton | Built, awaiting acceptance | Packs load, Build Wand opens a menu, selection prints to chat. |
| M1 — Structure Emitter | Built, awaiting acceptance | Both converters, palette tokens. Needs a real in-game capture to accept. |
| M2 — Rotation Correctness | **Built, awaiting acceptance** | Rotation table + engine + 61 offline tests + in-game probe harness. 4 encodings still need measuring. |
| M3 — Assembler | Not started | |
| M4 — Animated Construction | Not started | |
| M5 — Elevators | Not started | |
| M6 — Interior Fitout | Not started | Gates the content library — without it every room is furnished by hand. |
| M7 — Impostor Interiors | Not started | |
| **Phase 2 — Content** | | |
| M8 — Building Preset Library | Not started | 40 presets, composed + monolithic tiers. |
| M9 — Street & Infrastructure Kit | Not started | Streets, crosswalks, lighting, signals, bus stops, parking. |
| M10 — Transit | Not started | Subway, light rail, stations. |
| M11 — District Tiles | Not started | The unit that makes Realm placement possible. |
| **Phase 3 — Cities** | | |
| M12 — Vertical Solver | Not started | |
| M13 — Arnis Fork | Not started | |
| M14 — Real City Packages | Not started | NYC, Chicago, Boston, LA, Houston. |
| M15 — Fictional City Packages | Not started | Gotham, Metropolis. |

---

## M2 acceptance test — current

Two halves. The offline half is done and passing; the in-game half needs you.

### What is already proven offline

`npm test` runs 61 tests. The strongest of them do not depend on knowing
Bedrock's true encodings: rotation and mirroring form a mathematical group, so
`R⁴ = I`, `M² = I`, and `R² = Mx·Mz` must hold whatever the encodings are. An
internally inconsistent table fails these. Also checked: no orientation pushes a
state value outside its legal domain, every numeric encoding stays a permutation
(so two directions can never collapse into one), positions stay in bounds with
no collisions, block entities follow their blocks, and rotated modules still
compile to `.mcstructure`.

### What still needs measuring in-game

Four state encodings are marked below `high` confidence in
`data/block-states/rotation.json`. They are believed correct, not verified.
Guessing wrong here would corrupt the whole preset library at once, so the probe
measures them instead of trusting them.

| Property | Risk |
|---|---|
| `direction` | Doors and trapdoors may not share a value order. This is the likeliest error. |
| `ground_sign_direction` | Zero is south; the sense of increase needs confirming. |
| `rail_direction` | Curve and ascending value order. |
| `torch_facing_direction` | Value naming. |

### Procedure

1. Build the pack and generate the probe:
   ```sh
   node tools/gen-rotation-probe.mjs
   node tools/build.mjs
   ```
2. Import the `.mcaddon`, then copy `dist/probe/*.mcstructure` into your world's
   `structures` folder (or a behavior pack's `structures/` folder).
3. In a flat creative world, place `rotation_probe_r0` with a structure block.
   It is 24×4×21.
4. Stand at the probe's **lowest north-west corner**, open the Build Wand menu,
   choose **Rotation Probe**, then **r0**. Expect
   `all 50 cells match the rotation table`.
   - r0 is the control. If r0 fails, the emitter is wrong, not the rotation
     table — stop and send me the output.
5. Repeat for `r90`, `r180`, `r270`, `mirror_x`, `mirror_z`, placing each
   structure and running the matching check.
6. Send me any mismatch lines. They name the property, the expected value, and
   what the game actually produced — which is exactly what I need to correct
   the table. The full list also goes to the Content Log, which is copyable.

**Accept when:** all six orientations report zero mismatches, *and* a furnished
test room placed at all four rotations and both mirrors has zero visual defects
— stairs facing right, doors swinging right, chests keeping contents, signs
keeping text.

Mismatches are the expected outcome of the first run, not a failure. That is
what the harness is for.

---

## M1 acceptance test

Still open. Author a room by hand in-game, capture it with a structure block,
and run:

```sh
node tools/verify-roundtrip.mjs path/to/capture.mcstructure
```

Expect `NBT byte identity: PASS` and `module round-trip: PASS`. Then convert
both ways and place the rebuilt structure beside the original; accept when they
are visually identical, including chest contents, sign text, and waterlogging.
Full procedure was in the M1 change log entry; the tooling is unchanged.

---

## M0 acceptance test

1. **Pack loads clean.** Both packs appear with icons and names and activate
   without a red error banner. With Content Log enabled (Settings → Creator →
   Content Log GUI), no errors on world load.
2. **Script attaches.** Content Log shows `[City Builder] M0 skeleton loaded.`
3. **Item exists.** `/give @s cb:build_wand` succeeds. Shows the wand icon and
   the name "Build Wand".
4. **Menu opens.** Right-click while holding the wand opens a form titled
   "City Builder" with **four** buttons: Place Building, Choose Typology,
   Settings, Rotation Probe.
   - The first three are M0 placeholders. The fourth is the M2 harness and was
     added after M0 was written; it is the only entry that does real work.
5. **Selection registers.** Choosing one of the first three prints
   `[City Builder] <name> — not implemented yet (M0 placeholder).` in chat.
6. **Cancel is clean.** Escape / Close closes the form and prints nothing.

### Known-good environment assumptions

- `min_engine_version`: **1.21.20**
- `@minecraft/server`: **1.13.0**
- `@minecraft/server-ui`: **1.3.0**
- Item `format_version`: **1.21.10**

Beta APIs are **not** used, so the world does **not** need the "Beta APIs"
experimental toggle.

---

## Change log

- **M2** — Rotation table as data with explicit confidence levels
  (`data/block-states/rotation.json`); rotation engine that decodes each
  property to a semantic direction and applies one shared compass rule rather
  than forty per-family permutations; unhandled-property detection so an
  unknown directional block warns instead of silently facing wrong;
  `rotate-module.mjs`; `gen-rotation-probe.mjs` and the in-game checker wired
  into the Build Wand menu; 29 rotation tests (61 total).
- **M1** — Module intermediate format (SPEC.md §4.1) with validation;
  little-endian NBT reader/writer; `.mcstructure` reader/writer; both
  converters; `$STYLE_*` palette token resolution; `verify-roundtrip.mjs`;
  scripted reference module.
- **M0** — Behavior + resource pack skeleton, `cb:build_wand` item, menu,
  zero-dependency validator and `.mcaddon` bundler, placeholder art generator.
