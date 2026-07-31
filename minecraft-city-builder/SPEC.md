# Minecraft City Builder — Project Specification

**Owner:** Bob Leckie
**Purpose:** Ship a library of placeable, fully-detailed building presets modelled on real buildings — every type from gas stations to skyscrapers, with working interiors, stairs, elevators, doors, furniture and fixtures — and then prepackaged cities, real and fictional, complete with streets and transit.

This document is the persistent project brief. Claude Code should read it at the start of every session. It defines architecture, milestone sequence, and acceptance criteria. Do not skip milestones. Do not build systems in parallel.

**Revision 2** — scope restated by the owner. The building library is the product, not a stepping stone to it. Real buildings, not generic typologies. Realm-placeable, not local-server-only. Streets and transit are in scope, not a stretch goal.

---

## 1. Product Definition

The deliverable is a **preset library**: named, placeable buildings and city districts that drop into a Bedrock world — including a Realm — and are immediately walkable, furnished, and functional.

Three layers:

**Layer A — Runtime Add-On (behavior pack + resource pack)**
Player-facing. Preset browser and placer with menu UI, animated construction, working elevators, custom blocks and entities. This is what makes placement interactive and the world alive.

**Layer B — Content Library (data)**
The actual product. Building presets, interior fitout rules, street and transit kits, district layouts, city packages. Platform-neutral JSON compiled to `.mcstructure` at build time.

**Layer C — World Generator (offline tool)**
Reads OpenStreetMap data, solves vertical envelope, excavates terrain, and writes city districts. Forked from Arnis (Rust, open source, MIT) with its building renderer replaced by our assembler.

Layer A is buildable standalone. Layer B is where the value is and grows continuously once the engine exists. Layer C automates at city scale what Layer B does by hand. **Build A first, then B, then C** — but note that Layer B content authoring never stops; it runs in parallel with C once the engine is stable.

### 1.1 Delivery target

Presets must be placeable **in a Bedrock Realm**, which is the primary deployment target, not a local server.

This has a hard consequence: **a full real city will not fit in a Realm.** Cities therefore ship as **district tiles** — self-contained, individually placeable chunks of city (a few square blocks each) with matching edges. A Realm gets the districts the owner chooses. A local server can place every tile of a city and get the whole thing. One content format, two deployment scales. Do not design a city package that only works as a monolith.

---

## 2. Platform Decision

Start on **Bedrock**. Rationale: matches the owner's existing world and Realm, `.mcstructure` tooling is simpler than Java schematics, no compile loop, faster iteration to first visible result.

**Critical constraint on all work:** the preset library and fitout definitions are *data*, not platform code. They are authored in a platform-neutral intermediate format (see §4.1) and compiled to `.mcstructure` at build time. Only the runtime scripting layer is Bedrock-specific.

This keeps a Java port to a rewrite of Layer A's scripting — roughly 20% of the codebase — rather than a restart. Do not embed Bedrock-specific assumptions in the module format, the preset schema, the assembler, the rotation engine, or the vertical solver.

---

## 3. Milestones

Each milestone has a binary acceptance test performed in-game by the owner. Do not proceed to the next milestone until the current one passes. Report status against these milestones at the start of each session.

Claude Code cannot see the output and therefore cannot accept a milestone. Mark work "built, awaiting acceptance" — never "passed".

### Phase 1 — Engine

The engine is the minimum machinery needed before any preset is worth authoring. It is not the product; it is the thing without which the product cannot exist.

#### M0 — Skeleton ✅ built
Behavior pack + resource pack that loads without errors. One custom item ("Build Wand"). Right-click opens an `ActionFormData` menu. Selecting an entry prints a chat message.

**Accept:** Pack loads clean, menu opens, selection registers.

#### M1 — Structure Emitter ✅ built
Build-time tools that read a module definition in the intermediate format and emit a valid `.mcstructure`, and the reverse, so hand-built rooms can be captured in-game and brought into the pipeline. Must correctly handle directional block states and block entities.

**Accept:** Author a room by hand in-game, capture it with a structure block, round-trip it through both converters, place the result. Output is visually identical to the original.

