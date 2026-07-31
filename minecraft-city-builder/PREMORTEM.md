# Adversarial Premortem

**Framing:** it is a year from now. The add-on shipped and it is disappointing.
The buildings look samey, the cities never got built, and the owner stopped
opening the world. This document is the postmortem written in advance, ranked by
likelihood × damage.

Every number below comes from the catalog as it actually stands
(`node tools/catalog-report.mjs`), not from impression.

**Status when written:** 68 catalog entries, 0 buildings that exist as placeable
geometry, 0 milestones accepted in-game.

---

## 1. The catalog is a bill of materials that has been mistaken for progress

**This is the most dangerous item on the list, because it is the one most likely
to feel fine right up until it doesn't.**

68 catalog entries were produced in a single session. What they specify:

| Generator | Distinct count |
|---|---|
| Facade systems | 51 |
| Window patterns | 33 |
| Facade and roof features | 165 |
| Interior fitouts | 108 |
| **Total distinct generators required** | **357** |

Not one exists. The catalog is a specification for 357 pieces of work, written
in an afternoon, that will take months to build. Reading the catalog feels like
seeing a library. It is a purchase order.

**How it fails:** the first ten buildings get real generators and look good.
Buildings 11–68 get whichever existing generator is closest, because the
alternative is another 300 hours. The library converges on a dozen looks with
different footprints. That *is* the "lackluster building concepts" outcome — it
arrives through generator reuse, not through a bad catalog.

**Mitigation:** build one building end to end — Monadnock is the best candidate,
being rectilinear, pre-1990, distinctive, and only 17 floors — and measure how
long a real facade system takes. Multiply by 51. Decide scope from that number
rather than from optimism. If a facade system takes 3 hours, facades alone are
150 hours before a single interior exists.

---

## 2. Minecraft's block palette cannot express the distinctions the catalog claims

The catalog names materials: `bedford_limestone`, `dark_green_terracotta` with
gold leaf, `corten_steel`, `purple_brown_brick`, `white_glazed_terracotta`,
`buff_precast`, `board_formed_concrete`. **None of these are Minecraft blocks.**

Some map acceptably — limestone to smooth quartz or diorite, red brick to brick.
Some do not. The Carbide & Carbon Building is dark green with a gold-leaf crown;
Minecraft's green blocks are either too saturated (green concrete) or too muddy
(green terracotta), and there is no gold-leaf surface at facade scale that does
not read as a solid gold block. That building's entire identity is its colour.

Count how many of the 51 facade systems survive contact with the real palette. My
estimate is that they collapse to roughly 12–15 visually distinct looks. At that
point `monadnock_masonry_slab` and `loop_greystone_commercial` are the same
building in different proportions.

**How it fails:** the owner places six Chicago School buildings on a street and
cannot tell them apart. The catalog said they were different. The blocks say
otherwise.

**Mitigation:** a palette study *before* more catalog authoring. Take the eight
most-used facade systems, build 1-bay samples of each, place them side by side
in-game, and have the owner say which pairs are indistinguishable. Merge the
collisions and rewrite the catalog to the palette's real resolving power. This is
a two-session job that prevents a two-month mistake.

---

## 3. The marquee buildings have the worst interiors, and arithmetic forces it

Six supertalls use a 3-block floor height: 1 structural slab, **2 blocks of
interior.** The player is 1.8 blocks tall with 1.62 eye height. A table is 1
block. A 2-block room with furniture in it is a crawlspace with a ceiling at
head height.

This is not a choice. At 4-block floors the ceiling is 86 storeys and Willis
(108), Hancock (100), St Regis (101) and Trump (98) are all impossible. The
buildings the owner most wants are exactly the ones forced into the worst
interiors.

**How it fails:** the owner rides the elevator to floor 80 of Willis Tower,
steps out, and it feels like a parking deck. The exterior is the whole point of
a supertall, and the interior undoes it.

**Mitigation, pick one and decide now:**
- **Accept it** and make supertall interiors mostly impostor (M7) so nobody walks
  them — cheapest, and arguably correct, since nobody walks floor 80 of a real
  tower either.
- **Compress floor counts harder.** Willis at 70 rendered floors of 108 fits at 4
  blocks with room to spare. The silhouette survives; the floor count does not.
- **Accept a shorter city.** Cap at 86 floors and no Chicago supertall is literal.

I recommend the first. It should be an explicit decision, in writing, before M8.

---

## 4. Every building depends on rotation, and rotation is still unverified

Four block-state encodings in `data/block-states/rotation.json` are marked
`medium` confidence — believed correct, never measured. The probe that measures
them was built and has not been run.

68 buildings × 4 rotations, plus every street tile, every piece of transit.

**How it fails:** the probe is finally run after the assembler exists, `direction`
turns out to be wrong for trapdoors, and every door and trapdoor in the library
faces wrong. The fix is one line in a JSON file. Finding it after 40 buildings
are authored and captured is what costs.

**Mitigation:** run the probe. It is one creative-world session and it is the
cheapest risk retirement available anywhere in this project.

---

## 5. Seven buildings are not rectilinear and the engine is

`marina_city_corncob` is circular. `lake_point_curved_tower` is trilobal.
`loop_curved_bank_tower` has continuously sloped flanks. Four more have light
courts or cut corners.

The module grid is rectilinear. I approximated the curves as stepped boxes. A
35-block-diameter circle approximated in 5-block bays is an octagon.

**How it fails:** Marina City is one of the three most recognizable buildings in
Chicago and it comes out as a stack of octagons on a stick. The owner opens the
world, looks at the riverfront, and the thing that should be the showpiece is the
thing that looks worst.

