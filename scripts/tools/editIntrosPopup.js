/**
 * Edit Intros Popup - Handles UI for editing character intros with various formatting options
 */

import {
    extensionName,
    getContext,
    extension_settings,
    debugLog,
    requestCompletion,
    shouldUseDirectCall,
    generateNewSwipe,
    activateSendButtons,
    setSendButtonState,
    getPromptObject,
    getPromptValue,
    fillPromptTemplate,
    expandStMacros,
} from '../persistentGuides/guideExports.js'; // Import from central hub
import { appendSwipeToMessage } from '../utils/swipeHelpers.js';

// Class to handle the popup functionality
export class EditIntrosPopup {
    constructor() {
        // Initialize state for multiple selections
        this.selectedOptions = { 
            perspective: [], 
            tense: [], 
            style: [], 
            gender: [] 
        };
        this.isCustomSelected = false; // Track if custom option is active
        this.popupElement = null;
        this.initialized = false;
        this.lastCustomCommand = sessionStorage.getItem('gg_lastCustomCommand') || ''; // Load last command
        // Track how many times applyChanges is called
        this.applyChangesCount = 0;
    }

    /**
     * Initialize the popup
     */
    async init() {
        if (this.initialized) return;

        // Helper function to generate option HTML (to reduce repetition)
        function generateOptionHtml(category, optionKey, title) {
            return `<div class="gg-option" data-category="${category}" data-option="${optionKey}">
                        <span class="gg-option-title">${title}</span>
                    </div>`;
        }

        function generateSubOptionHtml(category, value, title) {
            return `<div class="gg-suboption" data-category="${category}" data-value="${value}">${title}</div>`;
        }

        // Create popup container if it doesn't exist
        if (!document.getElementById('editIntrosPopup')) {
            // Create the popup container
            const popupHtml = `
                <div id="editIntrosPopup" class="gg-popup">
                    <div class="gg-popup-content">
                        <div class="gg-popup-header">
                            <h2>Edit Intros</h2>
                            <span class="gg-popup-close">&times;</span>
                        </div>
                        <div class="gg-popup-body">
                            <!-- Perspective Section -->
                            <div class="gg-popup-section">
                                <h3>Perspective</h3>
                                <div class="gg-option-group">
                                    <div class="gg-option" data-category="perspective" data-option="first-person"> <!-- Grouping Option -->
                                        <span class="gg-option-title">First Person</span>
                                        <div class="gg-suboptions">
                                            ${generateSubOptionHtml('perspective', 'first-person-standard', 'I/me (standard 1st person)')}
                                            ${generateSubOptionHtml('perspective', 'first-person-by-name', '{{user}} by name')}
                                            ${generateSubOptionHtml('perspective', 'first-person-as-you', '{{user}} as you')}
                                            ${generateSubOptionHtml('perspective', 'first-person-he-him', '{{user}} as he/him')}
                                            ${generateSubOptionHtml('perspective', 'first-person-she-her', '{{user}} as she/her')}
                                            ${generateSubOptionHtml('perspective', 'first-person-they-them', '{{user}} as they/them')}
                                        </div>
                                    </div>
                                    <div class="gg-option" data-category="perspective" data-option="second-person"> <!-- Grouping Option -->
                                        <span class="gg-option-title">Second Person</span>
                                        <div class="gg-suboptions">
                                            ${generateSubOptionHtml('perspective', 'second-person-as-you', '{{user}} as you')}
                                        </div>
                                    </div>
                                    <div class="gg-option" data-category="perspective" data-option="third-person"> <!-- Grouping Option -->
                                        <span class="gg-option-title">Third Person</span>
                                        <div class="gg-suboptions">
                                            ${generateSubOptionHtml('perspective', 'third-person-by-name', '{{user}} by name and pronouns')}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Tense Section -->
                            <div class="gg-popup-section">
                                <h3>Tense</h3>
                                <div class="gg-option-group">
                                    ${generateOptionHtml('tense', 'past-tense', 'Past Tense')}
                                    ${generateOptionHtml('tense', 'present-tense', 'Present Tense')}
                                </div>
                            </div>

                            <!-- Style Section -->
                            <div class="gg-popup-section">
                                <h3>Style</h3>
                                <div class="gg-option-group">
                                    ${generateOptionHtml('style', 'novella-style', 'Novella Style')}
                                    ${generateOptionHtml('style', 'internet-rp-style', 'Internet RP Style')}
                                    ${generateOptionHtml('style', 'literary-style', 'Literary Style')}
                                    ${generateOptionHtml('style', 'script-style', 'Script Style')}
                                </div>
                            </div>

                            <!-- Gender Section -->
                            <div class="gg-popup-section">
                                <h3>Gender (for {{user}})</h3>
                                <div class="gg-option-group">
                                    ${generateOptionHtml('gender', 'he-him', 'He/Him')}
                                    ${generateOptionHtml('gender', 'she-her', 'She/Her')}
                                    ${generateOptionHtml('gender', 'they-them', 'They/Them')}
                                </div>
                            </div>

                            <!-- Custom Command Section -->
                            <div class="gg-popup-section gg-custom-command-section">
                                <h3>Custom</h3>
                                <div class="gg-option gg-custom-option" data-category="custom" data-option="custom"> <!-- Added category -->
                                    <span class="gg-option-title">Use Custom Instruction Below</span>
                                </div>
                                <textarea id="gg-custom-edit-command" placeholder="Enter custom rewrite instruction here...">${this.lastCustomCommand}</textarea>
                            </div>
                        </div>
                        <div class="gg-popup-footer">
                            <button id="ggCancelEditIntros" class="gg-button gg-button-secondary">Cancel</button>
                            <button id="ggMakeNewIntro" class="gg-button gg-button-primary">Make New Intro</button>
                            <button id="ggApplyEditIntros" class="gg-button gg-button-primary">Edit Intro</button>
                        </div>
                    </div>
                </div>
            `;

            // Append to body
            const popupContainer = document.createElement('div');
            popupContainer.innerHTML = popupHtml;
            document.body.appendChild(popupContainer.firstElementChild);
        }

        // Get the popup element reference
        this.popupElement = document.getElementById('editIntrosPopup');

        // Setup event listeners
        this.setupEventListeners();

        this.initialized = true;
    }

