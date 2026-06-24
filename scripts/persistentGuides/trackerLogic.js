/**
 * @file Contains the core tracker logic for automatically running trackers when enabled.
 * @description Handles the automatic execution of trackers based on chat metadata configuration.
 */

import { getContext, extensionName, debugLog, requestCompletion, shouldUseDirectCall, getPromptValue, fillPromptTemplate } from './guideExports.js'; // Import from central hub

/**
 * Executes the tracker logic automatically when triggered
 * @param {boolean} isAuto - Whether this is being auto-triggered
 * @param {boolean} force - Whether to force execution even if tracker is disabled (for manual execution)
 * @returns {Promise<void>}
 */
export async function executeTracker(isAuto = false, force = false) {
    try {
        const context = getContext();
        if (!context) {
            console.error('[GuidedGenerations] Context not available for tracker execution');
            return;
        }

        // Get tracker configuration from chat metadata
        const trackerConfig = context.chatMetadata?.[`${extensionName}_trackers`];
        if (!trackerConfig || (!trackerConfig.enabled && !force)) {
            debugLog('Tracker not enabled or not configured' + (force ? ' (but forcing execution)' : ''));
            if (!force) {
                return;
            }
        }

        debugLog('Executing tracker with config:', trackerConfig);

        // Check if the last message is a Stat Tracker note - if so, skip tracker execution
        // This check must happen BEFORE any profile switching to avoid switching profiles unnecessarily
        const lastMessage = context.chat[context.chat.length - 1];
        if (lastMessage?.extra?.type === 'stattracker') {
            debugLog('Last message is a Stat Tracker note, skipping tracker execution (likely deleted/broken generation)');
            return;
        }

        // Check if we need to switch to the tracker preset
        const globalSettings = context.extensionSettings?.[extensionName];
        debugLog('Debug - extensionName:', extensionName);
        debugLog('Debug - context.extensionSettings exists:', !!context.extensionSettings);
        debugLog('Debug - extensionSettings[extensionName]:', globalSettings);
        
        const trackerDetermineProfile = globalSettings?.profileTrackerDetermine;
        const trackerDeterminePreset = globalSettings?.presetTrackerDetermine;

        // Step 1: Generate guide content using the first prompt
        let guidePrompt = trackerConfig.guidePrompt;
        
        // If configured to include tracker context, add current tracker content
        if (trackerConfig.includeTrackerInGuide) {
            let currentTrackerContent = '';
            try {
                const listResult = await context.executeSlashCommandsWithOptions(
                    '/listinjects return=object',
                    { showOutput: false, handleExecutionErrors: true }
                );
                
                if (listResult && listResult.pipe) {
                    const injections = JSON.parse(listResult.pipe);
                    if (injections.tracker && injections.tracker.value) {
                        currentTrackerContent = injections.tracker.value;
                    }
                }
            } catch (error) {
                debugLog('Could not retrieve current tracker content for guide prompt, proceeding without it');
            }
            
            if (currentTrackerContent) {
                guidePrompt = `${trackerConfig.guidePrompt}\n\nCurrent Tracker:\n${currentTrackerContent}`;
            }
        }
        
        let guideContent = '';
        const useDetermineDirect = await shouldUseDirectCall(trackerDetermineProfile, trackerDeterminePreset);
        if (useDetermineDirect) {
            guideContent = await requestCompletion({
                profileName: trackerDetermineProfile,
                presetName: trackerDeterminePreset,
                prompt: guidePrompt,
                debugLabel: 'tracker:determine',
            });
        } else {
            const guideResult = await context.executeSlashCommandsWithOptions(
                `/gen ${guidePrompt}`,
                { showOutput: false, handleExecutionErrors: true }
            );
            guideContent = guideResult?.pipe || '';
        }

        if (!guideContent || guideContent.trim() === '') {
            console.error('[GuidedGenerations] Failed to generate guide content');
            return;
        }
        debugLog('Generated guide content:', guideContent);

        // Half second delay between the two tracker calls
        debugLog('Waiting 500ms before second tracker call...');
        await new Promise(resolve => setTimeout(resolve, 500));

        // Switch to tracker update profile and preset for the second call
        const trackerUpdateProfile = globalSettings?.profileTrackerUpdate;
        const trackerUpdatePreset = globalSettings?.presetTrackerUpdate;

        // Step 2: Get current tracker content to include in context
        let currentTrackerContent = '';
        try {
            const listResult = await context.executeSlashCommandsWithOptions(
                '/listinjects return=object',
                { showOutput: false, handleExecutionErrors: true }
            );
            
            if (listResult && listResult.pipe) {
                const injections = JSON.parse(listResult.pipe);
                if (injections.tracker && injections.tracker.value) {
                    currentTrackerContent = injections.tracker.value;
                }
            }
        } catch (error) {
            debugLog('Could not retrieve current tracker content, proceeding with empty context');
        }

        // Step 2: Generate tracker update using /genraw with the guide content and current tracker as contex
        const trackerPrompt = `${trackerConfig.trackerPrompt}\n\nLast Update:\n${guideContent}\n\nTracker:\n${currentTrackerContent}`;
        
        let trackerUpdate = '';
        const useUpdateDirect = await shouldUseDirectCall(trackerUpdateProfile, trackerUpdatePreset);
        if (useUpdateDirect) {
            trackerUpdate = await requestCompletion({
                profileName: trackerUpdateProfile,
                presetName: trackerUpdatePreset,
                prompt: trackerPrompt,
                debugLabel: 'tracker:update',
                includeChatHistory: false,
            });
        } else {
            const trackerResult = await context.executeSlashCommandsWithOptions(
                `/genraw ${trackerPrompt}`,
                { showOutput: false, handleExecutionErrors: true }
            );
            trackerUpdate = trackerResult?.pipe || '';
        }

        if (!trackerUpdate || trackerUpdate.trim() === '') {
            console.error('[GuidedGenerations] Failed to generate tracker update');
            console.error('[GuidedGenerations] trackerUpdate:', trackerUpdate);
            return;
        }
        debugLog('Generated tracker update:', trackerUpdate);
        debugLog('Tracker update length:', trackerUpdate?.length || 0);
        debugLog('Tracker update type:', typeof trackerUpdate);

        // Half second delay after the second tracker call
        debugLog('Waiting 500ms after second tracker call...');
        await new Promise(resolve => setTimeout(resolve, 700));

        // Step 3: Update the tracker injection
        if (trackerUpdate && trackerUpdate.trim()) {
            const injectionTemplate = await getPromptValue('tracker.trackerInjection', '');
            const injectionPrompt = fillPromptTemplate(injectionTemplate, { tracker: trackerUpdate });
            const injectionCommand = `/inject id=tracker position=chat scan=true depth=1 role=system ${injectionPrompt}`;
            await context.executeSlashCommandsWithOptions(injectionCommand, { 
                showOutput: false, 
                handleExecutionErrors: true 
            });
            debugLog('Tracker injection updated with content length:', trackerUpdate.length);
        } else {
            console.error('[GuidedGenerations] Tracker update is empty or undefined, skipping injection update');
        }

        // Step 4: Add a comment with the tracker update
        // Try using the standard comment command first, then fall back to custom creation
        await createTrackerNote(trackerUpdate, 'Stat Tracker', 'stattracker', guideContent);

        debugLog('Tracker execution completed successfully');

    } catch (error) {
        console.error('[GuidedGenerations] Error executing tracker:', error);
    }
}

