import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../../utils/logger';
import { getConversationHTML } from '../templates/conversationTemplate';
import { LLMService } from '../../services/llm';
import { WindowsVoiceRecorder } from '../../services/voice/WindowsVoiceRecorder';
import { AudioSanitizer } from '../../services/audioSanitizer';
import { validateWebviewMessage, generateNonce } from '../../utils/webviewSecurity';
import * as fs from 'fs';

/** Allowlist of message types this sidebar accepts from its webview. */
const SIDEBAR_ALLOWED_TYPES = [
    'processInputSubmit', 'start-sdlc', 'newTask', 'listConversations',
    'loadConversation', 'deleteConversation', 'mcpInstall', 'triggerUpload',
    'startRecording', 'vadAudioData', 'stopRecording', 'voiceConversationComplete',
    'voiceSessionEnded', 'log', 'showOutput', 'webviewReady', 'saveApiKey', 'deleteApiKey'
] as const;

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'verno.agentPanel';
    private logger: Logger;
    private llmService: LLMService;
    private windowsRecorder: WindowsVoiceRecorder | null = null;
    private audioSanitizer: AudioSanitizer;
    private onResolve?: (view: vscode.WebviewView) => void;
    private sessionVoiceKey: string | undefined;
    private isVoiceSessionActive: boolean = false;
    private coverageWatcher: vscode.FileSystemWatcher | null = null;

    constructor(
        private readonly context: vscode.ExtensionContext,
        logger: Logger,
        llmService: LLMService,
        onResolve?: (view: vscode.WebviewView) => void
    ) {
        this.logger = logger;
        this.llmService = llmService;
        this.audioSanitizer = new AudioSanitizer();
        this.onResolve = onResolve;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        webviewView.webview.options = {
            enableScripts: true
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        this.logger?.info('SidebarProvider resolved with conversation UI');

        // Handle messages from the webview — allowlist validated
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (!validateWebviewMessage(message, SIDEBAR_ALLOWED_TYPES, this.logger)) { return; }
            const data = message as any; // type validated above
            this.logger.info(`Message received: ${data.type}`);
            switch (data.type) {
                case 'processInputSubmit':
                    await vscode.commands.executeCommand('verno.processInputWithData', data.apiKey, data.input, data.mode, data.provider, data.model);
                    break;
                case 'start-sdlc':
                    await vscode.commands.executeCommand('verno.startSDLC', data.input, data.apiKey, data.provider);
                    break;
                case 'newTask':
                    await vscode.commands.executeCommand('verno.newTask');
                    break;
                case 'listConversations':
                    await vscode.commands.executeCommand('verno.listConversations');
                    break;
                case 'loadConversation':
                    await vscode.commands.executeCommand('verno.loadConversation', data.conversationId);
                    break;
                case 'deleteConversation':
                    await vscode.commands.executeCommand('verno.deleteConversation', data.conversationId);
                    break;
                case 'mcpInstall':
                    await vscode.commands.executeCommand('verno.mcpInstall', data.serverId, data.scope || 'project');
                    break;
                case 'triggerUpload':
                    this.logger.info(`Upload triggered: ${data.action}`);
                    break;
                case 'startRecording':
                    try {
                        if (!this.windowsRecorder) {
                            this.windowsRecorder = new WindowsVoiceRecorder();
                        }
                        await this.windowsRecorder.start();
                        this.logger.info('[Sidebar] Native recording started');
                        this.isVoiceSessionActive = true;
                        webviewView.webview.postMessage({ type: 'recordingStarted' });
                    } catch (error) {
                        this.logger.error('[Sidebar] Failed to start native recording', error as Error);
                        vscode.window.showErrorMessage('Failed to start recording: ' + (error as Error).message);
                        webviewView.webview.postMessage({ type: 'voiceError', message: 'Failed to start recording' });
                    }
                    break;
                case 'vadAudioData':
                    try {
                        this.logger.info('[Sidebar] Received VAD Int16Array data from Webview');
                        const samples: number[] = data.audioData;

                        if (!samples || samples.length < 8000) {
                            this.logger.warn('[Sidebar] VAD audio too short (less than 0.5s). Aborting.');
                            vscode.window.showWarningMessage('Recording was too short.');
                            webviewView.webview.postMessage({ type: 'voiceError', message: 'Recording too short' });
                            return;
                        }

                        const wavBuffer = this.encodeWav(samples, 16000);
                        const base64Audio = wavBuffer.toString('base64');
                        await this.processAudioBase64(base64Audio, webviewView);
                    } catch (error) {
                        this.logger.error('[Sidebar] Failed to process VAD audio', error as Error);
                        vscode.window.showErrorMessage('VAD processing failed: ' + (error as Error).message);
                        webviewView.webview.postMessage({ type: 'voiceError', message: 'Processing failed' });
                    }
                    break;
                case 'stopRecording':
                    try {
                        if (this.windowsRecorder) {
                            this.logger.info('[Sidebar] Stopping native recording...');
                            const filePath = await this.windowsRecorder.stop();
                            this.logger.info(`[Sidebar] Native recording saved to ${filePath}`);

                            const fs = require('fs');
                            const stats = fs.statSync(filePath);
                            const fileSizeInBytes = stats.size;
                            this.logger.info(`[Sidebar] Recording file size: ${fileSizeInBytes} bytes`);

                            if (fileSizeInBytes < 1024) {
                                this.logger.warn('[Sidebar] Recording is too short/empty.');
                                vscode.window.showWarningMessage('Recording was too short or captured no audio.');
                                webviewView.webview.postMessage({ type: 'voiceError', message: 'Recording too short' });
                                try { fs.unlinkSync(filePath); } catch (e) { }
                                return;
                            }

                            const fileBuffer = fs.readFileSync(filePath);
                            const base64Audio = fileBuffer.toString('base64');

                            try { fs.unlinkSync(filePath); } catch (e) { }

                            await this.processAudioBase64(base64Audio, webviewView);
                        }
                    } catch (error) {
                        this.logger.error('[Sidebar] Failed to stop/transcribe native recording', error as Error);
                        vscode.window.showErrorMessage('Recording failed: ' + (error as Error).message);
                        webviewView.webview.postMessage({ type: 'voiceError', message: 'Recording failed' });
                    }
                    break;
                case 'voiceConversationComplete':
                    this.logger.info(`Voice conversation complete, summary length: ${data.summary?.length || 0}`);
                    await vscode.commands.executeCommand('verno.voiceConversationComplete', data.summary, data.transcript);
                    break;
                case 'voiceSessionEnded':
                    this.logger.info('[Sidebar] Voice session ended by user');
                    this.isVoiceSessionActive = false;
                    break;
                case 'log':
                    this.logger.info(`[Webview] ${data.message}`);
                    break;
                case 'showOutput':
                    await vscode.commands.executeCommand('verno.showOutput');
                    break;
                case 'saveApiKey':
                    await vscode.commands.executeCommand('verno.saveApiKey', data.provider, data.apiKey);
                    webviewView.webview.postMessage({ type: 'apiKeySaved', provider: data.provider });
                    break;
                case 'deleteApiKey':
                    await vscode.commands.executeCommand('verno.deleteApiKey', data.provider);
                    webviewView.webview.postMessage({ type: 'apiKeyDeleted', provider: data.provider });
                    break;
                case 'webviewReady':
                    this.logger.info('[Sidebar] Webview ready signal received');
                    if (this.isVoiceSessionActive) {
                        this.logger.info('[Sidebar] Restoring active voice session state...');
                        webviewView.webview.postMessage({ type: 'restoreVoiceSession' });
                    }
                    // Bug 2 fix: eagerly initialize the LLM provider on webview mount
                    // so that "Start SDLC" works on the very first click without
                    // requiring a "Send" message to be dispatched first.
                    await vscode.commands.executeCommand('verno.ensureLLMReady');
                    break;
            }
        });

        // Remove the fragile setTimeout
        // if (this.isVoiceSessionActive) { ... }

        // Start watching for coverage updates
        this.setupCoverageWatcher(webviewView);

        this.onResolve?.(webviewView);
    }

    private setupCoverageWatcher(webviewView: vscode.WebviewView) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) return;

        const coveragePath = path.join(root, 'coverage', 'coverage-summary.json');
        
        const pushCoverage = () => {
            if (fs.existsSync(coveragePath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
                    let pct = 0;
                    if (data && data.total && data.total.lines && typeof data.total.lines.pct === 'number') {
                        pct = data.total.lines.pct;
                    }
                    webviewView.webview.postMessage({ type: 'coverageUpdate', percentage: pct });
                } catch(e) { /* ignore parse errors */ }
            }
        };

        const pattern = new vscode.RelativePattern(root, 'coverage/coverage-summary.json');
        this.coverageWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.coverageWatcher.onDidChange(pushCoverage);
        this.coverageWatcher.onDidCreate(pushCoverage);

        // Push initial
        pushCoverage();
    }

    private async getLLMProvider(): Promise<import('../../types').ILLMProvider | undefined> {
        return this.llmService.getProvider() || undefined;
    }

    private encodeWav(samples: number[], sampleRate: number = 16000): Buffer {
        const buffer = Buffer.alloc(44 + samples.length * 2);
        // RIFF chunk descriptor
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + samples.length * 2, 4);
        buffer.write('WAVE', 8);
        // fmt sub-chunk
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16); // Subchunk1Size
        buffer.writeUInt16LE(1, 20); // AudioFormat
        buffer.writeUInt16LE(1, 22); // NumChannels
        buffer.writeUInt32LE(sampleRate, 24); // SampleRate
        buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
        buffer.writeUInt16LE(2, 32); // BlockAlign
        buffer.writeUInt16LE(16, 34); // BitsPerSample
        // data sub-chunk
        buffer.write('data', 36);
        buffer.writeUInt32LE(samples.length * 2, 40);

        let offset = 44;
        for (let i = 0; i < samples.length; i++) {
            buffer.writeInt16LE(samples[i], offset);
            offset += 2;
        }
        return buffer;
    }

    private async processAudioBase64(base64Audio: string, webviewView: vscode.WebviewView) {
        // PREFER GROQ WHISPER IF AVAILABLE
        let groqKey = (await this.context.secrets.get('groqApiKey')) || this.sessionVoiceKey;

        if (!groqKey) {
            groqKey = process.env.GROQ_API_KEY;
            if (groqKey) {
                this.sessionVoiceKey = groqKey;
            }
        }

        let transcriptionProvider: import('../../types').ILLMProvider | undefined;

        if (groqKey) {
            const { GroqProvider } = require('../../services/llm/providers/GroqProvider');
            const groqProvider = new GroqProvider();
            await groqProvider.initialize(groqKey);
            transcriptionProvider = groqProvider;
        } else {
            transcriptionProvider = await this.getLLMProvider();
        }

        if (!transcriptionProvider) {
            this.logger.info('[Sidebar] No active provider or config. Prompting user for Voice Key...');
            const inputKey = await vscode.window.showInputBox({
                prompt: 'Voice Transcription requires an API Key. Enter Groq API Key (recommended) or Gemini Key. It will be saved to your settings.',
                ignoreFocusOut: true,
                placeHolder: 'gsk_... (Groq) or AIza... (Gemini)'
            });

            if (inputKey) {
                if (inputKey.startsWith('gsk_')) {
                    const { GroqProvider } = require('../../services/llm/providers/GroqProvider');
                    const groqProvider = new GroqProvider();
                    await groqProvider.initialize(inputKey);
                    transcriptionProvider = groqProvider;
                    this.sessionVoiceKey = inputKey;
                    await this.context.secrets.store('groqApiKey', inputKey);
                } else if (inputKey.startsWith('AIza')) {
                    const { GeminiProvider } = require('../../services/llm/providers/GeminiProvider');
                    const geminiProvider = new GeminiProvider();
                    await geminiProvider.initialize(inputKey);
                    transcriptionProvider = geminiProvider;
                }
            }
        }

        if (transcriptionProvider && transcriptionProvider.transcribeAudio) {
            this.logger.info('[Sidebar] Transcribing audio...');
            try {
                const text = await transcriptionProvider.transcribeAudio(base64Audio);
                this.logger.info(`[Sidebar] Transcription (raw): "${text.substring(0, 60)}..."`);

                const sanitizedText = await this.audioSanitizer.sanitize(text);
                if (sanitizedText !== text) {
                    this.logger.info(`[Sidebar] Transcription (sanitized): "${sanitizedText.substring(0, 60)}..."`);
                }

                webviewView.webview.postMessage({ type: 'voiceTranscript', text: sanitizedText });
            } catch (transcribeError) {
                this.logger.error('[Sidebar] Transcription error', transcribeError as Error);
                vscode.window.showErrorMessage('Transcription failed: ' + (transcribeError as Error).message);
                webviewView.webview.postMessage({ type: 'voiceError', message: 'Transcription failed' });
            }
        } else {
            const msg = transcriptionProvider
                ? `Current provider (${transcriptionProvider.constructor.name}) does not support audio transcription`
                : 'No API Key configured for Voice.';
            vscode.window.showWarningMessage(msg);
            webviewView.webview.postMessage({ type: 'voiceError', message: msg });
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();

        const vadPaths = {
            bundlePath: webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'vad', 'vad.bundle.min.js'))).toString(),
            workletPath: webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'vad', 'vad.worklet.bundle.min.js'))).toString(),
            modelPath: webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'vad', 'silero_vad.onnx'))).toString(),
            wasmRoot: webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'vad'))).toString() + '/'
        };

        return getConversationHTML(nonce, vadPaths);
    }
}

function getNonce() {
    return generateNonce();
}
