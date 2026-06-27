import {
    getContext,
    extensionName,
    extension_settings,
    debugLog,
    debugWarn,
    getCurrentProfile,
    getProfileApiType,
    extractApiIdFromApiType,
    deactivateSendButtons,
    activateSendButtons,
    setExternalAbortController,
    setSendButtonState,
    getOpenAIPromptManagerHelpers,
} from '../persistentGuides/guideExports.js';

const TEXT_API_IDS = new Set([
    'textgenerationwebui',
    'kobold',
    'koboldhorde',
    'novel',
    'novelai',
    'textgen',
    'text',
    'llamacpp',
]);
const INTERNAL_HELPER_PRESET_VALUE = '__GG_INTERNAL_HELPER__';
const INTERNAL_HELPER_PRESET_DEFAULT_MAX_TOKENS = 4000;
const INTERNAL_HELPER_PRESET_CHAT_OVERRIDES = {
    prompts: [
        {
            name: 'Main Prompt',
            system_prompt: true,
            role: 'system',
            content: '[You are a utility assistant for an ongoing roleplay chat. Complete only the task given. Stay accurate and concise. Return only the requested output, with no preamble, explanation, labels, or meta-commentary.]',
            identifier: 'main',
            injection_position: 0,
            injection_depth: 4,
            forbid_overrides: true,
        },
        {
            name: 'NSFW Prompt',
            system_prompt: true,
            role: 'system',
            content: 'NSFW/Smut is allowed.',
            identifier: 'nsfw',
            injection_position: 0,
            injection_depth: 4,
            forbid_overrides: false,
        },
        { identifier: 'dialogueExamples', name: 'Chat Examples', system_prompt: true, marker: true },
        { name: 'Jailbreak Prompt', system_prompt: true, role: 'system', content: '', identifier: 'jailbreak', injection_position: 0, injection_depth: 4, forbid_overrides: false },
        { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
        { identifier: 'worldInfoAfter', name: 'World Info (after)', system_prompt: true, marker: true },
        { identifier: 'worldInfoBefore', name: 'World Info (before)', system_prompt: true, marker: true },
        { identifier: 'charDescription', name: 'Char Description', system_prompt: true, marker: true },
        { identifier: 'charPersonality', name: 'Char Personality', system_prompt: true, marker: true },
        { identifier: 'scenario', name: 'Scenario', system_prompt: true, marker: true },
        { identifier: 'personaDescription', name: 'Persona Description', system_prompt: true, marker: true },
    ],
    prompt_order: [
        {
            character_id: 100000,
            order: [
                { identifier: 'main', enabled: true },
                { identifier: 'worldInfoBefore', enabled: true },
                { identifier: 'charDescription', enabled: true },
                { identifier: 'charPersonality', enabled: true },
                { identifier: 'scenario', enabled: true },
                { identifier: 'nsfw', enabled: true },
                { identifier: 'worldInfoAfter', enabled: true },
                { identifier: 'dialogueExamples', enabled: true },
                { identifier: 'chatHistory', enabled: true },
                { identifier: 'jailbreak', enabled: true },
            ],
        },
        {
            character_id: 100001,
            order: [
                { identifier: 'main', enabled: true },
                { identifier: 'worldInfoBefore', enabled: true },
                { identifier: 'personaDescription', enabled: true },
                { identifier: 'charDescription', enabled: true },
                { identifier: 'scenario', enabled: true },
                { identifier: 'charPersonality', enabled: true },
                { identifier: 'nsfw', enabled: false },
                { identifier: 'worldInfoAfter', enabled: true },
                { identifier: 'dialogueExamples', enabled: true },
                { identifier: 'chatHistory', enabled: true },
                { identifier: 'jailbreak', enabled: false },
            ],
        },
    ],
};

function getInternalHelperPresetMaxTokens() {
    const raw = extension_settings[extensionName]?.internalHelperPresetMaxTokens;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return INTERNAL_HELPER_PRESET_DEFAULT_MAX_TOKENS;
    }
    return parsed;
}

