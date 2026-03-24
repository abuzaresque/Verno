import * as vscode from 'vscode';
import { LocalWhisperService } from './localWhisperService';
import { GroqProvider } from './llm/providers/GroqProvider';

/**
 * AudioRouter — smart routing between local Whisper and cloud Groq STT.
 *
 * IMPORTANT: For cloud STT, we call GroqProvider.transcribeAudio() directly.
 * We do NOT duplicate the multipart fetch logic.
 */

let localWhisper: LocalWhisperService | null = null;
let groqProvider: GroqProvider | null = null;

export function setLocalWhisperInstance(instance: LocalWhisperService): void {
    localWhisper = instance;
}

export function setGroqProviderInstance(instance: GroqProvider): void {
    groqProvider = instance;
}

export async function transcribeAudio(
    audioBuffer: Buffer,
    durationMs: number,
    mode: 'command' | 'dictation' | 'conversation'
): Promise<string> {
    const config = vscode.workspace.getConfiguration('verno');
    const whisperMode = config.get<string>('whisperMode', 'hybrid');

    const localAvailable = localWhisper?.isAvailable() ?? false;

    // Determine routing
    let useLocal = false;

    if (whisperMode === 'local-only') {
        useLocal = true;
    } else if (whisperMode === 'cloud-only') {
        useLocal = false;
    } else {
        // hybrid mode
        if (mode === 'command') {
            // Speed-critical: always prefer local
            useLocal = localAvailable;
        } else if (durationMs < 3000) {
            // Short audio: local is faster than cloud round-trip
            useLocal = localAvailable;
        } else {
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
        const groqKey = config.get<string>('groqApiKey') || process.env.GROQ_API_KEY;
        if (!groqKey) {
            throw new Error('No Groq API key available for cloud transcription. Set verno.groqApiKey in settings.');
        }
        groqProvider = new GroqProvider();
        await groqProvider.initialize(groqKey);
    }

    // GroqProvider.transcribeAudio expects base64 audio
    const base64Audio = audioBuffer.toString('base64');
    return groqProvider.transcribeAudio(base64Audio);
}
