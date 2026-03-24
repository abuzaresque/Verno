import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './utils/logger';
import { ConfigService } from './config/ConfigService';
import { LLMService, GeminiProvider, GroqProvider } from './services/llm';
import { AgentRegistry, OrchestratorAgent } from './agents';
import { PlanningAgent } from './agents/planning/PlanningAgent';
import { FileService } from './services/file/FileService';
import { ContextBuilder } from './services/workflow/ContextBuilder';
import { ConversationService } from './services/conversation/ConversationService';
import { StartRecordingCommand } from './commands/StartRecordingCommand';
import { StopRecordingCommand } from './commands/StopRecordingCommand';
import { ManageAgentsCommand } from './commands/ManageAgentsCommand';
import { RecordingStatus } from './ui/statusBar/RecordingStatus';
import { AgentPanel } from './ui/panels/AgentPanel';
import { SidebarProvider } from './ui/panels/SidebarProvider';
import { EnhancedSidebarProvider } from './ui/panels/EnhancedSidebarProvider';
import { ConversationEngine } from './services/conversationEngine';
import { TTSService } from './services/ttsService';
import { LocalWhisperService } from './services/localWhisperService';
import { setLocalWhisperInstance, setGroqProviderInstance } from './services/audioRouter';
import { AudioSanitizer } from './services/audioSanitizer';

let logger: Logger;
let configService: ConfigService;
let llmService: LLMService;
let agentRegistry: AgentRegistry;
let fileService: FileService;
let recordingStatus: RecordingStatus;
let agentPanel: AgentPanel;
let sidebarProvider: SidebarProvider;
let conversationService: ConversationService;
let brain: ConversationEngine;
let tts: TTSService;
let localWhisper: LocalWhisperService;
let audioSanitizer: AudioSanitizer;
let currentConversationId: string | null = null;

async function cleanupStaleAudioFiles(logger: Logger) {
	try {
		const tmpDir = os.tmpdir();
		const files = await fs.promises.readdir(tmpDir);
		const staleFiles = files.filter(f => f.startsWith('verno_recording_') && f.endsWith('.wav'));

		let deletedCount = 0;
		for (const file of staleFiles) {
			const filePath = path.join(tmpDir, file);
			try {
				await fs.promises.unlink(filePath);
				deletedCount++;
			} catch (err) {
				logger.warn(`Failed to delete stale audio file ${file}: ${err}`);
			}
		}
		if (deletedCount > 0) {
			logger.info(`Cleaned up ${deletedCount} stale audio file(s)`);
		}
	} catch (err) {
		logger.warn(`Could not scan tmpdir for stale audio files: ${err}`);
	}
}