// Strips character/persona/world-info prompt entries from the internal helper
// preset for tools (spellchecker, tracker) that should NOT receive identity
// context. Returns a new preset object (original is not mutated).
const IDENTITY_PROMPT_IDENTIFIERS = new Set([
    'charDescription',
    'charPersonality',
    'scenario',
    'personaDescription',
    'worldInfoBefore',
    'worldInfoAfter',
]);

function stripIdentityPromptsFromHelperPreset(preset) {
    if (!preset || typeof preset !== 'object') return preset;
    const stripped = structuredClone(preset);
    if (Array.isArray(stripped.prompts)) {
        stripped.prompts = stripped.prompts.filter((p) => p && !IDENTITY_PROMPT_IDENTIFIERS.has(p.identifier));
    }
    if (Array.isArray(stripped.prompt_order)) {
        stripped.prompt_order = stripped.prompt_order.map((entry) => ({
            ...entry,
            order: Array.isArray(entry?.order)
                ? entry.order.filter((o) => o && !IDENTITY_PROMPT_IDENTIFIERS.has(o.identifier))
                : entry?.order,
        }));
    }
    return stripped;
}

function resolveProfileByNameOrId(profileName, profiles = []) {
    if (!profileName) return null;
    return profiles.find((profile) => profile?.name === profileName || profile?.id === profileName) || null;
}

function resolveCompletionMode(profile, apiType, apiId) {
    const rawMode = profile?.mode ? String(profile.mode).toLowerCase() : '';
    if (rawMode.includes('text')) return 'text';
    if (rawMode.includes('chat')) return 'chat';

    const typeKey = (apiId || apiType || '').toLowerCase();
    if (TEXT_API_IDS.has(typeKey)) return 'text';
    return 'chat';
}

function extractCompletionText(result) {
    if (typeof result === 'string') return result;
    if (!result || typeof result !== 'object') return '';

    const candidates = [
        result.pipe,
        result.text,
        result.content,
        result?.choices?.[0]?.message?.content,
        result?.choices?.[0]?.text,
        result?.data?.choices?.[0]?.message?.content,
        result?.data?.choices?.[0]?.text,
    ];

    for (const value of candidates) {
        if (typeof value === 'string' && value.trim() !== '') {
            return value;
        }
    }
    return '';
}

function isRawChatMessage(message) {
    return !!message && typeof message === 'object' && 'mes' in message;
}

function normalizePresetName(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'object') {
        return (value.name || value.id || value.title || value.label || '').toString().trim();
    }
    return value.toString().trim();
}

async function getCurrentProfileAndPreset() {
    const context = getContext();
    if (!context) return { profileName: '', presetName: '' };

    const profileName = await getCurrentProfile();
    let presetName = '';
    try {
        const apiType = await getProfileApiType(profileName);
        const apiId = extractApiIdFromApiType(apiType) || apiType;
        const presetManager = context?.getPresetManager?.(apiId);
        const selectedPreset = presetManager?.getSelectedPreset?.();
        presetName = normalizePresetName(selectedPreset);
    } catch (error) {
        debugWarn(`[${extensionName}] Failed to resolve current preset:`, error);
    }
    return { profileName, presetName };
}

