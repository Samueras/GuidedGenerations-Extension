/**
 * @file Contains the logic for the Corrections tool.
 */
import {
    getContext,
    extension_settings,
    extensionName,
    debugLog,
    requestCompletion,
    shouldUseDirectCall,
    getProfileApiType,
    extractApiIdFromApiType,
    getPromptValue,
    fillPromptTemplate,
    deactivateSendButtons,
    activateSendButtons,
    setSendButtonState,
} from '../persistentGuides/guideExports.js';
import { appendSwipeToMessage } from '../utils/swipeHelpers.js';

let lastCorrectionInstruction = '';
const TEXT_API_IDS = new Set([
    'textgenerationwebui',
    'kobold',
    'koboldhorde',
    'novel',
    'novelai',
    'textgen',
    'text',
    'llamacpp',
]);

function resolveProfileByNameOrId(profileName, profiles = []) {
    if (!profileName) return null;
    return profiles.find((profile) => profile?.name === profileName || profile?.id === profileName) || null;
}

function resolveCompletionMode(profile, apiType, apiId) {
    const rawMode = profile?.mode ? String(profile.mode).toLowerCase() : '';
    if (rawMode.includes('text')) return 'text';
    if (rawMode.includes('chat')) return 'chat';

    const typeKey = (apiId || apiType || '').toLowerCase();
    if (TEXT_API_IDS.has(typeKey)) return 'text';
    return 'chat';
}