#### M2 — Rotation Correctness ← current
Rotation mapping table covering every directional block: stairs, slabs, trapdoors, doors, beds, signs, banners, chests, barrels, lanterns, glazed terracotta, buttons, levers, rails, glass panes, walls, fences, campfires, ladders.

Automated test harness: place a reference module at all four rotations plus both mirrors, and diff the resulting block states against expected values.

**Accept:** A furnished test room places correctly at 0°, 90°, 180°, 270° and both mirror axes, with zero visual defects. Chests retain contents, signs retain text, item frames retain items.

> This milestone is the single highest-risk item in the project. Every preset and every city tile is placed at some rotation; a rotation bug corrupts the entire library at once. Do not shortcut it and do not defer it.

#### M3 — Assembler
Given a footprint polygon, floor count, and a style ID, assemble a complete building from modules: solve floor plans from the interior module set, wrap with facade modules on the correct bays, place a vertical core (stairwell + elevator shaft) aligned across all floors, cap with a roof module, apply the palette swap.

**Accept:** A 6-story building generates with walkable interiors, connected stairs, correct facade rhythm, and no floating or intersecting geometry.

#### M4 — Animated Construction
Deferred placement queue with a per-tick block budget. Scaffolding rises first, floors fill in behind it, scaffolding comes down. Particles and sounds at the active work layer.

**Accept:** A 20-story building animates start to finish with no perceptible tick lag on the target hardware.

#### M5 — Elevators
Custom entity cab with `minecraft:rideable`, no gravity. Call button block at each landing. Floor panel UI inside the cab, populated automatically from the assembler's floor registry. Door open/close with sounds.

**Accept:** Ride from ground to top floor and back in a 40-story building. Motion is smooth, doors work, no desync, no clipping.

#### M6 — Interior Fitout
Rule-driven furniture and fixture placement, keyed by room type. A room declares what it is — office, hotel room, restaurant kitchen, dining room, retail floor, apartment bedroom, lobby, restroom, mechanical — and the fitout engine dresses it: furniture, lighting, signage, appliances, floor and wall treatment.

Without this, every preset must be furnished by hand, and the library cannot scale past a handful of buildings.

**Accept:** The same empty shell, fitted as five different room types, reads unambiguously as each one.

#### M7 — Impostor Interiors
Floors beyond a configurable distance from the player get a 3-block-deep dressed shell behind the glass instead of a full interior. Lighting reads as occupied at night.

**Accept:** A 90-story tower generates and runs at playable framerate. Exterior appearance is indistinguishable from full interiors.

### Phase 2 — Content

This is the product. It begins only once the engine can place a rotated, furnished, elevator-served building correctly.

#### M8 — Building Preset Library
Named presets modelled on real buildings, spanning the full size and type range. Each carries provenance metadata (§6.1).

Two construction tiers, per §4.2:

- **Composed** — anything with repeating floors: skyscrapers, office towers, apartment buildings, condominiums, hotels, mid-rise mixed use. Generated by the M3 assembler from modules.
- **Monolithic** — anything without repeating floors: gas stations, restaurants, fast food, drive-throughs, strip retail, big-box stores, luxury homes, suburban houses, churches, schools, fire stations, small civic. Authored or scripted as complete structures.

Both tiers use the same module intermediate format and the same rotation engine. A monolithic preset is a module with `category: "building"`.

**v1 target:** 40 presets, no fewer than 6 per size class, covering every type named above.

**Accept:** Every preset places cleanly at all four rotations, is walkable end to end, and is recognizable as the building type it claims to be.

#### M9 — Street & Infrastructure Kit
Streets, sidewalks, curbs, crosswalks, lane markings, street lights, traffic signals, signage, bus stops and routes, parking lots and structures, plazas, street trees, hydrants, mailboxes, utility fixtures.

Includes an intersection solver: given two crossing streets of given widths, emit the correct corner radii, crosswalks, and signal placement.

**Accept:** A four-block grid of streets generates with correct intersections, working lighting at night, and continuous sidewalks.

#### M10 — Transit
Subway tunnels, platforms, station halls, entrances, track. Light rail and streetcar at grade. Elevated rail. Bus route furniture tied to the M9 stops.

**Accept:** Walk from a street entrance to a platform, ride to the next station, exit to street.

