/**
 * @file Shared helpers for appending swipes to chat messages.
 *
 * Modern SillyTavern keeps TWO parallel arrays per message:
 *   - `swipes`:      the text of each swipe
 *   - `swipe_info`:  per-swipe metadata (send_date, gen_started/finished, extra)
 *
 * If you push to `swipes` without also pushing a matching entry to
 * `swipe_info`, ST logs "missing or invalid swipe_info for a swipe" and
 * backfills an empty object — which causes the displayed swipe to fall back
 * to stale `extra` (often the previous swipe's content). These helpers keep
 * the two arrays aligned and refresh `extra`/DOM/events the same way ST's
 * own `/swipe` command does.
 */

import { debugLog, extensionName } from '../persistentGuides/guideExports.js';

/**
 * Append a new swipe with `text` to `context.chat[messageIndex]`, switch to
 * it, refresh the DOM, emit MESSAGE_SWIPED, and save the chat.
 *
 * @param {object} context - SillyTavern context
 * @param {number} messageIndex - Index into context.chat
 * @param {string} text - The new swipe's text
 * @param {object} [options]
 * @param {string} [options.source='manual'] - Value stored in swipe_info.extra.api
 * @param {string} [options.model='GuidedGenerations'] - Value stored in swipe_info.extra.model
 * @returns {Promise<number>} The new swipe id, or -1 if the message could not be updated.
 */
export async function appendSwipeToMessage(context, messageIndex, text, options = {}) {
    const messageData = context?.chat?.[messageIndex];
    if (!messageData) {
        console.warn(`[${extensionName}] appendSwipeToMessage: no message at index ${messageIndex}`);
        return -1;
    }

    const { source = 'manual', model = 'GuidedGenerations' } = options;

    // Ensure swipes + swipe_info arrays exist and are aligned.
    if (!Array.isArray(messageData.swipes) || messageData.swipes.length === 0) {
        messageData.swipes = [messageData.mes ?? ''];
    }
    if (!Array.isArray(messageData.swipe_info) || messageData.swipe_info.length === 0) {
        messageData.swipe_info = messageData.swipes.map(() => ({}));
    }
    // If the two arrays somehow drifted out of sync, pad swipe_info so the
    // new entry lands at the right index.
    while (messageData.swipe_info.length < messageData.swipes.length) {
        messageData.swipe_info.push({});
    }

    const newSwipeId = messageData.swipes.length;

    messageData.swipes.push(text);
    messageData.swipe_info.push({
        send_date: getMessageTimeStamp(context),
        gen_started: null,
        gen_finished: null,
        extra: {
            bias: extractMessageBias(context, text),
            gen_id: Date.now(),
            api: source,
            model: model,
        },
    });

    // Persist any ad-hoc edits to the current swipe's extra before switching
    // away from it (mirrors ST's syncMesToSwipe before /swipe).
    syncCurrentSwipeExtra(context, messageData);

    messageData.swipe_id = newSwipeId;
    messageData.mes = text;

    // The visible message's extra should reflect the newly selected swipe.
    const newExtra = messageData.swipe_info?.[newSwipeId]?.extra;
    if (newExtra && typeof newExtra === 'object') {
        messageData.extra = structuredClone(newExtra);
    }

    refreshMessageDom(context, messageIndex);
    emitSwipeEvent(context, messageIndex);

    if (typeof context.saveChatConditional === 'function') {
        await context.saveChatConditional();
    } else if (typeof context.saveChat === 'function') {
        await context.saveChat();
    }

    debugLog(`[${extensionName}] appendSwipeToMessage: added swipe ${newSwipeId + 1} to message ${messageIndex}`);
    return newSwipeId;
}

function getMessageTimeStamp(context) {
    if (typeof context?.getMessageTimeStamp === 'function') {
        try { return context.getMessageTimeStamp(); } catch { /* fall through */ }
    }
    return new Date().toISOString();
}

function extractMessageBias(context, text) {
    if (typeof context?.extractMessageBias === 'function') {
        try { return context.extractMessageBias(text); } catch { /* fall through */ }
    }
    return null;
}

// Copy any in-flight DOM edits for the currently shown swipe back into its
// swipe_info entry, so we don't lose them when switching swipes. Mirrors ST's
// syncMesToSwipe(), but done best-effort since the ST helper isn't always exposed.
function syncCurrentSwipeExtra(context, messageData) {
    try {
        const currentId = Number.isInteger(messageData.swipe_id) ? messageData.swipe_id : 0;
        const currentInfo = messageData.swipe_info?.[currentId];
        if (currentInfo && messageData.extra && typeof messageData.extra === 'object') {
            currentInfo.extra = structuredClone(messageData.extra);
        }
    } catch {
        // Non-fatal: extra sync is best-effort.
    }
}

function refreshMessageDom(context, messageIndex) {
    const messageData = context?.chat?.[messageIndex];
    if (!messageData) return;
    const mesDom = document.querySelector(`#chat .mes[mesid="${messageIndex}"]`);
    if (!mesDom) return;

    if (typeof context.messageFormatting === 'function') {
        const mesTextElement = mesDom.querySelector('.mes_text');
        if (mesTextElement) {
            mesTextElement.innerHTML = context.messageFormatting(
                messageData.mes,
                messageData.name,
                messageData.is_system,
                messageData.is_user,
                messageIndex,
            );
        }
    }

    const total = messageData.swipes.length;
    const current = (messageData.swipe_id ?? 0) + 1;
    [...mesDom.querySelectorAll('.swipes-counter')].forEach((it) => {
        it.textContent = `${current}/${total}`;
    });
}

function emitSwipeEvent(context, messageIndex) {
    if (context?.eventSource && context?.event_types?.MESSAGE_SWIPED) {
        try {
            context.eventSource.emit(context.event_types.MESSAGE_SWIPED, messageIndex);
        } catch {
            // Non-fatal.
        }
    }
}
