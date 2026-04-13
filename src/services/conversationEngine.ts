/**
 * ConversationEngine — SDLC-aware conversational AI for Verno.
 *
 * Responsibilities:
 * 1. Build a rich system prompt from WorkspaceIntelligence snapshot (SDLC phase, stack, file context)
 * 2. Route calls to the fastest available provider (Anthropic claude-3-5-sonnet / Groq llama)
 * 3. Classify input as "conversational" (fast path, no full context rebuild) vs "requires_context"
 * 4. Proactively surface pending coding pipelines to the user
 * 5. Shape response style per detected file context: security, api, test, ui, config, data, general
 */

import * as vscode from 'vscode';
import { WorkspaceIntelligence, WorkspaceSnapshot, FileContext } from './workspace/WorkspaceIntelligence';
import { ConfigService } from '../config/ConfigService';
import { Logger } from '../utils/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Message {
    role: 'user' | 'assistant';
    content: string;
}

// ─── Response template map ───────────────────────────────────────────────────

const CONTEXT_INSTRUCTIONS: Record<FileContext, string> = {
    security: `ADVISORY MODE: SECURITY
You are reviewing a security-sensitive file. Lead every response with:
- The relevant OWASP Top 10 category (if applicable)
- A concrete risk level (Critical / High / Medium / Low)
- A specific, actionable remediation step
Never downplay security issues. Flag secrets, hardcoded credentials, or insecure patterns immediately.`,

    api: `ADVISORY MODE: API DESIGN
Focus on:
- REST / GraphQL best-practices
- Correct HTTP status codes and error shapes
- Auth patterns: JWT, OAuth2, API keys
- Rate limiting and input validation concerns`,

    test: `ADVISORY MODE: TESTING
Focus on:
- Coverage gaps — what isn't tested?
- Edge cases and boundary conditions
- Mocking strategy and test isolation
- Suggest specific test cases the user may have missed`,

    ui: `ADVISORY MODE: UI/UX
Focus on:
- Component composition and reusability
- Accessibility (ARIA roles, keyboard nav)
- Performance: unnecessary re-renders, lazy loading
- Design system consistency`,

    config: `ADVISORY MODE: CONFIGURATION
Focus on:
- Secrets and credential hygiene (no hardcoded values)
- Environment parity (dev vs prod config drift)
- Schema validation and required field checks
- Docker / CI/CD configuration best practices`,

    data: `ADVISORY MODE: DATA / DATABASE
Focus on:
- Schema design and normalization
- Index strategy and query performance
- Migration safety (zero-downtime migrations)
- Data integrity constraints and validation`,

    general: `ADVISORY MODE: GENERAL
Provide balanced guidance across architecture, code quality, and SDLC best practices.
Prioritise the most impactful improvement for the current file.`,
};

// ─── ConversationEngine ──────────────────────────────────────────────────────

export class ConversationEngine {
    private history: Message[] = [];
    /** Track how many turns have passed since last pipeline reminder */
    private turnsSinceLastPipelineNudge = 0;
    private readonly PIPELINE_NUDGE_INTERVAL = 3;

    constructor(
        private readonly wsIntel: WorkspaceIntelligence,
        private readonly configService: ConfigService,
        private readonly logger: Logger
    ) {}

    // ── Public API ────────────────────────────────────────────────────────────

    public clearHistory(): void {
        this.history = [];
        this.turnsSinceLastPipelineNudge = 0;
    }

