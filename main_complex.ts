import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, moment, ItemView, WorkspaceLeaf } from 'obsidian';

interface NoLeftoversSettings {
	openaiApiKey: string;
	modelName: string;
	masterFilePath: string;
	dateFormat: string;
	addHeaders: boolean;
	maxTasks: number;
	enableDedupe: boolean;
}

const DEFAULT_SETTINGS: NoLeftoversSettings = {
	openaiApiKey: '',
	modelName: 'gpt-4o-mini',
	masterFilePath: 'No Leftovers.md',
	dateFormat: 'YYYY-MM-DD',
	addHeaders: true,
	maxTasks: 5,
	enableDedupe: true
}

export default class NoLeftoversPlugin extends Plugin {
	settings: NoLeftoversSettings;

	async onload() {
		await this.loadSettings();

		// Register the view
		this.registerView('no-leftovers-sidebar', (leaf) => new NoLeftoversView(leaf, this));

		// Add ribbon icon with a different icon
		this.addRibbonIcon('list', 'No Leftovers - Review Tasks', async () => {
			await this.showTaskSidebar();
		});

		// Add command palette command for automatic capture
		this.addCommand({
			id: 'capture-tasks-auto',
			name: 'Capture tasks from current note (automatic)',
			callback: async () => {
				await this.captureTasksAutomatic();
			}
		});

		// Add command palette command for review mode
		this.addCommand({
			id: 'capture-tasks-review',
			name: 'Capture tasks from current note (review)',
			callback: async () => {
				await this.showTaskSidebar();
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

	async captureTasksAutomatic() {
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

			// Automatically append tasks to master file
			await this.appendTasksToMasterFile(tasks, activeFile);
			
			new Notice(`Successfully captured ${tasks.length} tasks!`);
		} catch (error) {
			console.error('Error capturing tasks:', error);
			new Notice(`Error: ${error.message}`);
		}
	}

	async showTaskSidebar() {
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

			// Show sidebar with tasks
			await this.openTaskSidebar(tasks, activeFile);
			
		} catch (error) {
			console.error('Error capturing tasks:', error);
			new Notice(`Error: ${error.message}`);
		}
	}

	async openTaskSidebar(tasks: string[], sourceFile: TFile) {
		// Check if sidebar is already open
		const existingLeaf = this.app.workspace.getLeavesOfType('no-leftovers-sidebar')[0];
		
		if (existingLeaf) {
			// Update existing sidebar
			const view = existingLeaf.view as NoLeftoversView;
			view.updateTasks(tasks, sourceFile);
			existingLeaf.setViewState({ type: 'no-leftovers-sidebar', active: true });
		} else {
			// Create new sidebar
			const leaf = this.app.workspace.getRightLeaf(false);
			await leaf.setViewState({
				type: 'no-leftovers-sidebar',
				active: true,
			});
			
			// Set the tasks after the view is created
			const view = leaf.view as NoLeftoversView;
			view.updateTasks(tasks, sourceFile);
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
		
		// Format tasks with date appended
		const formattedTasks = tasks.map(task => {
			const cleanTask = task.replace('- [ ]', '').trim();
			return `- [ ] ${cleanTask} (${dateStr}.md)`;
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
			
			// Format only the new tasks with date
			const formattedNewTasks = newTasks.map(task => {
				const cleanTask = task.replace('- [ ]', '').trim();
				return `- [ ] ${cleanTask} (${dateStr}.md)`;
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
		// Remove the date part for deduplication comparison
		const taskWithoutDate = task.replace(/\(\d{4}-\d{2}-\d{2}\.md\)/, '').trim();
		return taskWithoutDate.replace('- [ ]', '').trim().toLowerCase().replace(/\s+/g, ' ');
	}

	isDuplicate(newTask: string, existingTasks: string[]): boolean {
		const normalizedNewTask = this.normalizeTask(newTask);
		return existingTasks.includes(normalizedNewTask);
	}
}

class NoLeftoversView extends ItemView {
	plugin: NoLeftoversPlugin;
	tasks: string[] = [];
	sourceFile: TFile | null = null;
	taskInputs: HTMLInputElement[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: NoLeftoversPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.addStyles();
	}

	getViewType() {
		return 'no-leftovers-sidebar';
	}

	getDisplayText() {
		return 'No Leftovers';
	}

	getIcon() {
		return 'list';
	}

	updateTasks(tasks: string[], sourceFile: TFile) {
		this.tasks = tasks;
		this.sourceFile = sourceFile;
		this.render();
	}

	render() {
		this.containerEl.empty();
		this.taskInputs = [];
		
		// Header
		const header = this.containerEl.createEl('div', { cls: 'no-leftovers-header' });
		header.createEl('h3', { text: 'No Leftovers - Review Tasks' });
		
		// Source file info
		if (this.sourceFile) {
			const sourceInfo = this.containerEl.createEl('div', { cls: 'no-leftovers-source' });
			sourceInfo.createEl('p', { text: `From: ${this.sourceFile.basename}` });
		}
		
		// Tasks container
		const tasksContainer = this.containerEl.createEl('div', { cls: 'no-leftovers-tasks' });
		
		// Create editable task inputs
		this.tasks.forEach((task, index) => {
			this.createTaskInput(tasksContainer, task, index);
		});
		
		// Add new task button
		const addTaskBtn = this.containerEl.createEl('button', {
			text: '+ Add Task',
			cls: 'no-leftovers-add-btn'
		});
		addTaskBtn.onclick = () => {
			this.addNewTask(tasksContainer);
		};
		
		// Action buttons
		const actions = this.containerEl.createEl('div', { cls: 'no-leftovers-actions' });
		
		const confirmBtn = actions.createEl('button', {
			text: 'Add to Master File',
			cls: 'no-leftovers-confirm-btn'
		});
		confirmBtn.onclick = () => {
			this.confirmTasks();
		};
		
		const cancelBtn = actions.createEl('button', {
			text: 'Cancel',
			cls: 'no-leftovers-cancel-btn'
		});
		cancelBtn.onclick = () => {
			this.close();
		};
	}

	createTaskInput(container: HTMLElement, task: string, index: number) {
		const taskDiv = container.createEl('div', { cls: 'no-leftovers-task' });
		
		const checkbox = taskDiv.createEl('input', { type: 'checkbox' });
		checkbox.checked = true; // Default to selected
		
		const input = taskDiv.createEl('input', { 
			type: 'text',
			value: task.replace('- [ ]', '').trim(),
			cls: 'no-leftovers-task-input'
		});
		
		// Store reference for later
		this.taskInputs.push(input);
		
		// Add remove button
		const removeBtn = taskDiv.createEl('button', { 
			text: '×',
			cls: 'no-leftovers-remove-btn'
		});
		removeBtn.onclick = () => {
			taskDiv.remove();
			const inputIndex = this.taskInputs.indexOf(input);
			if (inputIndex > -1) {
				this.taskInputs.splice(inputIndex, 1);
			}
		};
	}

	addNewTask(container: HTMLElement) {
		const taskDiv = container.createEl('div', { cls: 'no-leftovers-task' });
		
		const checkbox = taskDiv.createEl('input', { type: 'checkbox' });
		checkbox.checked = true;
		
		const input = taskDiv.createEl('input', { 
			type: 'text',
			value: '',
			placeholder: 'Enter new task...',
			cls: 'no-leftovers-task-input'
		});
		
		this.taskInputs.push(input);
		
		const removeBtn = taskDiv.createEl('button', { 
			text: '×',
			cls: 'no-leftovers-remove-btn'
		});
		removeBtn.onclick = () => {
			taskDiv.remove();
			const index = this.taskInputs.indexOf(input);
			if (index > -1) {
				this.taskInputs.splice(index, 1);
			}
		};
	}

	async confirmTasks() {
		const selectedTasks: string[] = [];
		
		// Get all task divs
		const taskDivs = this.containerEl.querySelectorAll('.no-leftovers-task');
		
		taskDivs.forEach((taskDiv) => {
			const checkbox = taskDiv.querySelector('input[type="checkbox"]') as HTMLInputElement;
			const input = taskDiv.querySelector('.no-leftovers-task-input') as HTMLInputElement;
			
			if (checkbox.checked && input.value.trim()) {
				selectedTasks.push(`- [ ] ${input.value.trim()}`);
			}
		});
		
		if (selectedTasks.length === 0) {
			new Notice('No tasks selected.');
			return;
		}
		
		if (!this.sourceFile) {
			new Notice('No source file found.');
			return;
		}
		
		try {
			await this.plugin.appendTasksToMasterFile(selectedTasks, this.sourceFile);
			new Notice(`Successfully added ${selectedTasks.length} tasks!`);
			this.close();
		} catch (error) {
			new Notice(`Error: ${error.message}`);
		}
	}

	close() {
		const leaf = this.app.workspace.getLeavesOfType('no-leftovers-sidebar')[0];
		if (leaf) {
			leaf.detach();
		}
	}

	addStyles() {
		const style = document.createElement('style');
		style.textContent = `
			.no-leftovers-header h3 {
				margin: 0 0 10px 0;
				color: var(--text-normal);
			}
			
			.no-leftovers-source {
				margin-bottom: 20px;
				padding: 10px;
				background: var(--background-secondary);
				border-radius: 4px;
			}
			
			.no-leftovers-source p {
				margin: 0;
				font-size: 0.9em;
				color: var(--text-muted);
			}
			
			.no-leftovers-tasks {
				margin-bottom: 20px;
			}
			
			.no-leftovers-task {
				display: flex;
				align-items: center;
				margin-bottom: 10px;
				padding: 8px;
				background: var(--background-secondary);
				border-radius: 4px;
			}
			
			.no-leftovers-task input[type="checkbox"] {
				margin-right: 10px;
			}
			
			.no-leftovers-task-input {
				flex: 1;
				background: var(--background-primary);
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				padding: 6px 8px;
				color: var(--text-normal);
				font-size: 14px;
			}
			
			.no-leftovers-task-input:focus {
				outline: none;
				border-color: var(--interactive-accent);
			}
			
			.no-leftovers-remove-btn {
				background: var(--background-modifier-error);
				color: var(--text-on-accent);
				border: none;
				border-radius: 4px;
				width: 24px;
				height: 24px;
				cursor: pointer;
				margin-left: 8px;
				font-size: 16px;
				line-height: 1;
			}
			
			.no-leftovers-remove-btn:hover {
				background: var(--background-modifier-error-hover);
			}
			
			.no-leftovers-add-btn {
				background: var(--interactive-accent);
				color: var(--text-on-accent);
				border: none;
				border-radius: 4px;
				padding: 8px 16px;
				cursor: pointer;
				margin-bottom: 20px;
				font-size: 14px;
			}
			
			.no-leftovers-add-btn:hover {
				background: var(--interactive-accent-hover);
			}
			
			.no-leftovers-actions {
				display: flex;
				gap: 10px;
				justify-content: flex-end;
			}
			
			.no-leftovers-confirm-btn {
				background: var(--interactive-accent);
				color: var(--text-on-accent);
				border: none;
				border-radius: 4px;
				padding: 10px 20px;
				cursor: pointer;
				font-size: 14px;
				font-weight: 500;
			}
			
			.no-leftovers-confirm-btn:hover {
				background: var(--interactive-accent-hover);
			}
			
			.no-leftovers-cancel-btn {
				background: var(--background-secondary);
				color: var(--text-normal);
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				padding: 10px 20px;
				cursor: pointer;
				font-size: 14px;
			}
			
			.no-leftovers-cancel-btn:hover {
				background: var(--background-modifier-hover);
			}
		`;
		document.head.appendChild(style);
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
			.setName('Add Headers')
			.setDesc('Add date headers with source note links (legacy option - now dates are appended to tasks)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.addHeaders)
				.onChange(async (value) => {
					this.plugin.settings.addHeaders = value;
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