export async function activate(context: vscode.ExtensionContext) {
	try {
		// Initialize services
		logger = new Logger('Verno');
		logger.show(); // Auto-show logs on startup for debugging
		configService = new ConfigService();
		fileService = new FileService();
		agentRegistry = new AgentRegistry();
		llmService = new LLMService();
		recordingStatus = new RecordingStatus();
		agentPanel = new AgentPanel(context);
		brain = new ConversationEngine();
		tts = new TTSService();
		localWhisper = new LocalWhisperService();
		audioSanitizer = new AudioSanitizer();

		logger.info('Initializing Verno extension...');

		// Cleanup stale audio files left over from previous sessions
		cleanupStaleAudioFiles(logger);

		// Background-initialize TTS and local Whisper (non-blocking)
		tts.initialize(context.extensionPath).catch(err => {
			logger.warn(`TTS background init failed: ${err}`);
		});
		localWhisper.initialize(context.extensionPath).then(() => {
			setLocalWhisperInstance(localWhisper);
			logger.info('Local Whisper initialized and registered with AudioRouter');
		}).catch(err => {
			logger.warn(`Local Whisper background init failed: ${err}`);
		});

		// Initialize ConversationService for persistence
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
		if (workspaceRoot) {
			conversationService = new ConversationService(workspaceRoot);
			logger.info('ConversationService initialized for persistence');
		}

		// Wire Context Updates from LLM to UI
		llmService.setContextUsageCallback((used, total) => {
			agentPanel?.updateContextUsage(used, total);
		});

		// Register sidebar provider and connect AgentPanel when view is resolved
		sidebarProvider = new SidebarProvider(context, logger, llmService, (webviewView) => {
			agentPanel.setWebviewView(webviewView);

			// Load existing conversation when sidebar is opened
			if (conversationService && currentConversationId) {
				const conv = conversationService.getConversation(currentConversationId);
				if (conv && conv.messages.length > 0) {
					agentPanel.displayConversation(conv.messages.map(m => ({
						role: m.role,
						content: m.content,
						timestamp: new Date(m.timestamp).toISOString()
					})));
					logger.info(`Loaded ${conv.messages.length} messages from conversation ${currentConversationId}`);
				}
			}
		});
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				SidebarProvider.viewType,
				sidebarProvider
			)
		);
		logger.info('Sidebar provider registered');

		// Register Enhanced Sidebar for Dashboard
		const enhancedSidebar = new EnhancedSidebarProvider(workspaceRoot);
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				EnhancedSidebarProvider.viewType,
				enhancedSidebar
			)
		);
		logger.info('Enhanced Sidebar provider registered');

		// Register all agents
		registerAllAgents();

		// Register commands
		StartRecordingCommand.register(context);
		StopRecordingCommand.register(context);
		ManageAgentsCommand.register(context);

		// Register main processing command (prompts in popup if no args)
		const processCommand = vscode.commands.registerCommand('verno.processInput', async () => {
			await processUserInput(context);
		});

		// show output channel command
		const showOutputCmd = vscode.commands.registerCommand('verno.showOutput', async () => {
			logger.show();
		});

		// Register processing command that accepts apiKey, input, mode, and model from webview
		const processWithData = vscode.commands.registerCommand('verno.processInputWithData', async (apiKey: string, input: string, mode: 'plan' | 'code' | 'ask' = 'code', model?: string) => {
			await processUserInput(context, apiKey, input, mode, { fromWebview: true, model });
		});

		// Register load conversation command
		const loadConversationCmd = vscode.commands.registerCommand('verno.loadConversation', async (conversationId: string) => {
			await loadConversation(conversationId);
		});

		// Register new task command
		const newTaskCmd = vscode.commands.registerCommand('verno.newTask', async () => {
			logger.info('New task requested');
			currentConversationId = null;
			logger.info('Ready for new task');
		});

		// Register MCP install command
		const mcpInstallCmd = vscode.commands.registerCommand('verno.mcpInstall', async (serverId: string, scope: string) => {
			logger.info(`MCP server install requested: ${serverId} (scope: ${scope})`);
			vscode.window.showInformationMessage(`MCP server "${serverId}" installed (${scope}).`);
		});

		// List conversations command - sends list to webview
		const listConvsCmd = vscode.commands.registerCommand('verno.listConversations', async () => {
			if (!conversationService) { return; }
			const convs = conversationService.getAllConversations();
			const list = convs.map(c => ({
				id: c.id,
				title: c.title,
				mode: c.mode || 'chat',
				updatedAt: c.updatedAt,
				messageCount: c.messages.length
			}));
			agentPanel.postMessage({ type: 'conversationList', conversations: list });
		});

		// Delete conversation command
		const deleteConvCmd = vscode.commands.registerCommand('verno.deleteConversation', async (conversationId: string) => {
			if (!conversationService) { return; }
			conversationService.deleteConversation(conversationId);
			if (currentConversationId === conversationId) { currentConversationId = null; }
			logger.info(`Deleted conversation: ${conversationId}`);
			// Refresh the list
			await vscode.commands.executeCommand('verno.listConversations');
		});

		// Voice conversation complete command — receives summary from voice overlay and feeds it to the pipeline
		const voiceConvCmd = vscode.commands.registerCommand('verno.voiceConversationComplete', async (summary: string, transcript?: any[]) => {
			if (!summary) {
				logger.warn('Voice conversation produced no summary');
				return;
			}
			logger.info(`Voice conversation complete. Summary length: ${summary.length}, turns: ${transcript?.length || 0}`);
			agentPanel.addMessage('system', '🎙️ Voice conversation captured. Processing your request...');

			// Try to find an API key from configured providers
			// The webview state isn't accessible from the extension, so prompt if needed
			const apiKey = await vscode.window.showInputBox({
				prompt: 'Enter your API key to process the voice conversation summary',
				password: true,
				ignoreFocusOut: true,
				placeHolder: 'API key (Gemini: AIza... or Groq)'
			});

			if (apiKey) {
				await processUserInput(context, apiKey, summary, 'plan', { fromWebview: false });
			} else {
				agentPanel.addMessage('system', 'No API key provided. Your voice summary has been added to the chat. You can send it manually using the Send button.');
			}
		});

		// Process voice input command — the core conversational loop entry point
		const processVoiceCmd = vscode.commands.registerCommand('verno.processVoiceInput', async (transcribedText: string) => {
			if (!transcribedText || transcribedText.trim().length === 0) {
				logger.warn('Empty voice input received');
				return;
			}

			// Show transcription in status bar
			vscode.window.setStatusBarMessage(`🎙️ "${transcribedText}"`, 3000);
			logger.info(`Voice input (raw): "${transcribedText}"`);

			// Sanitize: correct misheard identifiers against active file symbols
			const sanitizedText = await audioSanitizer.sanitize(transcribedText);
			if (sanitizedText !== transcribedText) {
				logger.info(`Voice input (sanitized): "${sanitizedText}"`);
			}

			try {
				// Think — LLM generates reply with full workspace context
				const reply = await brain.think(sanitizedText);

				// Speak — TTS plays reply out loud
				tts.speak(reply).catch(err => {
					logger.warn(`TTS speak failed: ${err}`);
				});

				// Show in sidebar conversation panel
				agentPanel.addMessage('user', sanitizedText, { silent: false });
				agentPanel.addMessage('assistant', reply, { silent: false });

				// Persist to ConversationService
				if (conversationService) {
					try {
						const convId = ensureConversation('ask');
						conversationService.addMessage(convId, 'user', sanitizedText);
						conversationService.addMessage(convId, 'assistant', reply);
					} catch (convErr) {
						logger.warn(`Conversation persistence error: ${convErr}`);
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error('Voice processing error', err as Error);
				agentPanel.addMessage('system', `Error: ${msg}`);
			}
		});

		// New conversation command — clears history and announces
		const newConversationCmd = vscode.commands.registerCommand('verno.newConversation', async () => {
			brain.clearHistory();
			logger.info('Conversation history cleared');
			tts.speak('Starting fresh. What are we working on?').catch(err => {
				logger.warn(`TTS speak failed on new conversation: ${err}`);
			});
		});

		context.subscriptions.push(processCommand, processWithData, showOutputCmd, recordingStatus, loadConversationCmd, newTaskCmd, mcpInstallCmd, listConvsCmd, deleteConvCmd, voiceConvCmd, processVoiceCmd, newConversationCmd);

		logger.info('Verno extension activated successfully');
		vscode.window.showInformationMessage('Verno extension is ready!');
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logger.error('Failed to activate extension', error as Error);
		vscode.window.showErrorMessage(`Verno activation failed: ${errorMsg}`);
	}
}

