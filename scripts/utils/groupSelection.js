/**
 * @file Group-chat character picker.
 *
 * Centralises how Guided Generations asks the user "which group member
 * should respond next?". If STGroupResponderSelector (GRS) is installed and
 * exposes its picker API, we delegate to it — that is its whole reason to
 * exist. Otherwise we fall back to GG's own selector (a small popup that
 * shows each member with their avatar).
 *
 * The cross-extension contract is the ST-sanctioned `globalThis.<Name>`
 * pattern (the same one `globalThis.quickReplyApi` uses):
 *
 *     globalThis.STGroupResponderSelector.pickCharacter(): Promise<{chid, name}|null>
 *
 * GG only ever consumes that — it never assumes GRS is present.
 */

import { extensionName, debugLog, getContext } from '../persistentGuides/guideExports.js';

/**
 * @typedef GroupMember
 * @property {number} chid
 * @property {string} name
 * @property {string|null} avatar
 * @property {string} triggerArg  Argument to pass to ST's `/trigger` command
 *                                (name as JSON string, or index as a bare
 *                                number when the name starts with a digit).
 */

/**
 * Look up GRS's published picker, if any.
 * @returns {{pickCharacter: () => Promise<{chid:number,name:string}|null>}|null}
 */
function getGrsPicker() {
    try {
        const api = globalThis.STGroupResponderSelector;
        return api && typeof api.pickCharacter === 'function' ? api : null;
    } catch {
        return null;
    }
}

/**
 * Build the `/trigger` argument for a member. ST's `/trigger` accepts either
 * a member index or a name string; we send the index when the name would
 * otherwise be misparsed as a number (i.e. starts with a digit).
 */
function triggerArgFor(index, name) {
    return /^\d/.test(name) && index >= 0 ? String(index) : JSON.stringify(name);
}

/**
 * Read the current group's members from ST context, each pre-tagged with
 * the `/trigger` argument that would target them.
 * @returns {GroupMember[]}
 */
function getGroupMembers() {
    const context = getContext();
    if (!context?.groupId || !Array.isArray(context.groups)) return [];

    const group = context.groups.find(g => g.id === context.groupId);
    if (!group || !Array.isArray(group.members)) return [];

    const characters = Array.isArray(context.characters) ? context.characters : [];
    const disabled = Array.isArray(group.disabled_members) ? group.disabled_members : [];

    const members = [];
    group.members.forEach((memberAvatar, index) => {
        if (typeof memberAvatar !== 'string') return;
        const chid = characters.findIndex(c => c && c.avatar === memberAvatar);
        if (chid === -1) return;
        const character = characters[chid];
        const name = typeof character.name === 'string' && character.name.length ? character.name : memberAvatar;
        members.push({
            chid,
            name,
            avatar: memberAvatar,
            muted: disabled.includes(memberAvatar),
            triggerArg: triggerArgFor(index, name),
        });
    });
    return members;
}

/**
 * GG's own picker popup. Builds a small centered dialog with one row per
 * group member (avatar + name) and resolves with the clicked member, or
 * null if the user dismisses the dialog without choosing.
 *
 * @param {GroupMember[]} members
 * @returns {Promise<GroupMember|null>}
 */