function resolvePresetNameFromManager(presetManager, presetValue) {
    if (!presetValue) return '';
    const presetName = normalizePresetName(presetValue);
    if (!presetName) return '';
    if (presetName === INTERNAL_HELPER_PRESET_VALUE) return presetName;
    if (!presetManager) return '';

    debugLog(`[${extensionName}] resolvePresetNameFromManager: input="${presetName}" manager=${!!presetManager}`);

    const presetList = presetManager.getPresetList?.();
    const presetNames = presetList?.preset_names;

    if (presetNames && !Array.isArray(presetNames)) {
        const entries = Object.entries(presetNames);
        debugLog(`[${extensionName}] resolvePresetNameFromManager: map entries=${entries.length}`);
        const matchByName = presetNames[presetName];
        debugLog(`[${extensionName}] resolvePresetNameFromManager: mapNameMatch=${matchByName ? presetName : ''}`);
        if (matchByName) return presetName;
        const matchById = entries.find(([, id]) => String(id) === presetName);
        debugLog(`[${extensionName}] resolvePresetNameFromManager: mapMatch=${matchById ? matchById[0] : ''}`);
        if (matchById) return matchById[0];
    }

    const namesArray = Array.isArray(presetNames) ? presetNames : [];
    debugLog(`[${extensionName}] resolvePresetNameFromManager: list size=${namesArray.length}`);
    const directMatch = namesArray.find((name) => String(name) === presetName);
    debugLog(`[${extensionName}] resolvePresetNameFromManager: listMatch=${directMatch || ''}`);
    if (directMatch) return directMatch;

    const asIndex = Number.parseInt(presetName, 10);
    if (!Number.isNaN(asIndex)) {
        const nameFromIndex = namesArray[asIndex] || '';
        debugLog(`[${extensionName}] resolvePresetNameFromManager: indexMatch=${nameFromIndex || ''}`);
        if (nameFromIndex) return nameFromIndex;
    }

    if (typeof presetManager.getCompletionPresetByName === 'function' && Number.isNaN(asIndex)) {
        const preset = presetManager.getCompletionPresetByName(presetName);
        debugLog(`[${extensionName}] resolvePresetNameFromManager: byName="${presetName}" found=${!!preset}`);
        if (preset) return presetName;
    }

    return '';
}

function buildPresetOverridePayload(presetManager, presetName, apiId, mode = 'chat') {
    if (!presetName) return {};
    if (presetName === INTERNAL_HELPER_PRESET_VALUE) {
        if (mode !== 'chat') return {};
        const payload = structuredClone(INTERNAL_HELPER_PRESET_CHAT_OVERRIDES);
        payload.max_tokens = getInternalHelperPresetMaxTokens();
        return payload;
    }
    if (!presetManager) return {};
    const preset = presetManager.getCompletionPresetByName?.(presetName);
    if (!preset) {
        debugWarn(`[${extensionName}] buildPresetOverridePayload: preset "${presetName}" not found.`);
        return {};
    }
    const presetKeys = Object.keys(preset || {});
    debugLog(`[${extensionName}] buildPresetOverridePayload: preset keys=${presetKeys.join(',')}`);

    if (mode === 'text') {
        const payload = structuredClone(preset);
        const blocklist = new Set([
            'chat_completion_source',
            'openai_model',
            'claude_model',
            'openrouter_model',
            'openrouter_use_fallback',
            'openrouter_group_models',
            'openrouter_sort_models',
            'openrouter_providers',
            'openrouter_allow_fallbacks',
            'openrouter_middleout',
            'ai21_model',
            'mistralai_model',
            'cohere_model',
            'perplexity_model',
            'groq_model',
            'chutes_model',
            'chutes_sort_models',
            'siliconflow_model',
            'electronhub_model',
            'electronhub_sort_models',
            'electronhub_group_models',
            'nanogpt_model',
            'deepseek_model',
            'aimlapi_model',
            'xai_model',
            'pollinations_model',
            'moonshot_model',
            'fireworks_model',
            'cometapi_model',
            'custom_model',
            'custom_url',
            'custom_include_body',
            'custom_exclude_body',
            'custom_include_headers',
            'custom_prompt_post_processing',
            'google_model',
            'vertexai_model',
            'zai_model',
            'zai_endpoint',
            'reverse_proxy',
            'proxy_password',
            'azure_base_url',
            'azure_deployment_name',
            'azure_api_version',
            'azure_openai_model',
            'model',
            'api_type',
            'api_server',
            'preset_name',
            'name',
            'id',
            'extensions',
        ]);

        for (const key of blocklist) {
            delete payload[key];
        }

        if (payload.temp !== undefined && payload.temperature === undefined) {
            payload.temperature = payload.temp;
        }

        if (payload.seed !== undefined) {
            const parsedSeed = Number(payload.seed);
            if (!Number.isInteger(parsedSeed) || parsedSeed < 0) {
                delete payload.seed;
            } else {
                payload.seed = parsedSeed;
            }
        }

        debugLog(`[${extensionName}] buildPresetOverridePayload: text payload keys=${Object.keys(payload).join(',')}`);
        return payload;
    }

    const payload = {};
    const allowlist = new Set([
        'temperature',
        'top_p',
        'top_k',
        'top_a',
        'min_p',
        'repetition_penalty',
        'presence_penalty',
        'frequency_penalty',
        'max_tokens',
        'openai_max_tokens',
        'stop',
        'logit_bias',
        'seed',
        'n',
        'response_format',
        'tool_choice',
        'tools',
        'function_call',
        'functions',
        'reasoning_effort',
        'verbosity',
        'enable_web_search',
        'request_images',
        'request_image_aspect_ratio',
        'request_image_resolution',
        'extensions',
        'stream_openai',
        'prompts',
        'prompt_order',
        'names_behavior',
        'send_if_empty',
        'bias_preset_selected',
        'wi_format',
        'scenario_format',
        'personality_format',
        'group_nudge_prompt',
        'assistant_prefill',
        'assistant_impersonation',
        'use_sysprompt',
        'squash_system_messages',
        'continue_prefill',
        'continue_postfix',
        'continue_nudge_prompt',
        'new_chat_prompt',
        'new_group_chat_prompt',
        'new_example_chat_prompt',
        'impersonation_prompt',
    ]);

    const promptKeyPattern = /_prompt$/i;
    presetKeys.forEach((key) => {
        if (allowlist.has(key) || promptKeyPattern.test(key)) {
            payload[key] = preset[key];
        }
    });

    const apiKey = (apiId || '').toLowerCase();
    if (apiKey === 'openai') {
        if (payload.openai_max_tokens !== undefined && payload.max_tokens === undefined) {
            payload.max_tokens = payload.openai_max_tokens;
        }
        delete payload.openai_max_tokens;
    }

    if (payload.seed !== undefined) {
        const parsedSeed = Number(payload.seed);
        if (!Number.isInteger(parsedSeed) || parsedSeed < 0) {
            delete payload.seed;
        } else {
            payload.seed = parsedSeed;
        }
    }

    debugLog(`[${extensionName}] buildPresetOverridePayload: payload keys=${Object.keys(payload).join(',')}`);
    return payload;
}

