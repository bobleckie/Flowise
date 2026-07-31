# Minecraft City Builder — Project Specification

**Owner:** Bob Leckie
**Purpose:** Build a Minecraft add-on that places detailed, furnished, elevator-served city buildings — scaling from a single placed building up to generation of entire real cities from map data.

This document is the persistent project brief. Claude Code should read it at the start of every session. It defines architecture, milestone sequence, and acceptance criteria. Do not skip milestones. Do not build systems in parallel.

---

## 1. Product Definition

Two layers that ship together:

**Layer A — Runtime Add-On (behavior pack + resource pack)**
Player-facing. Building placer with menu UI, animated construction, working elevators, custom blocks and entities. This is what makes the world interactive.

**Layer B — World Generator (offline tool)**
Reads OpenStreetMap data, solves vertical envelope, excavates terrain, and writes a complete city world file. Forked from Arnis (Rust, open source, MIT) with its building renderer replaced by our module/typology engine.

Layer A is buildable standalone and delivers value on its own. Layer B depends on the building engine that Layer A establishes. **Build A first.**

---

## 2. Platform Decision

Start on **Bedrock**. Rationale: matches the owner's existing world, `.mcstructure` tooling is simpler than Java schematics, no compile loop, faster iteration to first visible result.

**Critical constraint on all work:** the module library and typology definitions are *data*, not platform code. They must be authored in a platform-neutral intermediate format (see §4.1) and compiled to `.mcstructure` at build time. Only the runtime scripting layer is Bedrock-specific.

This keeps a Java port to a rewrite of Layer A's scripting — roughly 20% of the codebase — rather than a restart. Do not embed Bedrock-specific assumptions in the module format, the typology schema, the assembler, or the vertical solver.

---

## 3. Milestones

Each milestone has a binary acceptance test performed in-game by the owner. Do not proceed to the next milestone until the current one passes. Report status against these milestones at the start of each session.

### M0 — Skeleton
Behavior pack + resource pack that loads without errors. One custom item ("Build Wand"). Right-click opens an `ActionFormData` menu with three placeholder entries. Selecting one prints a chat message.

**Accept:** Pack loads clean, menu opens, selection registers.

### M1 — Structure Emitter
A build-time tool (Node or Python, runs outside Minecraft) that reads a module definition in the intermediate format and emits a valid `.mcstructure` file. Must correctly handle directional block states and block entities.

Also build the reverse: `.mcstructure` → intermediate format, so hand-built modules can be captured in-game and brought into the pipeline.

**Accept:** Author a room by hand in-game, capture it with a structure block, round-trip it through both converters, place the result. Output is byte-identical in appearance to the original.

### M2 — Rotation Correctness
Rotation mapping table covering every directional block: stairs, slabs, trapdoors, doors, beds, signs, banners, chests, barrels, lanterns, glazed terracotta, buttons, levers, rails, glass panes, walls, fences, campfires, ladders.

Build an automated test harness: place a reference module at all four rotations plus both mirrors, and diff the resulting block states against expected values.

**Accept:** A furnished test room places correctly at 0°, 90°, 180°, 270° and both mirror axes, with zero visual defects. Chests retain contents, signs retain text, item frames retain items.

> This milestone is the single highest-risk item in the project. Rotation bugs are the reason most add-ons of this type feel broken. Do not shortcut it and do not defer it.

### M3 — Assembler
Given a footprint polygon, floor count, and a style ID, assemble a complete building from modules:
- Solve floor plans from interior module set (adjacency + circulation)
- Wrap with facade modules on the correct bays
- Place a vertical core (stairwell + elevator shaft) with consistent alignment across all floors
- Cap with a roof module
- Apply palette swap for the style

**Accept:** A 6-story building generates with walkable interiors, connected stairs, correct facade rhythm, and no floating or intersecting geometry.

### M4 — Animated Construction
Deferred placement queue with a per-tick block budget. Scaffolding rises first, floors fill in behind it, scaffolding comes down. Particles and sounds at the active work layer.

**Accept:** A 20-story building animates start to finish with no perceptible tick lag on the target hardware.

### M5 — Elevators
Custom entity cab with `minecraft:rideable`, no gravity. Call button block at each landing. Floor panel UI inside the cab, populated automatically from the assembler's floor registry. Door open/close with sounds.

**Accept:** Ride from ground to top floor and back in a 40-story building. Motion is smooth, doors work, no desync, no clipping.

### M6 — Typology Library
Research and encode building typologies as parameter sets. Each typology defines: story count range, floor height, bay spacing, facade composition rules, material palette, window pattern, roof type, and which interior module set applies.

Target set for v1: brownstone row, Chicago School commercial, Art Deco tower, mid-century curtain wall, Brutalist civic, Victorian commercial, warehouse loft, low-rise retail.

This is a text research task producing JSON. It is well-suited to Claude Code and does not require visual judgment.

