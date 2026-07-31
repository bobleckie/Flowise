/**
 * M2 rotation harness — the in-game half.
 *
 * `tools/gen-rotation-probe.mjs` emits one structure per orientation plus the
 * block states the rotation table predicts. This reads back what the game
 * actually placed and reports every disagreement, so the table's uncertain
 * entries get measured rather than trusted.
 *
 * Usage: place a probe structure with its lowest north-west corner at your
 * feet, then pick "Rotation Probe" from the Build Wand menu and choose the
 * matching orientation.
 */

import { PROBE_EXPECTATIONS } from './probe_data.js'

const PREFIX = '§6[City Builder]§r'
const MAX_REPORTED = 24

export function probeOrientations() {
    return Object.keys(PROBE_EXPECTATIONS)
}

/**
 * Compare a placed probe against the table's predictions.
 * @returns `{ checked, missing, mismatches }`
 */
export function checkProbe(player, label) {
    const spec = PROBE_EXPECTATIONS[label]
    if (!spec) throw new Error(`unknown orientation "${label}"`)

    const origin = {
        x: Math.floor(player.location.x),
        y: Math.floor(player.location.y),
        z: Math.floor(player.location.z)
    }

    const mismatches = []
    let checked = 0
    let missing = 0

    for (const cell of spec.cells) {
        const location = {
            x: origin.x + cell.pos[0],
            y: origin.y + cell.pos[1],
            z: origin.z + cell.pos[2]
        }

        let block
        try {
            block = player.dimension.getBlock(location)
        } catch {
            // getBlock throws when the chunk is not loaded, which is a fact
            // about the test setup rather than a rotation failure.
            block = undefined
        }

        if (!block) {
            missing++
            continue
        }
        checked++

        if (block.typeId !== cell.block) {
            mismatches.push(`${cell.label}: expected ${short(cell.block)}, found ${short(block.typeId)}`)
            continue
        }

        const actual = block.permutation.getAllStates()
        for (const [property, expected] of Object.entries(cell.state)) {
            const got = actual[property]
            if (got !== expected) {
                mismatches.push(`${cell.label}: ${property} expected ${expected}, got ${got}`)
            }
        }
    }

    return { checked, missing, mismatches }
}

/** Run the check and report to chat. */
export function reportProbe(player, label) {
    let result
    try {
        result = checkProbe(player, label)
    } catch (error) {
        player.sendMessage(`${PREFIX} §cprobe failed:§r ${error}`)
        return
    }

    const { checked, missing, mismatches } = result
    player.sendMessage(`${PREFIX} ${label}: checked ${checked} cells${missing ? `, ${missing} unreadable` : ''}`)

    if (missing && !checked) {
        player.sendMessage(
            `${PREFIX} §eNothing readable.§r Stand at the probe's lowest north-west corner before running the check.`
        )
        return
    }

    if (!mismatches.length) {
        player.sendMessage(`${PREFIX} §a${label}: all ${checked} cells match the rotation table.§r`)
        return
    }

    player.sendMessage(`${PREFIX} §c${mismatches.length} mismatch(es):§r`)
    for (const line of mismatches.slice(0, MAX_REPORTED)) player.sendMessage(`  §c${line}§r`)
    if (mismatches.length > MAX_REPORTED) {
        player.sendMessage(`  §7... and ${mismatches.length - MAX_REPORTED} more (see the Content Log)§r`)
    }

    // The full list goes to the content log, which is copyable.
    console.warn(`[City Builder] rotation probe ${label}: ${mismatches.length} mismatches`)
    for (const line of mismatches) console.warn(`  ${line}`)
}

function short(id) {
    return id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id
}