    /**
     * Main entry point. Routes to fast path (conversational) or full path (context-rich).
     */
    public async think(userSpeech: string): Promise<string> {
        const snapshot = await this.wsIntel.getSnapshot();
        const conversational = await this.isConversational(userSpeech);
        this.logger.debug(`[ConversationEngine] Route: ${conversational ? 'fast' : 'full'} | context: ${snapshot.fileContext}`);

        let reply: string;
        if (conversational) {
            reply = await this.thinkFast(userSpeech, snapshot);
        } else {
            reply = await this.thinkFull(userSpeech, snapshot);
        }

        // Proactive pipeline nudge
        this.turnsSinceLastPipelineNudge++;
        if (
            snapshot.hasPendingPipeline &&
            this.turnsSinceLastPipelineNudge >= this.PIPELINE_NUDGE_INTERVAL &&
            !this.pipelineMentionedRecently(userSpeech)
        ) {
            reply += `\n\n💡 **Pipeline reminder:** You have a pending coding pipeline from your last planning session. Say "run the pipeline" or "continue development" to execute it.`;
            this.turnsSinceLastPipelineNudge = 0;
        }

        return reply;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /**
     * Build the full SDLC-aware system prompt from the workspace snapshot.
     */
    private buildSystemPrompt(snapshot: WorkspaceSnapshot): string {
        const contextInstruction = CONTEXT_INSTRUCTIONS[snapshot.fileContext];
        const recentFilesStr = snapshot.recentFiles.length > 0
            ? snapshot.recentFiles.join(', ')
            : 'none';

        const fileBlock = snapshot.activeFile
            ? `Active File: ${snapshot.activeFile} (${snapshot.activeLanguage ?? 'unknown'})
Active File Content (first 120 lines):
\`\`\`${snapshot.activeLanguage ?? ''}
${snapshot.activeFileContent}
\`\`\``
            : 'No active file.';

        const pipelineBlock = snapshot.hasPendingPipeline
            ? `✅ Pending Pipeline: ${snapshot.sdlcPhase ?? 'coding steps awaiting execution'}`
            : 'No active pipeline.';

        return `You are Verno, an SDLC-aware AI coding assistant with expert knowledge of software architecture, security (OWASP Top 10), clean code, testing, DevOps, and project planning.

You are pair programming with a developer and speaking naturally to them — be direct, specific, and concise.

CRITICAL RULES:
1. Never say "certainly", "of course", "I can help with that", or AI filler phrases.
2. Ask ONLY ONE clarifying question per response if needed.
3. Keep simple answers under 3 sentences.
4. Refer to the active file and visible code naturally ("I can see you have...", "Looking at line...").
5. Always ground security answers in OWASP categories.

━━━━━━━━━━━━━━━━━━━━━━━━━━
WORKSPACE CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━
Stack: ${snapshot.stackSummary}
Framework: ${snapshot.detectedFramework ?? 'not detected'}
${fileBlock}
Recently open: ${recentFilesStr}
${pipelineBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━
${contextInstruction}
━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    }

    /**
     * Fast path — minimal context, just conversation history.
     * Used when the user's message is a follow-up or chitchat.
     */
    private async thinkFast(userSpeech: string, snapshot: WorkspaceSnapshot): Promise<string> {
        this.history.push({ role: 'user', content: userSpeech });

        const systemPrompt = `You are Verno, a conversational AI pair programmer.
The user just gave a conversational or clarifying response.
Based on the conversation history, naturally reply or ask ONLY ONE brief clarifying question.
Be very brief (1–2 sentences). No AI filler. No "certainly".
Stack context: ${snapshot.stackSummary}.`;

        const reply = await this.callLLM(systemPrompt, 300);
        this.history.push({ role: 'assistant', content: reply });
        return reply;
    }

    /**
     * Full path — includes workspace snapshot and context-shaped system prompt.
     */
    private async thinkFull(userSpeech: string, snapshot: WorkspaceSnapshot): Promise<string> {
        this.history.push({ role: 'user', content: userSpeech });
        const systemPrompt = this.buildSystemPrompt(snapshot);
        const reply = await this.callLLM(systemPrompt, 1024);
        this.history.push({ role: 'assistant', content: reply });
        return reply;
    }

    /**
     * Classify the input as conversational (fast) or action-requiring (full context).
     * Uses Groq llama-3.1-8b for ultra-fast classification if a Groq key exists.
     */
    private async isConversational(userSpeech: string): Promise<boolean> {
        const groqKey = await this.configService.getApiKey('groq');
        if (!groqKey) { return false; }

        const historyCtx = JSON.stringify(this.history.slice(-3));
        const prompt = `Conversation history: ${historyCtx}\nLatest user message: "${userSpeech}"\n\nReply ONLY with "conversational" or "requires_context".\n"conversational" = chit-chat, yes/no follow-up, clarification question\n"requires_context" = coding action, file change, debugging, security scan, planning`;

        try {
            const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0,
                    max_tokens: 10
                })
            });
            if (resp.ok) {
                const data: any = await resp.json();
                return data.choices?.[0]?.message?.content?.trim().toLowerCase().includes('conversational') ?? false;
            }
        } catch (err) {
            this.logger.debug(`[ConversationEngine] Classification failed: ${err}`);
        }
        return false;
    }

    /**
     * Call the best available LLM provider.
     * Priority: Anthropic Claude → Groq LLaMA
     */
    private async callLLM(systemPrompt: string, maxTokens: number): Promise<string> {
        const anthropicKey = await this.configService.getApiKey('anthropic');
        const groqKey = await this.configService.getApiKey('groq');

        if (anthropicKey) {
            return this.callAnthropic(anthropicKey, systemPrompt, maxTokens);
        }
        if (groqKey) {
            return this.callGroq(groqKey, systemPrompt, maxTokens);
        }
        return "No API keys configured. Please set your Anthropic or Groq key via the Verno: Set API Key command.";
    }

    private async callAnthropic(key: string, systemPrompt: string, maxTokens: number): Promise<string> {
        try {
            const resp = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': key,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'claude-3-5-sonnet-20241022',
                    max_tokens: maxTokens,
                    system: systemPrompt,
                    messages: this.history
                })
            });
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(`Anthropic ${resp.status}: ${text}`);
            }
            const data: any = await resp.json();
            return data.content?.[0]?.text ?? '';
        } catch (err) {
            this.logger.error('[ConversationEngine] Anthropic call failed', err as Error);
            return `I ran into an error calling Anthropic. Check the Verno output log.`;
        }
    }

    private async callGroq(key: string, systemPrompt: string, maxTokens: number): Promise<string> {
        try {
            const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'llama-3.1-70b-versatile',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...this.history
                    ],
                    max_tokens: maxTokens,
                    temperature: 0.7
                })
            });
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(`Groq ${resp.status}: ${text}`);
            }
            const data: any = await resp.json();
            return data.choices?.[0]?.message?.content ?? '';
        } catch (err) {
            this.logger.error('[ConversationEngine] Groq call failed', err as Error);
            return `I ran into an error calling Groq. Check the Verno output log.`;
        }
    }

    /** Check if the user recently mentioned the pipeline in their message */
    private pipelineMentionedRecently(speech: string): boolean {
        const lower = speech.toLowerCase();
        return lower.includes('pipeline') || lower.includes('continue') || lower.includes('run');
    }
}
