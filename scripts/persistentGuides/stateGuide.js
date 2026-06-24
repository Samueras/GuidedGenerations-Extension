/**
 * @file Contains the logic for the State option in the Persistent Guides menu.
 */

// Import necessary items from central hub
import { getContext, extension_settings, extensionName, getPromptValue } from './guideExports.js'; // Import from central hub
import { runGuideScript } from './runGuide.js';

/**
 * Executes the State Guide script to track the physical state and positions of characters.
 * This helps maintain spatial awareness and physical continuity in the scene.
 * @param {boolean} isAuto - Whether this guide is being auto-triggered (true) or called directly from menu (false)
 * @returns {Promise<string|null>} The generated state info from the pipe, or null on error.
 */
const stateGuide = async (isAuto = false) => {
    const injectionRole = extension_settings[extensionName]?.injectionEndRole ?? 'system';

    const genAs = 'as=char';
    const genCommandSuffix = await getPromptValue('promptState', '', {
        settings: extension_settings[extensionName],
    });

    const depth = extension_settings[extensionName]?.depthPromptState ?? 1;
    const injectionPrompt = await getPromptValue('persistentGuides.stateInjection', '');
    const finalCommand = `/inject id=state position=chat scan=true depth=${depth} role=${injectionRole} ${injectionPrompt} |`;

    return await runGuideScript({
        guideId: 'state',
        genAs,
        genCommandSuffix,
        finalCommand,
        isAuto,
        previousInjectionAction: 'move',
        raw: extension_settings[extensionName]?.rawPromptState ?? false
    });
};

// Export the function for use in the main extension file
export default stateGuide;
