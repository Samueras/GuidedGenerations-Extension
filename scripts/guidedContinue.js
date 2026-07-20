import { extension_settings, getContext, setPreviousImpersonateInput, getPreviousImpersonateInput, chat, eventSource, event_types, saveChatConditional, addOneMessage, getPromptValue, expandStMacros } from './persistentGuides/guideExports.js'; // Import from central hub

const extensionName = "GuidedGenerations-Extension";

// --- State variables for tracking guided continue operations ---
let isGuidedContinueInProgress = false;
let textOfMessageBeforeContinue = ''; // This remains a local state for the current operation
let indexOfMessageToModify = -1;

// Helper to manage deletion from extra object
const deleteFromExtra = (message, propertyName) => {
    if (message && message.extra) {
        delete message.extra[propertyName];
        if (Object.keys(message.extra).length === 0) {
            delete message.extra;
        }
    }
};

// --- Event Handler for when a message is rendered after our continue operation ---
const handleGuidedContinueCompletion = (messageIndex) => {
    if (!isGuidedContinueInProgress || messageIndex !== indexOfMessageToModify) {
        return;
    }

    const targetMessage = chat[messageIndex];
    if (!targetMessage) {
        console.error(`[${extensionName}][ContinueHandler] Target message at index ${messageIndex} not found.`);
        isGuidedContinueInProgress = false;
        indexOfMessageToModify = -1;
        return;
    }

    targetMessage.extra = targetMessage.extra || {}; // Ensure extra object exists

    // Calculate and store the last addition in extra
    if (typeof textOfMessageBeforeContinue === 'string' && typeof targetMessage.mes === 'string' && targetMessage.mes.startsWith(textOfMessageBeforeContinue)) {
        targetMessage.extra.lastGuidedAddition = targetMessage.mes.substring(textOfMessageBeforeContinue.length);
    } else {
        console.warn(`[${extensionName}][ContinueHandler] Message content changed unexpectedly. Cannot determine last addition.`);
        deleteFromExtra(targetMessage, 'lastGuidedAddition');
    }

    // Clear flags for the next operation
    isGuidedContinueInProgress = false;
    textOfMessageBeforeContinue = '';
    indexOfMessageToModify = -1;
    saveChatConditional(); // Save chat after updating message properties
};

