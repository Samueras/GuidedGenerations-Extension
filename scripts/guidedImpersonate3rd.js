// scripts/guidedImpersonate3rd.js
import { extension_settings, extensionName, debugLog, getPreviousImpersonateInput, setPreviousImpersonateInput, getLastImpersonateResult, setLastImpersonateResult, requestCompletion, shouldUseDirectCall, getPromptValue, expandStMacros } from './persistentGuides/guideExports.js'; // Import from central hub

const guidedImpersonate3rd = async () => {
    const textarea = document.getElementById('send_textarea');
    if (!textarea) {
        console.error('[GuidedGenerations] Textarea #send_textarea not found.');
        return;
    }
    const currentInputText = textarea.value;
    const lastGeneratedText = getLastImpersonateResult(); // Use getter

    // Check if the current input matches the last generated text
    if (lastGeneratedText && currentInputText === lastGeneratedText) {
        textarea.value = getPreviousImpersonateInput(); // Use getter
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return; // Restoration done, exit
    }

    // --- If not restoring, proceed with impersonation ---
    setPreviousImpersonateInput(currentInputText); // Use setter

    // Resolve target profile and preset from settings
    const profileKey = 'profileImpersonate3rd';
    const presetKey = 'presetImpersonate3rd';
    const profileValue = extension_settings[extensionName]?.[profileKey] ?? '';
    const presetValue = extension_settings[extensionName]?.[presetKey] ?? '';
    
    // Debug: Log the exact values being retrieved
    debugLog(`[Impersonate-3rd] Profile key: "${profileKey}"`);
    debugLog(`[Impersonate-3rd] Preset key: "${presetKey}"`);
    debugLog(`[Impersonate-3rd] Profile value from settings: "${profileValue}"`);
    debugLog(`[Impersonate-3rd] Preset value from settings: "${presetValue}"`);
    debugLog(`[Impersonate-3rd] All profile settings:`, Object.keys(extension_settings[extensionName] || {}).filter(key => key.startsWith('profile')));
    
    debugLog(`[Impersonate-3rd] Using profile: ${profileValue || 'current'}, preset: ${presetValue || 'none'}`);
    
    // Use user-defined impersonate prompt override. {{input}} and other ST
    // macros are resolved by substituteParams via expandStMacros; the textarea
    // still holds the user's text at this point.
    const promptTemplate = await getPromptValue('promptImpersonate3rd', '', {
        settings: extension_settings[extensionName],
    });
    const filledPrompt = expandStMacros(promptTemplate);

    try {
        const useDirectCall = await shouldUseDirectCall(profileValue, presetValue);
        if (useDirectCall) {
            debugLog('[Impersonate-3rd] Requesting direct completion...');
            const completion = await requestCompletion({
                profileName: profileValue,
                presetName: presetValue,
                prompt: filledPrompt,
                debugLabel: 'impersonate:3rd',
                includeChatHistory: true,
                includeIdentityContext: true,
            });

            if (completion && completion.trim() !== '') {
                textarea.value = completion;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                setLastImpersonateResult(completion);
                debugLog('[Impersonate-3rd] Completion received and stored.');
            } else {
                debugLog('[Impersonate-3rd] Completion empty, input unchanged.');
            }
        } else {
            const context = SillyTavern.getContext();
            if (typeof context.executeSlashCommandsWithOptions === 'function') {
                const stscriptCommand = `/impersonate await=true ${filledPrompt} |`;
                await context.executeSlashCommandsWithOptions(stscriptCommand);
                setLastImpersonateResult(textarea.value);
                debugLog('[Impersonate-3rd] Slash command completed, input stored.');
            } else {
                console.error('[GuidedGenerations] context.executeSlashCommandsWithOptions not found!');
            }
        }
    } catch (error) {
        console.error(`[GuidedGenerations] Error executing Guided Impersonate (3rd): ${error}`);
        setLastImpersonateResult(''); // Use setter to clear shared state on error
    }
};

// Export the function
export { guidedImpersonate3rd };
