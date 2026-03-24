import * as vscode from 'vscode';

export interface Message {
    role: 'user' | 'assistant';
    content: string;
}

export class ConversationEngine {
    private history: Message[] = [];

    public clearHistory(): void {
        this.history = [];
    }

    private getDiagnosticsContext(): string {
        const diagnostics = vscode.languages.getDiagnostics();
        let issues: string[] = [];
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

        if (issues.length === 0) return "No workspace errors.";
        return issues.join('\n');
    }

    private async getGitContext(): Promise<string> {
        try {
            const gitExtension = vscode.extensions.getExtension<any>('vscode.git');
            if (gitExtension) {
                const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
                const api = git.getAPI(1);
                if (api.repositories && api.repositories.length > 0) {
                    const repo = api.repositories[0];
                    const changes = repo.state.workingTreeChanges;
                    if (!changes || changes.length === 0) return "No uncommitted changes.";
                    const changedFiles = changes.map((c: any) => c.uri.fsPath.split(/[\\/]/).pop()).join(', ');
                    return `Modified files: ${changedFiles}`;
                }
            }
        } catch (e) {
            console.error('Failed to get git context:', e);
        }
        return "Git status unavailable.";
    }

    private async buildSystemPrompt(): Promise<string> {
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

    private async isConversational(userSpeech: string): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('verno');
        const groqConfigKey = config.get<string>('groqApiKey');
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
                const data: any = await response.json();
                const result = data.choices[0]?.message?.content?.trim().toLowerCase() || '';
                return result.includes('conversational');
            }
        } catch (err) {
            // Log and fallback
            console.warn('[ConversationEngine] Clarification pass failed:', err);
        }
        return false;
    }

    public async think(userSpeech: string): Promise<string> {
        const conversational = await this.isConversational(userSpeech);
        console.log(`[ConversationEngine] Path: ${conversational ? 'fast' : 'full'}`);

        if (conversational) {
            return this.thinkWithoutContext(userSpeech);
        } else {
            return this.thinkWithContext(userSpeech);
        }
    }

    private async thinkWithoutContext(userSpeech: string): Promise<string> {
        this.history.push({ role: 'user', content: userSpeech });
        const systemPrompt = `You are a conversational AI pair programmer. The user just gave a conversational or clarifying response. Based on the conversation history, naturally reply or ask a brief clarifying question to understand what exactly they want to do next. Be very brief (1-2 sentences). Do NOT say "certainly" or "I can help with that".`;

        const config = vscode.workspace.getConfiguration('verno');
        const anthropicKey = config.get<string>('anthropicApiKey');

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

                const data: any = await response.json();
                replyText = data.content?.[0]?.text || '';
            } else {
                const groqConfigKey = config.get<string>('groqApiKey');
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

                const data: any = await response.json();
                replyText = data.choices[0]?.message?.content || '';
            }
        } catch (error) {
            console.error('[ConversationEngine] Fast Think Error:', error);
            replyText = "I'm having trouble connecting to my brain right now. Please check your API keys.";
        }

        if (replyText) {
            this.history.push({ role: 'assistant', content: replyText });
        }
        return replyText;
    }

    private async thinkWithContext(userSpeech: string): Promise<string> {
        this.history.push({ role: 'user', content: userSpeech });
        const systemPrompt = await this.buildSystemPrompt();

        const config = vscode.workspace.getConfiguration('verno');
        const anthropicKey = config.get<string>('anthropicApiKey');

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

                const data: any = await response.json();
                replyText = data.content?.[0]?.text || '';
            } else {
                // Fallback to Groq LLaMA
                // For Groq API key, the system uses prompts or process.env or fallback to groqApiKey config if it exists
                const groqConfigKey = config.get<string>('groqApiKey');
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

                const data: any = await response.json();
                replyText = data.choices?.[0]?.message?.content || '';
            }
        } catch (error) {
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
