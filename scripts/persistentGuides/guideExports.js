/**
 * @file Central import/export hub for all GuidedGenerations extension modules.
 * This file serves as a single point of entry for all imports, eliminating path depth issues.
 */

// External dependencies (SillyTavern)
import { getContext, extension_settings, renderExtensionTemplateAsync } from '../../../../../extensions.js';
import { chat, eventSource, event_types, saveChatConditional, addOneMessage, deactivateSendButtons, activateSendButtons, setExternalAbortController, setSendButtonState } from '../../../../../../script.js';

// Core extension constants and functions (defined locally to avoid circular dependency)
const extensionName = "GuidedGenerations-Extension";

// Conditional logging utility that only logs when debug mode is enabled
function debugLog(...args) {
    if (extension_settings[extensionName]?.debugMode) {
        console.log(`[${extensionName}][DEBUG]`, ...args);
    }
}

// Conditional warning utility that only logs when debug mode is enabled
function debugWarn(...args) {
    if (extension_settings[extensionName]?.debugMode) {
        console.warn(`[${extensionName}][DEBUG]`, ...args);
    }
}

// Shared state functions for impersonate input management
let previousImpersonateInput = '';
let lastImpersonateResult = '';
const RECOVERABLE_INPUT_HISTORY_LIMIT = 10;
let recoverableInputHistory = [];
let recoverableInputCycleIndex = 0;

function addRecoverableInput(input) {
    const normalizedInput = typeof input === 'string' ? input : '';
    if (!normalizedInput) return;

    // Avoid consecutive duplicates while preserving older history entries.
    if (recoverableInputHistory[0] === normalizedInput) {
        recoverableInputCycleIndex = 0;
        return;
    }

    recoverableInputHistory.unshift(normalizedInput);
    if (recoverableInputHistory.length > RECOVERABLE_INPUT_HISTORY_LIMIT) {
        recoverableInputHistory = recoverableInputHistory.slice(0, RECOVERABLE_INPUT_HISTORY_LIMIT);
    }
    recoverableInputCycleIndex = 0;
}

function getNextRecoverableInput() {
    if (!recoverableInputHistory.length) return '';

    const value = recoverableInputHistory[recoverableInputCycleIndex];
    recoverableInputCycleIndex = (recoverableInputCycleIndex + 1) % recoverableInputHistory.length;
    return value;
}

function setPreviousImpersonateInput(input) {
    previousImpersonateInput = input;
    addRecoverableInput(input);
}

function getPreviousImpersonateInput() {
    return previousImpersonateInput;
}

function setLastImpersonateResult(result) {
    lastImpersonateResult = result;
    addRecoverableInput(result);
}

function getLastImpersonateResult() {
    return lastImpersonateResult;
}

// Group chat detection function
function isGroupChat() {
    const context = getContext();
    return context && context.groupId && context.groups;
}

// Optional prompt manager helpers (SillyTavern openai.js)
async function getOpenAIPromptManagerHelpers() {
    try {
        return await import('../../../../../../scripts/openai.js');
    } catch (error) {
        debugWarn(`[${extensionName}] Failed to load openai prompt manager helpers:`, error);
        return null;
    }
}

// Settings management functions - imported from index.js
import { loadSettings, updateSettingsUI, addSettingsEventListeners, debugProfileSystem, getDebugMessages, clearDebugMessages, getDebugMessagesAsText, debugError } from '../../index.js';

// Default settings object
const defaultSettings = {
    autoTriggerClothes: false,
    autoTriggerState: false,
    autoTriggerThinking: false,
    enableAutoCustomAutoGuide: false,
    showImpersonate1stPerson: true,
    showImpersonate2ndPerson: false,
    showImpersonate3rdPerson: false,
    showGuidedContinue: false,
    showGuidedResponse: true,
    showGuidedSwipe: true,
    showSimpleSendButton: false,
    showRecoverInputButton: false,
    showEditIntrosButton: false,
    showCorrectionsButton: false,
    showSpellcheckerButton: false,
    showClearInputButton: false,
    showUndoButton: false,
    showRevertButton: false,
    integrateQrBar: true,
    debugMode: false,
    injectionEndRole: 'system'
};

