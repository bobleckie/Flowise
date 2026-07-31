# Minecraft City Builder

A Minecraft Bedrock add-on that places detailed, furnished, elevator-served city
buildings — scaling from a single placed building to generation of entire real
cities from OpenStreetMap data.

**Read [SPEC.md](SPEC.md) first.** It is the persistent project brief: architecture,
milestone sequence, and acceptance criteria. [MILESTONES.md](MILESTONES.md) tracks
where the project actually is.

**Current state: usable.** Import the add-on, hold the Build Wand, pick a building, place it. 68 presets with walkable interiors, stairs, doors and lighting. Rotation and undo included.

The deliverable is a preset library: named, placeable buildings and city
districts that drop into a Bedrock Realm and are immediately walkable and
furnished. Phase 1 (M0–M7) builds the engine; Phase 2 (M8–M11) is the content
library and is the actual product; Phase 3 (M12–M15) is whole cities.

---

## Layout

```
minecraft-city-builder/
├── SPEC.md                       persistent project brief
├── MILESTONES.md                 status + the current acceptance tests
├── packs/
│   ├── city_builder_bp/          behavior pack (data + scripts)
│   │   ├── manifest.json
│   │   ├── items/build_wand.json
│   │   ├── scripts/main.js       runtime entry point
│   │   └── texts/
│   └── city_builder_rp/          resource pack (textures + text)
├── data/styles/                  $STYLE_* token bindings (placeholders until M6)
├── fixtures/                     generated reference modules
├── tools/
│   ├── build.mjs                 validate packs + bundle dist/city_builder.mcaddon
│   ├── module-to-mcstructure.mjs module JSON  ->  .mcstructure
│   ├── mcstructure-to-module.mjs .mcstructure ->  module JSON
│   ├── verify-roundtrip.mjs      M1 acceptance check on a captured structure
│   ├── gen-test-room.mjs         regenerate the reference module
│   ├── gen_placeholder_art.py    regenerate the placeholder PNGs
│   ├── lib/                      nbt, nbt-json, mcstructure, module-format, palette
│   └── test/                     node --test suite
└── dist/                         build output (gitignored)
```

Only `packs/city_builder_bp/scripts/` is Bedrock-specific. Per SPEC.md §2, the
module library and typology definitions are platform-neutral JSON compiled to
`.mcstructure` at build time — do not push Bedrock assumptions into that data.

## Build

Requires Node 18+. No dependencies, no install step.

```sh
npm test                        # 32 tests over the M1 pipeline
node tools/build.mjs            # validate, then write dist/city_builder.mcaddon
node tools/build.mjs --check    # validate only (CI-friendly, non-zero on failure)
```

The validator checks that every JSON file parses, that pack UUIDs are unique,
that the behavior pack's dependency on the resource pack matches the resource
pack's actual UUID and version, that the script entry point exists, and that
every texture named in `item_texture.json` has a matching PNG. Run it before
every install — a version mismatch between the two manifests is the most common
cause of a pack that silently refuses to load.

Regenerating the placeholder art (only needed if you edit the generator):

```sh
python3 tools/gen_placeholder_art.py
```

The art is a stand-in. Replace the PNGs directly when real art exists; nothing
in the build reads the generator.

## The module pipeline (M1)

A module is platform-neutral JSON (SPEC.md §4.1). Block names may be concrete
(`minecraft:oak_stairs`) or `$STYLE_*` tokens that a style file binds, which is
how one authored module ships as several visually distinct styles.

```sh
# module -> .mcstructure, with tokens resolved against a style
node tools/module-to-mcstructure.mjs fixtures/test_room.module.json \
     --style data/styles/brownstone.json -o out/test_room.mcstructure

# the reverse: a structure-block capture becomes an editable module
node tools/mcstructure-to-module.mjs captures/lobby.mcstructure \
     --id lobby_hero --category interior

# what tokens does this module need?
node tools/module-to-mcstructure.mjs fixtures/test_room.module.json --list-tokens

# what's actually in this structure?
node tools/mcstructure-to-module.mjs captures/lobby.mcstructure --summary
```

Details worth knowing:

- **Structure void vs. air.** A position absent from `blocks` is written as
  index `-1` and left untouched on placement. An explicit `minecraft:air`
  clears. The reference module exercises both.
- **Waterlogging** is layer 1 of the structure. Set `"waterlogged": true` on a
  block; the rare non-water case uses `"extra": { "block": ... }`.
- **Block entities** (chest contents, sign text) carry arbitrary NBT, so they
  use an explicitly typed JSON encoding — `{ "type": "int", "value": 5 }` —
  rather than bare JSON, which has no way to tell a byte from an int.
- **Block states** need no such wrapper: Bedrock only uses byte/int/string, so
  `true`, `3`, and `"short"` map unambiguously.
- **`--enforce-dimensions`** checks a module against the §4.2 fixed footprints.
  Off by default so test modules are not blocked.

### Verifying a capture

`verify-roundtrip.mjs` is the M1 acceptance tool. Point it at a `.mcstructure`
captured in-game:

```sh
node tools/verify-roundtrip.mjs captures/my_room.mcstructure
```

