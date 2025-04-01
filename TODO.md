# SillyTavern Guided Generations Extension - TODO List

This list outlines the steps to develop the Guided Generations extension based on the `SCOPE.md`.

**Placement Key:**
*   `(Send)`: Button placed next to the main Send button.
*   `(Menu)`: Item placed inside the left-side Tools Menu (⚙️).
*   `(Panel)`: Item/button placed inside a dedicated modal/panel (e.g., Settings, Persistent Guides).

**Phase 1: Project Setup & Foundation**

1.  [x] **Understand SillyTavern Extension Structure:**
    *   [x] Analyze existing extensions in `References/SillyTavern` (look for patterns: `public/extensions/`, `script.js`, `style.css`, manifests).
    *   [x] Identify extension registration, UI element addition, and core API interaction methods.
2.  [x] **Create Basic Extension Files:**
    *   [x] `script.js` (Main logic)
    *   [x] `style.css` (Styling)
    *   [x] `config.json` / `manifest.json` (If needed)
    *   [x] `README.md` (Initial description)
3.  [x] **Basic UI Integration:**
    *   [x] Register the extension with SillyTavern.
    *   [x] Add a primary UI entry point (e.g., button/menu).

**Phase 2: Core Feature Implementation (Simpler Features)**

4.  [x] **Input Recovery (🛟) `(Menu)`:**
    *   [x] UI element in Tools Menu.
    *   [x] Implement temporary `old_input` storage.
    *   [x] Add UI element to restore `old_input`.
5.  [x] **Simple Send (➕) `(Menu)`:**
    *   [x] UI element in Tools Menu.
    *   [x] Add UI element.
    *   [x] Use SillyTavern API to send message without AI reply.
6.  [ ] **Guided Response (🦮) `(Send)`:**
    *   [] Add UI element next to Send Button.
    *   [] Store `old_input`.
    *   [] Use API to inject context (`instruct` ID).
    *   [ ] Use API to trigger AI response.
    *   [ ] Restore `old_input`.
    *   [ ] *Later:* Add group chat selection logic.
7.  [ ] **Guided Swipe (➡️) `(Send)`:**
    *   [ ] Add UI element next to Send Button.
    *   [ ] Check last message author.
    *   [ ] Store `old_input`.
    *   [ ] Use API to inject context.
    *   [ ] Use API to trigger swipe.
    *   [ ] Restore `old_input`.
8.  [ ] **Guided Impersonation (✍️, ✍️2, ✍️3) `(Send)`:**
    *   [ ] Add UI elements (consider initial visibility) next to Send Button.
    *   [ ] Use API for impersonation with correct perspective instructions.
    *   [ ] Implement `old_input`/`new_input` check logic.

**Phase 3: Persistent Guides Implementation (Complex)**

9.  [ ] **Persistent State Management:**
    *   [ ] Choose storage mechanism for active guides.
    *   [ ] Map SillyTavern APIs for `inject`, `listinjects`, `flushinjects` to required IDs (`situation`, `thinking`, `clothes`, `state`, `rule_guide`, `Custom`).
10. [ ] **Persistent Guides UI - Main Access `(Menu)`:**
    *   [ ] Add entry point in Tools Menu to open a dedicated panel/modal.
    *   [ ] Create main UI panel/modal.
11. [ ] **Show/Flush Guides `(Panel)`:**
    *   [ ] Implement "Show Guides" button inside Persistent Guides panel.
    *   [ ] Implement "Flush Guides" button inside Persistent Guides panel.
12. [ ] **Edit/Custom Guides `(Panel)`:**
    *   [ ] Implement "Edit Guides" button inside Persistent Guides panel.
    *   [ ] Implement "Custom Guide" button/area inside Persistent Guides panel.
13. [ ] **Guide Generation (using `/gen` equivalent) `(Panel)`:**
    *   [ ] Identify SillyTavern API for prompted generation.
    *   [ ] Implement generation buttons/controls inside Persistent Guides panel.
    *   [ ] Handle preset switching if needed.
    *   [ ] Inject generated content with correct IDs.

**Phase 4: Settings & Finalization**

14. [ ] **Settings UI `(Menu)`:**
    *   [ ] Create settings UI section/modal, accessed via Tools Menu.
    *   [ ] Add toggles `(Panel)` for auto-triggers and impersonation visibility inside Settings panel.
15. [ ] **Styling & Polish:**
    *   [ ] Refine UI with `style.css`.
    *   [ ] Ensure consistency.
16. [ ] **Testing & Debugging:**
    *   [ ] Test all features thoroughly.
    *   [ ] Debug issues.
17. [ ] **Documentation:**
    *   [ ] Update `README.md` with final instructions and usage.

**Phase 5: Character Description Management (New Feature)**

18. [ ] **Storage Design:**
    *   [ ] Determine storage for: Original (reference), Current Updated, Previous Updated descriptions (e.g., `localStorage` keyed by character ID).
19. [ ] **API Identification:**
    *   [ ] Find API to get original description.
    *   [ ] Find API to get relevant chat history.
    *   [ ] Find API/method to override description used by AI (context injection? direct data mod?).
    *   [ ] Find API for LLM generation (`/gen`).
20. [ ] **Update Logic Implementation:**
    *   [ ] Develop LLM prompt for description update.
    *   [ ] Implement logic: Trigger LLM -> Store New (Current Updated) -> Move Old (Current Updated) to Previous Updated.
21. [ ] **Context Override Implementation:**
    *   [ ] Ensure the Current Updated description is prioritized by the AI.
22. [ ] **Revert Logic Implementation:**
    *   [ ] Implement function to swap Current Updated and Previous Updated descriptions.
    *   [ ] Ensure AI context uses the reverted description.
23. [ ] **UI Elements for Description Update `(Panel)`:**
    *   [ ] Add UI button `(Panel)` to trigger description update.
    *   [ ] Add UI button `(Panel)` to revert to previous updated description (enable only if previous exists).
