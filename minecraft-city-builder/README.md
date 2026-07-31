# Minecraft City Builder

A Minecraft Bedrock add-on that places detailed, furnished, elevator-served city
buildings — scaling from a single placed building to generation of entire real
cities from OpenStreetMap data.

**Read [SPEC.md](SPEC.md) first.** It is the persistent project brief: architecture,
milestone sequence, and acceptance criteria. [MILESTONES.md](MILESTONES.md) tracks
where the project actually is.

**Current state: M0 (Skeleton) — built, awaiting in-game acceptance.**

---

## Layout

```
minecraft-city-builder/
├── SPEC.md                       persistent project brief
├── MILESTONES.md                 status + the current acceptance test
├── packs/
│   ├── city_builder_bp/          behavior pack (data + scripts)
│   │   ├── manifest.json
│   │   ├── items/build_wand.json
│   │   ├── scripts/main.js       runtime entry point
│   │   └── texts/
│   └── city_builder_rp/          resource pack (textures + text)
│       ├── manifest.json
│       ├── textures/
│       └── texts/
├── tools/
│   ├── build.mjs                 validate packs + bundle dist/city_builder.mcaddon
│   └── gen_placeholder_art.py    regenerate the placeholder PNGs
└── dist/                         build output (gitignored)
```

Only `packs/city_builder_bp/scripts/` is Bedrock-specific. Per SPEC.md §2, the
module library and typology definitions land in `packs/.../modules/` and
`data/typologies/` as platform-neutral JSON and are compiled to `.mcstructure`
at build time — do not push Bedrock assumptions into that data.

## Build

Requires Node 18+. No dependencies, no install step.

```sh
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
