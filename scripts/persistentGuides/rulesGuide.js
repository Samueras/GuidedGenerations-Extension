/**
 * @file Contains the logic for the Rules Guide option in the Persistent Guides menu.
 */
import { extensionName, extension_settings, getPromptValue } from './guideExports.js'; // Import from central hub
import { runGuideScript } from './runGuide.js';

/**
 * Executes the Rules Guide script to track the explicit rules that characters have learned.
 * This helps maintain consistency in character behavior based on established rules.
 */
const rulesGuide = async (isAuto = false) => {
    const injectionRole = extension_settings[extensionName]?.injectionEndRole ?? 'system';
    // Use user-defined prompt override for Rules Guide
    const promptTemplate = await getPromptValue('promptRules', '', {
        settings: extension_settings[extensionName],
    });
    const genCommandSuffix = promptTemplate;
    const depth = extension_settings[extensionName]?.depthPromptRules ?? 0;
    const injectionPrompt = await getPromptValue('persistentGuides.rulesInjection', '');
    const finalCommand = `/inject id=rules position=chat scan=true depth=${depth} role=${injectionRole} ${injectionPrompt} |`;
    return await runGuideScript({
        guideId: 'rules',
        genCommandSuffix,
        finalCommand,
        isAuto,
        previousInjectionAction: 'flush',
        raw: extension_settings[extensionName]?.rawPromptRules ?? false
    });
};

// Export the function for use in the main extension file
export default rulesGuide;
