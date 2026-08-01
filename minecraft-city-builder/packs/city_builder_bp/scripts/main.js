/**
 * City Builder — runtime entry point.
 *
 * The Build Wand browses the bundled preset catalog and places a building at
 * your feet. Geometry is generated in-game from the catalog description, on a
 * per-tick block budget (see placer.js).
 */

import { system, world } from '@minecraft/server'
import { ActionFormData, FormCancelationReason, ModalFormData } from '@minecraft/server-ui'
import { probeOrientations, reportProbe } from './rotation_probe.js'
import {
    placeBuilding, cancelBuild, isBuilding, catalogEntries, undoLast, lastPlacementFor, BUDGET,
    districtEntries, placeDistrict, cityEntries, placeCity
} from './placer.js'
import { totalHeight } from './lib/generate.js'
import { openFloorPanel, shaftAt, shaftCount } from './elevator.js'

const WAND_ITEM_ID = 'cb:build_wand'
const PREFIX = '§6[City Builder]§r'

/** Players with a City Builder form open, so a second right-click is a no-op. */
const openFor = new Set()

/**
 * `form.show()` fails with `UserBusy` when the player still has a screen open —
 * including the brief window right after the right-click that triggered us.
 */
async function showWhenReady(player, form, timeoutTicks = 200) {
    const startTick = system.currentTick
    while (system.currentTick - startTick < timeoutTicks) {
        const response = await form.show(player)
        if (response.cancelationReason !== FormCancelationReason.UserBusy) return response
    }
    return undefined
}

// --- main menu -------------------------------------------------------------

const MENU = [
    { label: 'Place Building', handler: (player) => chooseType(player) },
    { label: 'Place District Tile', handler: (player) => chooseDistrict(player) },
    { label: 'Place City', handler: (player) => chooseCity(player) },
    { label: 'Rebuild Last', handler: (player) => rebuildLast(player) },
    { label: 'Undo Last Build', handler: (player) => undoLast(player) },
    { label: 'Cancel Build', handler: (player) => cancelCurrent(player) },
    { label: 'Settings', handler: (player) => openSettings(player) },
    { label: 'Call Lift Here', handler: (player) => callLift(player) },
    { label: 'Rotation Probe', handler: (player) => openProbeMenu(player) }
]

async function openBuildMenu(player) {
    if (openFor.has(player.id)) return
    openFor.add(player.id)

    try {
        // Standing in a lift shaft, the wand is a call button first and a
        // build menu second — that is what you want it to be at that moment.
        if (shaftAt(player.location)) {
            if (await openFloorPanel(player, showWhenReady)) return
        }

        const form = new ActionFormData()
            .title('City Builder')
            .body(
                isBuilding()
                    ? '§eA build is in progress.§r'
                    : `${catalogEntries().length} presets available.` +
                      (lastPlacementFor(player.id) ? `\n§7Last: ${lastPlacementFor(player.id).entry.name}§r` : '')
            )
        for (const entry of MENU) form.button(entry.label)

        const response = await showWhenReady(player, form)
        if (!response || response.canceled || response.selection === undefined) return
        await MENU[response.selection]?.handler(player)
    } catch (error) {
        console.warn(`[City Builder] build menu failed: ${error}`)
    } finally {
        openFor.delete(player.id)
    }
}

// --- district browser ------------------------------------------------------

/**
 * A district tile is a whole city block: two streets, the alley behind, and the
 * buildings on both lot rows. It is laid from its north-west corner, so stand
 * on the corner you want the intersection to sit on.
 */
async function chooseDistrict(player) {
    const tiles = districtEntries()
    const form = new ActionFormData()
        .title('Place a District Tile')
        .body(
            'A tile carries its own north and west streets, so tiles abut without ' +
            'doubling the road. Laid from the north-west corner at your feet.'
        )
    for (const tile of tiles) {
        form.button(`${tile.name}\n§7${tile.size[0]}x${tile.size[1]} · ${tile.buildings.length} types§r`)
    }

    const response = await showWhenReady(player, form)
    if (!response || response.canceled || response.selection === undefined) return

    const tile = tiles[response.selection]
    const origin = {
        x: Math.floor(player.location.x),
        y: Math.floor(player.location.y),
        z: Math.floor(player.location.z)
    }
    placeDistrict(player, tile, origin)
}

// --- city browser ----------------------------------------------------------

/**
 * A city is a grid of district tiles with its streets agreed once across the
 * whole grid. Generation happens up front and takes a few seconds; placement
 * then runs on the same tick budget as everything else.
 */
async function chooseCity(player) {
    const cities = cityEntries()
    const form = new ActionFormData()
        .title('Place a City')
        .body(
            '§eThis is a very large build.§r Laid from the north-west corner at your feet. ' +
            'Use Cancel Build to stop it, or Undo Last Build to clear it.'
        )
    for (const city of cities) {
        form.button(`${city.name}\n§7${city.size[0]}x${city.size[1]} · ${city.blocks} blocks§r`)
    }

    const response = await showWhenReady(player, form)
    if (!response || response.canceled || response.selection === undefined) return

    const city = cities[response.selection]
    placeCity(player, city, {
        x: Math.floor(player.location.x),
        y: Math.floor(player.location.y),
        z: Math.floor(player.location.z)
    })
}

// --- preset browser --------------------------------------------------------

