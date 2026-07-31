# Milestone Status

Acceptance is binary and is performed **in-game by the owner**. Nothing moves to
"passed" on Claude Code's say-so — see SPEC.md §5.

| Milestone | State | Notes |
|---|---|---|
| M0 — Skeleton | **Built, awaiting owner acceptance** | Packs load, Build Wand opens a 3-entry `ActionFormData`, selection prints to chat. |
| M1 — Structure Emitter | Not started | Gated on M0 acceptance. |
| M2 — Rotation Correctness | Not started | Highest-risk item in the project. |
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

## Change log

- **M0** — Behavior + resource pack skeleton, `cb:build_wand` item, placeholder
  three-entry menu, zero-dependency validator and `.mcaddon` bundler
  (`tools/build.mjs`), reproducible placeholder art generator
  (`tools/gen_placeholder_art.py`).