    /**
     * Setup event listeners for the popup elements
     */
    setupEventListeners() {
        if (!this.popupElement) return;

        const closeButton = this.popupElement.querySelector('.gg-popup-close');
        const cancelButton = this.popupElement.querySelector('#ggCancelEditIntros');
        const applyButton = this.popupElement.querySelector('#ggApplyEditIntros');
        const makeNewIntroButton = this.popupElement.querySelector('#ggMakeNewIntro');
        const options = this.popupElement.querySelectorAll('.gg-option:not(.gg-custom-option)'); // Exclude custom
        const suboptions = this.popupElement.querySelectorAll('.gg-suboption');
        const customOption = this.popupElement.querySelector('.gg-custom-option');
        const customCommandTextarea = this.popupElement.querySelector('#gg-custom-edit-command');

        // Close/Cancel Actions
        closeButton.addEventListener('click', () => this.close());
        cancelButton.addEventListener('click', () => this.close());

        // Apply/Make New Actions
        applyButton.addEventListener('click', () => this.applyChanges());
        makeNewIntroButton.addEventListener('click', () => this.makeNewIntro());

        // --- Category Option/Suboption Click Logic ---
        const handleCategorySelection = (element) => {
            const category = element.dataset.category;
            const value = element.dataset.value || element.dataset.option; // Use data-value for suboptions, data-option for options

            const selected = element.classList.toggle('selected');
            const selectedValues = Array.isArray(this.selectedOptions[category])
                ? [...this.selectedOptions[category]]
                : this.selectedOptions[category]
                    ? [this.selectedOptions[category]]
                    : [];

            if (element.classList.contains('gg-suboption')) {
                const parentOption = element.closest('.gg-option');
                const hasSelectedSuboption = !!parentOption?.querySelector('.gg-suboption.selected');
                parentOption?.classList.toggle('selected', hasSelectedSuboption);
            }

            if (selected) {
                if (!selectedValues.includes(value)) {
                    selectedValues.push(value);
                }
            } else {
                const existingIndex = selectedValues.indexOf(value);
                if (existingIndex !== -1) {
                    selectedValues.splice(existingIndex, 1);
                }
            }

            this.selectedOptions[category] = selectedValues;
        };

        options.forEach(option => {
            // Handle clicks on main options that DON'T have suboptions
            if (!option.querySelector('.gg-suboptions')) {
                option.addEventListener('click', (event) => {
                    // Prevent triggering if click was on the suboptions container itself
                    if (event.target.closest('.gg-suboptions')) return; 
                    handleCategorySelection(option);
                 });
            }
            // We don't need listeners on parent options with suboptions, only the suboptions themselves
        });

        suboptions.forEach(suboption => {
            suboption.addEventListener('click', () => {
                handleCategorySelection(suboption);
            });
        });

        // --- Custom Option Click Logic ---
        customOption.addEventListener('click', () => {
            this.isCustomSelected = !this.isCustomSelected;
            customOption.classList.toggle('selected', this.isCustomSelected);
        });

        // --- Custom Textarea Input Logic ---
        customCommandTextarea.addEventListener('input', () => {
             // Automatically enable custom instructions if user types.
            if (!this.isCustomSelected && customCommandTextarea.value.trim() !== '') {
                this.isCustomSelected = true;
                customOption.classList.add('selected');
            }
        });
    }

