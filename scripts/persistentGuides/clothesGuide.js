/**
 * @file Contains the logic for the Clothes option in the Persistent Guides menu.
 */
import { extensionName, extension_settings, getPromptValue } from './guideExports.js'; // Import from central hub
import { runGuideScript } from './runGuide.js';

/**
 * Executes the Clothes Guide script to create a detailed description of what each character is wearing.
 * This helps maintain visual consistency throughout the chat.
 * @param {boolean} isAuto - Whether this guide is being auto-triggered (true) or called directly from menu (false)
 */
const clothesGuide = async (isAuto = false) => {
    const injectionRole = extension_settings[extensionName]?.injectionEndRole ?? 'system';
    const genAs = 'as=char';
    const genCommandSuffix = await getPromptValue('promptClothes', '', {
        settings: extension_settings[extensionName],
    });
    const depth = extension_settings[extensionName]?.depthPromptClothes ?? 1;
    const injectionPrompt = await getPromptValue('persistentGuides.clothesInjection', '');
    const finalCommand = `/inject id=clothes position=chat scan=true depth=${depth} role=${injectionRole} ${injectionPrompt} |`;
    return await runGuideScript({
        guideId: 'clothes',
        genAs,
        genCommandSuffix,
        finalCommand,
        isAuto,
        previousInjectionAction: 'move',
        raw: extension_settings[extensionName]?.rawPromptClothes ?? false
    });
};

// Export the function for use in the main extension file
export default clothesGuide;
