// scripts/inputRecovery.js
import { getNextRecoverableInput, debugLog } from './persistentGuides/guideExports.js'; // Import from central hub

const recoverInput = () => {
	debugLog('[InputRecovery] Button clicked');
	const textarea = document.getElementById('send_textarea');

	if (!textarea) {
		console.error('[GuidedGenerations][InputRecovery] Textarea #send_textarea not found.');
		return;
	}

	try {
		const previousInput = getNextRecoverableInput();
		if (!previousInput) {
			debugLog('[InputRecovery] No recoverable input found.');
			return;
		}
		debugLog(`[InputRecovery] Recovering input: "${previousInput}"`);
		textarea.value = previousInput;
		// Dispatch event for UI updates
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
		debugLog('[InputRecovery] Input recovered successfully.');
	} catch (error) {
		console.error("[GuidedGenerations][InputRecovery] Error recovering input:", error);
	}
};

// Export the function
export { recoverInput };
