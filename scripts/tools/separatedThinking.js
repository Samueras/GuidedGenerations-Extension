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
    getProfileApiType,
    getCurrentProfile,
    extractApiIdFromApiType,
    getPromptValue,
    fillPromptTemplate,
} from '../persistentGuides/guideExports.js';

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

function resolveCompletionMode(apiType, apiId) {
    const typeKey = String(apiId || apiType || '').toLowerCase();
    const textApiIds = new Set([
        'textgenerationwebui',
        'kobold',
        'koboldhorde',
        'novel',
        'novelai',
        'textgen',
        'text',
        'llamacpp',
    ]);
    return textApiIds.has(typeKey) ? 'text' : 'chat';
}

async function applySeparatedThinkingSwipe(context, messageIndex, correctedText) {
    const messageData = context.chat[messageIndex];
    if (!messageData) return;

    if (!Array.isArray(messageData.swipes)) {
        messageData.swipes = [messageData.mes];
    }

    messageData.swipes.push(correctedText);
    messageData.swipe_id = messageData.swipes.length - 1;
    messageData.mes = correctedText;

    const mesDom = document.querySelector(`#chat .mes[mesid="${messageIndex}"]`);
    if (mesDom && typeof context.messageFormatting === 'function') {
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
        [...mesDom.querySelectorAll('.swipes-counter')].forEach((it) => {
            it.textContent = `${messageData.swipe_id + 1}/${messageData.swipes.length}`;
        });
    }

    if (context.eventSource && context.event_types) {
        context.eventSource.emit(context.event_types.MESSAGE_SWIPED, messageIndex);
    }

    if (typeof context.saveChat === 'function') {
        await context.saveChat();
    }
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
        let correctedText = '';

        if (useDirectCall) {
            correctedText = await requestCompletion({
                profileName: profileValue,
                presetName: presetValue,
                prompt: promptForModel,
                debugLabel: 'separatedThinking',
                includeChatHistory: false,
            });
        } else if (typeof context.executeSlashCommandsWithOptions === 'function') {
            const effectiveProfile = profileValue || (await getCurrentProfile()) || '';
            const apiType = await getProfileApiType(effectiveProfile);
            const apiId = extractApiIdFromApiType(apiType) || apiType;
            const completionMode = resolveCompletionMode(apiType, apiId);
            const command = completionMode === 'text' ? '/gen' : '/genraw';
            const result = await context.executeSlashCommandsWithOptions(`${command} ${promptForModel}`, {
                showOutput: false,
                handleExecutionErrors: true,
            });
            correctedText = result?.pipe || '';
        }

        if (!correctedText || !correctedText.trim()) {
            debugLog('[SeparatedThinking] No corrected text returned; skipping swipe append.');
            return;
        }

        await applySeparatedThinkingSwipe(context, messageIndex, correctedText);
    } catch (error) {
        console.error('[GuidedGenerations][SeparatedThinking] Error:', error);
        if (!suppressAlerts) {
            alert(`Separated Thinking Error: ${error.message || 'An unexpected error occurred.'}`);
        }
    }
}

export { separatedThinking };