function ggFallbackPicker(members) {
    return new Promise((resolve) => {
        if (!members.length) {
            resolve(null);
            return;
        }

        let settled = false;
        /** @type {null | (() => void)} Cleanup for the resize listener. */
        let cleanupPosition = null;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            if (cleanupPosition) cleanupPosition();
            overlay.remove();
            document.removeEventListener('keydown', onKeydown);
            resolve(value);
        };

        const overlay = document.createElement('div');
        overlay.className = 'gg-group-picker-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'gg-group-picker-dialog';

        const header = document.createElement('div');
        header.className = 'gg-group-picker-header';
        const title = document.createElement('h3');
        title.textContent = 'Select member to respond as';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'gg-group-picker-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.setAttribute('aria-label', 'Cancel');
        closeBtn.addEventListener('click', () => finish(null));
        header.append(title, closeBtn);

        const list = document.createElement('ul');
        list.className = 'gg-group-picker-list';

        for (const member of members) {
            const li = document.createElement('li');
            li.className = 'gg-group-picker-item';
            li.tabIndex = 0;
            if (member.muted) li.classList.add('gg-group-picker-item--muted');

            const img = document.createElement('img');
            img.className = 'gg-group-picker-avatar';
            img.alt = '';
            if (member.avatar) {
                img.src = `/thumbnail?type=avatar&file=${encodeURIComponent(member.avatar)}`;
            }
            img.addEventListener('error', () => { img.style.visibility = 'hidden'; });

            const name = document.createElement('span');
            name.className = 'gg-group-picker-name';
            name.textContent = member.name;

            li.append(img, name);
            const choose = () => finish(member);
            li.addEventListener('click', choose);
            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    choose();
                }
            });
            list.appendChild(li);
        }

        dialog.append(header, list);
        overlay.append(dialog);

        // Click on backdrop (not dialog) cancels.
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) finish(null);
        });

        /** @param {KeyboardEvent} e */
        const onKeydown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                finish(null);
            }
        };
        document.addEventListener('keydown', onKeydown);

        document.body.append(overlay);
        // Anchor the dialog at the same vertical position as GG's tools
        // menu: just above the GG action-button row (#gg-action-button-
        // container), so it floats over the textarea instead of sitting at
        // the very bottom of the screen. Falls back to #send_form's top
        // (i.e. above the whole input form) if the action container isn't
        // present, and finally to a small gap from the viewport bottom.
        const updatePosition = () => {
            const actionContainer = document.getElementById('gg-action-button-container');
            const sendForm = document.getElementById('send_form');
            const anchorEl = actionContainer || sendForm;
            const gap = 5;
            if (anchorEl) {
                // Place the dialog's bottom edge `gap` px above the anchor's
                // top edge. Distance from viewport bottom =
                // window.innerHeight - anchorEl.top.
                const anchorTop = anchorEl.getBoundingClientRect().top;
                dialog.style.bottom = `${window.innerHeight - anchorTop + gap}px`;
            } else {
                dialog.style.bottom = `${gap}px`;
            }
        };
        updatePosition();
        window.addEventListener('resize', updatePosition);
        cleanupPosition = () => window.removeEventListener('resize', updatePosition);
        // Re-measure once the overlay is laid out, in case fonts/images shift
        // the anchor height on the same frame.
        requestAnimationFrame(updatePosition);
        // Focus the first item so keyboard users can pick immediately.
        const firstItem = list.querySelector('.gg-group-picker-item');
        if (firstItem && typeof firstItem.focus === 'function') {
            firstItem.focus();
        }
    });
}

/**
 * Ask the user which group member should respond next.
 *
 * - If STGroupResponderSelector is installed and publishes
 *   `globalThis.STGroupResponderSelector.pickCharacter`, use it.
 * - Otherwise open GG's own selector (with avatars).
 *
 * Returns the chosen member (with a ready-to-use `triggerArg`), or null if
 * the user cancelled.
 *
 * @returns {Promise<GroupMember|null>}
 */
export async function pickGroupMember() {
    const members = getGroupMembers();
    if (!members.length) {
        debugLog('[GroupSelection] No group members available; picker skipped.');
        return null;
    }

    const grs = getGrsPicker();
    if (grs) {
        try {
            debugLog('[GroupSelection] Using STGroupResponderSelector picker.');
            // Defer the call by one macrotask: GG's button click is still
            // bubbling at this point, and GRS's outside-click handler would
            // see the freshly-opened menu and close it immediately. Waiting
            // one tick lets the originating click finish propagating first.
            const picked = await new Promise((resolve) => setTimeout(resolve, 0))
                .then(() => grs.pickCharacter());
            if (!picked || typeof picked.chid !== 'number') {
                debugLog('[GroupSelection] GRS picker returned no selection.');
                return null;
            }
            // Normalise: prefer the locally-built member (it carries the
            // correct triggerArg, avatar and muted flag). Fall back to a
            // bare object if GRS reports a chid we don't know about.
            const matched = members.find(m => m.chid === picked.chid);
            return matched ?? {
                chid: picked.chid,
                name: typeof picked.name === 'string' && picked.name.length ? picked.name : String(picked.chid),
                avatar: null,
                muted: false,
                triggerArg: JSON.stringify(typeof picked.name === 'string' && picked.name.length ? picked.name : String(picked.chid)),
            };
        } catch (error) {
            console.warn(`[${extensionName}] GRS picker threw; falling back to GG selector.`, error);
        }
    }

    debugLog('[GroupSelection] Using GG fallback picker.');
    return ggFallbackPicker(members);
}
