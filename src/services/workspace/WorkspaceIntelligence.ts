/**
 * WorkspaceIntelligence — scans the active VSCode workspace and produces a
 * structured snapshot used by ConversationEngine to build SDLC-aware prompts.
 *
 * This service is the single source of truth for "what is the user working on?"
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PlanStateService } from '../planning/PlanStateService';
import { ConfigService } from '../../config/ConfigService';

// ─── Public Types ────────────────────────────────────────────────────────────

export type FileContext = 'security' | 'api' | 'test' | 'ui' | 'config' | 'data' | 'general';

export interface WorkspaceSnapshot {
    /** Relative path of the currently active file, or null */
    activeFile: string | null;
    /** VSCode languageId of the active file, or null */
    activeLanguage: string | null;
    /** Auto-detected tech stack flavour: react, express, nextjs, django, laravel, etc. */
    detectedFramework: string | null;
    /** Current GSD/SDLC phase label, or null if no plan is active */
    sdlcPhase: string | null;
    /** True if PlanStateService has pending coding steps */
    hasPendingPipeline: boolean;
    /** Last 5 recently modified files in the workspace (relative paths) */
    recentFiles: string[];
    /** Human-readable one-liner: "TypeScript + React + VSCode Extension" */
    stackSummary: string;
    /** File context classification for response shaping */
    fileContext: FileContext;
    /** Content of the active file (capped at maxLines) */
    activeFileContent: string;
}

// ─── WorkspaceIntelligence ───────────────────────────────────────────────────

export class WorkspaceIntelligence {
    private planStateService: PlanStateService | null = null;

    constructor(private readonly configService: ConfigService) {}

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Build a full workspace snapshot. Safe to call on every conversation turn.
     */
    async getSnapshot(): Promise<WorkspaceSnapshot> {
        const editor = vscode.window.activeTextEditor;
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;

        const activeFile = editor
            ? vscode.workspace.asRelativePath(editor.document.uri)
            : null;
        const activeLanguage = editor?.document.languageId ?? null;
        const activeFileContent = this.getActiveFileContent(editor, 120);

        const stackSummary = wsRoot ? await this.detectStack(wsRoot) : 'Unknown stack';
        const detectedFramework = wsRoot ? this.detectFramework(wsRoot) : null;
        const sdlcState = this.getPlanStateService(wsRoot);
        const hasPendingPipeline = sdlcState?.hasPendingCodingSteps() ?? false;
        const sdlcPhase = sdlcState?.getCurrentPhaseLabel() ?? null;
        const recentFiles = this.getRecentFiles(wsRoot);
        const fileContext = this.detectContext(activeFile, activeLanguage);

        return {
            activeFile,
            activeLanguage,
            detectedFramework,
            sdlcPhase,
            hasPendingPipeline,
            recentFiles,
            stackSummary,
            fileContext,
            activeFileContent,
        };
    }

    /**
     * Read the first N lines of the currently active editor file.
     * Avoids sending huge files to the LLM.
     */
    getActiveFileContent(editor?: vscode.TextEditor, maxLines = 100): string {
        const target = editor ?? vscode.window.activeTextEditor;
        if (!target) { return ''; }
        const lines = target.document.getText().split('\n');
        return lines.slice(0, maxLines).join('\n');
    }

    /**
     * Classify a file into a context category so ConversationEngine can
     * shape its response template appropriately.
     */
    detectContext(file: string | null, language: string | null): FileContext {
        if (!file) { return 'general'; }
        const lower = file.toLowerCase();

        if (lower.endsWith('.env') || lower.includes('.env.') || language === 'dotenv') {
            return 'security';
        }
        if (
            lower.includes('controller') ||
            lower.includes('router') ||
            lower.includes('route') ||
            lower.includes('handler') ||
            lower.endsWith('.http') ||
            lower.includes('api')
        ) { return 'api'; }
        if (
            lower.includes('.test.') ||
            lower.includes('.spec.') ||
            lower.includes('__tests__') ||
            language === 'jest' ||
            lower.includes('cypress')
        ) { return 'test'; }
        if (
            lower.endsWith('.jsx') ||
            lower.endsWith('.tsx') ||
            lower.includes('component') ||
            lower.includes('screen') ||
            lower.includes('page') ||
            lower.includes('view')
        ) { return 'ui'; }
        if (
            lower.endsWith('.json') ||
            lower.endsWith('.yaml') ||
            lower.endsWith('.yml') ||
            lower.endsWith('.toml') ||
            lower.includes('config') ||
            lower.includes('dockerfile')
        ) { return 'config'; }
        if (
            lower.includes('model') ||
            lower.includes('schema') ||
            lower.includes('migration') ||
            lower.includes('seed') ||
            language === 'sql'
        ) { return 'data'; }
        return 'general';
    }

