/**
 * @file Automated consistency correction tool for the currently shown message.
 */
import {
    getContext,
    extension_settings,
    extensionName,
    debugLog,
    requestCompletion,
    shouldUseDirectCall,
    getPromptValue,
    fillPromptTemplate,
    generateNewSwipe,
} from '../persistentGuides/guideExports.js';
import { appendSwipeToMessage } from '../utils/swipeHelpers.js';

const INJECT_ID = 'separated_thinking';
const SCRIPT_PROMPT_KEY = 'script_inject_';
const INJECT_POSITION_CHAT = 1;
const INJECT_ROLE_SYSTEM = 0;

function getMessageText(messageData) {
    if (!messageData) return '';
    const swipes = Array.isArray(messageData.swipes) ? messageData.swipes : [];
    const swipeId = Number.isInteger(messageData.swipe_id) ? messageData.swipe_id : 0;
    return swipes[swipeId] ?? messageData.mes ?? '';
}

function buildChatHistoryBlock(chat = []) {
    return chat.map((message, index) => {
        const role = message?.is_system ? 'system' : message?.is_user ? 'user' : 'assistant';
        const name = message?.name ? ` ${message.name}` : '';
        return `[${index + 1}] ${role}${name}: ${getMessageText(message)}`;
    }).join('\n\n');
}

function getCurrentlyShownMessageIndex(context) {
    const lastMessageElement = document.querySelector('#chat .mes.last_mes');
    const domMessageId = Number(lastMessageElement?.getAttribute('mesid'));
    if (Number.isInteger(domMessageId) && domMessageId >= 0 && domMessageId < context.chat.length) {
        return domMessageId;
    }
    return context.chat.length - 1;
}

async function applySeparatedThinkingSwipe(context, messageIndex, correctedText) {
    await appendSwipeToMessage(context, messageIndex, correctedText, {
        source: 'manual',
        model: 'Guided Generations',
    });
}

// Inject the prompt as an ephemeral extension prompt (a "quiet" prompt) so the
// native generation sees it without it appearing in the chat log.
function setTemporaryInjection(context, value) {
    if (!context.chatMetadata.script_injects) {
        context.chatMetadata.script_injects = {};
    }
    context.chatMetadata.script_injects[INJECT_ID] = {
        value,
        position: INJECT_POSITION_CHAT,
        depth: 0,
        scan: true,
        role: INJECT_ROLE_SYSTEM,
        filter: null,
    };
    context.setExtensionPrompt?.(`${SCRIPT_PROMPT_KEY}${INJECT_ID}`, value, INJECT_POSITION_CHAT, 0, true, INJECT_ROLE_SYSTEM);
    context.saveMetadataDebounced?.();
}

function flushTemporaryInjection(context) {
    if (context.chatMetadata?.script_injects) {
        delete context.chatMetadata.script_injects[INJECT_ID];
    }
    context.setExtensionPrompt?.(`${SCRIPT_PROMPT_KEY}${INJECT_ID}`, '', INJECT_POSITION_CHAT, 0, true, INJECT_ROLE_SYSTEM);
    context.saveMetadataDebounced?.();
}

export default async function separatedThinking({ suppressAlerts = false } = {}) {
    const context = getContext();
    if (!context || !Array.isArray(context.chat) || context.chat.length === 0) {
        if (!suppressAlerts) {
            alert('No chat messages available for Separated Thinking.');
        }
        return;
    }

    const messageIndex = getCurrentlyShownMessageIndex(context);
    const messageData = context.chat[messageIndex];
    const targetMessage = getMessageText(messageData);
    if (!targetMessage.trim()) {
        if (!suppressAlerts) {
            alert('The currently shown message is empty.');
        }
        return;
    }

    const settings = extension_settings[extensionName] || {};
    const profileValue = settings.profileSeparatedThinking ?? '';
    const presetValue = settings.presetSeparatedThinking ?? '';
    const promptTemplate = await getPromptValue('promptSeparatedThinking', '', { settings });
    const chatHistory = buildChatHistoryBlock(context.chat);
    const promptForModel = fillPromptTemplate(promptTemplate, {
        chat: chatHistory,
        message: targetMessage,
        input: targetMessage,
        messageIndex: messageIndex + 1,
    });

    debugLog(`[SeparatedThinking] Using profile: ${profileValue || 'current'}, preset: ${presetValue || 'none'}`);

    try {
        const useDirectCall = await shouldUseDirectCall(profileValue, presetValue);

        if (useDirectCall) {
            // A profile/preset override is set: generate out-of-band via the
            // extension's direct LLM call and append the result as a swipe.
            const correctedText = await requestCompletion({
                profileName: profileValue,
                presetName: presetValue,
                prompt: promptForModel,
                debugLabel: 'separatedThinking',
                includeChatHistory: false,
            });

            if (!correctedText || !correctedText.trim()) {
                debugLog('[SeparatedThinking] No corrected text returned; skipping swipe append.');
                return;
            }

            await applySeparatedThinkingSwipe(context, messageIndex, correctedText);
        } else {
            // No override: use the user's currently active settings. Inject the
            // correction prompt as an ephemeral "quiet" prompt and trigger a
            // normal ST swipe generation, so the result lands as a proper swipe
            // with full swipe_info/extra handled by ST itself.
            setTemporaryInjection(context, promptForModel);
            try {
                const ok = await generateNewSwipe();
                if (!ok) {
                    debugLog('[SeparatedThinking] Native swipe generation did not complete.');
                }
            } finally {
                flushTemporaryInjection(context);
            }
        }
    } catch (error) {
        console.error('[GuidedGenerations][SeparatedThinking] Error:', error);
        if (!suppressAlerts) {
            alert(`Separated Thinking Error: ${error.message || 'An unexpected error occurred.'}`);
        }
    }
}

export { separatedThinking };
