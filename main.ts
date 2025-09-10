import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, moment } from 'obsidian';

interface NoLeftoversSettings {
	openaiApiKey: string;
	modelName: string;
	masterFilePath: string;
	dateFormat: string;
	maxTasks: number;
	enableDedupe: boolean;
}

const DEFAULT_SETTINGS: NoLeftoversSettings = {
	openaiApiKey: '',
	modelName: 'gpt-4o-mini',
	masterFilePath: 'No Leftovers.md',
	dateFormat: 'YYYY-MM-DD',
	maxTasks: 5,
	enableDedupe: true
}

export default class NoLeftoversPlugin extends Plugin {
	settings: NoLeftoversSettings;

	async onload() {
		await this.loadSettings();

		// Add ribbon icon
		this.addRibbonIcon('list', 'No Leftovers', async () => {
			await this.captureTasks();
		});

		// Add command palette command
		this.addCommand({
			id: 'capture-tasks',
			name: 'No Leftovers: Capture tasks from current note',
			callback: async () => {
				await this.captureTasks();
			}
		});

		// Add settings tab
		this.addSettingTab(new NoLeftoversSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async captureTasks() {
		const activeFile = this.app.workspace.getActiveFile();
		
		if (!activeFile) {
			new Notice('No active file. Please open a note first.');
			return;
		}

		if (!this.settings.openaiApiKey) {
			new Notice('OpenAI API key not configured. Please check settings.');
			return;
		}

		try {
			// Read the current note content
			const noteContent = await this.app.vault.read(activeFile);
			
			// Extract tasks using OpenAI
			const tasks = await this.extractTasksFromNote(noteContent);
			
			if (tasks.length === 0) {
				new Notice('No actionable tasks found in the note.');
				return;
			}

			// Append tasks to master file
			await this.appendTasksToMasterFile(tasks, activeFile);
			
			new Notice(`Successfully captured ${tasks.length} tasks!`);
		} catch (error) {
			console.error('Error capturing tasks:', error);
			new Notice(`Error: ${error.message}`);
		}
	}

	async extractTasksFromNote(noteContent: string): Promise<string[]> {
		const prompt = `Extract ${this.settings.maxTasks} actionable, unresolved tasks from the journal below.
Return ONLY Markdown checkbox lines like: - [ ] task
No code fences, no commentary.
Prefer loop-closures that unblock tomorrow.
Journal:
${noteContent}`;

		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.settings.openaiApiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: this.settings.modelName,
				messages: [
					{
						role: 'system',
						content: 'You extract unresolved, actionable tasks from journals.'
					},
					{
						role: 'user',
						content: prompt
					}
				],
				max_tokens: 500,
				temperature: 0.3
			})
		});

		if (!response.ok) {
			throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		const content = data.choices[0].message.content.trim();
		
		// Parse the response to extract task lines
		const taskLines = content.split('\n')
			.filter((line: string) => line.trim().startsWith('- [ ]'))
			.map((line: string) => line.trim());

		return taskLines;
	}

	async appendTasksToMasterFile(tasks: string[], sourceFile: TFile) {
		const masterFilePath = this.settings.masterFilePath;
		const dateStr = moment().format(this.settings.dateFormat);
		const sourceFileName = sourceFile.basename;
		
		// Format tasks with wikilink to source file
		const formattedTasks = tasks.map(task => {
			const cleanTask = task.replace('- [ ]', '').trim();
			return `- [ ] ${cleanTask} ([[${sourceFileName}]])`;
		}).join('\n');
		const newContent = formattedTasks + '\n\n';

		// Check if master file exists
		let masterFile = this.app.vault.getAbstractFileByPath(masterFilePath) as TFile;
		
		if (!masterFile) {
			// Create the master file with just the header
			await this.app.vault.create(masterFilePath, '# No Leftovers\n\n');
			masterFile = this.app.vault.getAbstractFileByPath(masterFilePath) as TFile;
		}

		// Read existing content for deduplication
		let existingContent = await this.app.vault.read(masterFile);
		
		// Deduplicate if enabled
		if (this.settings.enableDedupe) {
			const existingTasks = this.extractExistingTasks(existingContent);
			const newTasks = tasks.filter(task => 
				!this.isDuplicate(task, existingTasks)
			);
			
			if (newTasks.length === 0) {
				new Notice('All tasks already exist in master file.');
				return;
			}
			
			// Format only the new tasks with wikilink
			const formattedNewTasks = newTasks.map(task => {
				const cleanTask = task.replace('- [ ]', '').trim();
				return `- [ ] ${cleanTask} ([[${sourceFileName}]])`;
			}).join('\n');
			const newContentDeduped = formattedNewTasks + '\n\n';
			
			// Always append, never replace
			await this.app.vault.append(masterFile, newContentDeduped);
		} else {
			// Always append, never replace
			await this.app.vault.append(masterFile, newContent);
		}
	}

	extractExistingTasks(content: string): string[] {
		const lines = content.split('\n');
		return lines
			.filter((line: string) => line.trim().startsWith('- [ ]'))
			.map((line: string) => this.normalizeTask(line));
	}

	normalizeTask(task: string): string {
		// Remove the wikilink part for deduplication comparison
		const taskWithoutLink = task.replace(/\(\[\[.*?\]\]\)/, '').trim();
		return taskWithoutLink.replace('- [ ]', '').trim().toLowerCase().replace(/\s+/g, ' ');
	}

	isDuplicate(newTask: string, existingTasks: string[]): boolean {
		const normalizedNewTask = this.normalizeTask(newTask);
		return existingTasks.includes(normalizedNewTask);
	}
}

class NoLeftoversSettingTab extends PluginSettingTab {
	plugin: NoLeftoversPlugin;

	constructor(app: App, plugin: NoLeftoversPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'No Leftovers Settings' });

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Your OpenAI API key for task extraction')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.openaiApiKey)
				.onChange(async (value) => {
					this.plugin.settings.openaiApiKey = value;
					await this.plugin.saveSettings();
				})
				.inputEl.type = 'password');

		new Setting(containerEl)
			.setName('Model Name')
			.setDesc('OpenAI model to use for task extraction')
			.addText(text => text
				.setPlaceholder('gpt-4o-mini')
				.setValue(this.plugin.settings.modelName)
				.onChange(async (value) => {
					this.plugin.settings.modelName = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Master File Path')
			.setDesc('Path to the master file where tasks will be stored')
			.addText(text => text
				.setPlaceholder('No Leftovers.md')
				.setValue(this.plugin.settings.masterFilePath)
				.onChange(async (value) => {
					this.plugin.settings.masterFilePath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Date Format')
			.setDesc('Moment.js date format for task dates')
			.addText(text => text
				.setPlaceholder('YYYY-MM-DD')
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async (value) => {
					this.plugin.settings.dateFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max Tasks')
			.setDesc('Maximum number of tasks to extract (3-7)')
			.addSlider(slider => slider
				.setLimits(3, 7, 1)
				.setValue(this.plugin.settings.maxTasks)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxTasks = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable Deduplication')
			.setDesc('Skip tasks that already exist in the master file')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableDedupe)
				.onChange(async (value) => {
					this.plugin.settings.enableDedupe = value;
					await this.plugin.saveSettings();
				}));
	}
}