It reports two independent results. **NBT byte identity** means bytes → tree →
bytes came back identical; a failure there is a reader/writer bug. **Module
round-trip** means every block, state, block entity and entity survived the
trip through the intermediate format. Tag *ordering* may legitimately differ
from the game's own output, so byte equality at that layer is reported as a
note rather than a failure.

## Rotation (M2)

Every preset and every city tile gets placed at some rotation, so a rotation bug
corrupts the whole library at once. This is the highest-risk part of the project.

```sh
node tools/rotate-module.mjs room.module.json --turns 1
node tools/rotate-module.mjs room.module.json --all --out-dir out/orientations
```

A turn is 90° clockwise viewed from above. Mirroring is applied **before** the
turn. Axes follow Minecraft: north = −Z, south = +Z, east = +X, west = −X.

`data/block-states/rotation.json` is the table, and it is data rather than code
for a reason: it can be corrected from in-game measurements without touching the
engine. Instead of one permutation table per block family, each property
declares how its values *encode* a direction; the engine decodes to a semantic
name, applies one shared compass rule, and re-encodes. One rule to get right
instead of forty.

Two safety nets:

- **Confidence levels.** Every entry is marked `high`, `medium`, or `low`.
  Anything below `high` is believed correct but unverified, and appears in the
  probe below.
- **Unhandled-property detection.** A state property that looks directional
  (contains `direction`, `facing`, `axis`, `face`, `hinge`, `orientation`,
  `connection`) but is not in the table is left untouched and *reported*, rather
  than silently passed through facing the wrong way. `rotate-module.mjs` exits
  with status 2 when this happens. This already caught one real bug — a typo'd
  `minecraft_cardinal_direction` (underscore instead of colon) that would have
  left every chest facing wrong after rotation.

### The probe harness

```sh
node tools/gen-rotation-probe.mjs
```

Emits a 50-cell probe structure in all six orientations, plus the block states
the table predicts. Place one in-game, stand at its lowest north-west corner,
and run **Rotation Probe** from the Build Wand menu. The script reads what the
game actually produced and reports every disagreement — property, expected
value, actual value. That output is what corrects the table.