function buildChatHistoryBlock(chat = []) {
    return chat.map((message, index) => {
        const role = message?.is_system ? 'system' : message?.is_user ? 'user' : 'assistant';
        const name = message?.name ? ` ${message.name}` : '';
        const content = message?.mes || '';
        return `[${index + 1}] ${role}${name}: ${content}`;
    }).join('\n\n');
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

class CorrectionsPopup {
    constructor() {
        this.popupId = 'correctionsPopup';
        this.popupElement = null;
        this.initialized = false;
        this.messageIndex = null;
        this.swipeIndex = null;
        this.includeChatHistory = true;
        this.selectionStart = null;
        this.selectionEnd = null;
    }

    async init(parentElement = document.body) {
        if (this.initialized) return;

        const existing = document.getElementById(this.popupId);
        if (!existing) {
            const popupHtml = `
                <div id="${this.popupId}" class="gg-popup" style="display: none;">
                    <div class="gg-popup-content gg-corrections-popup-content">
                        <div class="gg-popup-header">
                            <h2>Corrections</h2>
                            <span class="gg-popup-close">&times;</span>
                        </div>
                        <div class="gg-popup-body">
                            <div class="gg-popup-section gg-corrections-nav">
                                <div class="gg-corrections-nav-row">
                                    <button type="button" id="ggCorrectionsPrevMessage" class="gg-button gg-button-secondary">Older</button>
                                    <div id="ggCorrectionsMessageInfo" class="gg-corrections-info">Message</div>
                                    <button type="button" id="ggCorrectionsNextMessage" class="gg-button gg-button-secondary">Newer</button>
                                </div>
                                <div class="gg-corrections-nav-row">
                                    <button type="button" id="ggCorrectionsPrevSwipe" class="gg-button gg-button-secondary">Prev Swipe</button>
                                    <div id="ggCorrectionsSwipeInfo" class="gg-corrections-info">Swipe</div>
                                    <button type="button" id="ggCorrectionsNextSwipe" class="gg-button gg-button-secondary">Next Swipe</button>
                                </div>
                            </div>
                            <div class="gg-popup-section">
                                <label for="ggCorrectionsMessage">Selected Message:</label>
                                <div class="gg-corrections-message-wrap">
                                    <div id="ggCorrectionsMessageOverlay" class="gg-corrections-message-overlay"></div>
                                    <textarea id="ggCorrectionsMessage" class="gg-corrections-message" rows="10" readonly></textarea>
                                </div>
                                <p class="gg-popup-note">Tip: highlight any part of this message to only edit the selection.</p>
                                <div id="ggCorrectionsSelectionInfo" class="gg-popup-note">No recorded selection.</div>
                            </div>
                            <div class="gg-popup-section">
                                <label for="ggCorrectionsInstruction">Correction Instructions:</label>
                                <textarea id="ggCorrectionsInstruction" rows="4" placeholder="Describe what should be changed..."></textarea>
                            </div>
                            <div class="gg-popup-section gg-setting-inline">
                                <input id="ggCorrectionsIncludeHistory" type="checkbox" checked>
                                <label for="ggCorrectionsIncludeHistory">Include chat history with the request</label>
                            </div>
                            <div class="gg-popup-section gg-popup-note">
                                When selecting text, the model will only rewrite the highlighted part. If nothing is selected, the entire message is rewritten.
                            </div>
                        </div>
                        <div class="gg-popup-footer">
                            <button type="button" id="ggCorrectionsApply" class="gg-button gg-button-primary">Apply Correction</button>
                            <button type="button" id="ggCorrectionsCancel" class="gg-button gg-button-secondary">Cancel</button>
                        </div>
                    </div>
                </div>
            `;
            parentElement.insertAdjacentHTML('beforeend', popupHtml);
        }

        this.popupElement = document.getElementById(this.popupId);
        if (!this.popupElement) {
            console.error('[GuidedGenerations][Corrections] Failed to create popup element.');
            return;
        }

        this.setupEventListeners();
        this.initialized = true;
    }

    setupEventListeners() {
        if (!this.popupElement) return;

        const closeButton = this.popupElement.querySelector('.gg-popup-close');
        const cancelButton = this.popupElement.querySelector('#ggCorrectionsCancel');
        const applyButton = this.popupElement.querySelector('#ggCorrectionsApply');
        const prevMessageButton = this.popupElement.querySelector('#ggCorrectionsPrevMessage');
        const nextMessageButton = this.popupElement.querySelector('#ggCorrectionsNextMessage');
        const prevSwipeButton = this.popupElement.querySelector('#ggCorrectionsPrevSwipe');
        const nextSwipeButton = this.popupElement.querySelector('#ggCorrectionsNextSwipe');
        const includeHistoryCheckbox = this.popupElement.querySelector('#ggCorrectionsIncludeHistory');
        const messageTextarea = this.popupElement.querySelector('#ggCorrectionsMessage');

        closeButton?.addEventListener('click', () => this.close());
        cancelButton?.addEventListener('click', () => this.close());
        applyButton?.addEventListener('click', () => this.applyCorrection());

        prevMessageButton?.addEventListener('click', () => this.changeMessage(-1));
        nextMessageButton?.addEventListener('click', () => this.changeMessage(1));
        prevSwipeButton?.addEventListener('click', () => this.changeSwipe(-1));
        nextSwipeButton?.addEventListener('click', () => this.changeSwipe(1));

        includeHistoryCheckbox?.addEventListener('change', (event) => {
            this.includeChatHistory = !!event.target.checked;
        });

        if (messageTextarea) {
            const recordSelection = () => this.recordSelection(messageTextarea);
            messageTextarea.addEventListener('mouseup', recordSelection);
            messageTextarea.addEventListener('keyup', recordSelection);
            messageTextarea.addEventListener('select', recordSelection);
            // While focused, the native (yellow-tinted) selection is authoritative —
            // hide the overlay so the two never compete.
            messageTextarea.addEventListener('focus', () => {
                this.hideOverlay();
                this.restoreSelection(messageTextarea);
            });
            // On blur, paint a permanent yellow highlight from the recorded range so
            // the selection stays visible while the user edits the instruction box.
            messageTextarea.addEventListener('blur', () => {
                this.renderPersistentHighlight(messageTextarea.value || '');
            });
            const syncOverlayScroll = () => this.syncOverlayScroll(messageTextarea);
            messageTextarea.addEventListener('scroll', syncOverlayScroll, { passive: true });
        }
    }

    open() {
        if (!this.initialized) {
            console.error('[GuidedGenerations][Corrections] Popup not initialized.');
            return;
        }

        const context = getContext();
        if (!context || !Array.isArray(context.chat) || context.chat.length === 0) {
            alert('No chat messages available to correct.');
            return;
        }

        this.messageIndex = context.chat.length - 1;
        this.swipeIndex = this._getDefaultSwipeIndex(context.chat[this.messageIndex]);

        const instructionTextarea = this.popupElement.querySelector('#ggCorrectionsInstruction');
        if (instructionTextarea) {
            instructionTextarea.value = lastCorrectionInstruction;
        }

        const includeHistoryCheckbox = this.popupElement.querySelector('#ggCorrectionsIncludeHistory');
        if (includeHistoryCheckbox) {
            includeHistoryCheckbox.checked = true;
            this.includeChatHistory = true;
        }

        this.updateMessageDisplay();
        this.popupElement.style.display = 'block';
        document.body.classList.add('gg-popup-open');
    }

    close() {
        if (this.popupElement) {
            this.popupElement.style.display = 'none';
            document.body.classList.remove('gg-popup-open');
        }
    }

    _getDefaultSwipeIndex(messageData) {
        if (!messageData) return 0;
        const swipeId = Number.isInteger(messageData.swipe_id) ? messageData.swipe_id : 0;
        const swipes = this._getSwipesForMessage(messageData);
        return Math.min(Math.max(swipeId, 0), Math.max(swipes.length - 1, 0));
    }

    _getSwipesForMessage(messageData) {
        if (!messageData) return [];
        if (Array.isArray(messageData.swipes) && messageData.swipes.length > 0) {
            return messageData.swipes;
        }
        return [messageData.mes || ''];
    }

    changeMessage(direction) {
        const context = getContext();
        if (!context || !Array.isArray(context.chat)) return;

        const newIndex = this.messageIndex + direction;
        if (newIndex < 0 || newIndex >= context.chat.length) return;

        this.messageIndex = newIndex;
        this.swipeIndex = this._getDefaultSwipeIndex(context.chat[this.messageIndex]);
        this.updateMessageDisplay();
    }

    changeSwipe(direction) {
        const context = getContext();
        if (!context || !Array.isArray(context.chat)) return;

        const messageData = context.chat[this.messageIndex];
        const swipes = this._getSwipesForMessage(messageData);
        const newIndex = this.swipeIndex + direction;
        if (newIndex < 0 || newIndex >= swipes.length) return;

        this.swipeIndex = newIndex;
        this.updateMessageDisplay();
    }

    updateMessageDisplay() {
        const context = getContext();
        if (!context || !Array.isArray(context.chat)) return;

        const messageData = context.chat[this.messageIndex];
        const swipes = this._getSwipesForMessage(messageData);
        const currentSwipe = swipes[this.swipeIndex] ?? messageData?.mes ?? '';

        const messageTextarea = this.popupElement.querySelector('#ggCorrectionsMessage');
        const messageInfo = this.popupElement.querySelector('#ggCorrectionsMessageInfo');
        const swipeInfo = this.popupElement.querySelector('#ggCorrectionsSwipeInfo');
        const prevMessageButton = this.popupElement.querySelector('#ggCorrectionsPrevMessage');
        const nextMessageButton = this.popupElement.querySelector('#ggCorrectionsNextMessage');
        const prevSwipeButton = this.popupElement.querySelector('#ggCorrectionsPrevSwipe');
        const nextSwipeButton = this.popupElement.querySelector('#ggCorrectionsNextSwipe');

        if (messageTextarea) messageTextarea.value = currentSwipe;
        if (messageInfo) messageInfo.textContent = `Message ${this.messageIndex + 1}/${context.chat.length}`;
        if (swipeInfo) swipeInfo.textContent = `Swipe ${this.swipeIndex + 1}/${swipes.length}`;

        if (prevMessageButton) prevMessageButton.disabled = this.messageIndex <= 0;
        if (nextMessageButton) nextMessageButton.disabled = this.messageIndex >= context.chat.length - 1;
        if (prevSwipeButton) prevSwipeButton.disabled = this.swipeIndex <= 0;
        if (nextSwipeButton) nextSwipeButton.disabled = this.swipeIndex >= swipes.length - 1;

        this.selectionStart = null;
        this.selectionEnd = null;
        this.updateSelectionIndicator();
        // Clear any persistent highlight from the previous message.
        this.hideOverlay();
        const overlay = this.popupElement?.querySelector('#ggCorrectionsMessageOverlay');
        if (overlay) overlay.innerHTML = '';
    }

    recordSelection(textarea) {
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        if (typeof start === 'number' && typeof end === 'number' && end > start) {
            this.selectionStart = start;
            this.selectionEnd = end;
            this.updateSelectionIndicator();
        }
    }

    restoreSelection(textarea) {
        if (!textarea) return;
        if (typeof this.selectionStart !== 'number' || typeof this.selectionEnd !== 'number') return;

        const maxLength = textarea.value.length;
        const start = Math.max(0, Math.min(this.selectionStart, maxLength));
        const end = Math.max(start, Math.min(this.selectionEnd, maxLength));
        if (end > start) {
            textarea.setSelectionRange(start, end);
        }
    }

    hideOverlay() {
        const overlay = this.popupElement?.querySelector('#ggCorrectionsMessageOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    showOverlay() {
        const overlay = this.popupElement?.querySelector('#ggCorrectionsMessageOverlay');
        if (overlay) overlay.style.display = 'block';
    }

    /**
     * Paint a permanent yellow highlight on the recorded range. Called on blur
     * so the selection stays visible while the user types in the instruction
     * field. Only the stored range is trusted (not live textarea indices, which
     * can be corrupted after blur).
     */
    renderPersistentHighlight(text) {
        const overlay = this.popupElement?.querySelector('#ggCorrectionsMessageOverlay');
        if (!overlay) return;

        const hasStored = typeof this.selectionStart === 'number'
            && typeof this.selectionEnd === 'number'
            && this.selectionEnd > this.selectionStart;

        if (!hasStored) {
            overlay.innerHTML = escapeHtml(text || '');
            overlay.style.display = 'none';
            return;
        }

        const start = Math.max(0, Math.min(this.selectionStart, text.length));
        const end = Math.max(start, Math.min(this.selectionEnd, text.length));
        const before = escapeHtml(text.slice(0, start));
        const selected = escapeHtml(text.slice(start, end));
        const after = escapeHtml(text.slice(end));
        overlay.innerHTML = `${before}<span class="gg-corrections-selection">${selected}</span>${after}`;
        overlay.style.display = 'block';
    }

    syncOverlayScroll(textarea) {
        const overlay = this.popupElement?.querySelector('#ggCorrectionsMessageOverlay');
        if (!overlay) return;
        if (textarea && typeof textarea.scrollTop === 'number') {
            overlay.scrollTop = textarea.scrollTop;
            overlay.scrollLeft = textarea.scrollLeft;
        }
    }

    updateSelectionIndicator() {
        const indicator = this.popupElement?.querySelector('#ggCorrectionsSelectionInfo');
        if (!indicator) return;

        if (typeof this.selectionStart === 'number' && typeof this.selectionEnd === 'number' && this.selectionEnd > this.selectionStart) {
            const length = this.selectionEnd - this.selectionStart;
            indicator.textContent = `Recorded selection: ${length} characters.`;
        } else {
            indicator.textContent = 'No recorded selection.';
        }
    }

    resolveSelection(baseMessage, textarea) {
        // Only trust live textarea indices while the field is focused. After blur,
        // browsers may report a corrupted range (often selectionStart=0).
        const isFocused = textarea && document.activeElement === textarea;
        if (isFocused) {
            const activeStart = textarea.selectionStart;
            const activeEnd = textarea.selectionEnd;
            const hasActive = typeof activeStart === 'number' && typeof activeEnd === 'number' && activeEnd > activeStart;
            if (hasActive) {
                return { start: activeStart, end: activeEnd, hasSelection: true };
            }
        }

        const storedStart = this.selectionStart;
        const storedEnd = this.selectionEnd;
        const hasStored = typeof storedStart === 'number' && typeof storedEnd === 'number' && storedEnd > storedStart;
        if (hasStored) {
            const boundedStart = Math.max(0, Math.min(storedStart, baseMessage.length));
            const boundedEnd = Math.max(boundedStart, Math.min(storedEnd, baseMessage.length));
            return { start: boundedStart, end: boundedEnd, hasSelection: boundedEnd > boundedStart };
        }

        return { start: 0, end: 0, hasSelection: false };
    }

    async applyCorrection() {
        const context = getContext();
        if (!context || !Array.isArray(context.chat)) {
            console.error('[GuidedGenerations][Corrections] No chat context available.');
            return;
        }

        const instructionTextarea = this.popupElement.querySelector('#ggCorrectionsInstruction');
        const messageTextarea = this.popupElement.querySelector('#ggCorrectionsMessage');

        const instruction = instructionTextarea?.value?.trim() || '';
        if (!instruction) {
            alert('Please provide correction instructions.');
            return;
        }

        lastCorrectionInstruction = instruction;
        this.close();

        const messageData = context.chat[this.messageIndex];
        if (!messageData) {
            console.error('[GuidedGenerations][Corrections] Selected message not found.');
            return;
        }

        const swipes = this._getSwipesForMessage(messageData);
        const baseMessage = swipes[this.swipeIndex] ?? messageData.mes ?? '';
        const { start: selectionStart, end: selectionEnd, hasSelection } = this.resolveSelection(baseMessage, messageTextarea);
        const selectedText = hasSelection ? baseMessage.slice(selectionStart, selectionEnd) : '';

        const profileKey = 'profileCorrections';
        const presetKey = 'presetCorrections';
        const profileValue = extension_settings[extensionName]?.[profileKey] ?? '';
        const targetPreset = extension_settings[extensionName]?.[presetKey] ?? '';

        const promptTemplate = await getPromptValue('promptCorrections', '', {
            settings: extension_settings[extensionName],
        });
        const filledPrompt = fillPromptTemplate(promptTemplate, { input: instruction });

        const profiles = context?.extensionSettings?.connectionManager?.profiles || [];
        const selectedProfileId = context?.extensionSettings?.connectionManager?.selectedProfile || '';
        let profile = resolveProfileByNameOrId(profileValue, profiles);
        if (!profile && selectedProfileId) {
            profile = profiles.find((entry) => entry?.id === selectedProfileId) || null;
        }
        const resolvedProfileName = profile?.name || profileValue || selectedProfileId || '';
        const apiType = profile?.api || (await getProfileApiType(resolvedProfileName));
        const apiId = extractApiIdFromApiType(apiType) || apiType;
        const completionMode = resolveCompletionMode(profile, apiType, apiId);
        const historyBlock = (this.includeChatHistory && completionMode === 'text')
            ? buildChatHistoryBlock(context.chat || [])
            : '';

        const taskTemplate = hasSelection
            ? await getPromptValue('corrections.selectedTextTask', '')
            : await getPromptValue('corrections.fullMessageTask', '');
        const promptForModel = fillPromptTemplate(taskTemplate, {
            instruction: filledPrompt,
            historyBlock: historyBlock ? `\n\nEarlier conversation history (oldest first; may be truncated by context limits):\n${historyBlock}\n\n--- End of history ---` : '',
            baseMessage,
            selectedText,
        });

        debugLog(`[GuidedGenerations][Corrections] Using profile: ${profileValue || 'current'}, preset: ${targetPreset || 'none'}`);

        try {
            const useDirectCall = await shouldUseDirectCall(profileValue, targetPreset);
            let correctedText = '';

            // Close the popup and lock the send button so the user sees that
            // a generation is in progress (matching spellchecker/requestCompletion behavior).
            this.close();
            setSendButtonState?.(true);
            deactivateSendButtons?.();

            try {
                if (useDirectCall) {
                    // Corrections embeds its own chat history directly into the
                    // prompt template (via {{historyBlock}}), so we pass
                    // includeChatHistory: false here to avoid duplicating it
                    // through the prompt manager. Identity context (char/user
                    // descriptions, scenario, world info) is still attached.
                    correctedText = await requestCompletion({
                        profileName: profileValue,
                        presetName: targetPreset,
                        prompt: promptForModel,
                        debugLabel: 'corrections',
                        includeChatHistory: false,
                        includeIdentityContext: true,
                    });
                } else if (typeof context.executeSlashCommandsWithOptions === 'function') {
                    const command = this.includeChatHistory ? '/gen' : '/genraw';
                    const result = await context.executeSlashCommandsWithOptions(`${command} ${promptForModel}`, {
                        showOutput: false,
                        handleExecutionErrors: true,
                    });
                    correctedText = result?.pipe || '';
                } else {
                    console.error('[GuidedGenerations][Corrections] context.executeSlashCommandsWithOptions not found.');
                }
            } finally {
                activateSendButtons?.();
                setSendButtonState?.(false);
                requestAnimationFrame(() => {
                    activateSendButtons?.();
                    setSendButtonState?.(false);
                });
            }

            if (!correctedText || correctedText.trim() === '') {
                console.error('[GuidedGenerations][Corrections] No corrected text received.');
                return;
            }

            const updatedMessage = hasSelection
                ? `${baseMessage.slice(0, selectionStart)}${correctedText}${baseMessage.slice(selectionEnd)}`
                : correctedText;

            await applyCorrectionSwipe(context, this.messageIndex, updatedMessage);
        } catch (error) {
            console.error('[GuidedGenerations][Corrections] Error during Corrections apply:', error);
            alert(`Corrections Tool Error: ${error.message || 'An unexpected error occurred.'}`);
        }
    }
}

const correctionsPopup = new CorrectionsPopup();

/**
 * Provides a tool to modify the last message based on user's instructions
 * 
 * @returns {Promise<void>}
 */
export default async function corrections() {
    debugLog('[GuidedGenerations][Corrections] Tool activated.');
    if (!correctionsPopup.initialized) {
        await correctionsPopup.init();
    }
    correctionsPopup.open();
}

/**
 * Helper function to execute ST-Script commands
 * @param {string} stscript - The ST-Script command to execute
 */
async function applyCorrectionSwipe(context, messageIndex, correctedText) {
    await appendSwipeToMessage(context, messageIndex, correctedText, {
        source: 'manual',
        model: 'Guided Generations',
    });

    // Refresh swipe UI (chevrons) so the user can navigate between the
    // original and the new correction swipe. Without this, the back-chevron
    // may not appear when correcting the first pass of a message.
    try {
        if (context?.swipe?.refresh && typeof context.swipe.refresh === 'function') {
            context.swipe.refresh(true, false);
        }
    } catch (refreshError) {
        debugLog('[GuidedGenerations][Corrections] Could not refresh swipe buttons:', refreshError);
    }
}

// Export the function
export { corrections };