function emitGenerationEvent(context, eventType, payload = {}) {
    if (!context?.eventSource || !context?.eventTypes?.[eventType]) return;
    try {
        context.eventSource.emit(context.eventTypes[eventType], payload);
    } catch (error) {
        debugWarn(`[${extensionName}] Failed to emit ${eventType}:`, error);
    }
}

function getOpenAIPresetByName(helpers, presetName) {
    if (!helpers?.openai_settings || !helpers?.openai_setting_names || !presetName) return null;
    const presetIndex = helpers.openai_setting_names[presetName];
    if (presetIndex === undefined) return null;
    const preset = helpers.openai_settings[presetIndex];
    if (!preset) return null;
    return structuredClone(preset);
}

async function buildChatMessagesWithPromptManager(context, baseMessages, presetName = '', options = {}) {
    const helpers = await getOpenAIPromptManagerHelpers();
    if (!helpers?.prepareOpenAIMessages || !helpers?.setupChatCompletionPromptManager) {
        debugWarn(`[${extensionName}] Prompt manager helpers unavailable, using base messages.`);
        return baseMessages || [];
    }

    const { includeIdentityContext = true } = options;
    const originalSettings = structuredClone(helpers.oai_settings || {});

    // Some persona integrations (e.g. MultiPersonaComposer) merge their
    // descriptions directly into powerUserSettings.persona_description, which
    // the OpenAI prompt manager reads at build time — bypassing the params we
    // pass. When identity context is disabled, temporarily blank those fields
    // and restore them afterwards. This is safe regardless of whether such an
    // integration is installed.
    const powerUserSettings = context?.powerUserSettings;
    const PERSONA_DESCRIPTION_FIELDS = [
        'persona_description',
        'persona_description_position',
        'persona_description_depth',
        'persona_description_role',
        'persona_description_lorebook',
    ];
    const originalPersonaDescription = {};
    let personaDescriptionWasBlanked = false;
    if (!includeIdentityContext && powerUserSettings && typeof powerUserSettings === 'object') {
        for (const key of PERSONA_DESCRIPTION_FIELDS) {
            if (key in powerUserSettings) {
                originalPersonaDescription[key] = powerUserSettings[key];
                personaDescriptionWasBlanked = true;
            }
        }
        if (personaDescriptionWasBlanked) {
            for (const key of PERSONA_DESCRIPTION_FIELDS) {
                powerUserSettings[key] = '';
            }
            debugLog(`[${extensionName}] buildChatMessagesWithPromptManager: temporarily blanked persona description fields for identity-less request.`);
        }
    }

    let preset = null;
    if (presetName === INTERNAL_HELPER_PRESET_VALUE) {
        preset = structuredClone(INTERNAL_HELPER_PRESET_CHAT_OVERRIDES);
        preset.max_tokens = getInternalHelperPresetMaxTokens();
        if (!includeIdentityContext) {
            preset = stripIdentityPromptsFromHelperPreset(preset);
        }
    } else {
        preset = getOpenAIPresetByName(helpers, presetName);
        if (!preset) {
            debugLog(`[${extensionName}] buildChatMessagesWithPromptManager: preset "${presetName}" not found in openai settings.`);
        }
    }

    // When identity context is explicitly disabled (e.g. spellchecker/tracker),
    // also drop the live character/persona descriptions from the request params
    // regardless of which preset is in use, so the LLM only sees the task prompt.
    const stripIdentityFromParams = !includeIdentityContext;

    try {
        if (preset) {
            Object.assign(helpers.oai_settings, preset);
            if (preset.names_in_completion === true && helpers.oai_settings.names_behavior === undefined) {
                helpers.oai_settings.names_behavior = 1;
            }
            if (preset.assistant_prefill !== undefined && helpers.oai_settings.assistant_impersonation === undefined) {
                helpers.oai_settings.assistant_impersonation = preset.assistant_prefill;
            }
        }

        helpers.setupChatCompletionPromptManager(helpers.oai_settings);
        const { prompt = '', includeChatHistory = true } = options;
        const rawPrompt = typeof prompt === 'string' ? prompt.trim() : '';
        let resolvedBaseMessages = baseMessages;
        if (!Array.isArray(resolvedBaseMessages) || resolvedBaseMessages.length === 0) {
            resolvedBaseMessages = includeChatHistory
                ? helpers.setOpenAIMessages?.(context?.chat || []) || []
                : [];
        } else if (isRawChatMessage(resolvedBaseMessages[0])) {
            resolvedBaseMessages = helpers.setOpenAIMessages?.(resolvedBaseMessages) || [];
        }

        if (rawPrompt) {
            // setOpenAIMessages returns newest-first, so prepend the new prompt
            resolvedBaseMessages = [{ role: 'user', content: rawPrompt }, ...(resolvedBaseMessages || [])];
        }

        const resolvedExamples = Array.isArray(context?.messageExamples)
            ? helpers.setOpenAIMessageExamples?.(context.messageExamples) || context.messageExamples
            : [];

        const character = context?.characters?.[context?.characterId] || {};
        const params = {
            name2: context?.name2 || character?.name || '',
            charDescription: stripIdentityFromParams ? '' : (character?.description || ''),
            charPersonality: stripIdentityFromParams ? '' : (character?.personality || ''),
            scenario: stripIdentityFromParams ? '' : (character?.scenario || ''),
            worldInfoBefore: stripIdentityFromParams ? '' : (context?.worldInfoBefore || ''),
            worldInfoAfter: stripIdentityFromParams ? '' : (context?.worldInfoAfter || ''),
            bias: context?.bias || '',
            type: 'normal',
            quietPrompt: context?.quietPrompt || '',
            quietImage: context?.quietImage || '',
            extensionPrompts: context?.extensionPrompts || [],
            cyclePrompt: context?.cyclePrompt || '',
            systemPromptOverride: context?.systemPromptOverride || '',
            jailbreakPromptOverride: context?.jailbreakPromptOverride || '',
            messages: resolvedBaseMessages || [],
            messageExamples: resolvedExamples,
        };
        const [messages] = await helpers.prepareOpenAIMessages(params, false);
        if (Array.isArray(messages) && messages.length > 0) {
            debugLog(
                `[${extensionName}] buildChatMessagesWithPromptManager: built ${messages.length} messages (base=${baseMessages?.length || 0})`
            );
            return messages;
        }
    } catch (error) {
        debugWarn(`[${extensionName}] Failed to build messages with prompt manager:`, error);
    } finally {
        Object.assign(helpers.oai_settings, originalSettings);
        if (personaDescriptionWasBlanked) {
            for (const key of PERSONA_DESCRIPTION_FIELDS) {
                if (key in originalPersonaDescription) {
                    powerUserSettings[key] = originalPersonaDescription[key];
                } else {
                    delete powerUserSettings[key];
                }
            }
        }
    }

    return baseMessages;
}

