/**
 * @file Contains the logic for the Thinking option in the Persistent Guides menu.
 */
import { getContext, extension_settings, getPromptValue } from './guideExports.js'; // Import from central hub
import { runGuideScript } from './runGuide.js';

const extensionName = "GuidedGenerations-Extension";

/**
 * Executes the Thinking Guide script to create an insight into what the character is thinking.
 * This helps authors understand character motivations and inner thoughts.
 * @param {boolean} isAuto - Whether this guide is being auto-triggered.
 */
const thinkingGuide = async (isAuto = false) => {
    const injectionRole = extension_settings[extensionName]?.injectionEndRole ?? 'system';

    let genCommandSuffix = await getPromptValue('promptThinking', '', {
        settings: extension_settings[extensionName],
    });
    const injectionPrompt = await getPromptValue('persistentGuides.thinkingInjection', '');
    const depth = extension_settings[extensionName]?.depthPromptThinking ?? 0;
    const finalCommand = `/inject id=thinking position=chat scan=true depth=${depth} role=${injectionRole} ${injectionPrompt} |`;

    return await runGuideScript({
        guideId: 'thinking',
        genCommandSuffix,
        finalCommand,
        isAuto,
        previousInjectionAction: 'flush',
        raw: extension_settings[extensionName]?.rawPromptThinking ?? false
    });
};

// Export the function for use in the main extension file
export default thinkingGuide;
