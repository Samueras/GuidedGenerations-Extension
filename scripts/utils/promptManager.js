const PROMPTS_FILE_PATH = 'scripts/extensions/third-party/GuidedGenerations-Extension/prompts.json';

let promptCatalogPromise = null;
let promptCatalog = null;

function getNestedValue(source, keyPath) {
    if (!source || !keyPath) return undefined;
    return String(keyPath).split('.').reduce((current, part) => {
        if (current && Object.prototype.hasOwnProperty.call(current, part)) {
            return current[part];
        }
        return undefined;
    }, source);
}

function getPromptOverrideSettingKey(settingsKey) {
    if (!settingsKey) return '';
    return `use${settingsKey.charAt(0).toUpperCase()}${settingsKey.slice(1)}SettingOverride`;
}

export async function loadPromptCatalog({ force = false } = {}) {
    if (promptCatalog && !force) {
        return promptCatalog;
    }

    if (!promptCatalogPromise || force) {
        promptCatalogPromise = fetch(`${PROMPTS_FILE_PATH}?v=${Date.now()}`)
            .then(async response => {
                if (!response.ok) {
                    if (response.status !== 404) {
                        console.warn(`[GuidedGenerations] Failed to load ${PROMPTS_FILE_PATH}: ${response.status}`);
                    }
                    return {};
                }
                return await response.json();
            })
            .then(data => {
                promptCatalog = data && typeof data === 'object' ? data : {};
                return promptCatalog;
            })
            .catch(error => {
                console.warn(`[GuidedGenerations] Could not load ${PROMPTS_FILE_PATH}:`, error);
                promptCatalog = {};
                return promptCatalog;
            });
    }

    return promptCatalogPromise;
}

export async function getPromptValue(keyPath, fallback = '', { settings = null, settingsKey = keyPath } = {}) {
    const overrideSettingKey = getPromptOverrideSettingKey(settingsKey);
    // The flag is named "Use prompts.json". When checked (default), the
    // external prompts.json file takes precedence over the internal settings
    // value. When unchecked, the user's saved internal setting value is used
    // instead (e.g. for custom prompts carried over from before this option).
    const usePromptsJson = settings?.[overrideSettingKey] !== false;
    const hasSettingValue = settings && settingsKey && Object.prototype.hasOwnProperty.call(settings, settingsKey);
    const settingValue = hasSettingValue ? settings[settingsKey] : undefined;
    if (!usePromptsJson && typeof settingValue === 'string') {
        return settingValue;
    }

    const catalog = await loadPromptCatalog();
    const fileValue = getNestedValue(catalog, keyPath);
    if (typeof fileValue === 'string') {
        return fileValue;
    }

    // Fall back to the internal setting value if the file doesn't have it.
    if (typeof settingValue === 'string') {
        return settingValue;
    }

    return fallback;
}

export async function getPromptObject(keyPath, fallback = {}) {
    const catalog = await loadPromptCatalog();
    const fileValue = getNestedValue(catalog, keyPath);
    if (fileValue && typeof fileValue === 'object' && !Array.isArray(fileValue)) {
        return fileValue;
    }
    return fallback;
}

export function fillPromptTemplate(template, replacements = {}) {
    return Object.entries(replacements).reduce((result, [key, value]) => {
        return result.replaceAll(`{{${key}}}`, String(value ?? ''));
    }, String(template ?? ''));
}