**Mitigation:** curved buildings need a per-building authored shell rather than
the assembler — reclassify them as `monolithic` despite their floor count, and
accept that the repeating floor plate is generated but the skin is not. This
contradicts §4.2's "repetition, not size" rule, which needs amending.

---

## 6. Realm *storage* was never solved — only Realm *height*

The envelope solver answers "does the building fit vertically." It says nothing
about total world size, which is a separate Realm limit I have not measured.

The Chicago Loop at 1:1 is roughly 1500 × 1000 blocks — **5,922 chunks**, about
0.6 billion block positions in full column. With interiors.

**How it fails:** the district tiles work, the buildings look good, and the Realm
refuses the upload or degrades badly. The owner's actual stated goal — "place an
entire city" — turns out to have been impossible from the start, and nobody
checked because the height problem was so much more interesting.

**Mitigation:** measure it empirically and early. Generate a single filled
district tile, upload it to the Realm, and record the size. That number sets
everything downstream and is currently unknown.

---

## 7. "Chicago, all of it" has never been scoped, and the range is enormous

- The Loop alone: ~5,900 chunks.
- Downtown plus near neighbourhoods: ~10× that.
- The city of Chicago: 606 km², roughly **2.4 million chunks**.

These are three different projects, separated by two orders of magnitude. The
third is not a project; it is a decade.

**How it fails:** work proceeds on an unstated assumption. The owner is expecting
Chicago and receives the Loop, or work targets the whole city and nothing ever
ships.

**Mitigation:** pick a boundary and write it down. My recommendation is the Loop
plus River North and the Near South Side — recognizably Chicago, contains most
landmarks, and is roughly 15,000 chunks. Everything beyond is v2.

---

## 8. The fitout engine does not amortize

108 distinct fitouts across 68 buildings — **1.6 per building.** M6 exists
specifically so rooms are dressed by rule instead of by hand. A system producing
more rules than buildings is not a system; it is hand-authoring with extra steps.

**How it fails:** M6 is built, and it turns out to be 108 bespoke room recipes.
The bottleneck M6 was supposed to remove is exactly where it was.

**Mitigation:** collapse the fitout vocabulary hard before building M6. `office_
period_partitioned`, `office_corporate_open`, `office_government` and
`office_small_suite` are one parameterized office fitout with era, density and
partition variables. Target: 20 parameterized fitouts, not 108 named ones. That
is a catalog edit, and it is cheap today and expensive later.

---

## 9. Three milestones built, zero validated

M0, M1, M2 are all "built, awaiting acceptance." Nothing has been placed in-game.
The probe harness was built precisely because Claude Code cannot see output — and
it has not been run.

**How it fails:** an incorrect assumption at M1 or M2 propagates through the
assembler, the catalog, and the city builder before anyone looks. The rework is
not one milestone; it is everything downstream.

**Mitigation:** one creative-world session covering all three. This is the single
highest-value hour available and it has been available for three sessions.

---

## 10. The assembler is the hard part and it has not started

The catalog says `bundled tube, nine 23-block tubes on a 3×3 grid, setbacks at
50/66/90`. Converting that into geometry that reads as Willis Tower — proportion,
tube drop-offs at the right floors, the black anodized skin, the antenna pair —
is the entire difficulty of this project, and the catalog's confident tone
disguises it.

**How it fails:** the assembler produces dimensionally correct boxes. Every metric
in the catalog is satisfied and the building does not look like the building.

**Mitigation:** the vertical slice in item 1. One building, all the way, judged
in-game by the owner before the catalog grows further.

---

## What I would change right now

Ranked by value per hour:

1. **Run the M2 rotation probe.** One session. Retires the largest correctness
   risk in the project.
2. **Build one complete building** (Monadnock) end to end and have the owner look
   at it. Calibrates every estimate below.
3. **Palette study** on the eight commonest facade systems. Decide how many
   visually distinct buildings are actually achievable before authoring for 51.
4. **Collapse 108 fitouts to ~20 parameterized ones.** A catalog edit today, a
   rewrite later.
5. **Measure Realm storage** with one filled district tile.
6. **Write down what "Chicago" means** as a boundary on a map.
7. **Decide the supertall interior question** explicitly.

Items 1, 2 and 3 are each under a day and together they determine whether the
remaining plan is real. Nothing further should be authored into the catalog until
2 and 3 are done.

---

## What is genuinely solid

Being adversarial is not the same as being negative. These are load-bearing and
sound:

- **The vertical envelope is solved and proven.** Bedrock's 384-block limit is
  real, add-ons cannot extend it, digging down is the only lever, and the solver
  proves all 68 buildings fit. That is a correct, quantified answer to a question
  that would otherwise have surfaced at the top of a tower.
- **The rotation engine is well built and honestly hedged.** Semantics rather than
  forty permutation tables, group-theoretic tests that hold without ground truth,
  and unhandled-property detection that already caught a real bug.
- **The module format round-trips losslessly**, cross-checked against an
  independent parser.
- **The catalog's structure is right even where its content is optimistic.**
  Program bands tile every floor, provenance is honest, compression is declared
  rather than silent.

The engine is in better shape than the content plan. The risk is almost entirely
in the 357 generators, not in the machinery that will run them.

---

## The margin nobody should ignore

All 68 buildings fit the Bedrock envelope **with 2 blocks to spare.**

That is not a margin. It is a coincidence. One deeper subway, one taller antenna,
one foundation course, or any terrain relief at all, and Chicago stops fitting.
And Chicago is not the tallest city on the list — New York is.

The envelope should be re-solved every time the catalog changes.
`npm test` does this, and it should stay that way.
