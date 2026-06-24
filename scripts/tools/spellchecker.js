/**
 * @file Contains the logic for the Spellcheck tool.
 */
import { extension_settings, extensionName, debugLog, requestCompletion, shouldUseDirectCall, getPromptValue, fillPromptTemplate } from '../persistentGuides/guideExports.js';

const spellchecker = async () => {
    const textarea = document.getElementById('send_textarea');
    if (!textarea) {
        console.error('[GuidedGenerations] Textarea #send_textarea not found.');
        return;
    }
    const currentInputText = textarea.value;
    
    // Resolve target profile and preset from settings
    const profileKey = 'profileSpellchecker';
    const presetKey = 'presetSpellchecker';
    const profileValue = extension_settings[extensionName]?.[profileKey] ?? '';
    const presetValue = extension_settings[extensionName]?.[presetKey] ?? '';
    
    debugLog(`[Spellchecker] Using profile: ${profileValue || 'current'}, preset: ${presetValue || 'none'}`);
    
    // Use user-defined spellchecker prompt override
    const promptTemplate = await getPromptValue('promptSpellchecker', '', {
        settings: extension_settings[extensionName],
    });
    const filledPrompt = fillPromptTemplate(promptTemplate, { input: currentInputText });

    try {
        const useDirectCall = await shouldUseDirectCall(profileValue, presetValue);
        let resultText = '';

        if (useDirectCall) {
            debugLog('[Spellchecker] Requesting direct completion...');
            resultText = await requestCompletion({
                profileName: profileValue,
                presetName: presetValue,
                prompt: filledPrompt,
                debugLabel: 'spellchecker',
                includeChatHistory: false,
            });
        } else {
            const context = SillyTavern.getContext();
            if (typeof context.executeSlashCommandsWithOptions === 'function') {
                const result = await context.executeSlashCommandsWithOptions(`/genraw ${filledPrompt}`, {
                    showOutput: false,
                    handleExecutionErrors: true,
                });
                resultText = result?.pipe || '';
            } else {
                console.error('[GuidedGenerations] context.executeSlashCommandsWithOptions not found!');
            }
        }

        if (resultText && resultText.trim() !== '') {
            debugLog('[Spellchecker] Got corrected result, pasting into textarea.');
            textarea.value = resultText;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            debugLog('[Spellchecker] Corrected result pasted into textarea successfully');
        } else {
            debugLog('[Spellchecker] No result from completion, textarea unchanged');
        }
    } catch (error) {
        console.error(`[GuidedGenerations] Error executing Spellchecker: ${error}`);
    }
};

// Export the function
export { spellchecker };


