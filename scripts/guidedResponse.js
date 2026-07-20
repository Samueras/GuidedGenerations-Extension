/**
 * @file Contains the logic for the Guided Response button.
 */
import { extension_settings, isGroupChat, setPreviousImpersonateInput, getPreviousImpersonateInput, debugLog, getPromptValue, expandStMacros, pickGroupMember } from './persistentGuides/guideExports.js'; // Import from central hub

// Import the guide scripts for direct execution
import thinkingGuide from './persistentGuides/thinkingGuide.js'; // Correct relative path
import stateGuide from './persistentGuides/stateGuide.js'; // Correct relative path
import clothesGuide from './persistentGuides/clothesGuide.js'; // Correct relative path
import customAutoGuide from './persistentGuides/customAutoGuide.js'; // Import the new Custom Auto Guide

const extensionName = "GuidedGenerations-Extension";

const guidedResponse = async () => {
    const textarea = document.getElementById('send_textarea');
    if (!textarea) {
        console.error('[GuidedGenerations][Response] Textarea #send_textarea not found.');
        return;
    }
    const originalInput = textarea.value; // Get current input

    // --- Get Setting ---
    const injectionRole = extension_settings[extensionName]?.injectionEndRole ?? 'system'; // Get the role setting

    // Save the input state using the shared function
    setPreviousImpersonateInput(originalInput);

    // Use user-defined guided response prompt override. {{input}} and other ST
    // macros are resolved by ST's substituteParams via expandStMacros; the
    // textarea still holds the user's text at this point.
    const promptTemplate = await getPromptValue('promptGuidedResponse', '', {
        settings: extension_settings[extensionName],
    });
    const filledPrompt = expandStMacros(promptTemplate);
    const depth = extension_settings[extensionName]?.depthPromptGuidedResponse ?? 0;

    // For group chats, ask the user which member should respond. If GRS is
    // installed, this delegates to it; otherwise GG's own selector is used.
    // Resolves null when the user cancels.
    let selectedMember = null;
    if (isGroupChat()) {
        selectedMember = await pickGroupMember();
        if (!selectedMember) {
            debugLog('[Response] Group selection cancelled; aborting guided response (no generation).');
            return;
        }
    }

    let stscriptCommand;
    if (selectedMember) {
        const { name, chid, triggerArg } = selectedMember;
        debugLog(`[Response] Group member selected: ${name} (chid ${chid}, trigger arg ${triggerArg}).`);
        stscriptCommand =
            `// Group chat logic (JS selection, safe trigger)|
/inject id=instruct position=chat ephemeral=true scan=true depth=${depth} role=${injectionRole} ${filledPrompt}|
/trigger await=true ${triggerArg}|
`;
    } else {
        stscriptCommand =
            `// Single character logic|
/inject id=instruct position=chat ephemeral=true scan=true depth=${depth} role=${injectionRole} ${filledPrompt}|
/trigger await=true|
`;
    }

    // Execute the main stscript command
    if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
        const context = SillyTavern.getContext();
        try {
            await context.executeSlashCommandsWithOptions(stscriptCommand);
            debugLog('[Response] Executed Command:', stscriptCommand); // Log the command
        } catch (error) {
            console.error(`[GuidedGenerations][Response] Error executing Guided Response stscript: ${error}`);
        } finally {
            // Always restore the input field from the shared state
            const restoredInput = getPreviousImpersonateInput();
            textarea.value = restoredInput;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            if (typeof SillyTavern === 'undefined' || typeof SillyTavern.getContext !== 'function') {
                debugLog(`[Response] Restoring input field after context error: "${restoredInput}"`);
            }
        }
    } else {
        console.error('[GuidedGenerations][Response] SillyTavern context is not available.');
        // Even if context isn't available, attempt restore if textarea exists
        if (textarea) {
             const restoredInput = getPreviousImpersonateInput();
             debugLog(`[Response] Restoring input field after context error: "${restoredInput}"`);
             textarea.value = restoredInput;
             textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
};

// Export the function
export { guidedResponse };
