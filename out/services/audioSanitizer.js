"use strict";
/**
 * Audio-Context Sanitization Pass
 *
 * A lightweight LLM pass that corrects noisy Whisper STT output by comparing
 * against AST symbols from the active editor. For example, spoken "max width"
 * transcribed as "max_width" gets corrected to the actual `maxWidth` variable.
 *
 * Uses VS Code's built-in DocumentSymbolProvider for zero-cost AST extraction
 * and Groq (LLaMA) for fast inference (~200ms). Falls back silently to raw
 * transcript on any error so the voice pipeline is never blocked.
 */
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
exports.AudioSanitizer = void 0;
const vscode = __importStar(require("vscode"));
const MAX_SYMBOLS = 50;
/**
 * Flatten a hierarchical DocumentSymbol tree into a flat list with line numbers.
 */
function flattenSymbols(symbols, out = []) {
    for (const sym of symbols) {
        out.push({ name: sym.name, line: sym.range.start.line });
        if (sym.children && sym.children.length > 0) {
            flattenSymbols(sym.children, out);
        }
    }
    return out;
}
/**
 * Get the nearest symbols to the cursor position, capped at MAX_SYMBOLS.
 */
function getNearestSymbols(symbols, cursorLine) {
    // Sort by distance from cursor, then take the closest MAX_SYMBOLS
    const sorted = [...symbols].sort((a, b) => Math.abs(a.line - cursorLine) - Math.abs(b.line - cursorLine));
    const capped = sorted.slice(0, MAX_SYMBOLS);
    // Deduplicate symbol names (a name may appear multiple times, e.g. overloads)
    return [...new Set(capped.map(s => s.name))];
}
class AudioSanitizer {
    /**
     * Sanitize a raw Whisper transcript by correcting identifier names
     * to match symbols in the currently active editor file.
     *
     * Returns the corrected text, or the raw transcript on any failure.
     */
    async sanitize(rawTranscript) {
        try {
            // 1. Get active editor and cursor position
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return rawTranscript;
            }
            const document = editor.document;
            const cursorLine = editor.selection.active.line;
            // 2. Extract AST symbols via VS Code's built-in provider
            const allSymbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri);
            if (!allSymbols || allSymbols.length === 0) {
                return rawTranscript;
            }
            // 3. Flatten and cap at 50 nearest to cursor
            const flat = flattenSymbols(allSymbols);
            const symbolNames = getNearestSymbols(flat, cursorLine);
            if (symbolNames.length === 0) {
                return rawTranscript;
            }
            // 4. Get Groq API key for fast inference
            const config = vscode.workspace.getConfiguration('verno');
            const groqKey = config.get('groqApiKey') || process.env.GROQ_API_KEY;
            if (!groqKey) {
                // No key available — return raw transcript silently
                return rawTranscript;
            }
            // 5. Build the sanitization prompt
            const prompt = [
                'You are a code-aware transcript corrector. You receive a voice transcription and a list of real code symbols from the user\'s active file.',
                '',
                'Your ONLY job: fix identifier names in the transcript to match the provided symbols.',
                'Rules:',
                '- ONLY correct words that are clearly misheard versions of a symbol (e.g. "max width" → "maxWidth", "get user data" → "getUserData")',
                '- Do NOT change anything else — keep the sentence structure, intent and non-code words exactly as-is',
                '- Return ONLY the corrected transcript text, nothing else',
                '',
                `SYMBOLS: ${symbolNames.join(', ')}`,
                '',
                `TRANSCRIPT: ${rawTranscript}`,
            ].join('\n');
            // 6. Fast Groq LLM call
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant',
                    max_tokens: 256,
                    temperature: 0,
                    messages: [
                        { role: 'user', content: prompt },
                    ],
                }),
            });
            if (!response.ok) {
                console.warn(`[AudioSanitizer] Groq API error: ${response.status}`);
                return rawTranscript;
            }
            const data = await response.json();
            const corrected = data.choices?.[0]?.message?.content?.trim();
            if (!corrected || corrected.length === 0) {
                return rawTranscript;
            }
            // 7. Log the correction if it changed
            if (corrected !== rawTranscript) {
                console.log(`[AudioSanitizer] Corrected: "${rawTranscript}" → "${corrected}"`);
            }
            return corrected;
        }
        catch (err) {
            // Never block the pipeline — silently return raw transcript
            console.warn(`[AudioSanitizer] Sanitization failed, passing raw transcript: ${err}`);
            return rawTranscript;
        }
    }
}
exports.AudioSanitizer = AudioSanitizer;
//# sourceMappingURL=audioSanitizer.js.map