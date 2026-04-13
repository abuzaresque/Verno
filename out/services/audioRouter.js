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
exports.setLocalWhisperInstance = setLocalWhisperInstance;
exports.setGroqProviderInstance = setGroqProviderInstance;
exports.transcribeAudio = transcribeAudio;
const vscode = __importStar(require("vscode"));
const GroqProvider_1 = require("./llm/providers/GroqProvider");
/**
 * AudioRouter — smart routing between local Whisper and cloud Groq STT.
 *
 * IMPORTANT: For cloud STT, we call GroqProvider.transcribeAudio() directly.
 * We do NOT duplicate the multipart fetch logic.
 */
let localWhisper = null;
let groqProvider = null;
function setLocalWhisperInstance(instance) {
    localWhisper = instance;
}
function setGroqProviderInstance(instance) {
    groqProvider = instance;
}
async function transcribeAudio(audioBuffer, durationMs, mode) {
    const config = vscode.workspace.getConfiguration('verno');
    const whisperMode = config.get('whisperMode', 'hybrid');
    const localAvailable = localWhisper?.isAvailable() ?? false;
    // Determine routing
    let useLocal = false;
    if (whisperMode === 'local-only') {
        useLocal = true;
    }
    else if (whisperMode === 'cloud-only') {
        useLocal = false;
    }
    else {
        // hybrid mode
        if (mode === 'command') {
            // Speed-critical: always prefer local
            useLocal = localAvailable;
        }
        else if (durationMs < 3000) {
            // Short audio: local is faster than cloud round-trip
            useLocal = localAvailable;
        }
        else {
            // Longer audio or local unavailable: use cloud for accuracy
            useLocal = false;
        }
    }
    // If we chose local but it's not available, fall back to cloud
    if (useLocal && !localAvailable) {
        console.log('[AudioRouter] Local whisper requested but unavailable, falling back to cloud');
        useLocal = false;
    }
    if (useLocal && localWhisper) {
        console.log(`[AudioRouter] Routing to local Whisper (mode=${mode}, duration=${durationMs}ms)`);
        return localWhisper.transcribe(audioBuffer);
    }
    // Cloud path: use existing GroqProvider.transcribeAudio
    console.log(`[AudioRouter] Routing to Groq cloud STT (mode=${mode}, duration=${durationMs}ms)`);
    if (!groqProvider) {
        // Create a temporary provider instance if one hasn't been set
        const groqKey = config.get('groqApiKey') || process.env.GROQ_API_KEY;
        if (!groqKey) {
            throw new Error('No Groq API key available for cloud transcription. Set verno.groqApiKey in settings.');
        }
        groqProvider = new GroqProvider_1.GroqProvider();
        await groqProvider.initialize(groqKey);
    }
    // GroqProvider.transcribeAudio expects base64 audio
    const base64Audio = audioBuffer.toString('base64');
    return groqProvider.transcribeAudio(base64Audio);
}
//# sourceMappingURL=audioRouter.js.map