function detectAndCreateProvider(apiKey: string): GeminiProvider | GroqProvider {
	if (apiKey.startsWith('AIza')) {
		return new GeminiProvider();
	} else {
		return new GroqProvider();
	}
}

function registerAllAgents(): void {
	// Register Planning Agent for plan mode conversations
	const planningAgent = new PlanningAgent(logger, llmService);
	agentRegistry.register('planning', planningAgent);

	// Register Orchestrator (Planner) for code mode pipeline
	const orchestrator = new OrchestratorAgent(logger, agentRegistry, llmService, fileService);
	agentRegistry.register('orchestrator', orchestrator);

	logger.info('All agents registered successfully');
}

/**
 * Ensure a conversation exists for the current session
 */
function ensureConversation(mode: 'plan' | 'code' | 'ask'): string {
	if (!conversationService) {
		throw new Error('ConversationService not initialized');
	}

	// Check if current conversation still exists (might have been deleted via dashboard)
	if (currentConversationId && !conversationService.getConversation(currentConversationId)) {
		currentConversationId = null;
	}

	// Reuse existing conversation or create new one
	if (!currentConversationId) {
		const convMode = mode === 'plan' ? 'planning' : mode === 'code' ? 'development' : 'chat';
		const title = mode === 'plan' ? 'Planning' : mode === 'code' ? 'Development' : 'Ask';
		currentConversationId = conversationService.createConversation(
			`${title} Session`,
			convMode as 'planning' | 'development' | 'chat'
		);
		logger.info(`Created new conversation: ${currentConversationId}`);
	}

	return currentConversationId;
}

