/**
 * @file Contains the logic for the Custom Guide option in the Persistent Guides menu.
 */

/**
 * Executes the Custom Guide script to let users create their own personal guides.
 * This allows for maximum flexibility in creating specialized context for characters.
 */
import editGuidesPopup from './editGuidesPopup.js';
import { debugLog } from '../../index.js';

const customGuide = async () => {
	debugLog('[CustomGuide] Button clicked');

	const context = SillyTavern.getContext();
	if (!context || !context.chatMetadata || !context.chatMetadata.script_injects) {
		console.error('[GuidedGenerations] Context or persistent injections not available.');
		return;
	}
	const injections = context.chatMetadata.script_injects;
	const customPrompts = {};
	for (const name in injections) {
		if (name.startsWith('custom_')) {
			customPrompts[`script_inject_${name}`] = {
				value: injections[name].value,
				depth: injections[name].depth,
				position: injections[name].position
			};
		}
	}
	// If no custom prompts found, warn but still open popup
	if (Object.keys(customPrompts).length === 0) {
		console.warn('[GuidedGenerations] No custom guides found.');
	}
	await editGuidesPopup.init();
	// Open popup in custom creation mode
	editGuidesPopup.open(customPrompts, true);
};

// Export the function for use in the main extension file
export default customGuide;