const guidedContinue = async () => {
    const textarea = document.getElementById('send_textarea');
    if (!textarea) {
        console.error(`[${extensionName}][Continue] Textarea not found.`);
        return;
    }
    const originalInputFromTextarea = textarea.value;

    if (chat.length === 0) {
        console.warn(`[${extensionName}][Continue] No messages in chat to continue from.`);
        return;
    }

    indexOfMessageToModify = chat.length - 1; 
    const targetMessage = chat[indexOfMessageToModify];
    targetMessage.extra = targetMessage.extra || {}; 
    if (targetMessage.extra.originalForGuidedContinue === undefined) {
        targetMessage.extra.originalForGuidedContinue = targetMessage.mes;
    }
    textOfMessageBeforeContinue = targetMessage.mes;

    // Save input state from textarea (for restoring textarea content later)
    setPreviousImpersonateInput(originalInputFromTextarea);

    // --- Get Setting for prompt template ---
    // {{input}} and other ST macros are resolved by substituteParams via
    // expandStMacros; the textarea still holds the user's text at this point.
    const promptTemplate = await getPromptValue('promptGuidedContinue', '', {
        settings: extension_settings[extensionName],
    });
    let commandParameter;
    if (promptTemplate && promptTemplate.trim()) {
        commandParameter = expandStMacros(promptTemplate);
    } else {
        commandParameter = originalInputFromTextarea;
    }

    const stscriptCommand = `/continue await=true ${commandParameter} |`;
    if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
        const context = SillyTavern.getContext();
        try {
            isGuidedContinueInProgress = true; 
            await context.executeSlashCommandsWithOptions(stscriptCommand);
        } catch (error) {
            console.error(`[${extensionName}][Continue] Error executing Guided Continue stscript: ${error}`);
            isGuidedContinueInProgress = false; 
            indexOfMessageToModify = -1;
            textOfMessageBeforeContinue = '';
        } finally {
            const restoredInput = getPreviousImpersonateInput();
            textarea.value = restoredInput;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
    } else {
        console.error(`[${extensionName}][Continue] SillyTavern context is not available.`);
        const restoredInput = getPreviousImpersonateInput();
        textarea.value = restoredInput;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
};

// --- Functions for Undo and Revert ---
export async function undoLastGuidedAddition() {
    const context = getContext();
    const currentChat = chat; // Use the imported chat
    if (!currentChat || currentChat.length === 0) {
        console.warn(`[${extensionName}][Undo] Chat is empty or not found.`);
        return;
    }
    const targetMessage = currentChat[currentChat.length - 1];

    if (!targetMessage || !targetMessage.extra) {
        console.warn(`[${extensionName}][Undo] Target message or its extra data is not found.`);
        return;
    }

    if (typeof targetMessage.extra.lastGuidedAddition === 'string') {
        const lastAddition = targetMessage.extra.lastGuidedAddition;
        const currentMessageText = String(targetMessage.mes || '');
        const originalTextBeforeLastAddition = currentMessageText.slice(0, -lastAddition.length);
        
        targetMessage.mes = originalTextBeforeLastAddition;
        targetMessage.is_edited = true; // Mark as edited
        
        deleteFromExtra(targetMessage, 'lastGuidedAddition');
        
        eventSource.emit(event_types.MESSAGE_EDITED, currentChat.length - 1, { isUndoRedo: true, newMes: originalTextBeforeLastAddition });
        await saveChatConditional(true); 

        const freshContext = getContext(); // Ensure context is fresh
        if (freshContext && typeof freshContext.reloadCurrentChat === 'function') {
            freshContext.reloadCurrentChat();
        } else {
            console.warn(`[${extensionName}][Undo] reloadCurrentChat function not found or context is unavailable.`);
        }
    } else {
        console.warn(`[${extensionName}][Undo] No lastGuidedAddition found or not a string.`);
    }
}

export async function revertToOriginalGuidedContinue() {
    const context = getContext();
    const currentChat = chat; // Use the imported chat
    if (!currentChat || currentChat.length === 0) {
        console.warn(`[${extensionName}][Revert] Chat is empty or not found.`);
        return;
    }
    const targetMessage = currentChat[currentChat.length - 1];

    if (!targetMessage || !targetMessage.extra) {
        console.warn(`[${extensionName}][Revert] Target message or its extra data is not found.`);
        return;
    }

    if (typeof targetMessage.extra.originalForGuidedContinue === 'string') {
        const textToRevertTo = targetMessage.extra.originalForGuidedContinue; // Get it first!
        
        targetMessage.mes = textToRevertTo; // Use the local const
        targetMessage.is_edited = true; // Mark as edited
        
        deleteFromExtra(targetMessage, 'originalForGuidedContinue'); 
        deleteFromExtra(targetMessage, 'lastGuidedAddition');      
        
        eventSource.emit(event_types.MESSAGE_EDITED, currentChat.length - 1, { isUndoRedo: true, newMes: textToRevertTo }); // Use the local const
        await saveChatConditional(true);

        const freshContext = getContext(); // Ensure context is fresh
        if (freshContext && typeof freshContext.reloadCurrentChat === 'function') {
            freshContext.reloadCurrentChat();
        } else {
            console.warn(`[${extensionName}][Revert] reloadCurrentChat function not found or context is unavailable.`);
        }
    } else {
        console.warn(`[${extensionName}][Revert] No originalForGuidedContinue found or not a string.`);
    }
}

// --- Function to initialize event listeners (call this from index.js) ---
const initGuidedContinueListeners = () => {
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageIndex) => {
        if (isGuidedContinueInProgress && messageIndex === indexOfMessageToModify) {
            handleGuidedContinueCompletion(messageIndex);
        }
    });
};

export { guidedContinue, initGuidedContinueListeners };
