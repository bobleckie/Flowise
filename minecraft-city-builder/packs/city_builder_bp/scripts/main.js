/**
 * City Builder — runtime entry point.
 *
 * Milestone M0 (Skeleton): the Build Wand opens an ActionFormData menu with
 * three placeholder entries; selecting one prints a chat message.
 *
 * Everything below the `MENU` table is deliberately generic — later milestones
 * replace the placeholder handlers, not the menu plumbing.
 */

import { system, world } from '@minecraft/server'
import { ActionFormData, FormCancelationReason } from '@minecraft/server-ui'

const WAND_ITEM_ID = 'cb:build_wand'

/** Chat prefix so City Builder output is distinguishable from vanilla messages. */
const PREFIX = '§6[City Builder]§r'

/**
 * Placeholder menu. `handler` receives the player and is the seam every later
 * milestone plugs into (M3 assembler, M6 typology picker, and so on).
 */
const MENU = [
    {
        label: 'Place Building',
        handler: (player) => player.sendMessage(`${PREFIX} Place Building — not implemented yet (M0 placeholder).`)
    },
    {
        label: 'Choose Typology',
        handler: (player) => player.sendMessage(`${PREFIX} Choose Typology — not implemented yet (M0 placeholder).`)
    },
    {
        label: 'Settings',
        handler: (player) => player.sendMessage(`${PREFIX} Settings — not implemented yet (M0 placeholder).`)
    }
]

/** Players with a City Builder form currently on screen, so a second right-click is a no-op. */
const openFor = new Set()

/**
 * `form.show()` fails with `UserBusy` when the player still has a screen open —
 * including the brief window right after the right-click that triggered us.
 * Retry until the player is free or we give up.
 */
async function showWhenReady(player, form, timeoutTicks = 200) {
    const startTick = system.currentTick
    while (system.currentTick - startTick < timeoutTicks) {
        const response = await form.show(player)
        if (response.cancelationReason !== FormCancelationReason.UserBusy) return response
    }
    return undefined
}

async function openBuildMenu(player) {
    if (openFor.has(player.id)) return
    openFor.add(player.id)

    try {
        const form = new ActionFormData().title('City Builder').body('Select an action.')
        for (const entry of MENU) form.button(entry.label)

        const response = await showWhenReady(player, form)
        if (!response || response.canceled || response.selection === undefined) return

        const entry = MENU[response.selection]
        if (!entry) return
        entry.handler(player)
    } catch (error) {
        console.warn(`[City Builder] build menu failed: ${error}`)
    } finally {
        openFor.delete(player.id)
    }
}

world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack?.typeId !== WAND_ITEM_ID) return
    // Forms cannot be shown from inside the event callback; defer a tick.
    system.run(() => openBuildMenu(event.source))
})

world.afterEvents.playerLeave.subscribe((event) => {
    openFor.delete(event.playerId)
})

console.info('[City Builder] M0 skeleton loaded.')
