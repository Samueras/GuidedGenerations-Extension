/**
 * @file Automated consistency correction tool for the currently shown message.
 */
import {
    getContext,
    extension_settings,
    extensionName,
    debugLog,
    generateNewSwipe,
    handleSwitching,
} from '../persistentGuides/guideExports.js';

const SCRIPT_PROMPT_KEY = 'script_inject_';
const INJECT_POSITIONS = {
    chat: 1,
};
const INJECT_ROLES = {
    system: 0,
    user: 1,
    assistant: 2,
};

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

function fillPromptTemplate(template, replacements) {
    return Object.entries(replacements).reduce((result, [key, value]) => {
        return result.replaceAll(`{{${key}}}`, String(value ?? ''));
    }, template);
}

function setTemporaryInjection(context, id, value, { position = INJECT_POSITIONS.chat, depth = 0, scan = true, role = INJECT_ROLES.system } = {}) {
    if (!context.chatMetadata.script_injects) {
        context.chatMetadata.script_injects = {};
    }

    context.chatMetadata.script_injects[id] = { value, position, depth, scan, role, filter: null };
    context.setExtensionPrompt?.(`${SCRIPT_PROMPT_KEY}${id}`, value, position, depth, scan, role);
    context.saveMetadataDebounced?.();
}

function flushTemporaryInjection(context, id) {
    const existingInject = context.chatMetadata?.script_injects?.[id];
    const position = existingInject?.position ?? INJECT_POSITIONS.chat;
    const depth = existingInject?.depth ?? 0;
    const scan = existingInject?.scan ?? true;
    const role = existingInject?.role ?? INJECT_ROLES.system;

    if (context.chatMetadata?.script_injects) {
        delete context.chatMetadata.script_injects[id];
    }

    context.setExtensionPrompt?.(`${SCRIPT_PROMPT_KEY}${id}`, '', position, depth, scan, role);
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
    const injectionRole = settings.injectionEndRole ?? 'system';
    const role = INJECT_ROLES[String(injectionRole).toLowerCase()] ?? INJECT_ROLES.system;
    const promptTemplate = settings.promptSeparatedThinking ?? '';
    const chatHistory = buildChatHistoryBlock(context.chat);
    const promptForModel = fillPromptTemplate(promptTemplate, {
        chat: chatHistory,
        message: targetMessage,
        input: targetMessage,
        messageIndex: messageIndex + 1,
    });

    debugLog(`[SeparatedThinking] Using profile: ${profileValue || 'current'}, preset: ${presetValue || 'none'}`);

    let switching = null;
    let injectionSet = false;
    try {
        switching = await handleSwitching(profileValue, presetValue);
        setTemporaryInjection(context, 'instruct', promptForModel, { role });
        injectionSet = true;
        await switching.switch();
        await generateNewSwipe();
    } catch (error) {
        console.error('[GuidedGenerations][SeparatedThinking] Error:', error);
        if (!suppressAlerts) {
            alert(`Separated Thinking Error: ${error.message || 'An unexpected error occurred.'}`);
        }
    } finally {
        if (injectionSet) {
            flushTemporaryInjection(context, 'instruct');
        }
        await switching?.restore();
    }
}

export { separatedThinking };