    async getSelectedInstructions() {
        const optionPrompts = await getPromptObject('editIntros.options', {});
        const selectedKeys = Object.values(this.selectedOptions).flatMap(value => {
            if (Array.isArray(value)) {
                return value;
            }
            return value ? [value] : [];
        });

        return selectedKeys
            .map(key => optionPrompts[key])
            .filter(Boolean);
    }

    deselectAllPresets() {
        this.popupElement.querySelectorAll('.gg-option:not(.gg-custom-option), .gg-suboption').forEach(el => {
            el.classList.remove('selected');
        });
        this.popupElement.querySelector('.gg-custom-option')?.classList.remove('selected');
        Object.keys(this.selectedOptions).forEach(key => {
            this.selectedOptions[key] = [];
        });
        this.isCustomSelected = false;
    }

    restoreSelectionState() {
        const customOption = this.popupElement.querySelector('.gg-custom-option');
        Object.values(this.selectedOptions).flatMap(value => Array.isArray(value) ? value : [value]).forEach(selectedKey => {
            if (!selectedKey) return;
            const selectedElement = this.popupElement.querySelector(`[data-option="${selectedKey}"], [data-value="${selectedKey}"]`);
            selectedElement?.classList.add('selected');
            selectedElement?.closest('.gg-option')?.classList.add('selected');
        });
        customOption?.classList.toggle('selected', this.isCustomSelected);
    }

    /**
     * Resets the selection state both visually and in the internal state object,
     * but preserves the custom command text.
     */
    _resetSelections() {
        // Reset state variables
        this.isCustomSelected = false;
        Object.keys(this.selectedOptions).forEach(key => {
            this.selectedOptions[key] = [];
        });

        // Reset visual state
        this.popupElement.querySelectorAll('.gg-option.selected, .gg-suboption.selected').forEach(el => {
            el.classList.remove('selected');
        });
        // Ensure custom is visually deselected too
        this.popupElement.querySelector('.gg-custom-option')?.classList.remove('selected');
        
        // NOTE: We intentionally do NOT clear the custom command textarea here.
    }

    /**
     * Open the popup
     */
    open() {
        if (!this.initialized) {
            this.init().then(() => {
                if (this.popupElement) {
                    this.popupElement.style.display = 'block';
                }
            });
        } else if (this.popupElement) {
            this.popupElement.style.display = 'block';
        }
    }

    /**
     * Close the popup
     */
    close() {
        if (this.popupElement) {
            this.popupElement.style.display = 'none';
        }
        // Reset selections when closing
        this._resetSelections();
    }