export async function shouldUseDirectCall(profileName = '', presetName = '') {
    const targetProfile = (profileName || '').trim();
    const targetPreset = (presetName || '').trim();
    if (!targetProfile && !targetPreset) return false;

    const context = getContext();
    if (!context) return false;

    if (targetPreset && targetPreset !== INTERNAL_HELPER_PRESET_VALUE) {
        const apiType = await getProfileApiType(targetProfile || (await getCurrentProfile()));
        const apiId = extractApiIdFromApiType(apiType) || apiType;
        const presetManager = context?.getPresetManager?.(apiId);
        debugLog(`[${extensionName}] shouldUseDirectCall: apiType="${apiType}", apiId="${apiId}", targetPreset="${targetPreset}"`);
        const resolvedPreset = resolvePresetNameFromManager(presetManager, targetPreset);
        debugLog(`[${extensionName}] shouldUseDirectCall: resolvedPreset="${resolvedPreset || ''}"`);
        if (!resolvedPreset) {
            debugWarn(`[${extensionName}] Preset "${targetPreset}" not found for api "${apiId}", using default call.`);
            return false;
        }
    } else if (targetPreset === INTERNAL_HELPER_PRESET_VALUE) {
        const apiType = await getProfileApiType(targetProfile || (await getCurrentProfile()));
        const apiId = extractApiIdFromApiType(apiType) || apiType;
        if (TEXT_API_IDS.has((apiId || '').toLowerCase())) {
            return false;
        }
        return true;
    }

    const { profileName: currentProfile, presetName: currentPreset } = await getCurrentProfileAndPreset();
    debugLog(`[${extensionName}] shouldUseDirectCall: currentProfile="${currentProfile}", currentPreset="${currentPreset}"`);
    if (targetProfile && currentProfile && targetProfile === currentProfile) {
        if (!targetPreset) return false;
        if (currentPreset && (currentPreset === targetPreset || currentPreset.includes(targetPreset))) {
            return false;
        }
    }
    return true;
}

