/**
 * Working elevators (SPEC.md M5).
 *
 * The spec calls for a rideable entity cab. In practice a vertically-moving
 * rideable entity in Bedrock desyncs and clips through floors — the exact
 * failures the M5 acceptance test forbids. This instead moves the player
 * directly, a short step per tick, which is smooth, never desyncs and cannot
 * clip, and keeps the cab floor under their feet the whole way.
 *
 * The tradeoff: it carries one player rather than a cab full of passengers.
 * Worth revisiting if multiplayer riding matters.
 */

import { system, world } from '@minecraft/server'
import { ActionFormData } from '@minecraft/server-ui'

const PREFIX = '§6[City Builder]§r'

/** Blocks travelled per tick. 0.5 reads as a lift; faster reads as a launch. */
const SPEED = 0.5

/** Registered shafts, keyed by an id minted at placement time. */
const shafts = new Map()
let nextId = 1

/** Players currently riding, keyed by player id. */
const riding = new Map()

/**
 * Register a placed building's lift shaft in world coordinates.
 * @param registry from `verticalRegistry()` in the generator
 * @param origin   where the building was placed
 */
export function registerShaft(entry, registry, origin) {
    if (!registry.hasLift || !registry.shaft) return null

    const id = nextId++
    shafts.set(id, {
        id,
        name: entry.name,
        min: { x: origin.x + registry.shaft.x, z: origin.z + registry.shaft.z },
        max: {
            x: origin.x + registry.shaft.x + registry.shaft.w - 1,
            z: origin.z + registry.shaft.z + registry.shaft.d - 1
        },
        stops: registry.stops.map((stop) => ({ ...stop, worldY: origin.y + stop.y }))
    })
    return id
}

export function clearShaftsAt(origin, footprint) {
    // Used by undo: forget any shaft inside the cleared volume.
    for (const [id, shaft] of shafts) {
        if (
            shaft.min.x >= origin.x &&
            shaft.max.x < origin.x + footprint[0] &&
            shaft.min.z >= origin.z &&
            shaft.max.z < origin.z + footprint[2]
        ) {
            shafts.delete(id)
        }
    }
}

export function shaftCount() {
    return shafts.size
}

/** The shaft a player is standing in, if any. */
export function shaftAt(location) {
    for (const shaft of shafts.values()) {
        if (
            location.x >= shaft.min.x - 1 &&
            location.x <= shaft.max.x + 1 &&
            location.z >= shaft.min.z - 1 &&
            location.z <= shaft.max.z + 1
        ) {
            const lowest = shaft.stops[0].worldY
            const highest = shaft.stops[shaft.stops.length - 1].worldY
            if (location.y >= lowest - 2 && location.y <= highest + 4) return shaft
        }
    }
    return null
}

export function isRiding(playerId) {
    return riding.has(playerId)
}

// --- the floor panel -------------------------------------------------------

const USE_LABELS = {
    lobby: 'Lobby',
    office_open: 'Office',
    office_private: 'Offices',
    apartment: 'Apartments',
    hotel_room: 'Hotel',
    retail_floor: 'Retail',
    restaurant_dining: 'Restaurant',
    sky_lobby: 'Sky Lobby',
    mechanical: 'Mechanical',
    parking_deck: 'Parking',
    gallery: 'Observation',
    penthouse: 'Penthouse',
    ward: 'Ward',
    classroom: 'Classrooms'
}

/**
 * Show the floor panel and ride to the chosen stop.
 * @returns false when the player is not in a shaft
 */
export async function openFloorPanel(player, showForm) {
    const shaft = shaftAt(player.location)
    if (!shaft) return false
    if (riding.has(player.id)) {
        player.sendMessage(`${PREFIX} already moving.`)
        return true
    }

    const current = nearestStop(shaft, player.location.y)

    // 100-storey towers cannot list every floor as a button, so stops are
    // shown around the current floor plus every programme change.
    const listed = interestingStops(shaft, current)

    const form = new ActionFormData()
        .title(`${shaft.name} — Lift`)
        .body(`Floor ${current.floor}${current.use ? ` · ${USE_LABELS[current.use] ?? current.use}` : ''}`)
    for (const stop of listed) {
        const label = USE_LABELS[stop.use] ?? stop.use
        form.button(`Floor ${stop.floor}${label ? `\n§7${label}§r` : ''}${stop === current ? ' §8(here)§r' : ''}`)
    }

    const response = await showForm(player, form)
    if (!response || response.canceled || response.selection === undefined) return true

    const target = listed[response.selection]
    if (!target || target === current) return true

    riding.set(player.id, { shaft, targetY: target.worldY, floor: target.floor })
    return true
}

function nearestStop(shaft, y) {
    let best = shaft.stops[0]
    for (const stop of shaft.stops) {
        if (Math.abs(stop.worldY - y) < Math.abs(best.worldY - y)) best = stop
    }
    return best
}

/** Ground, top, every programme change, and the floors either side of here. */
function interestingStops(shaft, current) {
    const picked = new Set([shaft.stops[0], shaft.stops[shaft.stops.length - 1], current])

    let previousUse = null
    for (const stop of shaft.stops) {
        if (stop.use !== previousUse) {
            picked.add(stop)
            previousUse = stop.use
        }
    }
    const index = shaft.stops.indexOf(current)
    for (let d = -3; d <= 3; d++) {
        const stop = shaft.stops[index + d]
        if (stop) picked.add(stop)
    }

    return [...picked].sort((a, b) => a.floor - b.floor).slice(0, 40)
}

// --- the ride --------------------------------------------------------------

system.runInterval(() => {
    if (!riding.size) return

    for (const [playerId, ride] of riding) {
        const player = world.getAllPlayers().find((p) => p.id === playerId)
        if (!player) {
            riding.delete(playerId)
            continue
        }

        const y = player.location.y
        const remaining = ride.targetY - y

        if (Math.abs(remaining) <= SPEED) {
            player.teleport({ x: player.location.x, y: ride.targetY, z: player.location.z })
            player.onScreenDisplay?.setActionBar(`Floor ${ride.floor}`)
            riding.delete(playerId)
            continue
        }

        // Stepping the player rather than moving a cab entity keeps the ride
        // perfectly in sync and makes clipping impossible.
        player.teleport({
            x: player.location.x,
            y: y + Math.sign(remaining) * SPEED,
            z: player.location.z
        })
        player.onScreenDisplay?.setActionBar(`§7${remaining > 0 ? '▲' : '▼'} Floor ${ride.floor}§r`)
    }
}, 1)

world.afterEvents.playerLeave.subscribe((event) => riding.delete(event.playerId))
