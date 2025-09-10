# No Leftovers - Obsidian Plugin

An LLM-assisted task capture plugin for Obsidian that automatically extracts actionable tasks from your journal notes using OpenAI's API.

## Features

- **AI-Powered Task Extraction**: Uses OpenAI's API to intelligently extract 3-7 actionable tasks from your journal notes
- **Master File Management**: Automatically appends tasks to a centralized "No Leftovers" file or the file of your choice.
- **Smart Deduplication**: Prevents duplicate tasks from being added to your master file
- **Wikilink Integration**: Tasks include clickable links back to the source note
- **Flexible Configuration**: Customizable settings for API key, model, file paths, and more
- **Easy Access**: Ribbon icon and command palette integration for quick access

## Installation

1. Copy this plugin folder to your Obsidian vault's `.obsidian/plugins/` directory
2. Enable the plugin in Obsidian's Community Plugins settings
3. Configure your OpenAI API key in the plugin settings

## Usage

1. **Configure Settings**: Go to Settings → Community Plugins → No Leftovers and set your OpenAI API key
2. **Open a Journal Note**: Open any note you want to extract tasks from
3. **Capture Tasks**: Either:
   - Click the list icon in the ribbon
   - Use Command Palette (`Cmd+P` / `Ctrl+P`) and search for "No Leftovers: Capture tasks from current note"

## Settings

- **OpenAI API Key**: Your OpenAI API key (required)
- **Model Name**: OpenAI model to use (default: gpt-4o-mini)
- **Master File Path**: Path to the file where tasks will be stored (default: "No Leftovers.md")
- **Date Format**: Moment.js format for task dates (default: "YYYY-MM-DD")
- **Max Tasks**: Maximum number of tasks to extract (3-7, default: 5)
- **Enable Deduplication**: Skip tasks that already exist in the master file

## How It Works

1. The plugin reads the content of your currently active note
2. Sends the content to OpenAI with a specialized prompt for task extraction
3. Extracts 3-7 actionable, unresolved tasks in Markdown checkbox format
4. Appends the tasks to your master file with wikilinks to the source note
5. Optionally deduplicates against existing tasks

## Task Format

Tasks are added to your master file in this format:
```
- [ ] Make notion for Thomas ([[2025-09-10.md]])
- [ ] Finish project proposal ([[2025-09-10.md]])
- [ ] Call client about meeting ([[2025-09-10.md]])
```

The wikilinks allow you to click back to the original note where the task was extracted from.

## Network Use Disclosure

**This plugin requires network access to function properly.**

- **Remote Service**: OpenAI API (https://api.openai.com)
- **Purpose**: AI-powered task extraction from journal notes
- **Data Sent**: Only the content of your currently active note is sent to OpenAI for processing
- **Data Stored**: No data is stored by the plugin; all processing is done via OpenAI's API
- **Privacy**: Your note content is sent to OpenAI's servers for task extraction. Please review OpenAI's privacy policy for details on how they handle your data.

## Requirements

- Obsidian 0.15.0 or higher
- OpenAI API key
- Internet connection (for API calls)

## Development

To build the plugin:

```bash
npm install
npm run build
```

To run in development mode:

```bash
npm run dev
```

## License

MIT

## Copyright and Attribution

This plugin uses the following open source libraries:
- **Obsidian API**: Licensed under the MIT License
- **Moment.js**: Licensed under the MIT License (bundled with Obsidian)

All code in this plugin is open source and available for review.