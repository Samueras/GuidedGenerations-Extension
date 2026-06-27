/**
 * @file Contains the logic for the Custom Auto Guide option in the Persistent Guides menu.
 */

// Import necessary items from central hub
import { getContext, extension_settings, extensionName, getPromptValue } from './guideExports.js'; // Import from central hub
import { runGuideScript } from './runGuide.js';

/**
 * Executes the Custom Auto Guide script. This guide is designed to be flexible and autorun.
 * @param {boolean} isAuto - Whether this guide is being auto-triggered (true) or called directly from menu (false)
 * @returns {Promise<string|null>} The generated guide info from the pipe, or null on error.
 */
const customAutoGuide = async (isAuto = false) => {
    const injectionRole = extension_settings[extensionName]?.injectionEndRole ?? 'system';

    // Allow override from settings, default to empty
    const customPrompt = await getPromptValue('customAutoGuidePrompt', '', {
        settings: extension_settings[extensionName],
    });

    const genAs = 'as=char'; // Default generation role, consider making this configurable if needed
    const genCommandSuffix = customPrompt; // Use the prompt from settings

    // Using a generic final command, adjust if specific formatting is needed
    const depth = extension_settings[extensionName]?.depthPromptCustomAuto ?? 1;
    const injectionPrompt = await getPromptValue('persistentGuides.customAutoInjection', '');
    const finalCommand = `/inject id=customAuto position=chat scan=true depth=${depth} role=${injectionRole} ${injectionPrompt} |`;

    return await runGuideScript({
        guideId: 'customAuto',
        genAs,
        genCommandSuffix, 
        finalCommand,
        isAuto,
        previousInjectionAction: 'move', // Or 'replace'/'add' depending on desired behavior
        raw: extension_settings[extensionName]?.rawPromptCustomAuto ?? false,
        enableSetting: 'enableCustomAutoGuide' // Link to its specific enable setting
    });
};

// Export the function for use in the main extension file
export default customAutoGuide;