    /**
     * Apply the selected changes
     */
    async applyChanges() {
        // Increment and log invocation count
        this.applyChangesCount++;
        let instruction = '';
        const customCommandTextarea = this.popupElement.querySelector('#gg-custom-edit-command');
        const customCommand = customCommandTextarea.value.trim();
        const selectedInstructions = await this.getSelectedInstructions();

        // --- Build Instruction ---
        if (this.isCustomSelected && customCommand) {
            selectedInstructions.push(customCommand);
            instruction = customCommand;
            sessionStorage.setItem('gg_lastCustomCommand', customCommand);
        }

        if (selectedInstructions.length === 0) {
             alert('Please select at least one category option and/or add custom instructions.');
             return;
        }
        instruction = selectedInstructions.join('. ');

        // Close the popup immediately now that validation has passed
        this.close();

        const textareaElement = document.getElementById('send_textarea');
        const customEdit = textareaElement ? textareaElement.value.trim() : '';

        const introPresetSettingKey = 'presetEditIntros';
        const presetValue = extension_settings[extensionName]?.[introPresetSettingKey] ?? '';
        const profileValue = extension_settings[extensionName]?.profileEditIntros ?? '';

        try {
            const context = getContext();
            if (!context || !context.chat || context.chat.length === 0) {
                console.error('[GuidedGenerations] No intro message available to edit.');
                return;
            }

            const messageToRewrite = context.chat[0]?.mes || '';
            const promptTemplate = await getPromptValue('editIntros.editExisting', '');
            const promptForModel = expandStMacros(fillPromptTemplate(promptTemplate, {
                instruction,
                messageToRewrite,
            }));

            const useDirectCall = await shouldUseDirectCall(profileValue, presetValue);
            let updatedIntro = '';
            if (useDirectCall) {
                debugLog('[EditIntros] Requesting direct completion for intro edit...');
                updatedIntro = await requestCompletion({
                    profileName: profileValue,
                    presetName: presetValue,
                    prompt: promptForModel,
                    debugLabel: 'editIntros:edit',
                    includeChatHistory: false,
                });
            } else if (typeof context.executeSlashCommandsWithOptions === 'function') {
                const swipeHandled = await executeSwipeGenerationWithPrompt(context, promptForModel);
                if (swipeHandled) {
                    return;
                }
            } else {
                console.error('[GuidedGenerations] context.executeSlashCommandsWithOptions not found!');
            }

            if (!updatedIntro || updatedIntro.trim() === '') {
                console.error('[GuidedGenerations] No updated intro text received.');
                return;
            }

            await applyIntroUpdate(context, updatedIntro);
        } catch (error) {
            console.error('[GuidedGenerations] Error executing Edit Intros request:', error);
        }

        if (customEdit && textareaElement) {
            textareaElement.value = '';
        }
    }

    /**
     * Creates a new intro based on the selected option or custom instruction.
     */
    async makeNewIntro() {
        let instruction = '';
        const customCommandTextarea = this.popupElement.querySelector('#gg-custom-edit-command');
        const customCommand = customCommandTextarea.value.trim();
        const selectedInstructions = await this.getSelectedInstructions();

        // --- Build Instruction (Same logic as applyChanges) ---
        if (this.isCustomSelected && customCommand) {
            selectedInstructions.push(customCommand);
            instruction = customCommand;
            sessionStorage.setItem('gg_lastCustomCommand', customCommand);
        }

        if (selectedInstructions.length === 0) {
             alert('Please select at least one category option and/or add custom instructions.');
             return;
        }
        instruction = selectedInstructions.join('. ');

        // Close the popup immediately now that validation has passed
        this.close();

        const introPresetSettingKey = 'presetEditIntros';
        const presetValue = extension_settings[extensionName]?.[introPresetSettingKey] ?? '';
        const profileValue = extension_settings[extensionName]?.profileEditIntros ?? '';

        try {
            const context = getContext();
            if (!context) {
                console.error('[GuidedGenerations] Context unavailable for intro generation.');
                return;
            }

            const promptTemplate = await getPromptValue('editIntros.makeNew', '');
            const promptForModel = expandStMacros(fillPromptTemplate(promptTemplate, { instruction }));
            const useDirectCall = await shouldUseDirectCall(profileValue, presetValue);
            let newIntro = '';
            if (useDirectCall) {
                debugLog('[EditIntros] Requesting direct completion for new intro...');
                newIntro = await requestCompletion({
                    profileName: profileValue,
                    presetName: presetValue,
                    prompt: promptForModel,
                    debugLabel: 'editIntros:new',
                    includeChatHistory: false,
                });
            } else if (typeof context.executeSlashCommandsWithOptions === 'function') {
                const swipeHandled = await executeSwipeGenerationWithPrompt(context, promptForModel);
                if (swipeHandled) {
                    return;
                }
            } else {
                console.error('[GuidedGenerations] context.executeSlashCommandsWithOptions not found!');
            }

            if (!newIntro || newIntro.trim() === '') {
                console.error('[GuidedGenerations] No new intro text received.');
                return;
            }

            await applyIntroUpdate(context, newIntro);
        } catch (error) {
            console.error('[GuidedGenerations] Error executing Make New Intro request:', error);
        }
    }

}