async function processUserInput(
	context: vscode.ExtensionContext,
	apiKeyArg?: string,
	inputArg?: string,
	mode: 'plan' | 'code' | 'ask' = 'code',
	options: { fromWebview?: boolean; model?: string } = {}
): Promise<void> {
	try {
		let apiKey = apiKeyArg;
		let input = inputArg;

		if (!apiKey) {
			apiKey = await vscode.window.showInputBox({
				prompt: 'Enter your API key (Gemini: AIza... or Groq)',
				password: true,
				ignoreFocusOut: true
			});

			if (!apiKey) {
				logger.warn('No API key provided');
				return;
			}
		}

		if (!input) {
			input = await vscode.window.showInputBox({
				prompt: 'Enter your request (e.g., "Create a REST API with user authentication")',
				ignoreFocusOut: true
			});

			if (!input) {
				return;
			}
		}

		logger.info(`Processing user input: ${input} (mode: ${mode}, model: ${options.model || 'auto'})`);

		// Show thinking indicator in UI
		agentPanel.showThinking(true);

		// Add user message to conversation UI
		// If from webview, the message is already displayed optimistically — add silently to history only
		agentPanel.addMessage('user', input, { silent: !!options.fromWebview });

		// Persist user message to disk
		let conversationHistory = '';
		if (conversationService) {
			try {
				const convId = ensureConversation(mode);
				conversationService.addMessage(convId, 'user', input);
				conversationHistory = conversationService.getConversationAsText(convId);
				logger.info(`Persisted user message to conversation ${convId}`);
			} catch (convErr) {
				logger.warn(`Conversation persistence error: ${convErr}`);
			}
		}

		// Initialize the appropriate provider based on model selection or API key detection
		let provider;
		const modelName = options.model || '';
		if (modelName === 'groq' || (!modelName && !apiKey.startsWith('AIza'))) {
			provider = new GroqProvider();
			logger.info('Using Groq provider');
		} else {
			provider = new GeminiProvider();
			logger.info('Using Gemini provider');
		}
		await provider.initialize(apiKey);
		llmService.setProvider(provider);

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('No workspace folder open');
			agentPanel.showThinking(false);
			return;
		}

		// Build context with conversation history
		const agentContext = new ContextBuilder()
			.setWorkspaceRoot(workspaceRoot)
			.setMetadata({
				userRequest: input,
				conversationHistory,
				mode,
				timestamp: new Date().toISOString()
			})
			.build();

		// Route to appropriate agent based on mode
		let result: string;

		if (mode === 'ask') {
			// Ask mode: simple direct LLM call without orchestration
			logger.info('Ask mode: sending directly to LLM');
			result = await llmService.generateText(
				`You are a helpful coding assistant. The user is asking about their project.\n\nUser question: ${input}\n\nProvide a clear, concise answer.`
			);
		} else if (mode === 'plan') {
			// Plan mode: generate plan + run non-coding agents
			const orchestrator = agentRegistry.get('orchestrator') as OrchestratorAgent;
			if (!orchestrator) {
				throw new Error('Orchestrator agent not found');
			}
			logger.info('Routing to Orchestrator.executePlan() for planning phase');
			result = await orchestrator.executePlan(agentContext);
		} else {
			// Code mode: run pending coding agents or detect workspace state
			const orchestrator = agentRegistry.get('orchestrator') as OrchestratorAgent;
			if (!orchestrator) {
				throw new Error('Orchestrator agent not found');
			}
			logger.info('Routing to Orchestrator.executeCode() for code generation');
			result = await orchestrator.executeCode(agentContext);
		}

		// Add result to conversation UI
		agentPanel.addMessage('assistant', result || 'Task completed successfully!');
		agentPanel.showThinking(false);

		// Persist assistant response to disk
		if (conversationService && currentConversationId) {
			try {
				conversationService.addMessage(currentConversationId, 'assistant', result || 'Task completed successfully!');
				logger.info('Persisted assistant response to conversation');
			} catch (convErr) {
				logger.warn(`Failed to persist assistant response: ${convErr}`);
			}
		}

		logger.info(`Processing complete in ${mode} mode`);
		agentPanel.notifyProcessingComplete();
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logger.error('Error processing input', error as Error);

		// Show error in conversation
		agentPanel.addMessage('system', `Error: ${errorMsg}`);
		agentPanel.showThinking(false);

		// Persist error to conversation
		if (conversationService && currentConversationId) {
			try {
				conversationService.addMessage(currentConversationId, 'system', `Error: ${errorMsg}`);
			} catch (convErr) {
				// ignore
			}
		}

		vscode.window.showErrorMessage(`Processing failed: ${errorMsg}`);
	}
}

export function deactivate() {
	recordingStatus.dispose();
	try { tts?.dispose(); } catch { /* ignore */ }
	try { localWhisper?.dispose(); } catch { /* ignore */ }
	logger.info('Verno extension deactivated');
	logger.dispose();
}

/**
 * Load a conversation into the agent panel
 */
async function loadConversation(conversationId: string): Promise<void> {
	if (!conversationService || !agentPanel) { return; }

	const conv = conversationService.getConversation(conversationId);
	if (!conv) {
		vscode.window.showErrorMessage(`Conversation ${conversationId} not found`);
		return;
	}

	// Set as current
	currentConversationId = conversationId;
	conversationService.setCurrentConversation(conversationId);

	// Display in UI
	agentPanel.displayConversation(conv.messages.map(m => ({
		role: m.role,
		content: m.content,
		timestamp: new Date(m.timestamp).toISOString()
	})));

	logger.info(`Loaded conversation: ${conversationId}`);
	vscode.window.showInformationMessage(`Loaded conversation: ${conv.title || 'Untitled Session'}`);
}
