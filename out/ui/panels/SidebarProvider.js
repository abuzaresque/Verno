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
const path = __importStar(require("path"));
const conversationTemplate_1 = require("../templates/conversationTemplate");
const WindowsVoiceRecorder_1 = require("../../services/voice/WindowsVoiceRecorder");
const audioSanitizer_1 = require("../../services/audioSanitizer");
class SidebarProvider {
    context;
    static viewType = 'verno.agentPanel';
    logger;
    llmService;
    windowsRecorder = null;
    audioSanitizer;
    onResolve;
    sessionVoiceKey;
    isVoiceSessionActive = false;
    constructor(context, logger, llmService, onResolve) {
        this.context = context;
        this.logger = logger;
        this.llmService = llmService;
        this.audioSanitizer = new audioSanitizer_1.AudioSanitizer();
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
                case 'start-sdlc':
                    await vscode.commands.executeCommand('verno.startSDLC', data.input);
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
                case 'vadAudioData':
                    try {
                        this.logger.info('[Sidebar] Received VAD Int16Array data from Webview');
                        const samples = data.audioData;
                        if (!samples || samples.length < 8000) {
                            this.logger.warn('[Sidebar] VAD audio too short (less than 0.5s). Aborting.');
                            vscode.window.showWarningMessage('Recording was too short.');
                            webviewView.webview.postMessage({ type: 'voiceError', message: 'Recording too short' });
                            return;
                        }
                        const wavBuffer = this.encodeWav(samples, 16000);
                        const base64Audio = wavBuffer.toString('base64');
                        await this.processAudioBase64(base64Audio, webviewView);
                    }
                    catch (error) {
                        this.logger.error('[Sidebar] Failed to process VAD audio', error);
                        vscode.window.showErrorMessage('VAD processing failed: ' + error.message);
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
                                try {
                                    fs.unlinkSync(filePath);
                                }
                                catch (e) { }
                                return;
                            }
                            const fileBuffer = fs.readFileSync(filePath);
                            const base64Audio = fileBuffer.toString('base64');
                            try {
                                fs.unlinkSync(filePath);
                            }
                            catch (e) { }
                            await this.processAudioBase64(base64Audio, webviewView);
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
    encodeWav(samples, sampleRate = 16000) {
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
    async processAudioBase64(base64Audio, webviewView) {
        // PREFER GROQ WHISPER IF AVAILABLE
        let groqKey = (await this.context.secrets.get('groqApiKey')) || this.sessionVoiceKey;
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
                        this.sessionVoiceKey = groqKey;
                    }
                }
            }
            catch (envErr) {
                this.logger.warn(`[Sidebar] Error reading .env file: ${envErr.message}`);
            }
        }
        let transcriptionProvider;
        if (groqKey) {
            const { GroqProvider } = require('../../services/llm/providers/GroqProvider');
            const groqProvider = new GroqProvider();
            await groqProvider.initialize(groqKey);
            transcriptionProvider = groqProvider;
        }
        else {
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
                }
                else if (inputKey.startsWith('AIza')) {
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
                : 'No API Key configured for Voice.';
            vscode.window.showWarningMessage(msg);
            webviewView.webview.postMessage({ type: 'voiceError', message: msg });
        }
    }
    getHtmlForWebview(webview) {
        const nonce = getNonce();
        const vadPaths = {
            bundlePath: webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'vad', 'vad.bundle.min.js'))).toString(),
            workletPath: webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'vad', 'vad.worklet.bundle.min.js'))).toString(),
            modelPath: webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'vad', 'silero_vad.onnx'))).toString(),
            wasmRoot: webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'vad'))).toString() + '/'
        };
        return (0, conversationTemplate_1.getConversationHTML)(nonce, vadPaths);
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