async function applyIntroUpdate(context, introText) {
    const targetIndex = context?.chat?.length ? 0 : -1;
    const characterName = context?.characters?.[context.characterId]?.name || 'Assistant';

    if (targetIndex === -1) {
        const message = {
            name: characterName,
            is_user: false,
            is_system: false,
            send_date: Date.now(),
            mes: introText,
            force_avatar: null,
            extra: {
                type: 'intro',
                gen_id: Date.now(),
            },
        };
        context.chat.push(message);
        await context.eventSource.emit('MESSAGE_SENT', context.chat.length - 1);
        if (typeof context.addOneMessage === 'function') {
            await context.addOneMessage(message);
        }
        await context.eventSource.emit('USER_MESSAGE_RENDERED', context.chat.length - 1);
        if (typeof context.saveChat === 'function') {
            await context.saveChat();
        }
        return;
    }

    const messageData = context.chat[targetIndex];
    if (!messageData) {
        console.error('[GuidedGenerations] Could not find intro message to update.');
        return;
    }

    await appendSwipeToMessage(context, targetIndex, introText, {
        source: 'manual',
        model: 'Guided Generations',
    });
}

// Singleton instance
const editIntrosPopup = new EditIntrosPopup();
export default editIntrosPopup;

const SCRIPT_PROMPT_KEY = 'script_inject_';
const INJECT_POSITIONS = {
    chat: 1,
};
const INJECT_ROLES = {
    system: 0,
    user: 1,
    assistant: 2,
};

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

async function executeSwipeGenerationWithPrompt(context, promptText) {
    const injectionRole = extension_settings[extensionName]?.injectionEndRole ?? 'system';
    const role = INJECT_ROLES[String(injectionRole).toLowerCase()] ?? INJECT_ROLES.system;
    const filledPrompt = String(promptText || '');
    const tempMessage = {
        name: 'Editing Greeting',
        is_user: false,
        is_system: false,
        send_date: Date.now(),
        mes: 'Editing Greeting',
        swipes: ['Editing Greeting'],
        swipe_id: 0,
        force_avatar: null,
        extra: {
            type: 'temp_intro_edit',
            gen_id: Date.now(),
        },
    };

    // Insert deterministically at index 0 so generateNewSwipe targets intro, not temp.
    context.chat.unshift(tempMessage);
    if (typeof context.saveChat === 'function') {
        await context.saveChat();
    }
    if (typeof context.reloadCurrentChat === 'function') {
        await context.reloadCurrentChat();
    }

    let tempInserted = true;
    try {
        await context.executeSlashCommandsWithOptions('/hide 0', {
            showOutput: false,
            handleExecutionErrors: true,
        });

        setTemporaryInjection(context, 'instruct', filledPrompt, { role });

        const swipeSuccess = await generateNewSwipe();
        if (!swipeSuccess) {
            return false;
        }
        return true;
    } finally {
        flushTemporaryInjection(context, 'instruct');

        if (tempInserted) {
            if (context.chat[0] === tempMessage) {
                context.chat.splice(0, 1);
            } else {
                const fallbackIndex = context.chat.findIndex((message) => message?.extra?.gen_id === tempMessage.extra.gen_id);
                if (fallbackIndex !== -1) {
                    context.chat.splice(fallbackIndex, 1);
                }
            }
            if (typeof context.saveChat === 'function') {
                await context.saveChat();
            }
            if (typeof context.reloadCurrentChat === 'function') {
                await context.reloadCurrentChat();
            }
            // reloadCurrentChat rebuilds UI; generation may have left send/stop controls hidden — resync explicitly
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            try {
                activateSendButtons?.();
                setSendButtonState?.(false);
            } catch (_) {
                /* ignore if SillyTavern API differs */
            }
            debugLog('[EditIntros] Removed temporary "Editing Greeting" message after swipe generation.');
        }
    }
}
