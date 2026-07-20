const PROMPTS_FILE_PATH = 'scripts/extensions/third-party/GuidedGenerations-Extension/prompts.json';

let promptCatalogPromise = null;
let promptCatalog = null;

// SillyTavern macros that would have side effects or otherwise misbehave when
// resolved inside a GuidedGenerations prompt (which may run automatically, on
// swipes, on corrections, etc.). We strip these out before handing the prompt
// to ST's substituteParams, so a stray {{setvar}} in a prompt can't mutate
// chat/global variables or alter token-banning state on every guide run.
const BLOCKED_ST_MACROS = [
    // Variable write / mutation macros
    'setvar', 'setvarkey', 'addvar',
    'setglobalvar', 'setglobalvarkey', 'addglobalvar',
    'incvar', 'decvar', 'incglobalvar', 'decglobalvar',
    'deletevar', 'deleteglobalvar',
    // Token-banning side effect (Text Completion only, useless in prompt text)
    'banned',
    // Original-message substitution; only meaningful in character prompt overrides
    'original',
];

// Matches {{macroName}} or {{macroName::arg::...}} or {{macroName arg}}.
// Captures the macro name in group 1. Whitespace and flags before the name
// (e.g. "{{ # setvar }}") are tolerated by skipping leading non-word chars.
const ST_MACRO_PATTERN = /\{\{\s*[!#/?~]*\s*([A-Za-z][\w-]*)\b[^}]*\}\}/g;

// Variable-shorthand operators that perform writes (i.e. side effects).
// Matches `{{.name = ...}}`, `{{$name++}}`, `{{.name += ...}}`, etc. and
// consumes the entire macro body up to the closing }}.
const BLOCKED_SHORTHAND_PATTERN = /\{\{\s*[!#/?~]*\s*[.$]\s*[\w-]+\s*(?:\+\+|--|\+=|-=|\|\|=|\?\?=|=[?|]?)[^}]*\}\}/g;

function stripBlockedStMacros(text) {
    if (typeof text !== 'string' || text.length === 0) return text;

    const blocked = new Set(BLOCKED_ST_MACROS);
    const cleaned = text.replace(ST_MACRO_PATTERN, (full, name) => {
        return blocked.has(name.toLowerCase()) ? '' : full;
    });
    return cleaned.replace(BLOCKED_SHORTHAND_PATTERN, '');
}

/**
 * Run ST's substituteParams on a prompt, but only after GG's own
 * fillPromptTemplate has filled its private placeholders ({{input}} is left
 * for ST to resolve, {{correctionInstruction}}, {{message}}, {{instruction}},
 * {{pipe}}, {{tracker}}, etc. are filled by GG first) and after stripping any
 * blocked/side-effecting macros so a guide prompt can't mutate chat state.
 *
 * Order: GG fill -> strip blocked -> ST substituteParams.
 *
 * @param {string} prompt
 * @returns {string}
 */
export function expandStMacros(prompt) {
    const ctx = (() => {
        try {
            return typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function'
                ? SillyTavern.getContext()
                : null;
        } catch {
            return null;
        }
    })();

    const text = typeof prompt === 'string' ? prompt : String(prompt ?? '');

    if (!ctx || typeof ctx.substituteParams !== 'function') {
        // ST context not ready (very early calls). Fall back to a no-op so the
        // caller still gets a usable string; the only macros that would have
        // expanded are ST's, which would also have produced literals.
        return text;
    }

    try {
        return ctx.substituteParams(stripBlockedStMacros(text));
    } catch (error) {
        console.warn('[GuidedGenerations] substituteParams failed, using raw prompt:', error);
        return text;
    }
}

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