export async function requestCompletion({
    profileName = '',
    presetName = '',
    prompt = '',
    messages = null,
    requestOverrides = {},
    optionsOverrides = {},
    debugLabel = '',
    includeChatHistory = true,
    includeIdentityContext = true,
} = {}) {
    const context = getContext();
    if (!context) {
        debugWarn(`[${extensionName}] requestCompletion: Context unavailable ${debugLabel ? `(${debugLabel})` : ''}`);
        return '';
    }

    const profiles = context?.extensionSettings?.connectionManager?.profiles || [];
    const selectedProfileId = context?.extensionSettings?.connectionManager?.selectedProfile || '';

    let profile = resolveProfileByNameOrId(profileName, profiles);
    if (!profile && selectedProfileId) {
        profile = profiles.find((entry) => entry?.id === selectedProfileId) || null;
    }
    if (!profile) {
        debugWarn(`[${extensionName}] requestCompletion: Profile not found "${profileName}" ${debugLabel ? `(${debugLabel})` : ''}`);
    }

    const resolvedProfileName = profile?.name || profileName || selectedProfileId || 'unknown';
    const apiType = profile?.api || (await getProfileApiType(resolvedProfileName));
    const apiId = extractApiIdFromApiType(apiType) || apiType;
    const mode = resolveCompletionMode(profile, apiType, apiId);

    const service = mode === 'text' ? context?.TextCompletionService : context?.ChatCompletionService;
    if (!service || typeof service.processRequest !== 'function') {
        debugWarn(`[${extensionName}] requestCompletion: ${mode} completion service unavailable ${debugLabel ? `(${debugLabel})` : ''}`);
        return '';
    }

    const requestData = { ...requestOverrides };
    if (mode === 'text') {
        requestData.prompt = typeof prompt === 'string' ? prompt : '';
    } else if (Array.isArray(messages) && messages.length > 0) {
        requestData.messages = messages;
    } else {
        requestData.messages = null;
    }

    if (profile?.model) {
        requestData.model = profile.model;
    }

    const presetManager = context?.getPresetManager?.(apiId);
    const resolvedPresetName = resolvePresetNameFromManager(presetManager, presetName);

    if (mode === 'chat') {
        requestData.messages = await buildChatMessagesWithPromptManager(
            context,
            requestData.messages,
            resolvedPresetName,
            { prompt, includeChatHistory, includeIdentityContext }
        );
    }

    const options = {
        presetName: resolvedPresetName || undefined,
        instructName: profile?.instruct || undefined,
        ...optionsOverrides,
    };

    const connectionManagerService = context?.ConnectionManagerRequestService;
    const canUseConnectionManager = !!(connectionManagerService?.sendRequest && profile?.id);

    let originalType = null;
    if (apiId && typeof service.TYPE === 'string' && service.TYPE !== apiId) {
        originalType = service.TYPE;
        service.TYPE = apiId;
    }

    try {
        debugLog(`[${extensionName}] requestCompletion: ${mode} request using profile "${resolvedProfileName}", preset "${resolvedPresetName || 'default'}" ${debugLabel ? `(${debugLabel})` : ''}`);

        const abortController = new AbortController();
        setExternalAbortController?.(abortController);
        setSendButtonState?.(true);
        deactivateSendButtons?.();

        if (canUseConnectionManager) {
            const maxTokens = requestOverrides?.max_tokens ?? requestOverrides?.maxTokens;
            const custom = {
                includePreset: false,
                extractData: true,
                signal: abortController.signal,
            };

            const overridePayload = buildPresetOverridePayload(presetManager, resolvedPresetName, apiId, mode);
            if (Array.isArray(requestData.messages)) {
                overridePayload.messages = requestData.messages;
            }
            debugLog(`[${extensionName}] requestCompletion: using ConnectionManagerRequestService for profile "${resolvedProfileName}" includePreset=false`);
            emitGenerationEvent(context, 'GENERATION_STARTED', { source: extensionName });
            const promptPayload = mode === 'chat' ? requestData.messages : typeof prompt === 'string' ? prompt : '';
            const result = await connectionManagerService.sendRequest(
                profile.id,
                promptPayload,
                maxTokens,
                custom,
                overridePayload
            );
            emitGenerationEvent(context, 'GENERATION_ENDED', { source: extensionName });
            return extractCompletionText(result);
        }

        emitGenerationEvent(context, 'GENERATION_STARTED', { source: extensionName });
        const result = await service.processRequest(requestData, options, true, abortController.signal);
        emitGenerationEvent(context, 'GENERATION_ENDED', { source: extensionName });
        return extractCompletionText(result);
    } catch (error) {
        emitGenerationEvent(context, 'GENERATION_STOPPED', { source: extensionName });
        debugWarn(`[${extensionName}] requestCompletion failed ${debugLabel ? `(${debugLabel})` : ''}:`, error);
        return '';
    } finally {
        activateSendButtons?.();
        setSendButtonState?.(false);
        setExternalAbortController?.(null);
        if (originalType) {
            service.TYPE = originalType;
        }
    }
}

