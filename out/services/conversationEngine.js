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
exports.ConversationEngine = void 0;
const vscode = __importStar(require("vscode"));
class ConversationEngine {
    history = [];
    clearHistory() {
        this.history = [];
    }
    getDiagnosticsContext() {
        const diagnostics = vscode.languages.getDiagnostics();
        let issues = [];
        let totalCount = 0;
        diagnostics.forEach(([uri, diags]) => {
            if (diags.length > 0 && totalCount < 30) {
                issues.push(`File: ${vscode.workspace.asRelativePath(uri)}`);
                diags.forEach(d => {
                    if (totalCount < 30) {
                        issues.push(`- [Line ${d.range.start.line + 1}] ${d.message}`);
                        totalCount++;
                    }
                });
            }
        });
        if (issues.length === 0)
            return "No workspace errors.";
        return issues.join('\n');
    }
    async getGitContext() {
        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (gitExtension) {
                const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
                const api = git.getAPI(1);
                if (api.repositories && api.repositories.length > 0) {
                    const repo = api.repositories[0];
                    const changes = repo.state.workingTreeChanges;
                    if (!changes || changes.length === 0)
                        return "No uncommitted changes.";
                    const changedFiles = changes.map((c) => c.uri.fsPath.split(/[\\/]/).pop()).join(', ');
                    return `Modified files: ${changedFiles}`;
                }
            }
        }
        catch (e) {
            console.error('Failed to get git context:', e);
        }
        return "Git status unavailable.";
    }
    async buildSystemPrompt() {
        let fileContext = "No active editor.";
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const fileName = editor.document.fileName.split(/[\\/]/).pop() || '';
            const language = editor.document.languageId;
            const content = editor.document.getText().substring(0, 3000);
            const line = editor.selection.active.line + 1;
            fileContext = `Active File: ${fileName} (${language})
Cursor Line: ${line}

Content (first 3000 chars):
\`\`\`${language}
${content}
\`\`\`
`;
        }
        const diagnosticsContext = this.getDiagnosticsContext();
        const gitContext = await this.getGitContext();
        return `You are Verno, a senior software developer pair programming with the user. You are speaking out loud to them via text-to-speech, like on a phone call.
        
CRITICAL RULES FOR YOUR RESPONSES:
1. Be concise, conversational, and NOT chatbot-like.
2. NEVER say "certainly", "of course", "I can help with that", or similar AI filler.
3. If you need clarity, ask ONLY ONE clarifying question at a time.
4. Keep simple answers under 3 sentences.
5. Mention what you see on the user's screen naturally.

CURRENT WORKSPACE CONTEXT:
${fileContext}

WORKSPACE ERRORS:
${diagnosticsContext}

GIT STATUS:
${gitContext}`;
    }
    async isConversational(userSpeech) {
        const config = vscode.workspace.getConfiguration('verno');
        const groqConfigKey = config.get('groqApiKey');
        const groqKey = groqConfigKey || process.env.GROQ_API_KEY;
        if (!groqKey) {
            return false;
        }
        const historyContext = JSON.stringify(this.history.slice(-3));
        const prompt = `Conversation history: ${historyContext}\nLatest user message: "${userSpeech}"\n\nReply with ONLY "conversational" or "requires_context".\n"conversational" = chit-chat, yes/no follow-up, clarification question\n"requires_context" = any coding action, file change, debugging request`;
        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0,
                    max_tokens: 10
                })
            });
            if (response.ok) {
                const data = await response.json();
                const result = data.choices[0]?.message?.content?.trim().toLowerCase() || '';
                return result.includes('conversational');
            }
        }
        catch (err) {
            // Log and fallback
            console.warn('[ConversationEngine] Clarification pass failed:', err);
        }
        return false;
    }
    async think(userSpeech) {
        const conversational = await this.isConversational(userSpeech);
        console.log(`[ConversationEngine] Path: ${conversational ? 'fast' : 'full'}`);
        if (conversational) {
            return this.thinkWithoutContext(userSpeech);
        }
        else {
            return this.thinkWithContext(userSpeech);
        }
    }
    async thinkWithoutContext(userSpeech) {
        this.history.push({ role: 'user', content: userSpeech });
        const systemPrompt = `You are a conversational AI pair programmer. The user just gave a conversational or clarifying response. Based on the conversation history, naturally reply or ask a brief clarifying question to understand what exactly they want to do next. Be very brief (1-2 sentences). Do NOT say "certainly" or "I can help with that".`;
        const config = vscode.workspace.getConfiguration('verno');
        const anthropicKey = config.get('anthropicApiKey');
        let replyText = '';
        try {
            if (anthropicKey && anthropicKey.trim() !== '') {
                const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'x-api-key': anthropicKey,
                        'anthropic-version': '2023-06-01',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'claude-3-5-sonnet-20241022',
                        max_tokens: 300,
                        system: systemPrompt,
                        messages: this.history
                    })
                });
                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(`Anthropic Error: ${response.status} ${text}`);
                }
                const data = await response.json();
                replyText = data.content?.[0]?.text || '';
            }
            else {
                const groqConfigKey = config.get('groqApiKey');
                const groqKey = groqConfigKey || process.env.GROQ_API_KEY;
                if (!groqKey) {
                    throw new Error('Neither Anthropic nor Groq API keys are set.');
                }
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'llama-3.1-70b-versatile',
                        messages: [
                            { role: 'system', content: systemPrompt },
                            ...this.history
                        ],
                        temperature: 0.7,
                        max_tokens: 300
                    })
                });
                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(`Groq LLM Error: ${response.status} ${text}`);
                }
                const data = await response.json();
                replyText = data.choices[0]?.message?.content || '';
            }
        }
        catch (error) {
            console.error('[ConversationEngine] Fast Think Error:', error);
            replyText = "I'm having trouble connecting to my brain right now. Please check your API keys.";
        }
        if (replyText) {
            this.history.push({ role: 'assistant', content: replyText });
        }
        return replyText;
    }
    async thinkWithContext(userSpeech) {
        this.history.push({ role: 'user', content: userSpeech });
        const systemPrompt = await this.buildSystemPrompt();
        const config = vscode.workspace.getConfiguration('verno');
        const anthropicKey = config.get('anthropicApiKey');
        let replyText = '';
        try {
            if (anthropicKey && anthropicKey.trim() !== '') {
                // Use Anthropic Claude
                const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'x-api-key': anthropicKey,
                        'anthropic-version': '2023-06-01',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'claude-3-5-sonnet-20241022',
                        max_tokens: 1000,
                        system: systemPrompt,
                        messages: this.history
                    })
                });
                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(`Anthropic Error: ${response.status} ${text}`);
                }
                const data = await response.json();
                replyText = data.content?.[0]?.text || '';
            }
            else {
                // Fallback to Groq LLaMA
                // For Groq API key, the system uses prompts or process.env or fallback to groqApiKey config if it exists
                const groqConfigKey = config.get('groqApiKey');
                const groqKey = groqConfigKey || process.env.GROQ_API_KEY;
                if (!groqKey) {
                    throw new Error('Neither Anthropic nor Groq API keys are set. Please set verno.anthropicApiKey in settings.');
                }
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'llama-3.1-70b-versatile',
                        messages: [
                            { role: 'system', content: systemPrompt },
                            ...this.history
                        ]
                    })
                });
                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(`Groq Error: ${response.status} ${text}`);
                }
                const data = await response.json();
                replyText = data.choices?.[0]?.message?.content || '';
            }
        }
        catch (error) {
            console.error('Conversation Engine Error:', error);
            // On failure, reply with error message so user knows
            replyText = "Sorry, I ran into an error connecting to the AI model. Check the extension logs.";
        }
        // Add assistant reply to history
        if (replyText) {
            this.history.push({ role: 'assistant', content: replyText });
        }
        return replyText;
    }
}
exports.ConversationEngine = ConversationEngine;
//# sourceMappingURL=conversationEngine.js.map