#### M11 — District Tiles
Compose presets, streets, and transit into self-contained, individually placeable district tiles with matching edges. Tile size fixed early and not varied.

**Accept:** Three adjacent tiles place in a Realm, join seamlessly, and the result is walkable across the seams.

### Phase 3 — Cities

#### M12 — Vertical Solver
Pre-pass over OSM data for a selected bounding box:
1. Compute `max(street_elevation + building_height)` across all buildings in the box
2. Add subsurface budget (subway alignments + foundations + parking)
3. Compare required envelope against available world range
4. If insufficient, **compress floor counts or floor heights** — see §4.5. There is no other lever.
5. Set street datum at `world_min + subsurface_budget`
6. Rebase terrain — preserve real relief, shift the surface so the lowest street point lands on datum. Do not flatten.
7. Excavate the full box to datum and fill

Emit a manifest before generation begins: datum chosen, ceiling required, and any buildings clipped with the amount.

**Accept:** Solver produces correct envelopes for three test boxes — a small town, a mid-size downtown, and Lower Manhattan — with no manual configuration.

#### M13 — Arnis Fork
Fork Arnis. Replace its building renderer with the M3 assembler and the M8 preset library. Keep its Overpass queries, projection, terrain, road network, and world-file writer.

**Accept:** Generate a four-square-block neighborhood with full facades, interiors, elevators, streets, and lighting.

#### M14 — Real City Packages
New York, Chicago, Boston, Los Angeles, Houston. Each shipped as district tiles per §1.1, with landmark presets hand-placed and the surrounding fabric generated.

**Accept:** For each city, a recognizable downtown core places into a Realm as a set of tiles and is walkable.

#### M15 — Fictional City Packages
Gotham, Metropolis, and others. Authored layouts rather than OSM — these cities have no map data, only established visual identity.

**Accept:** Each fictional city reads as itself at a glance and is walkable.

---

## 4. Technical Specifications

### 4.1 Module Intermediate Format

Platform-neutral JSON. This is the contract everything else depends on.

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

Palette tokens (`$STYLE_*`) resolve at generation time against the active style. This is what allows one authored module to ship as several visually distinct buildings.

Categories: `interior`, `facade`, `roof`, `core`, `fixture`, `building` (a complete monolithic preset), `street`, `transit`, `district`.

### 4.2 Footprints — two tiers

**Tier 1, composed.** For buildings with repeating floors. Fixed and not varied: interior modules 7×11 and 7×7, facade bays 5 blocks wide. Consistent dimensions are what make the assembler tractable; irregular module sizes turn floor planning into a bin-packing problem and are not worth it.

**Floor height is 4 blocks (3 interior + 1 structural slab) — except above 60 storeys, where it must be 3.** This is arithmetic, not preference. See §4.5: at 4 blocks the Bedrock ceiling is 86 storeys, and Chicago has four towers above that. A 3-block floor gives 2 blocks of interior, which is walkable but cramped, so it is used only where the envelope forces it. Modules therefore ship in 4-block and 3-block variants.

**Tier 2, monolithic.** For buildings without repeating floors — a gas station canopy, a diner, a ranch house. These have no meaningful module grid and forcing them onto one produces worse buildings for no benefit. Authored at their natural size, bounded at 64×48×64 so they stay placeable and reviewable.

The decision rule is repetition, not size: if floors repeat, compose; if not, author whole.

### 4.3 Scripted Generation

Repetitive content — cubicle grids, desk rows, corridors, hotel floors, parking decks, street segments, track — is generated by script from a layout spec rather than hand-built. Only hero spaces and signature exteriors are authored by hand.

### 4.4 Performance Budgets

- Placement queue: max 400 blocks per tick, tunable
- Full interiors: nearest 8 floors to player, plus ground and top floor
- Impostor depth: 3 blocks
- Target: no frame below 50 FPS on RTX 5060 at 16 chunk render distance
- District tile: sized so a Realm can hold a useful number of them (fixed at M11)

### 4.5 The Vertical Envelope — a hard constraint

Bedrock's build range is **fixed at Y −64..319, 384 blocks**, and **an add-on
cannot extend it.** There is no Bedrock equivalent of Java's custom dimension
height; no behavior pack, manifest field, or experimental toggle changes it.
(An earlier revision of this document claimed otherwise. That was wrong.)

