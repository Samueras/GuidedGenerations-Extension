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
        let chid = characters.findIndex(c => c && c.avatar === memberAvatar);
        let character = chid !== -1 ? characters[chid] : null;

        // Fallback: match by name or clean avatar filename if path formats differ
        if (!character) {
            const cleanName = memberAvatar.replace(/\.[^/.]+$/, "");
            chid = characters.findIndex(c => c && (c.name === memberAvatar || c.name === cleanName || c.avatar?.includes(cleanName)));
            character = chid !== -1 ? characters[chid] : null;
        }

        const name = (character && typeof character.name === 'string' && character.name.length)
            ? character.name
            : memberAvatar.replace(/\.[^/.]+$/, "");

        members.push({
            chid: chid !== -1 ? chid : index,
            name,
            avatar: memberAvatar,
            muted: disabled.includes(memberAvatar),
            triggerArg: triggerArgFor(index, name),
        });
    });
    return members;
}

/**
 * GG's own picker popup. Builds a small dialog above the bottom toolbar with one row per
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
        /** @type {null | (() => void)} Cleanup for listeners attached while open. */
        let cleanup = null;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            if (cleanup) cleanup();
            container.remove();
            resolve(value);
        };

        // Transparent overlay container that anchors the dialog above the bottom toolbar
        // and captures outside clicks without darkening the screen.
        const container = document.createElement('div');
        container.className = 'gg-group-picker-container';
        Object.assign(container.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100vw',
            height: '100vh',
            zIndex: '99999',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            paddingBottom: '60px',
            boxSizing: 'border-box',
            pointerEvents: 'auto',
        });

        container.addEventListener('click', (e) => {
            if (e.target === container) {
                finish(null);
            }
        });

        const dialog = document.createElement('div');
        dialog.className = 'gg-group-picker-dialog';
        dialog.setAttribute('role', 'dialog');
        Object.assign(dialog.style, {
            width: '320px',
            maxWidth: '92vw',
            maxHeight: '48vh',
            backgroundColor: 'var(--SmartThemeBlurTintColor, #22262e)',
            color: 'var(--SmartThemeBodyColor, #ffffff)',
            border: '1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2))',
            borderRadius: '10px',
            padding: '12px',
            boxShadow: '0 6px 24px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxSizing: 'border-box',
        });

        const header = document.createElement('div');
        header.className = 'gg-group-picker-header';
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            paddingBottom: '6px',
        });

        const title = document.createElement('h3');
        title.textContent = 'Select member to respond as';
        Object.assign(title.style, {
            margin: '0',
            fontSize: '0.95em',
            fontWeight: '600',
            color: 'inherit',
        });

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'gg-group-picker-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.setAttribute('aria-label', 'Cancel');
        Object.assign(closeBtn.style, {
            background: 'none',
            border: 'none',
            fontSize: '1.4em',
            lineHeight: '1',
            cursor: 'pointer',
            color: 'inherit',
            padding: '0 4px',
            opacity: '0.8',
        });
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            finish(null);
        });
        header.append(title, closeBtn);

        const list = document.createElement('ul');
        list.className = 'gg-group-picker-list';
        Object.assign(list.style, {
            listStyle: 'none',
            margin: '0',
            padding: '0',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            maxHeight: '36vh',
        });

        for (const member of members) {
            const li = document.createElement('li');
            li.className = 'gg-group-picker-item';
            li.tabIndex = 0;
            if (member.muted) li.classList.add('gg-group-picker-item--muted');
            Object.assign(li.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 10px',
                borderRadius: '6px',
                cursor: 'pointer',
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                transition: 'background-color 0.15s ease',
                userSelect: 'none',
                opacity: member.muted ? '0.5' : '1',
            });

            li.addEventListener('pointerenter', () => {
                li.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
            });
            li.addEventListener('pointerleave', () => {
                li.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
            });

            const img = document.createElement('img');
            img.className = 'gg-group-picker-avatar';
            img.alt = '';
            Object.assign(img.style, {
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                objectFit: 'cover',
                flexShrink: '0',
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
            });
            if (member.avatar) {
                img.src = `/thumbnail?type=avatar&file=${encodeURIComponent(member.avatar)}`;
            }
            img.addEventListener('error', () => { img.style.visibility = 'hidden'; });

            const name = document.createElement('span');
            name.className = 'gg-group-picker-name';
            name.textContent = member.name + (member.muted ? ' (muted)' : '');
            Object.assign(name.style, {
                fontSize: '0.95em',
                fontWeight: '500',
                color: 'inherit',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            });

            li.append(img, name);

            const choose = (e) => {
                if (e) e.stopPropagation();
                finish(member);
            };
            li.addEventListener('click', choose);
            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    choose(e);
                }
            });
            list.appendChild(li);
        }

        dialog.append(header, list);
        container.append(dialog);
        document.body.append(container);

        // Adjust bottom padding dynamically so it floats right above the input bar
        const updateOffset = () => {
            const anchor = document.getElementById('gg-action-button-container') || document.getElementById('send_form');
            if (anchor) {
                const rect = anchor.getBoundingClientRect();
                const offset = Math.max(10, window.innerHeight - rect.top + 8);
                container.style.paddingBottom = `${offset}px`;
            }
        };
        updateOffset();
        window.addEventListener('resize', updateOffset);

        /** @param {KeyboardEvent} e */
        const onKeydown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                finish(null);
            }
        };
        document.addEventListener('keydown', onKeydown);

        cleanup = () => {
            document.removeEventListener('keydown', onKeydown);
            window.removeEventListener('resize', updateOffset);
        };

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