/**
 * Checks if tracker should be auto-triggered and executes it if needed
 * @returns {Promise<void>}
 */
export async function checkAndExecuteTracker() {
    try {
        const context = getContext();
        if (!context) {
            return;
        }

        // Check if tracker is enabled in chat metadata
        const trackerConfig = context.chatMetadata?.[`${extensionName}_trackers`];
        if (trackerConfig && trackerConfig.enabled) {
            debugLog('Auto-triggering tracker');
            await executeTracker(true);
        }
    } catch (error) {
        console.error('[GuidedGenerations] Error checking tracker auto-trigger:', error);
    }
}

/**
 * Creates a custom tracker note in the chat
 * Uses the exact same pattern as sendCommentMessage for compatibility
 * @param {string} trackerUpdate - The tracker update content to display
 * @param {string} trackerName - The name to display for the tracker note
 * @param {string} trackerType - The type identifier for the tracker
 * @param {string} guideContent - The guide content that determined the changes (optional)
 * @returns {Promise<void>}
 */
export async function createTrackerNote(trackerUpdate, trackerName, trackerType, guideContent = null) {
    try {
        const context = getContext();
        if (!context || !context.chat) {
            console.error('[GuidedGenerations] Cannot create tracker note: context or chat not available');
            return;
        }

        debugLog(`[TrackerLogic] Creating ${trackerName} note...`);
        
        // Create the message object exactly like sendCommentMessage
        let messageContent = trackerUpdate;
        
        // Add HTML structure for stat trackers to match the CSS styling
        if (trackerType === 'stattracker') {
            // If we have guide content, include it in a separate details tag before the tracker update
            let detailsContent = '';
            
            if (guideContent) {
                detailsContent += `<details class="situational-tracker-details" data-tracker-type="guide-analysis">
    <summary>
        🔍 Analysis - Click to expand
    </summary>
    <div>
${guideContent}
    </div>
</details>`;
            }
            
            detailsContent += `<details class="situational-tracker-details" data-tracker-type="stattracker">
    <summary>
        📊 ${trackerName} - Click to expand
    </summary>
    <div>
${trackerUpdate}
    </div>
</details>`;
            
            messageContent = detailsContent;
        }
        
        const message = {
            name: trackerName,
            is_user: false,
            is_system: true,
            send_date: Date.now(),
            mes: messageContent,
            force_avatar: null,
            extra: {
                type: trackerType, // Custom type for tracker notes
                gen_id: Date.now(),
                isSmallSys: false,
                api: 'manual',
                model: 'tracker system',
            },
        };

        // Add the message to the end of the chat (push version like sendCommentMessage)
        context.chat.push(message);
        debugLog('[TrackerLogic] Message added to chat array. Chat length:', context.chat.length);
        
        // Follow the exact same pattern as sendCommentMessage
        await context.eventSource.emit('MESSAGE_SENT', (context.chat.length - 1));
        await context.addOneMessage(message);
        await context.eventSource.emit('USER_MESSAGE_RENDERED', (context.chat.length - 1));
        await context.saveChat();
        
        debugLog(`[TrackerLogic] ${trackerName} note created successfully using sendCommentMessage pattern`);
    } catch (error) {
        console.error(`[GuidedGenerations] Error creating ${trackerName} note:`, error);
    }
}
