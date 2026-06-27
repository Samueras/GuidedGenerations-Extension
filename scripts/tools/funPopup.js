/**
 * Fun Popup - Handles UI for fun prompts and interactions
 */

import { getContext, extension_settings, extensionName, debugLog, requestCompletion, shouldUseDirectCall, generateNewSwipe, getPromptValue, fillPromptTemplate } from '../persistentGuides/guideExports.js'; // Import from central hub

// Map to store fun prompts loaded from file
let FUN_PROMPTS = {};

/**
 * Load fun prompts from the text file
 */
async function loadFunPrompts() {
    try {
        // Use the correct path for SillyTavern extensions
        const presetPath = `scripts/extensions/third-party/GuidedGenerations-Extension/scripts/tools/funPrompts.txt`;
        
        const response = await fetch(presetPath);
        
        if (!response.ok) {
            console.error(`${extensionName}: Failed to load fun prompts file. Status: ${response.status}`);
            if (response.status === 404) {
                console.error(`${extensionName}: Make sure 'funPrompts.txt' exists in the extension folder.`);
            }
            return;
        }
        
        debugLog(`${extensionName}: Successfully loaded fun prompts from:`, presetPath);
        
        const text = await response.text();
        const lines = text.split('\n').filter(line => line.trim() && !line.startsWith('#'));
        
        FUN_PROMPTS = {};
        
        lines.forEach(line => {
            const parts = line.split('|');
            if (parts.length >= 4) {
                const [key, title, description, prompt] = parts;
                FUN_PROMPTS[key.trim()] = {
                    title: title.trim(),
                    description: description.trim(),
                    prompt: prompt.trim()
                };
            }
        });
        
        debugLog(`${extensionName}: Loaded ${Object.keys(FUN_PROMPTS).length} fun prompts from file`);
    } catch (error) {
        console.error(`${extensionName}: Error loading fun prompts:`, error);
        // Fallback to empty prompts if file can't be loaded
        FUN_PROMPTS = {};
    }
}

// Class to handle the popup functionality
export class FunPopup {
    constructor() {
        this.popupElement = null;
        this.initialized = false;
    }