Full procedure in [MILESTONES.md](MILESTONES.md#m2-acceptance-test--current).

## Using it

1. `npm run build`, then double-click `dist/city_builder.mcaddon`.
2. Activate *City Builder (Behavior)* on a creative world.
3. `/give @s cb:build_wand`, then right-click.

**Stand in a lift shaft and the wand becomes a call button** — pick a floor and
ride. On a 100-storey tower the panel lists the floors around you plus every
programme change, rather than a hundred buttons.

**Place Building** browses 68 presets grouped by type. Pick one, choose a
rotation, and it builds from your feet outward with its north-west corner at
your position. **Undo Last Build** clears it again. **Settings** tunes the
per-tick block budget if placement feels slow or heavy.

Buildings are generated *in-game* from a 122 KB bundle of catalog descriptions
plus the generator itself — not shipped as `.mcstructure` files. Willis Tower
alone would be ~14 MB as a structure, and Bedrock structure blocks cap at
64x384x64 so the large presets could not be placed that way at all.

Placement times at the default 400 blocks/tick: most buildings land in under 10
seconds; the largest supertall takes about a minute. Raise the budget in
Settings to trade smoothness for speed.

## Custom blocks

Vanilla Minecraft has no angled roof block — stairs are the closest it gets, and
stairs read as steps. Bedrock does support custom blocks with arbitrary
geometry, so the pack ships its own: a genuine 45-degree shingled slope, rolled
ridge caps, hips, eaves fascias, dormers, canted bay windows, corbelled
cornices, stoops, porch posts, wall sconces, chandeliers, pendant and ceiling
lights, framed artwork in five variants, and furniture with real arms, backs,
legs and pedestals rather than a coloured cube.

```sh
node tools/gen-blocks.mjs      # 23 blocks, 23 geometries, 41 textures
```

Three things a roof block has to get right, each learned from a defect that
reached a render:

- **Solid under the surface.** A bare rotated plate leaves the lower half of its
  block hollow, and you can see through every perimeter course to the block
  behind. Slopes and hips are filled beneath their plane.
- **A hip takes the lower of its two slopes.** Unioning two whole plates takes
  the higher one, which bulges each hip block above its neighbours and breaks
  the hip line into diamonds. Each plate is clipped at the diagonal.
- **Eaves need somewhere to go.** Every module carries a one-block `margin` so
  the roof plane can continue past the wall, with a fascia and soffit under it.
  Cornices, bay windows and stoops live in that margin too.

Pitched roofs honour the rise the catalog declares. A 45-degree hip over a
40-wide building would rise twenty blocks; where the declared rise is lower the
roof finishes on a flat deck ringed with ridge tiles, which is what a truncated
hip — a mansard — actually is.

Roof materials: slate, clay tile, wood shake, asphalt shingle and barrel
(mission) tile — each with its own procedural pattern, so a barrel-tile roof of
half-round pantiles reads nothing like a flat slate one.

Windows are framed units with a recessed light, mullions, a transom, a head and
a sill, in four frame colourways. They are used for punched windows only — a
curtain wall genuinely is a continuous sheet of glass, so putting a sash frame
on a Miesian tower would be wrong rather than better.

Everything is generated from one spec table in `tools/gen-blocks.mjs`, including
the textures — `tools/lib/textures.mjs` produces shingle courses, upholstery,
wood grain, brushed metal, glow panels and framed art procedurally, so a new
material is a line of data rather than a hand-painted PNG.

Roofing picks its kit from the building's era: slate for gothic and
neoclassical, clay tile for vernacular and revival, wood shake for expressionist,
asphalt for postwar. Shingle colour, ridge and hip all follow.

The preview renderer reads the real `.geo.json` and rasterises it, rotation and
all (`tools/lib/geo-voxels.mjs`), so what you see in a preview is the geometry
Minecraft will build — not an approximation. Before that existed, a 45-degree
wedge and a stack of cubes rendered identically, which made the roof impossible
to judge.

The camera is deliberately **not** isometric. True isometric looks down the
(1,1,1) axis, and the normal of a 45-degree roof plane is exactly perpendicular
to it — so every pitched slope in the library was edge-on to the camera and
culled as a back face, leaving only the notches between courses. That, not the
geometry, is why the roofs kept "looking like stairs". The camera now sits 35
degrees round and 50 degrees down, and no principal plane of a building is
degenerate.

A block's facing convention: **the front is the -Z face.** North is -Z in
Minecraft, so that is the only convention under which "facing north" and
"unrotated" mean the same thing. The window, the framed art and the screen were
built the other way round, which put every window frame, sill and head on the
inside of the building and hung every picture facing the wall.

**Not verified in-game:** the slope geometry is a plate rotated 45 degrees. The
voxeliser confirms the profile is a clean diagonal, but the *sign* of the
rotation cannot be checked without the game. If roofs render sloping inward,
flip `SLOPE_ROTATION` in `tools/gen-blocks.mjs` — that one constant controls
every roof in the library.

## Interiors and fitout

Buildings are not shells. Every floor gets a walkable surface, the stair core
connects top to bottom, entrances are cut through the facade, lift shafts run
the full height with a landing door on each floor, and ceiling lights mean the
interior is not a black box.

Furniture is rule-driven, keyed to **room type** rather than to building
(`tools/lib/fitout.mjs`). 26 rules cover offices, apartments, hotel rooms,
classrooms, wards, lobbies, restaurants, retail, workshops, platforms and
sanctuaries. Rooms also get framed art and wall sconces on the inside face of
the exterior wall — a room with furniture but blank walls still reads as a
warehouse. That is the answer to the premortem's finding that 108 named
fitouts across 68 buildings was hand-authoring with extra steps: a 1920s office
and a 1970s office are the same rule with different materials.

Three rules the fitout follows, each learned from a bug:

- **Furniture only fills cells the shell left empty**, so it can never displace
  a stair, a doorway, a partition or a lift shaft.
- **Multi-cell items are placed all-or-nothing.** Half a bed is a broken block
  in-game, not a short bed.
- **If the grid point is occupied, it nudges** to a nearby free spot rather than
  dropping the room. The fitout grid and the partition grid land on the same
  column often enough that this matters.

## Install (Windows / Bedrock)

1. `node tools/build.mjs`
2. Double-click `dist/city_builder.mcaddon`. Minecraft imports both packs.
3. Create or edit a world → **Behavior Packs** → activate *City Builder (Behavior)*.
   The resource pack activates automatically via the manifest dependency; if it
   does not, activate *City Builder (Resources)* manually.
4. No experimental toggles are required — the pack uses only stable script APIs.

To iterate without re-importing, symlink or copy `packs/city_builder_bp` and
`packs/city_builder_rp` straight into:

```
%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\development_behavior_packs\
%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\development_resource_packs\
```

Packs in the `development_*` folders reload on world reload, so the edit loop is
save → leave world → rejoin.

## Testing M0

The full acceptance checklist is in [MILESTONES.md](MILESTONES.md#m0-acceptance-test).
The short version: `/give @s cb:build_wand`, right-click, expect a "City Builder"
form with three buttons, and a chat line when you pick one.

Turn on **Settings → Creator → Content Log GUI** before loading the world.
Script errors surface there and nowhere else.

## Version pinning

Bedrock's JSON schemas and script module versions drift between game versions —
this is a tracked risk in SPEC.md §6. The pins are:

| Thing | Pinned to | Where |
|---|---|---|
| `min_engine_version` | `1.21.20` | both `manifest.json` headers |
| `@minecraft/server` | `1.13.0` | BP `manifest.json` dependencies |
| `@minecraft/server-ui` | `1.3.0` | BP `manifest.json` dependencies |
| Item schema | `1.21.10` | `items/build_wand.json` `format_version` |

If the game reports an unsupported script module version, raise the
`@minecraft/server` / `@minecraft/server-ui` versions to the newest **stable**
(non-beta) versions your game build ships, and raise `min_engine_version` to
match. Do not switch to a beta module version — that would require the
"Beta APIs" experimental toggle and would put the pack on a moving schema.
