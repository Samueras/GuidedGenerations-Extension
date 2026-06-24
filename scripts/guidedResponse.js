/**
 * @file Contains the logic for the Guided Response button.
 */
import { getContext, extension_settings, isGroupChat, setPreviousImpersonateInput, getPreviousImpersonateInput, debugLog, getPromptValue, fillPromptTemplate } from './persistentGuides/guideExports.js'; // Import from central hub

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

    let stscriptCommand;

    // Use user-defined guided response prompt override
    const promptTemplate = await getPromptValue('promptGuidedResponse', '', {
        settings: extension_settings[extensionName],
    });
    const filledPrompt = fillPromptTemplate(promptTemplate, { input: originalInput });
    const depth = extension_settings[extensionName]?.depthPromptGuidedResponse ?? 0;

    let groupCharacterNames = [];
    let groupCharacterListJson = '[]';
    let needsGroupSelection = false;

    // Check if it's a group chat using the helper function
    if (isGroupChat()) {
        const context = getContext();

        try {
            const currentGroupId = context?.groupId; // Optional chaining for safety
            const groups = context?.groups;         // Optional chaining for safety

            if (currentGroupId && groups && Array.isArray(groups)) {
                const currentGroup = groups.find(group => group.id === currentGroupId);

                if (currentGroup && currentGroup.members && Array.isArray(currentGroup.members)) {
                    groupCharacterNames = currentGroup.members.map(member => {
                        // Remove .png from the end of the member name if present
                        if (typeof member === 'string' && member.toLowerCase().endsWith('.png')) {
                            return member.slice(0, -4);
                        }
                        return member;
                    }).filter(name => name); // Filter out any empty names after processing
                }
            }

            if (groupCharacterNames.length > 0) {
                // Convert the array to a JSON string for the /buttons command
                groupCharacterListJson = JSON.stringify(groupCharacterNames);
                needsGroupSelection = true;
            } else {
                console.warn(`[${extensionName}][Response] Processed group members resulted in empty list or group not found.`);
            }
        } catch (error) {
            console.error(`[${extensionName}][Response] Error processing group members from context:`, error);
        }

        if (!needsGroupSelection) {
            console.warn(`[${extensionName}][Response] Could not get character list for group chat selection. Falling back to single character logic.`);
            // Fallback to single character logic if character list is empty or invalid
            stscriptCommand = 
                `// Single character logic (fallback from group)|
/inject id=instruct position=chat ephemeral=true scan=true depth=${depth} role=${injectionRole} ${filledPrompt}|
/trigger await=true|
`;
        }
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
            if (needsGroupSelection && groupCharacterListJson !== '[]') {
                const selectionResult = await context.executeSlashCommandsWithOptions(
                    `/buttons labels=${groupCharacterListJson} "Select member to respond as"`,
                    { showOutput: false, handleExecutionErrors: true }
                );
                const selectedCharacter = typeof selectionResult?.pipe === 'string' ? selectionResult.pipe.trim() : '';

                if (selectedCharacter) {
                    const selectedIndex = groupCharacterNames.findIndex(name => name === selectedCharacter);
                    const shouldUseIndex = /^\d/.test(selectedCharacter) && selectedIndex >= 0;
                    const triggerArg = shouldUseIndex ? String(selectedIndex) : JSON.stringify(selectedCharacter);
                    if (shouldUseIndex) {
                        debugLog(`[Response] Using group member index ${selectedIndex} for numeric-prefixed name.`);
                    }
                    stscriptCommand =
                        `// Group chat logic (JS selection, safe trigger)|
/inject id=instruct position=chat ephemeral=true scan=true depth=${depth} role=${injectionRole} ${filledPrompt}|
/trigger await=true ${triggerArg}|
`;
                } else {
                    debugLog('[Response] Group selection cancelled; aborting guided response.');
                    return;
                }
            }

            // Execute the main command
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
