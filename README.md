<p align="center">
  <img src="Media/GG Logo Text.png" alt="Guided Generations" width="600">
</p>

# Guided Generations Extension for SillyTavern

This extension brings the full power of the original "Guided Generations" Quick Reply set to SillyTavern as a native extension. It provides modular, context-aware tools for shaping, refining, and guiding AI responses—ideal for roleplay, story, and character-driven chats. All features are accessible via intuitive buttons and menus integrated into the SillyTavern UI.

See [`JSDoc.md`](./JSDoc.md) for code-level documentation.

---

## Table of Contents
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Settings](#settings)
- [Troubleshooting](#troubleshooting)
- [License](#license)
- [Contributing](#contributing)

---

## Features

### 🐕 Guided Response
*Inject instructions before the AI replies.*
- Type instructions and press 🐕.
- Your instructions guide the next AI response.
- [Video Example](https://youtube.com/shorts/yxdtbF3NxW4?feature=share)

### 👈 Guided Swipe
*Regenerate the last AI message with new guidance.*
- Enter new instructions and press 👈 to generate a new swipe.
- Only available if the last message is from the AI.
- [Video Example](https://youtube.com/shorts/GRQ9l_8K6-Y?feature=share)

### Impersonation (1st: 👤, 2nd: 👥, 3rd: 🗣️)
*Expand outlines into rich, in-character narratives.*
- Enter a brief outline, select perspective (toggle in settings), and press the corresponding button (👤/👥/🗣️).
- Your outline is expanded into a full message from the chosen viewpoint.
- Can be hidden or displayed individually per settings. 1st Person is displayed by default.
- Video Examples:
  - [1st Person](https://youtube.com/shorts/FT5gv3d2kE4?feature=share)
  - [2nd Person](https://youtube.com/shorts/80l12LrtBpQ?feature=share)
  - [3rd Person](https://youtube.com/shorts/wWka-1URLPg?feature=share)

### 📖 Persistent Guides Menu
*Manage persistent scenario context.*
- Click the 📖 button to open the persistent guides menu.
- Select a guide type (see below) to generate or manage context.

**Guide Types:**
  - 🗺️ Situational: Generate context from recent chat or user focus.
  - 🧠 Thinking: Generate character thoughts (auto-trigger optional).
  - 👕 Clothes: Describe character outfits (auto-trigger optional).
  - 🧍 State: Detail character positions/status (auto-trigger optional).
  - 📜 Rules: Define or update in-story rules.
  - ➕ Custom: Inject user-defined context.

**Management Actions:**
  - ✏️ Edit Guides: Modify existing guide injections via popup.
  - 👁️ Show Guides: Display all active guides.
  - 🗑️ Flush Guides: Remove selected or all guides.
- Auto-trigger for Thinking, Clothes, and State can be toggled in settings.

### 🔖 Tools Menu
*Access additional utilities*
  - **🔧 Corrections:** Edit the last AI message with targeted instructions.
  - **🧩 Separated Thinking:** Analyze the currently shown AI message against the full chat and generate a corrected version as a new swipe. Can also run automatically after normal replies and swipe generations.
  - **✅ Spellchecker:** Polish your input for grammar, punctuation, and flow.
  - **✈️ Simple Send:** Send input as a user message without triggering a model response.
  - **🖋️ Edit Intros:** Rewrite or transform introductory messages on demand.
  - **↩️ Input Recovery:** Restore previously cleared input.

---

## Installation

1. **Install the Extension:**
   - In the Extensionmanager click on Install Extension and enter https://github.com/Samueras/GuidedGenerations-Extension/ as the GITHUB


---

## Usage

- All main features appear as buttons next to the send button or in the left-side gear menu.
- Hover tooltips and context menus provide guidance and quick access to advanced features.
- See in-app settings for feature toggles and auto-guide configuration.
- For full technical details, see [`JSDoc.md`](./JSDoc.md).

---

## ⚙️ Settings

All extension settings are managed via SillyTavern’s Extension Settings panel:

- **Auto-Trigger**: toggle automatic execution of:
  - Thinking Guide
  - State Guide
  - Clothes Guide
  - Custom Auto Guide
  - Separated Thinking, which runs after a generated assistant message and creates a corrected swipe.

- **Buttons Visibility**: show or hide action buttons:
  - 1st Person Impersonation (👤)
  - 2nd Person Impersonation (👥)
  - 3rd Person Impersonation (🗣️)
  - Guided Response (🐕)
  - Guided Swipe (👈)
  - Persistent Guides Menu (📖)
  - Optional tool buttons such as Corrections, Spellchecker, Edit Intros, and Separated Thinking.

- **Injection Role**: select the role (`system`, `assistant`, or `user`) used when injecting instructions.

- **Debug Mode**: when enabled, shows detailed debug information in the browser console. Useful for troubleshooting but can clutter the console during normal use.

- **Presets & Profiles**: for each guide/tool (Clothes, State, Thinking, Situational, Rules, Custom, Corrections, Separated Thinking, Spellchecker, Edit Intros, Fun Prompts, Impersonation 1st/2nd/3rd, and the Stat Tracker's two calls), pick an API connection profile and a preset baseline. The extension builds the request from your selected profile/preset directly (it no longer globally switches your active profile during a guide run), so each tool can use a different model without disrupting your main chat connection.

  **GG Internal Helper Preset** is available (and set as the default) for the guides and tools that benefit from a helper-oriented prompt stack — Clothes, State, Thinking, Situational, Rules, Custom, Custom Auto, Corrections, Separated Thinking, Spellchecker, and both Stat Tracker calls. It keeps your current profile's model/context/temperature settings but swaps in a focused helper prompt layout and a configurable Max Response Tokens value (set in the same section). Choose **None** for any of them if you'd rather use your active preset as-is. The internal helper preset is intentionally hidden for Impersonation, Edit Intros, and Fun Prompts, since those need your full chat/character context.

- **Prompt Files and Overrides**: default prompt templates are stored in [`prompts.json`](./prompts.json), so they can be edited outside SillyTavern. The Extension Settings prompt fields show the effective prompt, but the file remains the default source unless **Use settings override** is enabled for that prompt. Editing a prompt in settings turns that override on automatically; disabling it makes the extension use `prompts.json` again. The settings panel also includes a button to download the default `prompts.json` from GitHub.

  Use `{{input}}` for your input text and other placeholders as supported. Prompt coverage includes:
  - Clothes Guide Prompt
  - State Guide Prompt
  - Thinking Guide Prompt
  - Situational Guide Prompt
  - Rules Guide Prompt
  - Corrections Prompt
  - Separated Thinking Prompt
  - Spellchecker Prompt
  - Impersonate 1st/2nd/3rd Person Prompts
  - Guided Continue Prompt
  - Guided Response Prompt
  - Guided Swipe Prompt
  - Custom Auto Guide Prompt
  - Edit Intros option and wrapper prompts
  - Persistent guide injection wrappers and tracker default prompts

---

## Troubleshooting

- **Missing Buttons:** Ensure SillyTavern is up to date (v1.12.9+) and LALib is installed/enabled.
- **Context Menus Not Appearing:** Try switching chats or re-adding the extension in the Quick Replies menu.
- **Other Issues:** Restart SillyTavern, check for updates, and consult the [SillyTavern documentation](https://github.com/SillyTavern/SillyTavern).

---

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.

---

## Contributing

Contributions are welcome! Submit pull requests or open issues for improvements, features, or documentation. For questions or feedback, open an issue in this repository.

---

## ❤️ Support the Project

If you find this extension helpful, please consider supporting my work:

- [☕ Buy me a coffee on Ko-fi](https://ko-fi.com/samueras)
