"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SidebarProvider = void 0;
const vscode = __importStar(require("vscode"));
const conversationTemplate_1 = require("../templates/conversationTemplate");
const WindowsVoiceRecorder_1 = require("../../services/voice/WindowsVoiceRecorder");
class SidebarProvider {
    context;
    static viewType = 'verno.agentPanel';
    logger;
    llmService;
    windowsRecorder = null;
    onResolve;
    sessionVoiceKey;
    isVoiceSessionActive = false;
    constructor(context, logger, llmService, onResolve) {
        this.context = context;
        this.logger = logger;
        this.llmService = llmService;
        this.onResolve = onResolve;
    }
    resolveWebviewView(webviewView, _context, _token) {
        webviewView.webview.options = {
            enableScripts: true
        };
        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
        this.logger?.info('SidebarProvider resolved with conversation UI');
        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            this.logger.info(`Message received: ${data.type}`);
            switch (data.type) {
                case 'processInputSubmit':
                    await vscode.commands.executeCommand('verno.processInputWithData', data.apiKey, data.input, data.mode, data.model);
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
                            this.windowsRecorder = new WindowsVoiceRecorder_1.WindowsVoiceRecorder();
                        }
                        await this.windowsRecorder.start();
                        this.logger.info('[Sidebar] Native recording started');
                        this.isVoiceSessionActive = true;
                        webviewView.webview.postMessage({ type: 'recordingStarted' });
                    }
                    catch (error) {
                        this.logger.error('[Sidebar] Failed to start native recording', error);
                        vscode.window.showErrorMessage('Failed to start recording: ' + error.message);
                        webviewView.webview.postMessage({ type: 'voiceError', message: 'Failed to start recording' });
                    }
                    break;
                case 'stopRecording':
                    try {
                        if (this.windowsRecorder) {
                            this.logger.info('[Sidebar] Stopping native recording...');
                            const filePath = await this.windowsRecorder.stop();
                            this.logger.info(`[Sidebar] Native recording saved to ${filePath}`);
                            // Read file and transcribe
                            const fs = require('fs');
                            const stats = fs.statSync(filePath);
                            const fileSizeInBytes = stats.size;
                            this.logger.info(`[Sidebar] Recording file size: ${fileSizeInBytes} bytes`);
                            if (fileSizeInBytes < 1024) {
                                // < 1KB is basically empty (44 byte header + silence)
                                this.logger.warn('[Sidebar] Recording is too short/empty. Aborting transcription.');
                                vscode.window.showWarningMessage('Recording was too short or captured no audio. Please try speaking longer.');
                                webviewView.webview.postMessage({ type: 'voiceError', message: 'Recording too short' });
                                try {
                                    fs.unlinkSync(filePath);
                                }
                                catch (e) { }
                                return;
                            }
                            const fileBuffer = fs.readFileSync(filePath);
                            const base64Audio = fileBuffer.toString('base64');
                            // Clean up file
                            try {
                                fs.unlinkSync(filePath);
                            }
                            catch (e) { }
                            // PREFER GROQ WHISPER IF AVAILABLE
                            // Check for configured Groq Key first
                            const config = vscode.workspace.getConfiguration('verno');
                            let groqKey = (await this.context.secrets.get('groqApiKey')) || this.sessionVoiceKey;
                            // If not in config, check .env in workspace root
                            if (!groqKey && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                                try {
                                    const fs = require('fs');
                                    const path = require('path');
                                    const envPath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.env');
                                    if (fs.existsSync(envPath)) {
                                        const envContent = fs.readFileSync(envPath).toString();
                                        const match = envContent.match(/^(?:VERNO_)?GROQ_API_KEY=(.*)$/m);
                                        if (match && match[1]) {
                                            groqKey = match[1].trim();
                                            this.logger.info('[Sidebar] Found Groq API Key in .env file');
                                            // Cache it for session
                                            this.sessionVoiceKey = groqKey;
                                        }
                                    }
                                }
                                catch (envErr) {
                                    this.logger.warn(`[Sidebar] Error reading .env file: ${envErr.message}`);
                                }
                            }
                            this.logger.info(`[Sidebar] Voice Config - GroqKey configured: ${!!groqKey}`);
                            let transcriptionProvider;
                            if (groqKey) {
                                // User has a Groq key, use it specifically for efficient Whisper
                                const { GroqProvider } = require('../../services/llm/providers/GroqProvider');
                                const groqProvider = new GroqProvider();
                                await groqProvider.initialize(groqKey);
                                transcriptionProvider = groqProvider;
                                this.logger.info('[Sidebar] Using dedicated Groq Whisper for transcription (from Config/Cache)');
                            }
                            else {
                                // Fallback to current provider (Gemini etc)
                                transcriptionProvider = await this.getLLMProvider();
                                this.logger.info(`[Sidebar] Voice Fallback - Active Provider available: ${!!transcriptionProvider}`);
                            }
                            // If still no provider (fresh start, no config), Prompt user!
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
                                        // Cache and SAVE the key
                                        this.sessionVoiceKey = inputKey;
                                        await this.context.secrets.store('groqApiKey', inputKey);
                                        this.logger.info('[Sidebar] Saved Groq key to SecretStorage');
                                    }
                                    else if (inputKey.startsWith('AIza')) {
                                        const { GeminiProvider } = require('../../services/llm/providers/GeminiProvider');
                                        const geminiProvider = new GeminiProvider();
                                        await geminiProvider.initialize(inputKey);
                                        transcriptionProvider = geminiProvider;
                                        this.logger.info('[Sidebar] Using user-provided Gemini key');
                                    }
                                }
                            }
                            if (transcriptionProvider && transcriptionProvider.transcribeAudio) {
                                this.logger.info('[Sidebar] Transcribing audio...');
                                try {
                                    const text = await transcriptionProvider.transcribeAudio(base64Audio);
                                    this.logger.info(`[Sidebar] Transcription success: "${text.substring(0, 30)}..."`);
                                    webviewView.webview.postMessage({ type: 'voiceTranscript', text });
                                }
                                catch (transcribeError) {
                                    this.logger.error('[Sidebar] Transcription error', transcribeError);
                                    vscode.window.showErrorMessage('Transcription failed: ' + transcribeError.message);
                                    webviewView.webview.postMessage({ type: 'voiceError', message: 'Transcription failed' });
                                }
                            }
                            else {
                                const msg = transcriptionProvider
                                    ? `Current provider (${transcriptionProvider.constructor.name}) does not support audio transcription`
                                    : 'No API Key configured for Voice. Start a voice session to configure.';
                                vscode.window.showWarningMessage(msg);
                                webviewView.webview.postMessage({ type: 'voiceError', message: msg });
                            }
                        }
                    }
                    catch (error) {
                        this.logger.error('[Sidebar] Failed to stop/transcribe native recording', error);
                        vscode.window.showErrorMessage('Recording failed: ' + error.message);
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
                case 'webviewReady':
                    this.logger.info('[Sidebar] Webview ready signal received');
                    if (this.isVoiceSessionActive) {
                        this.logger.info('[Sidebar] Restoring active voice session state...');
                        webviewView.webview.postMessage({ type: 'restoreVoiceSession' });
                    }
                    break;
            }
        });
        // Remove the fragile setTimeout
        // if (this.isVoiceSessionActive) { ... }
        this.onResolve?.(webviewView);
    }
    async getLLMProvider() {
        return this.llmService.getProvider() || undefined;
    }
    getHtmlForWebview(webview) {
        const nonce = getNonce();
        return (0, conversationTemplate_1.getConversationHTML)(nonce);
    }
}
exports.SidebarProvider = SidebarProvider;
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=SidebarProvider.js.map