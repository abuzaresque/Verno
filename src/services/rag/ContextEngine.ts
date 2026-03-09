import { ImportTracer } from './ImportTracer';
import { IndexingService } from './IndexingService';
import { TokenBudget } from './TokenBudget';
import { LSPService } from './LSPService';
import * as vscode from 'vscode';

export class ContextEngine {
    private importTracer: ImportTracer;
    private indexingService: IndexingService;
    private lspService: LSPService;
    private workspaceRoot: string;
    private maxBudgetTokens: number;

    constructor(
        importTracer: ImportTracer,
        indexingService: IndexingService,
        workspaceRoot: string,
        maxBudgetTokens: number = 12000
    ) {
        this.importTracer = importTracer;
        this.indexingService = indexingService;
        this.lspService = new LSPService();
        this.workspaceRoot = workspaceRoot;
        this.maxBudgetTokens = maxBudgetTokens;
    }

    /**
     * Tiered context retrieval with explicit token budget management.
     * 
     * Tier 0: LSP type definitions (highest signal, lowest token cost)
     * Tier 1: Structural dependencies via import graph
     * Tier 2: Semantic vector fallback
     */
    async getTieredContext(userRequest: string, maxSemanticChunks: number = 8): Promise<string> {
        const budget = new TokenBudget(this.maxBudgetTokens);
        let contextBuffer = '';
        const includedFiles = new Set<string>();

        // Stale index warning
        if (this.indexingService.currentlyIndexing) {
            contextBuffer += '[⚠ INDEX UPDATING — context may be partially stale]\n\n';
        }

        // Extract symbol hints once — reused by Tier 0 and Tier 2
        const symbolHints = this.extractSymbolHints(userRequest);

        // --- Tier 0: LSP Type Definitions ---
        // Highest signal, lowest token cost. One hover call gives us type info
        // that no amount of file chunking can replicate.
        try {
            const activeFileUri = this.getActiveFileUri(userRequest);
            const typeInfos = await this.lspService.resolveSymbolTypes(symbolHints, activeFileUri || undefined);

            if (typeInfos.length > 0) {
                const lspContext = LSPService.formatForPrompt(typeInfos);
                if (budget.canFit(lspContext)) {
                    budget.consume(lspContext);
                    contextBuffer += lspContext + '\n';
                }
            }
        } catch {
            // LSP not available — graceful degradation, skip Tier 0
        }

        // --- Tier 1: Structural Context (Import Graph) ---
        const rootFile = this.guessActiveFile(userRequest);

        if (rootFile) {
            const rootContext = this.importTracer.getFileContext(rootFile);
            if (budget.canFit(rootContext)) {
                budget.consume(rootContext);
                contextBuffer += rootContext;
                includedFiles.add(rootFile);
            } else {
                const truncated = this.truncateToBudget(rootContext, budget);
                contextBuffer += truncated;
                includedFiles.add(rootFile);
            }

            const deps = this.importTracer.resolveDependencies(rootFile);
            for (const dep of deps) {
                if (includedFiles.has(dep)) continue;
                const depContext = this.importTracer.getFileContext(dep);
                if (budget.canFit(depContext)) {
                    budget.consume(depContext);
                    contextBuffer += depContext;
                    includedFiles.add(dep);
                } else if (budget.remaining() > 500) {
                    const truncated = this.truncateToBudget(depContext, budget);
                    contextBuffer += truncated;
                    includedFiles.add(dep);
                    break;
                } else {
                    break;
                }
            }
        }

        // --- Tier 2: Semantic Vector Fallback ---
        if (budget.remaining() > 500) {
            const semanticContext = await this.indexingService.retrieveContext(
                userRequest,
                maxSemanticChunks,
                symbolHints
            );

            if (semanticContext) {
                const remainingChars = Math.floor(budget.remaining() * 3.5);
                const trimmed = semanticContext.length > remainingChars
                    ? semanticContext.substring(0, remainingChars) + '\n... (semantic context truncated to budget)'
                    : semanticContext;

                contextBuffer += `\n[SEMANTIC FALLBACK]\n${trimmed}`;
                budget.consume(trimmed);
            }
        }

        return contextBuffer;
    }

    /**
     * Extract potential symbol names from the user's prompt.
     */
    private extractSymbolHints(request: string): string[] {
        const tokens = request.split(/[^a-zA-Z0-9_]+/).filter(t => t.length > 2);
        const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'are', 'was', 'not', 'but', 'can', 'all', 'will', 'add', 'fix', 'bug', 'new', 'use', 'make', 'get', 'set', 'run', 'file', 'code', 'implement', 'create', 'update', 'delete', 'change', 'modify']);
        return tokens.filter(t => !stopWords.has(t.toLowerCase()));
    }

    /** Truncate text to fit remaining budget, preserving whole lines */
    private truncateToBudget(text: string, budget: TokenBudget): string {
        const maxChars = Math.floor(budget.remaining() * 3.5);
        if (text.length <= maxChars) {
            budget.consume(text);
            return text;
        }

        const cut = text.substring(0, maxChars);
        const lastNewline = cut.lastIndexOf('\n');
        const truncated = lastNewline > 0 ? cut.substring(0, lastNewline) : cut;
        budget.consume(truncated);
        return truncated + '\n... (truncated to token budget)\n';
    }

    /** Try to get the active editor's file URI, or resolve from request */
    private getActiveFileUri(request: string): vscode.Uri | null {
        // First: check VS Code's actual active editor
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            return activeEditor.document.uri;
        }

        // Fallback: try to find a file path in the request
        const filePath = this.guessActiveFile(request);
        if (filePath) {
            return vscode.Uri.file(filePath);
        }

        return null;
    }

    /** Heuristic: find a file path or name in the user's request */
    private guessActiveFile(request: string): string | null {
        const pathMatch = request.match(/([\w./-]+\.(ts|js|jsx|tsx|py|css|html))/i);
        if (pathMatch) {
            const candidate = `${this.workspaceRoot}/${pathMatch[1]}`;
            try {
                const fs = require('fs');
                if (fs.existsSync(candidate)) return candidate;
            } catch { }
        }
        return null;
    }
}
