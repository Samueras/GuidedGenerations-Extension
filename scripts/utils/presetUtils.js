import { debugLog, debugWarn, extensionName } from '../persistentGuides/guideExports.js';

/**
 * Wait for the connection manager to become available.
 * @param {number} maxAttempts
 * @param {number} delayMs
 * @returns {Promise<boolean>}
 */
async function waitForConnectionManager(maxAttempts = 10, delayMs = 200) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const context = SillyTavern.getContext();
        if (context?.extensionSettings?.connectionManager) {
            debugLog(`[${extensionName}] Connection manager available on attempt ${attempt}`);
            return true;
        }

        if (attempt < maxAttempts) {
            debugLog(`[${extensionName}] Connection manager not available, attempt ${attempt}/${maxAttempts}, waiting ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    debugWarn(`[${extensionName}] Connection manager not available after ${maxAttempts} attempts`);
    return false;
}

/**
 * Extract the API ID from an API type using CONNECT_API_MAP.
 * @param {string} apiType
 * @returns {string|null}
 */
export function extractApiIdFromApiType(apiType) {
    try {
        const context = SillyTavern.getContext();
        if (!context?.CONNECT_API_MAP) {
            debugWarn(`[${extensionName}] CONNECT_API_MAP not available for API type: ${apiType}`);
            return null;
        }

        const apiInfo = context.CONNECT_API_MAP[apiType];
        if (!apiInfo) {
            debugWarn(`[${extensionName}] No API info found for type: ${apiType}`);
            return null;
        }

        let apiId;
        if (typeof apiInfo === 'string') {
            apiId = apiInfo;
        } else if (apiInfo && typeof apiInfo === 'object' && apiInfo.selected) {
            apiId = apiInfo.selected;
        } else if (apiInfo && typeof apiInfo === 'object' && apiInfo.apiId) {
            apiId = apiInfo.apiId;
        } else {
            debugWarn(`[${extensionName}] Could not extract apiId from API info:`, apiInfo);
            return null;
        }

        debugLog(`[${extensionName}] Extracted API ID "${apiId}" from API type "${apiType}"`);
        return apiId;
    } catch (error) {
        debugWarn(`[${extensionName}] Error extracting API ID from API type ${apiType}:`, error);
        return null;
    }
}

/**
 * Get the currently selected profile name.
 * @returns {Promise<string>}
 */
export async function getCurrentProfile() {
    try {
        const isAvailable = await waitForConnectionManager();
        if (!isAvailable) return '';

        const context = SillyTavern.getContext();
        const { selectedProfile, profiles } = context.extensionSettings.connectionManager;
        if (!selectedProfile || !profiles || !Array.isArray(profiles)) {
            debugLog(`[${extensionName}] No profile selected or profiles not available`);
            return '';
        }

        const currentProfile = profiles.find(p => p.id === selectedProfile);
        if (!currentProfile) {
            debugLog(`[${extensionName}] Current profile not found in profiles list`);
            return '';
        }

        debugLog(`[${extensionName}] Current profile: ${currentProfile.name}`);
        return currentProfile.name;
    } catch (error) {
        debugWarn(`[${extensionName}] Error getting current profile:`, error);
        return '';
    }
}

/**
 * Get all available profile names.
 * @returns {Promise<string[]>}
 */
export async function getProfileList() {
    try {
        const isAvailable = await waitForConnectionManager();
        if (!isAvailable) return [];

        const context = SillyTavern.getContext();
        const { profiles } = context.extensionSettings.connectionManager;
        if (!profiles || !Array.isArray(profiles)) {
            debugLog(`[${extensionName}] Profiles not available`);
            return [];
        }

        const profileNames = profiles.map(p => p.name);
        debugLog(`[${extensionName}] Available profiles:`, profileNames);
        return profileNames;
    } catch (error) {
        debugWarn(`[${extensionName}] Error getting profile list:`, error);
        return [];
    }
}

/**
 * Get a profile's API type.
 * @param {string} profileName
 * @returns {Promise<string>}
 */
export async function getProfileApiType(profileName) {
    try {
        const isAvailable = await waitForConnectionManager();
        if (!isAvailable) return '';

        const context = SillyTavern.getContext();
        const { profiles } = context.extensionSettings.connectionManager;
        if (!profiles || !Array.isArray(profiles)) {
            debugWarn(`[${extensionName}] Profiles not available`);
            return '';
        }

        const profile = profiles.find(p => p.name === profileName || p.id === profileName);
        if (!profile) {
            debugWarn(`[${extensionName}] Profile not found: ${profileName}`);
            return '';
        }

        const apiType = profile.api || '';
        debugLog(`[${extensionName}] Profile ${profileName} API type: ${apiType}`);
        return apiType;
    } catch (error) {
        debugWarn(`[${extensionName}] Error getting profile API type:`, error);
        return '';
    }
}

/**
 * Get preset list for an API type.
 * @param {string} apiType
 * @returns {Promise<any[]|Object>}
 */
export async function getPresetsForApiType(apiType) {
    try {
        const context = SillyTavern.getContext();
        if (!context || !context.CONNECT_API_MAP) {
            debugWarn(`[${extensionName}] Context or CONNECT_API_MAP not available`);
            return [];
        }

        const apiId = extractApiIdFromApiType(apiType);
        if (!apiId) {
            debugWarn(`[${extensionName}] Could not extract API ID for API type: ${apiType}`);
            return [];
        }

        const presetManager = context.getPresetManager(apiId);
        if (!presetManager || typeof presetManager.getPresetList !== 'function') {
            debugWarn(`[${extensionName}] Preset manager not available for API ID: ${apiId}`);
            return [];
        }

        const presetList = presetManager.getPresetList();
        debugLog(`[${extensionName}] Presets for ${apiType} (${apiId}):`, presetList);
        return presetList || [];
    } catch (error) {
        debugWarn(`[${extensionName}] Error getting presets for API type:`, error);
        return [];
    }
}

/**
 * Get CONNECT_API_MAP from SillyTavern context.
 * @returns {Object}
 */
export function getConnectApiMap() {
    try {
        const context = SillyTavern.getContext();
        return context?.CONNECT_API_MAP || {};
    } catch (error) {
        debugWarn(`[${extensionName}] Error getting CONNECT_API_MAP:`, error);
        return {};
    }
}
