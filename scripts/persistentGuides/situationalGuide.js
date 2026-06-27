/**
 * @file Contains the logic for the Situational Guide option in the Persistent Guides menu.
 */
import { isGroupChat, getContext, extension_settings, extensionName, getPromptValue } from './guideExports.js'; // Import from central hub
import { runGuideScript } from './runGuide.js';
/**
 * @param {boolean} isAuto - Whether this guide is auto-triggered (true) or manual (false)
 * @returns {Promise<string|null>}
 */
const situationalGuide = async (isAuto = false) => {
    const genCommandSuffix = await getPromptValue('promptSituational', '', {
        settings: extension_settings[extensionName],
    });
    const depth = extension_settings[extensionName]?.depthPromptSituational ?? 3;
    const injectionPrompt = await getPromptValue('persistentGuides.situationalInjection', '');
    const finalCommand = `/inject id=situational position=chat scan=true depth=${depth} ${injectionPrompt} |`;
    return await runGuideScript({
        guideId: 'situational',
        genCommandSuffix,
        finalCommand,
        isAuto,
        previousInjectionAction: 'flush',
        raw: extension_settings[extensionName]?.rawPromptSituational ?? false
    });
};

export default situationalGuide;
