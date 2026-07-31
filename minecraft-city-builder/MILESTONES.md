# Milestone Status

Acceptance is binary and is performed **in-game by the owner**. Nothing moves to
"passed" on Claude Code's say-so — see SPEC.md §5.

| Milestone | State | Notes |
|---|---|---|
| M0 — Skeleton | **Built, awaiting owner acceptance** | Packs load, Build Wand opens a 3-entry `ActionFormData`, selection prints to chat. |
| M1 — Structure Emitter | **Built, awaiting owner acceptance** | Both converters, palette tokens, 32 offline tests. Needs a real in-game capture to accept. |
| M2 — Rotation Correctness | Next | Highest-risk item in the project. |
| M3 — Assembler | Not started | |
| M4 — Animated Construction | Not started | |
| M5 — Elevators | Not started | |
| M6 — Typology Library | Not started | |
| M7 — Impostor Interiors | Not started | |
| M8 — Vertical Solver | Not started | Layer B. Do not start before M7 passes. |
| M9 — Arnis Fork | Not started | Layer B. |
| M10 — Subway | Not started | Layer B. |

---

## M0 acceptance test

Run through this in-game and report pass/fail on each line.

1. **Pack loads clean.** Both packs appear in the world's Behavior/Resource pack
   lists with icons and names, and activate without a red error banner. With
   Content Log enabled (Settings → Creator → Content Log GUI), there are no
   errors on world load.
2. **Script attaches.** The Content Log shows `[City Builder] M0 skeleton loaded.`
3. **Item exists.** `/give @s cb:build_wand` succeeds, or the Build Wand is
   findable in the Creative inventory under Equipment. It shows the wand icon
   and the name "Build Wand".
4. **Menu opens.** Right-click (or long-press on controller/touch) while holding
   the wand opens a form titled "City Builder" with body text "Select an action."
   and exactly three buttons: Place Building, Choose Typology, Settings.
5. **Selection registers.** Choosing any button closes the form and prints
   `[City Builder] <name> — not implemented yet (M0 placeholder).` in chat.
6. **Cancel is clean.** Pressing Escape / Close closes the form and prints
   nothing.

### Known-good environment assumptions

The manifest pins these; if the game reports an unsupported module version, see
the "Version pinning" section of README.md before changing anything else.

- `min_engine_version`: **1.21.20**
- `@minecraft/server`: **1.13.0**
- `@minecraft/server-ui`: **1.3.0**
- Item `format_version`: **1.21.10**

Beta APIs are **not** used, so the world does **not** need the "Beta APIs"
experimental toggle.

---

---

## M1 acceptance test

The spec's acceptance is a real in-game round trip, which needs you: author a
room by hand, capture it, run it through both converters, place the result, and
confirm it is visually identical.

Offline, the pipeline is already proven against a generated reference module —
`npm test` runs 32 tests covering directional states, block entity payloads,
waterlogging, structure void, palette tokens, and byte-level determinism. What
those tests cannot prove is that the file is valid *to Minecraft*, which is the
whole point of this test.

1. **Author a room.** Build something small (7×7 or 7×11, 4 high) with at least
   one of each: stairs, a door, a chest with items in it, a sign with text, a
   ladder, a trapdoor, and a waterlogged slab or fence.
2. **Capture it** with a structure block in Save mode. Export gives you a
   `.mcstructure` in
   `...\LocalState\games\com.mojang\minecraftWorlds\<world>\structures\`
   (or `behavior_packs\<pack>\structures\` for an exported pack).
3. **Verify the round trip:**
   ```sh
   node tools/verify-roundtrip.mjs path/to/capture.mcstructure
   ```
   Expect `NBT byte identity: PASS` and `module round-trip: PASS`. If either
   fails, the output names the exact block position and what changed — send it
   over and stop; do not continue to step 4.
4. **Convert both ways:**
   ```sh
   node tools/mcstructure-to-module.mjs capture.mcstructure --id my_room
   node tools/module-to-mcstructure.mjs my_room.module.json -o my_room_rebuilt.mcstructure
   ```
5. **Place the rebuilt structure** in-game with a structure block in Load mode,
   next to the original.

**Accept when:** the rebuilt room is visually identical to the original —
stairs face the same way, the door swings the same way, the chest still has its
items, the sign still has its text, and the waterlogged block is still
waterlogged.

### What I could not verify

The block-state `version` stamp is written as `1.21.20` (`18158592`) for blocks
authored from scratch; captured blocks keep whatever version they came with. If
your game writes a different version, captures still round-trip exactly — only
freshly authored modules use the default, and `DEFAULT_BLOCK_VERSION` in
`tools/lib/mcstructure.mjs` is the one place to change it.

The reference module's block names target 1.21.x. If any turn up as "unknown
block" in-game, tell me which and I will correct the fixture.

---

## Change log

- **M1** — Module intermediate format (SPEC.md §4.1) with validation;
  little-endian NBT reader/writer; `.mcstructure` reader/writer; both
  converters; `$STYLE_*` palette token resolution with two placeholder styles;
  `verify-roundtrip.mjs` acceptance tool; scripted reference module
  (`tools/gen-test-room.mjs`, per §4.3); 32-test suite.
- **M0** — Behavior + resource pack skeleton, `cb:build_wand` item, placeholder
  three-entry menu, zero-dependency validator and `.mcaddon` bundler
  (`tools/build.mjs`), reproducible placeholder art generator
  (`tools/gen_placeholder_art.py`).