/** Group the catalog by type so the list stays navigable at 68 entries. */
function byType() {
    const groups = new Map()
    for (const entry of catalogEntries()) {
        if (!groups.has(entry.type)) groups.set(entry.type, [])
        groups.get(entry.type).push(entry)
    }
    for (const list of groups.values()) list.sort((a, b) => b.massing.floors - a.massing.floors)
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

const TYPE_LABELS = {
    office: 'Office', residential: 'Residential', mixed_use: 'Mixed Use', hotel: 'Hotel',
    retail: 'Retail', restaurant: 'Restaurant', automotive: 'Automotive', industrial: 'Industrial',
    civic: 'Civic', institutional: 'Institutional', transit: 'Transit', religious: 'Religious',
    entertainment: 'Entertainment', parking: 'Parking', healthcare: 'Healthcare', education: 'Education'
}

async function chooseType(player) {
    const groups = byType()
    const form = new ActionFormData().title('Choose a Category').body('Presets are grouped by building type.')
    for (const [type, list] of groups) form.button(`${TYPE_LABELS[type] ?? type}\n§7${list.length} presets§r`)

    const response = await showWhenReady(player, form)
    if (!response || response.canceled || response.selection === undefined) return
    await chooseBuilding(player, groups[response.selection])
}

async function chooseBuilding(player, [type, list]) {
    const form = new ActionFormData()
        .title(TYPE_LABELS[type] ?? type)
        .body('Tallest first. The building is placed with its north-west corner at your feet.')
    for (const entry of list) {
        const [x, z] = entry.massing.footprint
        form.button(`${entry.name}\n§7${entry.massing.floors}f · ${x}x${z} · ${totalHeight(entry)} tall§r`)
    }

    const response = await showWhenReady(player, form)
    if (!response || response.canceled || response.selection === undefined) return
    await confirmPlacement(player, list[response.selection])
}

async function confirmPlacement(player, entry) {
    const [x, z] = entry.massing.footprint
    const height = totalHeight(entry)
    const origin = {
        x: Math.floor(player.location.x),
        y: Math.floor(player.location.y),
        z: Math.floor(player.location.z)
    }

    const roomAbove = 320 - (origin.y + height)
    const warning =
        roomAbove < 0
            ? `\n\n§cThis building is ${-roomAbove} blocks too tall here.§r Move down before building.`
            : roomAbove < 20
              ? `\n\n§eOnly ${roomAbove} blocks of headroom above.§r`
              : ''

    const form = new ModalFormData()
        .title(entry.name)
        .dropdown(
            `${entry.massing.floors} floors · ${x} x ${z} · ${height} tall\n` +
                `${entry.facade.system}\n` +
                `Origin ${origin.x}, ${origin.y}, ${origin.z}${warning}\n\nRotation`,
            ['0°', '90°', '180°', '270°'],
            0
        )
        .toggle('Build here', true)

    const response = await showWhenReady(player, form)
    if (!response || response.canceled || !response.formValues) return

    const [turns, confirmed] = response.formValues
    if (!confirmed) return

    if (roomAbove < 0) {
        player.sendMessage(`${PREFIX} §crefusing to build — ${-roomAbove} blocks over the world ceiling.§r`)
        return
    }

    lastBuilt.set(player.id, entry.id)
    placeBuilding(player, entry, origin, turns)
}

// --- other menu actions ----------------------------------------------------

const lastBuilt = new Map()

function rebuildLast(player) {
    const id = lastBuilt.get(player.id)
    if (!id) {
        player.sendMessage(`${PREFIX} nothing built yet this session.`)
        return
    }
    const entry = catalogEntries().find((e) => e.id === id)
    if (entry) return confirmPlacement(player, entry)
}

async function callLift(player) {
    if (!(await openFloorPanel(player, showWhenReady))) {
        player.sendMessage(
            `${PREFIX} no lift here. ${shaftCount()} shaft(s) registered — stand inside one and try again.`
        )
    }
}

function cancelCurrent(player) {
    player.sendMessage(cancelBuild() ? `${PREFIX} cancelling.` : `${PREFIX} nothing is building.`)
}

async function openSettings(player) {
    const form = new ModalFormData()
        .title('Settings')
        .slider('Blocks placed per tick', 50, 2000, 50, BUDGET.blocksPerTick)

    const response = await showWhenReady(player, form)
    if (!response || response.canceled || !response.formValues) return
    BUDGET.blocksPerTick = response.formValues[0]
    player.sendMessage(`${PREFIX} block budget set to ${BUDGET.blocksPerTick} per tick.`)
}

async function openProbeMenu(player) {
    const orientations = probeOrientations()
    if (!orientations.length) {
        player.sendMessage(`${PREFIX} No probe data — run "node tools/gen-rotation-probe.mjs" and rebuild the pack.`)
        return
    }

    const form = new ActionFormData()
        .title('Rotation Probe')
        .body("Stand at the probe's lowest north-west corner, then pick the orientation you placed.")
    for (const label of orientations) form.button(label)

    const response = await showWhenReady(player, form)
    if (!response || response.canceled || response.selection === undefined) return
    reportProbe(player, orientations[response.selection])
}

// --- wiring ----------------------------------------------------------------

world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack?.typeId !== WAND_ITEM_ID) return
    // Forms cannot be shown from inside the event callback; defer a tick.
    system.run(() => openBuildMenu(event.source))
})

world.afterEvents.playerLeave.subscribe((event) => {
    openFor.delete(event.playerId)
    lastBuilt.delete(event.playerId)
})

console.info(`[City Builder] loaded — ${catalogEntries().length} presets available.`)