// Utility functions
import { getProfileApiType, getPresetsForApiType, getCurrentProfile, getProfileList, getConnectApiMap, extractApiIdFromApiType, handleSwitching } from '../utils/presetUtils.js';
import { requestCompletion, shouldUseDirectCall } from '../utils/llmClient.js';
import { getPromptObject, getPromptValue, fillPromptTemplate, loadPromptCatalog } from '../utils/promptManager.js';

// Guide functions
import situationalGuide from './situationalGuide.js';
import thinkingGuide from './thinkingGuide.js';
import clothesGuide from './clothesGuide.js';
import stateGuide from './stateGuide.js';
import rulesGuide from './rulesGuide.js';
import customGuide from './customGuide.js';
import customAutoGuide from './customAutoGuide.js';
import editGuides from './editGuides.js';
import showGuides from './showGuides.js';
import flushGuides from './flushGuides.js';
import funGuide from './funGuide.js';
import trackerGuide from './trackerGuide.js';
import { executeTracker, checkAndExecuteTracker, createTrackerNote } from './trackerLogic.js';
import { runGuideScript } from './runGuide.js';
import { updateCharacter } from './updateCharacter.js';

// Tool functions
import { corrections } from '../tools/corrections.js';
import { spellchecker } from '../tools/spellchecker.js';
import editIntros from '../tools/editIntros.js';
import clearInput from '../tools/clearInput.js';
import separatedThinking from '../tools/separatedThinking.js';

// Main script functions
import { guidedSwipe, generateNewSwipe } from '../guidedSwipe.js';
import { guidedContinue, initGuidedContinueListeners, undoLastGuidedAddition, revertToOriginalGuidedContinue } from '../guidedContinue.js';
import { guidedResponse } from '../guidedResponse.js';
import { guidedImpersonate } from '../guidedImpersonate.js';
import { guidedImpersonate2nd } from '../guidedImpersonate2nd.js';
import { guidedImpersonate3rd } from '../guidedImpersonate3rd.js';
import { simpleSend } from '../simpleSend.js';
import { recoverInput } from '../inputRecovery.js';
import { loadSettingsPanel } from '../settingsPanel.js';

// Export everything
export {
    // Context and settings
    getContext,
    extension_settings,
    extensionName,
    debugLog,
    debugWarn,
    debugError,
    
    // SillyTavern dependencies
    chat,
    eventSource,
    event_types,
    saveChatConditional,
    addOneMessage,
    deactivateSendButtons,
    activateSendButtons,
    setExternalAbortController,
    setSendButtonState,
    renderExtensionTemplateAsync,
    
    // Utility functions
    getProfileApiType,
    getPresetsForApiType,
    getCurrentProfile,
    getProfileList,
    getConnectApiMap,
    extractApiIdFromApiType,
    handleSwitching,
    requestCompletion,
    shouldUseDirectCall,
    getPromptObject,
    getPromptValue,
    fillPromptTemplate,
    loadPromptCatalog,
    
    // Guides
    runGuideScript,
    clothesGuide,
    stateGuide,
    thinkingGuide,
    situationalGuide,
    rulesGuide,
    customGuide,
    customAutoGuide,
    trackerGuide,
    executeTracker,
    checkAndExecuteTracker,
    createTrackerNote,
    funGuide,
    flushGuides,
    showGuides,
    editGuides,
    updateCharacter,
    
    // Tools
    clearInput,
    corrections,
    editIntros,
    separatedThinking,
    spellchecker,
    
    // Main script functions
    guidedSwipe,
    generateNewSwipe,
    guidedContinue,
    initGuidedContinueListeners,
    undoLastGuidedAddition,
    revertToOriginalGuidedContinue,
    guidedResponse,
    guidedImpersonate,
    guidedImpersonate2nd,
    guidedImpersonate3rd,
    simpleSend,
    recoverInput,
    loadSettingsPanel,
    
    // Settings and other
    loadSettings,
    updateSettingsUI,
    addSettingsEventListeners,
    debugProfileSystem,
    defaultSettings,
    isGroupChat,
    setPreviousImpersonateInput,
    getPreviousImpersonateInput,
    addRecoverableInput,
    getNextRecoverableInput,
    setLastImpersonateResult,
    getLastImpersonateResult,
    
    // Debug logging functions
    getDebugMessages,
    clearDebugMessages,
    getDebugMessagesAsText,
    getOpenAIPromptManagerHelpers,
};