    // ── Private Helpers ──────────────────────────────────────────────────────

    private getPlanStateService(wsRoot: string | null): PlanStateService | null {
        if (!wsRoot) { return null; }
        if (!this.planStateService) {
            this.planStateService = new PlanStateService(wsRoot);
        }
        return this.planStateService;
    }

    /**
     * Detect the tech stack by inspecting package.json, pyproject.toml,
     * Gemfile, pom.xml etc. Returns a compact human-readable string.
     */
    private async detectStack(wsRoot: string): Promise<string> {
        const parts: string[] = [];

        // --- JavaScript / TypeScript ---
        const pkgPath = path.join(wsRoot, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                const deps = { ...pkg.dependencies, ...pkg.devDependencies };

                if (deps['typescript']) { parts.push('TypeScript'); }
                else { parts.push('JavaScript'); }

                // Frameworks (most-specific first)
                if (deps['next']) { parts.push('Next.js'); }
                else if (deps['nuxt']) { parts.push('Nuxt.js'); }
                else if (deps['@sveltejs/kit']) { parts.push('SvelteKit'); }
                else if (deps['svelte']) { parts.push('Svelte'); }
                else if (deps['react-native']) { parts.push('React Native'); }
                else if (deps['react']) { parts.push('React'); }
                else if (deps['vue']) { parts.push('Vue.js'); }
                else if (deps['@angular/core']) { parts.push('Angular'); }
                else if (deps['express']) { parts.push('Express'); }
                else if (deps['fastify']) { parts.push('Fastify'); }
                else if (deps['@nestjs/core']) { parts.push('NestJS'); }
                else if (deps['vscode']) { parts.push('VSCode Extension'); }

            } catch { /* ignore malformed package.json */ }
        }

        // --- Python ---
        if (
            fs.existsSync(path.join(wsRoot, 'pyproject.toml')) ||
            fs.existsSync(path.join(wsRoot, 'requirements.txt'))
        ) {
            parts.push('Python');
            const req = this.tryRead(path.join(wsRoot, 'requirements.txt')) ?? '';
            if (req.includes('django')) { parts.push('Django'); }
            else if (req.includes('fastapi')) { parts.push('FastAPI'); }
            else if (req.includes('flask')) { parts.push('Flask'); }
        }

        // --- Ruby ---
        if (fs.existsSync(path.join(wsRoot, 'Gemfile'))) {
            parts.push('Ruby on Rails');
        }

        // --- Java / Kotlin ---
        if (
            fs.existsSync(path.join(wsRoot, 'pom.xml')) ||
            fs.existsSync(path.join(wsRoot, 'build.gradle'))
        ) {
            parts.push('Java / Kotlin');
        }

        // --- Go ---
        if (fs.existsSync(path.join(wsRoot, 'go.mod'))) {
            parts.push('Go');
        }

        // --- Rust ---
        if (fs.existsSync(path.join(wsRoot, 'Cargo.toml'))) {
            parts.push('Rust');
        }

        return parts.length > 0 ? parts.join(' + ') : 'Unknown stack';
    }

    /** Synchronous first-pass framework detection from package.json */
    private detectFramework(wsRoot: string): string | null {
        const pkgPath = path.join(wsRoot, 'package.json');
        if (!fs.existsSync(pkgPath)) { return null; }
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (deps['next']) { return 'nextjs'; }
            if (deps['react-native']) { return 'react-native'; }
            if (deps['react']) { return 'react'; }
            if (deps['vue']) { return 'vue'; }
            if (deps['@angular/core']) { return 'angular'; }
            if (deps['svelte']) { return 'svelte'; }
            if (deps['express']) { return 'express'; }
            if (deps['@nestjs/core']) { return 'nestjs'; }
            if (deps['vscode']) { return 'vscode-extension'; }
        } catch { /* ignore */ }
        return null;
    }

    /**
     * Return the 5 most recently saved files tracked by VSCode open editors.
     * Falls back to an empty list if unavailable.
     */
    private getRecentFiles(wsRoot: string | null): string[] {
        if (!wsRoot) { return []; }
        try {
            return vscode.workspace.textDocuments
                .filter(d => !d.isUntitled && d.uri.scheme === 'file')
                .slice(0, 5)
                .map(d => vscode.workspace.asRelativePath(d.uri));
        } catch { return []; }
    }

    private tryRead(filePath: string): string | null {
        try { return fs.readFileSync(filePath, 'utf-8'); }
        catch { return null; }
    }
}