The only lever is where the street sits. Digging the datum down buys headroom
above it, and nothing else does.

With a 28-block subsurface budget (foundation, two basements, subway mezzanine
and tunnel), the datum lands at Y −36 and leaves **355 blocks above street**:

| Floor height | Max storeys | With a 40-block antenna |
|---|---|---|
| 3 blocks | 115 | 102 |
| 4 blocks | 86 | 76 |
| 5 blocks | 69 | 61 |

**Consequence:** at the 4-block floor height, Willis Tower (108), Hancock (100),
St Regis (101) and Trump Chicago (98) are all impossible. Chicago does not fit
until supertalls drop to 3-block floors, and even then Willis needs its rendered
floor count compressed from 108 to 100.

Compression is legitimate but must be **declared**, never silent: the catalog's
`massing.floors_actual` records the real building whenever fewer floors are
rendered.

`tools/lib/envelope.mjs` solves this, `node tools/catalog-report.mjs --envelope`
reports it, and `npm test` fails if any catalog entry stops fitting. Re-solve
whenever the catalog changes — the current margin across all 68 buildings is
**2 blocks**.

### 4.6 The projection margin

Every generated module is one block larger than its structure on each of the
four sides, and reports that as `margin`. Real buildings project past their
structure — eaves overhang, cornices corbel out, bay windows bulge, stoops reach
the pavement — and without somewhere to put those blocks they are generated and
then silently discarded, which is what was happening to every eaves course.

City assembly must overlap neighbouring modules by `margin` where buildings
share a party wall, or the street will read one block too wide.

---

## 5. Division of Labor

**Claude Code owns:** all code and all data generation — emitter, converters, rotation tables, test harnesses, assembler, fitout engine, animation, elevators, palette system, preset research and JSON, street and transit kits, vertical solver, Arnis fork, city packages.

**Owner owns:** hero-space authoring (lobbies, penthouses, distinctive rooms), signature exteriors where it matters, and all visual quality judgment. Claude Code cannot see the output. Every milestone acceptance requires the owner to look at the result in-game and give feedback.

This is the loop that determines whether the project is good rather than merely working. Budget for it.

---

## 6. Known Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Rotation / block-state bugs | High | M2 test harness before any preset authoring. A rotation bug corrupts the whole library at once. |
| Realm size limits vs. city scale | High | District tiles (§1.1). Never design a city package as a monolith. |
| Architectural copyright / trademark | High | Provenance metadata on every preset (§6.1). Decide distribution per preset, not per library. |
| Block entity loss on placement | High | Explicit repopulation pass; covered by M1 round-trip tests. |
| Tick budget exhaustion on large builds | High | Hard per-tick cap; impostor interiors from M7. |
| Content authoring becomes the bottleneck | High | M6 fitout engine before M8. Never furnish a room by hand that a rule could dress. |
| Bedrock JSON schema drift between versions | Medium | Pin `format_version`; keep a known-good reference pack to pattern-match. |
| Scope creep across parallel systems | High | Strict milestone gating; one system at a time. |

### 6.1 Provenance metadata

Every preset modelled on a real building carries:

```json
"provenance": {
  "inspiration": "Chicago School commercial block, State Street",
  "city": "Chicago",
  "era": "1895-1910",
  "completed_before_1990": true,
  "named_landmark": false,
  "distribution": "unrestricted"
}
```

`distribution` is one of `unrestricted` (generic or pre-1990 vernacular), `review` (recognizable but not landmark), or `personal_only` (named post-1990 landmark, or trademarked silhouette or name). Nothing is blocked from being built — this exists so a distribution decision can be made per preset later instead of unpicking the library retroactively.

Fictional city names (Gotham, Metropolis) are third-party trademarks. Their packages are `personal_only` regardless of content.

---

## 7. Out of Scope for v1

NPCs with behavior, vehicles that drive, weather effects, destructible buildings, multiplayer sync beyond vanilla behavior, building interiors for parked vehicles. Log these as v2 candidates. Do not build them during v1 regardless of how tempting they become mid-milestone.

Static parked vehicles, static rolling stock, and static aircraft are **in** scope as fixtures — they are set dressing, not systems.