    /**
     * Initialize the popup
     */
    async init() {
        if (this.initialized) return;

        // Load prompts from file first
        await loadFunPrompts();

        // Create popup container if it doesn't exist
        if (!document.getElementById('funPopup')) {
            const funPromptsHtml = Object.entries(FUN_PROMPTS).map(([key, { title, description }]) => `
                <div class="gg-fun-prompt-row">
                    <button type="button" class="gg-fun-button" data-prompt="${key}">${title}</button>
                    <span class="gg-fun-prompt-description">${description}</span>
                </div>
            `).join('');

            const popupHtml = `
                <div id="funPopup" class="gg-popup">
                    <div class="gg-popup-content">
                        <div class="gg-popup-header">
                            <h2>Fun Prompts</h2>
                            <div class="gg-popup-header-actions">
                                <label class="gg-popup-checkbox">
                                    <input type="checkbox" id="ggFunPromptSwipeToggle">
                                    Swipe
                                </label>
                                <span class="gg-popup-close">&times;</span>
                            </div>
                        </div>
                        <div class="gg-popup-body">
                            <div class="gg-popup-section">
                                <div class="gg-fun-prompts-container">
                                    ${funPromptsHtml}
                                </div>
                            </div>
                        </div>
                        <div class="gg-popup-footer">
                            <button type="button" class="gg-button-secondary gg-close-button">Close</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.insertAdjacentHTML('beforeend', popupHtml);
            this.popupElement = document.getElementById('funPopup');
            this.addEventListeners();
        }

        this.initialized = true;
    }

    /**
     * Add event listeners to the popup
     */
    addEventListeners() {
        // Close button
        const closeBtn = this.popupElement.querySelector('.gg-popup-close');
        const closeFooterBtn = this.popupElement.querySelector('.gg-close-button');
        
        closeBtn.addEventListener('click', () => this.close());
        closeFooterBtn.addEventListener('click', () => this.close());

        // Close when clicking outside the popup
        this.popupElement.addEventListener('click', (e) => {
            if (e.target === this.popupElement) {
                this.close();
            }
        });

        // Add event listeners to the dynamically created buttons
        const funPromptsContainer = this.popupElement.querySelector('.gg-fun-prompts-container');
        funPromptsContainer.addEventListener('click', (e) => {
            const button = e.target.closest('.gg-fun-button');
            if (button) {
                const promptKey = button.dataset.prompt;
                this.handleFunPrompt(promptKey);
            }
        });
    }

    /**
     * Handle fun prompt selection
     * @param {string} promptKey - The key of the selected prompt
     */
    async handleFunPrompt(promptKey) {
        const funPrompt = FUN_PROMPTS[promptKey];
        if (!funPrompt) return;

        // Close the popup immediately and execute the prompt in the background
        this.close();
        if (this._isSwipeEnabled()) {
            await this._executePromptAsSwipe(funPrompt.prompt);
            return;
        }

        await this._executePrompt(funPrompt.prompt);
    }

    /**
     * Executes a given prompt string, handling group and single chats.
     * @param {string} promptText - The prompt to execute.
     */
    async _executePrompt(promptText) {
        const context = getContext();
        if (!context || typeof context.executeSlashCommandsWithOptions !== 'function') {
            console.error(`${extensionName}: Context unavailable to execute fun prompt.`);
            return;
        }

        // Resolve target profile and preset from settings
        const profileKey = 'profileFun';
        const presetKey = 'presetFun';
        const profileValue = extension_settings[extensionName]?.[profileKey] ?? '';
        const presetValue = extension_settings[extensionName]?.[presetKey] ?? '';
        debugLog(`${extensionName}: Using profile: ${profileValue || 'current'}, preset: ${presetValue || 'none'}`);

        // Get the current input from the textarea
        const textarea = document.getElementById('send_textarea');
        const currentInput = textarea ? textarea.value.trim() : '';

        // Get the configured injection role from settings
        const injectionRole = extension_settings[extensionName]?.injectionEndRole ?? 'system';

        const filledPrompt = promptText.replace(/\n/g, '\\n'); // Escape newlines for the script
        const useDirectCall = await shouldUseDirectCall(profileValue, presetValue);

        try {
            if (useDirectCall) {
                // Check if it's a group chat
                let selectedCharacter = '';
                if (context.groupId) {
                    let characterList = [];
                    try {
                        const groups = context.groups || [];
                        const currentGroup = groups.find(group => group.id === context.groupId);

                        if (currentGroup && Array.isArray(currentGroup.members)) {
                            characterList = currentGroup.members.map(member => {
                                return (typeof member === 'string' && member.toLowerCase().endsWith('.png')) ? member.slice(0, -4) : member;
                            }).filter(Boolean);
                        }
                    } catch (error) {
                        console.error(`${extensionName}: Error processing group members:`, error);
                    }
                    if (characterList.length > 0) {
                        const characterListJson = JSON.stringify(characterList);
                        const selectionResult = await context.executeSlashCommandsWithOptions(
                            `/buttons labels=${characterListJson} "Select character to respond"`,
                            { showOutput: false, handleExecutionErrors: true }
                        );
                        if (selectionResult?.pipe) {
                            selectedCharacter = String(selectionResult.pipe).trim();
                        }
                    }
                }

                const inputSuffixTemplate = await getPromptValue('funPrompts.inputSuffix', '');
                const promptWithInput = `${filledPrompt}${fillPromptTemplate(inputSuffixTemplate, { input: currentInput })}`;
                const responseText = await requestCompletion({
                    profileName: profileValue,
                    presetName: presetValue,
                    prompt: promptWithInput,
                    debugLabel: 'funPopup',
                });

                if (!responseText || responseText.trim() === '') {
                    debugLog('[FunPopup] No response received from completion.');
                    return;
                }

                const fallbackCharacter = (() => {
                    const lastAssistant = [...(context.chat || [])].reverse().find(message => !message?.is_user);
                    return lastAssistant?.name || 'Assistant';
                })();
                const characterName = selectedCharacter || context?.characters?.[context.characterId]?.name || fallbackCharacter;

                const message = {
                    name: characterName,
                    is_user: false,
                    is_system: false,
                    send_date: Date.now(),
                    mes: responseText,
                    force_avatar: null,
                    extra: {
                        type: 'funprompt',
                        gen_id: Date.now(),
                        api: profileValue || 'manual',
                        model: profileValue || 'manual',
                        role: injectionRole,
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
            } else {
                let stscriptCommand = '';
                if (context.groupId) {
                    let characterListJson = '[]';
                    let characterNames = [];
                    let selectedCharacter = '';
                    try {
                        const groups = context.groups || [];
                        const currentGroup = groups.find(group => group.id === context.groupId);

                        if (currentGroup && Array.isArray(currentGroup.members)) {
                            characterNames = currentGroup.members.map(member => {
                                return (typeof member === 'string' && member.toLowerCase().endsWith('.png')) ? member.slice(0, -4) : member;
                            }).filter(Boolean);

                            if (characterNames.length > 0) {
                                characterListJson = JSON.stringify(characterNames);
                            }
                        }
                    } catch (error) {
                        console.error(`${extensionName}: Error processing group members:`, error);
                    }

                    if (characterListJson !== '[]') {
                        const selectionResult = await context.executeSlashCommandsWithOptions(
                            `/buttons labels=${characterListJson} "Select character to respond"`,
                            { showOutput: false, handleExecutionErrors: true }
                        );
                        if (selectionResult?.pipe) {
                            selectedCharacter = String(selectionResult.pipe).trim();
                        }
                    }

                    if (selectedCharacter) {
                        const selectedIndex = characterNames.findIndex(name => name === selectedCharacter);
                        const shouldUseIndex = /^\d/.test(selectedCharacter) && selectedIndex >= 0;
                        const triggerArg = shouldUseIndex ? String(selectedIndex) : JSON.stringify(selectedCharacter);
                        if (shouldUseIndex) {
                            debugLog(`[FunPopup] Using group member index ${selectedIndex} for numeric-prefixed name.`);
                        }
                        const inputSuffixTemplate = await getPromptValue('funPrompts.inputSuffix', '');
                        const inputSuffix = fillPromptTemplate(inputSuffixTemplate, { input: '{{input}}' });
                        stscriptCommand = 
`// Group chat logic for Fun Prompt|
/inject id=instruct position=chat ephemeral=true scan=true depth=0 role=${injectionRole} ${filledPrompt}${inputSuffix}]|
/trigger await=true ${triggerArg}|
`;
                    } else {
                        // Cancel group fun prompt when selection is cancelled or invalid
                        debugLog('[FunPopup] Group selection cancelled; aborting fun prompt.');
                        return;
                    }
                } else {
                    // Single character logic
                    const inputSuffixTemplate = await getPromptValue('funPrompts.inputSuffix', '');
                    const inputSuffix = fillPromptTemplate(inputSuffixTemplate, { input: '{{input}}' });
                    stscriptCommand = `// Single character logic for Fun Prompt|
/inject id=instruct position=chat ephemeral=true scan=true depth=0 role=${injectionRole} ${filledPrompt}${inputSuffix}]|
/trigger await=true|
`;
                }

                await context.executeSlashCommandsWithOptions(stscriptCommand, {
                    showOutput: false,
                    handleExecutionErrors: true
                });
            }
        } catch (error) {
            console.error(`${extensionName}: Error executing fun prompt script:`, error);
        }
    }

    /**
     * Executes a prompt as a swipe (new variation on last assistant message).
     * @param {string} promptText - The prompt to execute as a swipe.
     */
    async _executePromptAsSwipe(promptText) {
        const context = getContext();
        if (!context || typeof context.executeSlashCommandsWithOptions !== 'function') {
            console.error(`${extensionName}: Context unavailable to execute fun prompt swipe.`);
            return;
        }

        const profileKey = 'profileFun';
        const presetKey = 'presetFun';
        const profileValue = extension_settings[extensionName]?.[profileKey] ?? '';
        const presetValue = extension_settings[extensionName]?.[presetKey] ?? '';
        const injectionRole = extension_settings[extensionName]?.injectionEndRole ?? 'system';
        debugLog(`${extensionName}: Swipe using profile: ${profileValue || 'current'}, preset: ${presetValue || 'none'}`);

        const textarea = document.getElementById('send_textarea');
        const currentInput = textarea ? textarea.value.trim() : '';
        const filledPrompt = promptText.replace(/\n/g, '\\n'); // Escape newlines for the script
        const inputSuffixTemplate = await getPromptValue('funPrompts.inputSuffix', '');
        const promptWithInput = `${filledPrompt}${fillPromptTemplate(inputSuffixTemplate, { input: currentInput })}`;

        try {
            const useDirectCall = await shouldUseDirectCall(profileValue, presetValue);
            let responseText = '';

            if (useDirectCall) {
                debugLog('[FunPopup] Requesting direct completion for swipe...');
                responseText = await requestCompletion({
                    profileName: profileValue,
                    presetName: presetValue,
                    prompt: promptWithInput,
                    debugLabel: 'funPopup:swipe',
                    includeChatHistory: true,
                });
            } else if (typeof context.executeSlashCommandsWithOptions === 'function') {
                responseText = await this._executeSwipeViaGenerateNewSwipe(context, promptWithInput, injectionRole);
            } else {
                console.error(`${extensionName}: context.executeSlashCommandsWithOptions not found for fun prompt swipe.`);
            }

            if (!responseText || responseText.trim() === '') {
                debugLog('[FunPopup] No response received for swipe.');
                return;
            }

            await this._applySwipeUpdate(context, responseText);
        } catch (error) {
            console.error(`${extensionName}: Error executing fun prompt swipe:`, error);
        }
    }

    async _executeSwipeViaGenerateNewSwipe(context, promptText, injectionRole) {
        const filledPrompt = String(promptText || '').replace(/\n/g, '\\n');
        const injectCommand = `/inject id=instruct position=chat ephemeral=true scan=true depth=0 role=${injectionRole} ${filledPrompt} |`;
        try {
            await context.executeSlashCommandsWithOptions(injectCommand, {
                showOutput: false,
                handleExecutionErrors: true,
            });

            const swipeSuccess = await generateNewSwipe();
            if (!swipeSuccess) {
                return '';
            }

            const latestAssistant = [...(context.chat || [])].reverse().find((message) => !message?.is_user);
            return latestAssistant?.mes || '';
        } finally {
            await context.executeSlashCommandsWithOptions('/flushinject instruct', {
                showOutput: false,
                handleExecutionErrors: true,
            });
        }
    }

    async _applySwipeUpdate(context, responseText) {
        const chat = Array.isArray(context?.chat) ? context.chat : [];
        const targetIndex = (() => {
            for (let i = chat.length - 1; i >= 0; i -= 1) {
                if (!chat[i]?.is_user) return i;
            }
            return -1;
        })();

        if (targetIndex === -1) {
            debugLog('[FunPopup] No assistant message found for swipe; adding new message instead.');
            const fallbackCharacter = (() => {
                const lastAssistant = [...chat].reverse().find(message => !message?.is_user);
                return lastAssistant?.name || 'Assistant';
            })();
            const message = {
                name: fallbackCharacter,
                is_user: false,
                is_system: false,
                send_date: Date.now(),
                mes: responseText,
                force_avatar: null,
                extra: {
                    type: 'funprompt',
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
        if (!messageData) return;

        if (!Array.isArray(messageData.swipes)) {
            messageData.swipes = [messageData.mes];
        }
        messageData.swipes.push(responseText);
        messageData.swipe_id = messageData.swipes.length - 1;
        messageData.mes = responseText;

        const mesDom = document.querySelector(`#chat .mes[mesid="${targetIndex}"]`);
        if (mesDom && typeof context.messageFormatting === 'function') {
            const mesTextElement = mesDom.querySelector('.mes_text');
            if (mesTextElement) {
                mesTextElement.innerHTML = context.messageFormatting(
                    messageData.mes,
                    messageData.name,
                    messageData.is_system,
                    messageData.is_user,
                    targetIndex
                );
            }
            [...mesDom.querySelectorAll('.swipes-counter')].forEach((it) => {
                it.textContent = `${messageData.swipe_id + 1}/${messageData.swipes.length}`;
            });
        }

        if (context.eventSource && context.event_types) {
            context.eventSource.emit(context.event_types.MESSAGE_SWIPED, targetIndex);
        }

        if (typeof context.saveChat === 'function') {
            await context.saveChat();
        }
    }

    /**
     * Open the popup
     */
    async open() {
        if (!this.initialized) {
            await this.init();
        }
        
        this.popupElement.style.display = 'block';
        document.body.classList.add('gg-popup-open');
    }

    /**
     * Close the popup
     */
    close() {
        if (this.popupElement) {
            this.popupElement.style.display = 'none';
            document.body.classList.remove('gg-popup-open');
        }
    }

    _isSwipeEnabled() {
        const toggle = this.popupElement?.querySelector('#ggFunPromptSwipeToggle');
        return Boolean(toggle?.checked);
    }
}

// Singleton instance
const funPopup = new FunPopup();
export default funPopup;
