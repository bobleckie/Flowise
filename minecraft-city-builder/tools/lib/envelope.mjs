/**
 * Vertical envelope solver (SPEC.md M12, brought forward because it constrains
 * the catalog).
 *
 * Bedrock's build range is fixed at Y -64..319 — 384 blocks — and, unlike Java,
 * **an add-on cannot extend it**. There is no Bedrock equivalent of a custom
 * dimension height. The only lever is where the street sits: dig the datum down
 * so tall buildings have headroom above it.
 *
 * That makes a city's feasibility arithmetic. This module does the arithmetic.
 */

import { heightAboveGrade, depthBelowGrade } from './catalog.mjs'

export const WORLD_MIN = -64
export const WORLD_MAX = 319
export const WORLD_HEIGHT = WORLD_MAX - WORLD_MIN + 1

/** Default subsurface reservation, in blocks below the street datum. */
export const DEFAULT_SUBSURFACE = {
    foundation: 3,
    basements: 8,
    subway_mezzanine: 5,
    subway_tunnel: 12
}

export function subsurfaceTotal(budget = DEFAULT_SUBSURFACE) {
    return Object.values(budget).reduce((sum, n) => sum + n, 0)
}

/**
 * Solve the envelope for a set of catalog entries.
 *
 * The datum is placed as low as the subsurface budget allows, because that is
 * the only way to buy headroom. If the tallest building still does not fit,
 * that is reported as a deficit rather than silently clipped.
 */
export function solveEnvelope(entries, { subsurface = DEFAULT_SUBSURFACE, clearance = 0 } = {}) {
    const reserved = subsurfaceTotal(subsurface)

    // Every building also wants its own basement depth; the datum must clear
    // the deepest one as well as the transit budget.
    const deepest = Math.max(0, ...entries.map(depthBelowGrade))
    const below = Math.max(reserved, deepest + subsurface.foundation)

    const datum = WORLD_MIN + below
    const headroom = WORLD_MAX - datum - clearance

    const measured = entries
        .map((entry) => {
            const height = heightAboveGrade(entry)
            return {
                id: entry.id,
                name: entry.name,
                floors: entry.massing.floors,
                floors_actual: entry.massing.floors_actual,
                floor_height: entry.massing.floor_height,
                ...height,
                fits: height.total <= headroom,
                deficit: Math.max(0, height.total - headroom)
            }
        })
        .sort((a, b) => b.total - a.total)

    const failures = measured.filter((m) => !m.fits)

    return {
        world: { min: WORLD_MIN, max: WORLD_MAX, height: WORLD_HEIGHT },
        subsurface,
        below,
        datum,
        headroom,
        deepest_basement: deepest,
        tallest: measured[0] ?? null,
        buildings: measured,
        failures,
        feasible: failures.length === 0
    }
}

/** Maximum rendered floors that fit, for a given floor height and roof load. */
export function maxFloors(headroom, floorHeight, roofcap = 8, antenna = 0) {
    return Math.floor((headroom - roofcap - antenna) / floorHeight)
}