**Accept:** Eight typologies generate and are visually distinguishable at a glance.

### M7 — Impostor Interiors
Floors beyond a configurable distance from the player get a 3-block-deep dressed shell behind the glass instead of a full interior. Lighting reads as occupied at night.

**Accept:** A 90-story tower generates and runs at playable framerate. Exterior appearance is indistinguishable from full interiors.

---

### Layer B milestones — do not start before M7 passes

### M8 — Vertical Solver
Pre-pass over OSM data for a selected bounding box:
1. Compute `max(street_elevation + building_height)` across all buildings in the box
2. Add subsurface budget (subway alignments + foundations + parking)
3. Compare required envelope against available world range
4. If insufficient, emit a height datapack (Java) or behavior pack (Bedrock) rounded to the next multiple of 16
5. Set street datum at `world_min + subsurface_budget`
6. Rebase terrain — preserve real relief, shift the surface so the lowest street point lands on datum. Do not flatten.
7. Excavate the full box to datum and fill

Emit a manifest before generation begins: datum chosen, ceiling required, and any buildings clipped with the amount.

**Accept:** Solver produces correct envelopes for three test boxes — a small town, a mid-size downtown, and Lower Manhattan — with no manual configuration.

### M9 — Arnis Fork
Fork Arnis. Replace its building renderer with the M3 assembler. Keep its Overpass queries, projection, terrain, road network, and world-file writer untouched.

**Accept:** Generate a four-square-block neighborhood with full facades, interiors, and elevators.

### M10 — Subway
Cut tunnels along OSM `railway=subway` alignments. Place station modules at station nodes. Connect to street level.

**Accept:** Walk from a street entrance to a platform, ride to the next station, exit to street.

---

## 4. Technical Specifications

### 4.1 Module Intermediate Format

Platform-neutral JSON. This is the contract everything else depends on — get it right before writing the assembler.

```json
{
  "id": "office_typical_7x11",
  "footprint": [7, 4, 11],
  "category": "interior",
  "connections": {
    "north": ["corridor"],
    "south": ["exterior_wall"],
    "east": ["door"],
    "west": ["door"]
  },
  "palette": {
    "wall": "$STYLE_WALL",
    "floor": "$STYLE_FLOOR",
    "trim": "$STYLE_TRIM"
  },
  "blocks": [
    { "pos": [0, 0, 0], "block": "$STYLE_FLOOR", "state": {} }
  ],
  "entities": [],
  "block_entities": []
}
```

Palette tokens (`$STYLE_*`) resolve at generation time against the active typology. This is what allows one authored module to ship as five visually distinct styles.

### 4.2 Module Footprints

Fix these early and do not vary them. Interior modules: 7×11 and 7×7. Facade bays: 5 blocks wide. Floor height: 4 blocks (3 interior + 1 structural slab).

Consistent dimensions are what make the assembler tractable. Irregular module sizes turn floor planning into a bin-packing problem and are not worth it.

### 4.3 Scripted Module Generation

Repetitive interiors — cubicle grids, desk rows, corridors, hotel floors, parking decks — should be generated by script from a layout spec rather than hand-built. Only hero spaces are authored by hand.

### 4.4 Performance Budgets

- Placement queue: max 400 blocks per tick, tunable
- Full interiors: nearest 8 floors to player, plus ground and top floor
- Impostor depth: 3 blocks
- Target: no frame below 50 FPS on RTX 5060 at 16 chunk render distance

---

## 5. Division of Labor

**Claude Code owns:** all code — emitter, converters, rotation tables, test harness, assembler, animation, elevators, palette system, typology research and JSON, vertical solver, Arnis fork, scripted module generation.

**Owner owns:** hero-space authoring (lobbies, penthouses, distinctive rooms), and all visual quality judgment. Claude Code cannot see the output. Every milestone acceptance requires the owner to look at the result in-game and give feedback.

This is the loop that determines whether the project is good rather than merely working. Budget for it.

---

## 6. Known Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Rotation / block-state bugs | High | M2 test harness before any assembler work |
| Block entity loss on placement | High | Use native structure manager where possible; explicit repopulation pass |
| Tick budget exhaustion on large builds | High | Hard per-tick cap; impostor interiors from M7 |
| Bedrock JSON schema drift between versions | Medium | Pin `format_version`; keep a known-good reference pack to pattern-match |
| Scope creep across parallel systems | High | Strict milestone gating; one system at a time |
| Architectural copyright on post-1990 buildings | Medium | Generate typologies, not named landmarks. Revisit before any distribution. |
| World size exceeds Realm limits | Low | City-scale output targets local server only |

---

## 7. Out of Scope for v1

Gun turrets, NPCs, vehicles, weather effects, destructible buildings, multiplayer sync beyond vanilla behavior. Log these as v2 candidates. Do not build them during v1 regardless of how tempting they become mid-milestone.
