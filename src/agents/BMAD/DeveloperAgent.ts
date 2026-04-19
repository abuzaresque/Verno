import { BaseAgent } from '../base/BaseAgent';
import { IAgentContext } from '../../types';
import { LLMService } from '../../services/llm';
import { FileService } from '../../services/file/FileService';
import { FileChangeTracker } from '../../services/file/FileChangeTracker';
import { FeedbackService, IssueSeverity } from '../../services/feedback';
import { ProjectAnalyzer } from '../../services/project';
import { VectorStore } from '../../services/rag/VectorStore';
import { EmbeddingService } from '../../services/rag/EmbeddingService';
import { IndexingService } from '../../services/rag/IndexingService';
import { ImportTracer } from '../../services/rag/ImportTracer';
import { ContextEngine } from '../../services/rag/ContextEngine';
import { SymbolChunker } from '../../services/rag/SymbolChunker';
import * as childProcess from 'child_process';
import * as util from 'util';
import * as fs from 'fs';
import * as path from 'path';

const exec = util.promisify(childProcess.exec);

/**
 * Enhanced Developer Agent with Test Execution and Quality Checks
 * Generates code, runs tests, and validates quality
 */
export class DeveloperAgent extends BaseAgent {
  name = 'developer';
  description = 'Developer - Senior software engineer, code implementation, testing, quality assurance';
  private feedbackService?: FeedbackService;
  private indexingService?: IndexingService;
  private importTracer?: ImportTracer;
  private contextEngine?: ContextEngine;

  constructor(
    protected logger: any,
    private llmService: LLMService,
    private fileService: FileService,
    private changeTracker: FileChangeTracker
  ) {
    super(logger);
  }

  // Late initialization to access workspace context dynamically
  private lazyInitRagServices(workspaceRoot: string) {
    if (this.contextEngine) return;
    const vectorStore = new VectorStore();
    const embeddingService = new EmbeddingService();
    // extensionPath fallback: use workspaceRoot if no extension context available
    const symbolChunker = new SymbolChunker(workspaceRoot);
    this.indexingService = new IndexingService(vectorStore, embeddingService, symbolChunker, workspaceRoot);
    this.importTracer = new ImportTracer(workspaceRoot);
    this.contextEngine = new ContextEngine(this.importTracer, this.indexingService, workspaceRoot);
  }

  async execute(context: IAgentContext): Promise<string> {
    this.log('Running Developer (Amelia) - Implementation with Quality Checks');

    // Initialize feedback service
    if (context.workspaceRoot) {
      this.feedbackService = new FeedbackService(context.workspaceRoot);
    }

    const completedTasks: string[] = [];
    const issues: Array<{ severity: IssueSeverity; description: string; context: string }> = [];
    const suggestions: string[] = [];

    const MAX_RETRIES = 3;
    let finalBuffer = '';
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      this.log(`Self-healing loop attempt ${attempt}/${MAX_RETRIES}`);
      
      // Clear per-attempt tracking arrays if it's a retry
      if (attempt > 1) {
        completedTasks.length = 0;
        issues.length = 0;
        suggestions.length = 0;
      }

    // Get previous outputs from context
    const previousOutputs = (context.metadata?.previousOutputs || {}) as Record<string, string>;
    const analysis = previousOutputs['analyst'] || '';
    const architecture = previousOutputs['architect'] || '';
    const uxDesign = previousOutputs['uxdesigner'] || '';
    const conversationHistory = (context.metadata?.conversationHistory as string) || '';
    const projectContext = (context.metadata?.projectContext as string) || '';
    const editMode = !!context.metadata?.editMode;
    const userRequest = context.metadata?.userRequest as string || 'implement feature';

    // Retrieve high-density Tiered Context via Import Graph + Local RAG pipeline
    let existingFilesContext = '';
    if (context.workspaceRoot) {
      try {
        this.lazyInitRagServices(context.workspaceRoot);
        if (this.indexingService && this.contextEngine) {
          this.log('Building Structural/Semantic Context...');
          // Fire-and-forget background indexing (Tier 2 baseline)
          this.indexingService.indexWorkspace(context.workspaceRoot, this).catch((ragErr: any) => {
            this.log(`Background RAG indexing failed (non-fatal): ${ragErr?.message ?? ragErr}`, 'warn');
          });

          // Fetch Tier 1 (Structural) + Tier 2 (Vector Fallback)
          existingFilesContext = await this.contextEngine.getTieredContext(userRequest, 8);
          this.log(`Retrieved Tiered context chunks. Size: ${existingFilesContext.length} chars`);
        }
      } catch (ragErr: any) {
        // Native module (e.g. sharp via @xenova/transformers) unavailable — degrade gracefully.
        // Code generation proceeds without semantic context.
        this.log(`RAG context unavailable (native module issue — ${ragErr?.message ?? ragErr}). Proceeding without context.`, 'warn');
        existingFilesContext = '';
      }
    }

    let hasCodeFiles = false;
    if (context.workspaceRoot) {
      const analyzer = new ProjectAnalyzer(context.workspaceRoot);
      hasCodeFiles = !analyzer.isNewProject();
    }

    const hasExistingCode = existingFilesContext.length > 0;

    // Detect target language from the user request
    const detectedLang = this.detectLanguage(userRequest);

    // Build the prompt based on mode
    let prompt: string;
    if (editMode || hasCodeFiles) {
      prompt = this.buildEditPrompt(
        userRequest,
        conversationHistory,
        analysis,
        architecture,
        projectContext,
        existingFilesContext,
        detectedLang
      );
    } else {
      prompt = this.buildCreatePrompt(
        userRequest,
        conversationHistory,
        analysis,
        architecture,
        projectContext,
        detectedLang
      );
    }

    // If it's a retry, append the negative context (errors or conflicts)
    if (attempt > 1 && issues.length > 0) {
      const errorContext = issues.filter(i => i.severity === 'high' || i.severity === 'critical' || i.severity === 'medium')
                                 .map(i => `- ${i.description}:\n${i.context}\n`)
                                 .join('\n');
      
      prompt += `\n\nCRITICAL FIX REQUIRED:\nYour previous attempt generated the following errors or conflicts. Please fix them. Do not generate new unrelated functionality. Only output the fixed files.\nERRORS:\n${errorContext}`;
      
      // Also wipe memory issues immediately so they don't persist into the new attempt
      issues.length = 0;
    }

      let buffer = '';
      try {
        await this.llmService.streamGenerate(prompt, undefined, (token: string) => {
          buffer += token;
        });
        completedTasks.push(`Generated code from LLM (Attempt ${attempt})`);
        finalBuffer = buffer;
      } catch (error) {
        issues.push({
          severity: 'critical',
          description: 'Code generation failed',
          context: `Error: ${error}`
        });
        if (attempt === MAX_RETRIES) {
          this.generateFeedback(completedTasks, issues, suggestions, context.workspaceRoot);
          return finalBuffer;
        } else {
          continue; // Retry
        }
      }

      // Parse and write generated code files or diffs
      let generatedFiles: Array<{ name: string; content: string; isDiff?: boolean }> = [];
      if (context.workspaceRoot) {
        generatedFiles = this.parseCodeFiles(buffer);
        this.log(`Parsed ${generatedFiles.length} file instructions from LLM output`);
        completedTasks.push(`Parsed ${generatedFiles.length} files`);

        for (const file of generatedFiles) {
          try {
            const filePath = `${context.workspaceRoot}/${file.name}`;
            
            if (file.isDiff) {
               // COD-03: Incremental differ — diff markers detected in LLM output
               if (fs.existsSync(filePath)) {
                 // File exists: try applying the patch
                 try {
                   this.log(`Applying incremental patch to: ${file.name}`);
                   await (this.fileService as any).applyPatch(filePath, file.content);
                   this.changeTracker.recordChange(filePath, 'Applied diff patch');
                   this.log(`Patched existing file: ${file.name}`);
                   completedTasks.push(`Patched ${file.name}`);
                 } catch (diffErr: any) {
                   // Patch failed (e.g. context mismatch) — fall back to extracting new code
                   this.log(`Patch failed for ${file.name}, falling back to new-code extraction: ${diffErr.message}`, 'warn');
                   const newContent = this.extractNewCodeFromDiff(file.content);
                   await this.fileService.updateFile(filePath, newContent, true);
                   this.changeTracker.recordChange(filePath, newContent);
                   this.log(`Overwrote ${file.name} with extracted new code (patch fallback)`);
                   completedTasks.push(`Updated ${file.name} (diff fallback)`);
                 }
               } else {
                 // New file: NEVER write raw diff markers — extract the new-code portion only
                 this.log(`Diff for new file ${file.name} — extracting new code block`);
                 const newContent = this.extractNewCodeFromDiff(file.content);
                 await this.fileService.createFile(filePath, newContent);
                 this.changeTracker.recordChange(filePath, newContent);
                 this.log(`Created new file from diff: ${file.name}`);
                 completedTasks.push(`Created ${file.name} (from diff)`);
               }
            } else {
               // Full file content — write directly
               if (fs.existsSync(filePath)) {
                 await this.fileService.updateFile(filePath, file.content, /* allowOverwrite */ true);
                 this.log(`Updated existing file: ${file.name}`);
               } else {
                 await this.fileService.createFile(filePath, file.content);
                 this.log(`Created new file: ${file.name}`);
               }
               this.changeTracker.recordChange(filePath, file.content);
               this.log(`Generated code file: ${file.name}`);
               completedTasks.push(`Created/Updated ${file.name}`);
            }
          } catch (err: any) {
            this.log(`Failed to write code file ${file.name}: ${err}`, 'error');
            issues.push({
              severity: 'high',
              description: `Failed to write ${file.name}`,
              context: `Error: ${err.message}`
            });
          }
        }

        // Save full output as reference
        const implPath = `${context.workspaceRoot}/.verno/IMPLEMENTATION.md`;
        try {
          await this.fileService.updateFile(implPath, buffer, true);
          this.changeTracker.recordChange(implPath, buffer);
          this.log(`Implementation reference saved to ${implPath}`);
          completedTasks.push('Saved implementation reference');
        } catch (err: any) {
          // fallback create
          (this.fileService as any).createFile(implPath, buffer).catch(() => {});
        }

        // Run quality checks
        await this.runQualityChecks(context.workspaceRoot, completedTasks, issues, suggestions);
      }

      // COD-01: Detect fatals for self-healing logic
      const fatals = issues.filter(i => i.severity === 'high' || i.severity === 'critical');
      if (fatals.length === 0) {
        this.log('Generation successful, no fatal issues.');
        break; // break the retry cycle
      } else {
        this.log(`Self-healing detected ${fatals.length} fatal errors. Retrying...`, 'warn');
      }
    } // end MAX_RETRIES loop

    // Generate feedback based on the ultimate state
    this.generateFeedback(completedTasks, issues, suggestions, context.workspaceRoot);

    return finalBuffer;
  }

  /**
   * Run comprehensive quality checks on generated code
   */
  private async runQualityChecks(
    workspaceRoot: string,
    completedTasks: string[],
    issues: Array<{ severity: IssueSeverity; description: string; context: string }>,
    suggestions: string[]
  ): Promise<void> {
    this.log('Running quality checks...');

    // 1. Check for package.json and install dependencies
    try {
      const packageJsonPath = `${workspaceRoot}/package.json`;
      const packageJsonExists = fs.existsSync(packageJsonPath);

      if (packageJsonExists) {
        this.log('Installing dependencies...');
        try {
          const { stdout, stderr } = await exec('npm install', { cwd: workspaceRoot, timeout: 60000 });
          this.log(`npm install: ${stdout}`);
          completedTasks.push('Installed dependencies');
        } catch (error: any) {
          const errMsg: string = error.message || '';

          // Detect native binary / prebuild failures (e.g. sharp, canvas, bcrypt)
          // These are environment-level issues — NOT code quality issues — and must NOT
          // block the rest of the pipeline. We surface them as non-fatal suggestions.
          const NATIVE_MODULE_PATTERNS = [
            /sharp/i,
            /node-gyp/i,
            /prebuild-install/i,
            /binding\.gyp/i,
            /ELIFECYCLE/i,
            /Cannot find module.*\.node/i,
          ];
          const isNativeModuleError = NATIVE_MODULE_PATTERNS.some(p => p.test(errMsg));

          if (isNativeModuleError) {
            this.log(`npm install: native module build issue detected (non-fatal). ${errMsg.substring(0, 200)}`, 'warn');
            suggestions.push(
              '⚠️ A native module failed to build on this machine (likely \'sharp\' or similar). ' +
              'This does NOT affect the generated code. To fix it manually, run:\n' +
              '  npm install --platform=win32 --arch=x64 sharp\n' +
              'or follow https://sharp.pixelplumbing.com/install'
            );
          } else {
            this.log(`npm install failed: ${errMsg}`, 'warn');
            issues.push({
              severity: 'medium',
              description: 'npm install failed',
              context: errMsg
            });
            suggestions.push('Check package.json for dependency issues');
          }
        }
      }
    } catch (error) {
      // package.json doesn't exist, skip
    }

    // 2. Run TypeScript compilation if tsconfig.json exists
    try {
      const tsconfigExists = fs.existsSync(`${workspaceRoot}/tsconfig.json`);

      if (tsconfigExists) {
        this.log('Running TypeScript compilation...');
        try {
          const { stdout, stderr } = await exec('npx tsc --noEmit', { cwd: workspaceRoot, timeout: 30000 });
          this.log('TypeScript compilation successful');
          completedTasks.push('Passed TypeScript compilation');
        } catch (error: any) {
          this.log(`TypeScript compilation errors: ${error.message}`, 'warn');
          issues.push({
            severity: 'high',
            description: 'TypeScript compilation failed',
            context: error.message.substring(0, 500)
          });
          suggestions.push('Fix TypeScript compilation errors before proceeding');
        }
      }
    } catch (error) {
      // tsconfig doesn't exist, skip
    }

    // 3. Run tests if test script exists
    try {
      const packageJsonPath = `${workspaceRoot}/package.json`;
      const packageJsonExists = fs.existsSync(packageJsonPath);

      if (packageJsonExists) {
        const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);

        if (packageJson.scripts && packageJson.scripts.test) {
          this.log('Running tests...');
          try {
            const { stdout, stderr } = await exec('npm test', { cwd: workspaceRoot, timeout: 60000 });
            this.log(`Tests output: ${stdout}`);
            completedTasks.push('All tests passed');
          } catch (error: any) {
            this.log(`Tests failed: ${error.message}`, 'warn');
            issues.push({
              severity: 'high',
              description: 'Some tests failed',
              context: error.message.substring(0, 500)
            });
            suggestions.push('Fix failing tests');
          }
        } else {
          suggestions.push('Add test script to package.json');
        }
      }
    } catch (error) {
      // Can't run tests, note it
      suggestions.push('Consider adding automated tests');
    }

    // 4. Run linter if available
    try {
      this.log('Running linter...');
      try {
        const { stdout, stderr } = await exec('npm run lint', { cwd: workspaceRoot, timeout: 30000 });
        this.log('Linting passed');
        completedTasks.push('Passed linting checks');
      } catch (error: any) {
        // Lint script might not exist
        if (error.message.includes('Missing script')) {
          suggestions.push('Consider adding ESLint or Prettier for code quality');
        } else {
          issues.push({
            severity: 'low',
            description: 'Linting issues found',
            context: error.message.substring(0, 500)
          });
          suggestions.push('Fix linting issues for better code quality');
        }
      }
    } catch (error) {
      // Linter not available
    }

    this.log('Quality checks completed');
  }

  /**
   * Generate comprehensive feedback
   */
  private generateFeedback(
    completedTasks: string[],
    issues: Array<{ severity: IssueSeverity; description: string; context: string }>,
    suggestions: string[],
    workspaceRoot?: string
  ): void {
    if (!this.feedbackService || !workspaceRoot) {
      return;
    }

    const remainingWork = [];
    if (issues.some(i => i.severity === 'high' || i.severity === 'critical')) {
      remainingWork.push('Fix critical/high severity issues');
    }
    if (issues.some(i => i.description.includes('test'))) {
      remainingWork.push('Debug and fix failing tests');
    }
    if (issues.some(i => i.description.includes('TypeScript'))) {
      remainingWork.push('Resolve TypeScript compilation errors');
    }

    const nextSteps = [];
    if (issues.length === 0) {
      nextSteps.push('Proceed to QA review');
      nextSteps.push('Deploy to staging environment');
    } else {
      nextSteps.push('Address high-priority issues first');
      nextSteps.push('Re-run quality checks after fixes');
    }

    this.feedbackService.createFeedback(
      'DeveloperAgent',
      completedTasks,
      remainingWork,
      issues,
      suggestions,
      nextSteps
    );
  }

  private parseCodeFiles(content: string): Array<{ name: string; content: string; isDiff?: boolean }> {
    const files: Array<{ name: string; content: string; isDiff?: boolean }> = [];
    /** Deduplication — first writer wins */
    const seen = new Set<string>();
    const add = (name: string, rawContent: string, isDiff?: boolean) => {
      const n = name.trim().replace(/^`+|`+$/g, '').trim(); // strip stray backticks from filename
      if (!n || seen.has(n) || rawContent.trim().length === 0) { return; }
      seen.add(n);
      files.push({ name: n, content: rawContent.trim(), isDiff });
    };

    let match;

    // ── Pass 0: ```diff\nFILE: filename\n<<<<====>>>>``` blocks ──────────────────
    const diffRegex = /```diff\s*\n(?:FILE|EDIT):\s*([^\n]+)\s*\n([\s\S]*?)```/g;
    while ((match = diffRegex.exec(content)) !== null) {
      add(match[1], match[2], true);
    }

    // ── Pass 1a: ```FILE: name\ncontent``` (inline fenced — preferred format) ───────
    const inlineRegex = /```(?:FILE|EDIT):\s*([^\n]+)\n([\s\S]*?)```/g;
    while ((match = inlineRegex.exec(content)) !== null) {
      const hasDiffMarkers = /^<{3,}/m.test(match[2]);
      add(match[1], match[2], hasDiffMarkers);
    }

    // ── Pass 1b: FILE: name\n```lang\ncontent``` (split fenced) ─────────────
    const splitRegex = /(?:^|\n)(?:FILE|EDIT):\s*([^\n]+)\s*\n+\s*```(?:\w+)?\s*\n([\s\S]*?)```/g;
    while ((match = splitRegex.exec(content)) !== null) {
      const hasDiffMarkers = /^<{3,}/m.test(match[2]);
      add(match[1], match[2], hasDiffMarkers);
    }

    // ── Pass 1c: Bare FILE: blocks — LLM forgot backtick fences ─────────────
    // This is the most common LLM failure mode: outputting FILE: lines without
    // surrounding triple-backtick fences. The content runs until the next FILE:
    // block, a code fence, or end of string.
    //
    // Also handles:
    //   "NEW FILE: path"    (LLM adds "NEW " prefix)
    //   "#### FILE: `path`" (LLM wraps path in markdown formatting)
    const bareFileRegex =
      /(?:^|\n)(?:#{1,6}\s+)?(?:NEW\s+)?(?:FILE|EDIT):\s*`?([^\n`]+?)`?\s*\n((?:(?!\n(?:#{0,6}\s+)?(?:NEW\s+)?(?:FILE|EDIT):|```)(?:.|\n))*)/gi;
    while ((match = bareFileRegex.exec(content)) !== null) {
      let filecontent = match[2].trim();
      // If the content is itself inside a fence, unwrap it
      if (filecontent.startsWith('```') && filecontent.includes('\n')) {
        filecontent = filecontent.replace(/^```(?:\w+)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
      }
      const hasDiffMarkers = /^<{3,}/m.test(filecontent);
      add(match[1], filecontent, hasDiffMarkers);
    }

    // ── Pass 2: # file: / // file: raw comment headers ────────────────────
    const rawFileRegex = /(?:^|\n)(?:#|\/\/)\s*file:\s*([^\n]+)\s*\n([\s\S]*?)(?=\n(?:#|\/\/)\s*file:|$)/gi;
    while ((match = rawFileRegex.exec(content)) !== null) {
      let filecontent = match[2].trim();
      if (filecontent.startsWith('```') && filecontent.endsWith('```')) {
        filecontent = filecontent.replace(/^```(?:\w+)?\s*\n/, '').replace(/\n```$/, '');
      }
      add(match[1], filecontent);
    }

    // If ANY named files were found, return them — skip unnamed fallback
    if (files.length > 0) {
      this.log(`Parsed ${files.length} named files from LLM output`);
      return files;
    }

    // ── Pass 3 (last resort): Unnamed language-tagged fenced blocks ──────────
    // Only reached when the LLM output has NO FILE: labels at all.
    this.log('No named FILE: blocks found, falling back to language-tagged code blocks');
    const langBlockRegex = /```(\w+)\s*\n([\s\S]*?)```/g;
    const langToExt: Record<string, string> = {
      html: '.html', htm: '.html',
      css: '.css', scss: '.scss', less: '.less',
      javascript: '.js', js: '.js', jsx: '.jsx',
      typescript: '.ts', ts: '.ts', tsx: '.tsx',
      python: '.py', py: '.py',
      java: '.java',
      json: '.json',
      markdown: '.md', md: '.md',
      xml: '.xml',
      yaml: '.yaml', yml: '.yaml',
      bash: '.sh', sh: '.sh', shell: '.sh',
      sql: '.sql',
      go: '.go',
      rust: '.rs',
      ruby: '.rb',
      php: '.php',
    };

    const usedNames = new Set<string>();
    let blockIndex = 0;
    while ((match = langBlockRegex.exec(content)) !== null) {
      const lang = match[1].toLowerCase().trim();
      const code = match[2].trim();

      // Skip non-code blocks (e.g. ```text, ```plaintext, ```diff)
      if (['text', 'plaintext', 'diff', 'log', 'output', 'console', 'shell'].includes(lang) && !langToExt[lang]) {
        continue;
      }

      // Skip very short blocks (likely inline examples)
      if (code.length < 20) { continue; }

      const ext = langToExt[lang] || `.${lang}`;

      // Try to guess filename from content or context
      let filename = this.guessFilename(content, match.index, lang, ext, blockIndex);

      // Deduplicate names
      if (usedNames.has(filename)) {
        blockIndex++;
        filename = filename.replace(ext, `_${blockIndex}${ext}`);
      }
      usedNames.add(filename);

      files.push({ name: filename, content: code });
      blockIndex++;
    }

    if (files.length > 0) {
      this.log(`Parsed ${files.length} files using language-tagged fallback`);
    } else {
      this.log('WARNING: Could not parse any code files from LLM output');
    }

    return files;
  }

  /**
   * Extract the "new" code portions from a diff block.
   *
   * Supports the LLM's inline diff format:
   *   <<<<
   *   old code
   *   ====
   *   new code
   *   >>>>
   *
   * For a file with multiple hunks, joins all new-code sections.
   * Falls back to the raw content if no diff markers are found.
   */
  private extractNewCodeFromDiff(diffContent: string): string {
    // Regex: match each hunk — capture everything between ==== and >>>>
    // Supports 3+ chars for each marker to be lenient with LLM output (3='s etc.)
    const hunkRegex = /<{3,}[^\n]*\n[\s\S]*?={3,}[^\n]*\n([\s\S]*?)>{3,}/g;
    const newParts: string[] = [];
    let match;
    let hasHunks = false;

    while ((match = hunkRegex.exec(diffContent)) !== null) {
      hasHunks = true;
      const newCode = match[1].replace(/\n$/, ''); // trim trailing newline only
      if (newCode.trim().length > 0) {
        newParts.push(newCode);
      }
    }

    if (!hasHunks) {
      // No valid diff markers found — return content as-is
      return diffContent;
    }

    return newParts.join('\n\n');
  }

  /**
   * Guess a filename from context around a code block
   */
  private guessFilename(fullContent: string, blockOffset: number, lang: string, ext: string, index: number): string {
    // Look at the ~200 chars before the code block for a filename hint
    const contextBefore = fullContent.substring(Math.max(0, blockOffset - 200), blockOffset);

    // Try to find a filename pattern like "index.html", "main.css", "app.js"
    const filenamePattern = /([\w./-]+\.(html|css|js|ts|jsx|tsx|py|java|json|md|xml|yaml|yml|go|rs|rb|php|sh|sql))\s*$/im;
    const filenameMatch = contextBefore.match(filenamePattern);
    if (filenameMatch) {
      return filenameMatch[1].trim();
    }

    // Try path-like patterns: `src/App.tsx`, `public/index.html`
    const pathPattern = /(?:^|\s|`|\*\*)([\w/-]+\/[\w.-]+)(?:`|\*\*|\s|$)/gm;
    let pathMatch;
    while ((pathMatch = pathPattern.exec(contextBefore)) !== null) {
      const candidate = pathMatch[1];
      if (candidate.includes('.')) {
        return candidate;
      }
    }

    // Default: use language as filename
    const defaultNames: Record<string, string> = {
      html: 'index.html',
      css: 'styles.css',
      javascript: 'script.js', js: 'script.js',
      typescript: 'index.ts', ts: 'index.ts',
      json: 'package.json',
      python: 'main.py', py: 'main.py',
      markdown: 'README.md', md: 'README.md',
    };

    return defaultNames[lang] || `file_${index}${ext}`;
  }

  /**
   * Detect programming language from user request
   */
  private detectLanguage(userRequest: string): string | undefined {
    const langPatterns: Array<[RegExp, string]> = [
      [/\bpython\b/i, 'Python'],
      [/\bpython3?\b/i, 'Python'],
      [/\b\.py\b/i, 'Python'],
      [/\btypescript\b/i, 'TypeScript'],
      [/\b\.ts\b/i, 'TypeScript'],
      [/\bjavascript\b/i, 'JavaScript'],
      [/\b\.js\b/i, 'JavaScript'],
      [/\bjava\b(?!script)/i, 'Java'],
      [/\bruby\b/i, 'Ruby'],
      [/\brust\b/i, 'Rust'],
      [/\bgolang\b|\bgo\b/i, 'Go'],
      [/\bc\+\+\b|\bcpp\b/i, 'C++'],
      [/\bc#\b|\bcsharp\b/i, 'C#'],
      [/\bphp\b/i, 'PHP'],
      [/\bswift\b/i, 'Swift'],
      [/\bkotlin\b/i, 'Kotlin'],
      [/\bhtml\b/i, 'HTML'],
      [/\bcss\b/i, 'CSS'],
      [/\bsql\b/i, 'SQL'],
      [/\bbash\b|\bshell\b/i, 'Bash'],
    ];

    for (const [pattern, lang] of langPatterns) {
      if (pattern.test(userRequest)) {
        return lang;
      }
    }
    return undefined;
  }

  /**
   * Build prompt for creating new code (greenfield)
   */
  private buildCreatePrompt(
    userRequest: string,
    conversationHistory: string,
    analysis: string,
    architecture: string,
    projectContext: string,
    detectedLang?: string
  ): string {
    const langLine = detectedLang ? `LANGUAGE: ${detectedLang}. You MUST write ALL code in ${detectedLang}.\n` : '';
    return `${langLine}You are Amelia, a senior software engineer. OUTPUT CODE FILES ONLY.
Task: ${userRequest}

${analysis ? `ANALYSIS:\n${analysis.substring(0, 2000)}\n` : ''}${architecture ? `ARCHITECTURE:\n${architecture.substring(0, 2000)}\n` : ''}
RULES:
- Generate FULLY WORKING, COMPLETE code. No stubs, no placeholders.
- Every function must have a real implementation.
- You are bootstrapping a NEW project from scratch. Even if the task seems focused on a specific feature, you MUST generate ALL standard required scaffolding (e.g., package.json, index.html, Vite/Webpack config, tsconfig.json, routing).
- You MUST include a root-level package.json with all required dependencies and scripts (dev, build, preview).
- If building a React web application, you MUST use either Next.js (App Router) or Vite (React SPA). DO NOT build custom Express+React SSR setups.
- You MUST include the exact build tool configurations (e.g., vite.config.ts or next.config.mjs).
- Include README.md as the last file.
${detectedLang ? `- You MUST use ${detectedLang}. Do NOT use any other language.\n` : ''}
OUTPUT FORMAT — MANDATORY RULES:
1. Wrap EVERY file in triple-backtick code fences labeled with FILE:.
2. NEVER output a bare \`FILE: path/to/file\` without surrounding triple-backtick fences.
3. Use EXACTLY this format for every file — no exceptions, no variations:

\`\`\`FILE: package.json
{
  "name": "my-app",
  ...
}
\`\`\`

\`\`\`FILE: vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
...
\`\`\`

\`\`\`FILE: src/main.tsx
import React from 'react';
...
\`\`\`

Every single file MUST follow this exact format. Missing the backtick fences means the file will NOT be created on disk.`;
  }

  /**
   * Build prompt for editing existing code
   */
  private buildEditPrompt(
    userRequest: string,
    conversationHistory: string,
    analysis: string,
    architecture: string,
    projectContext: string,
    existingFilesContext: string,
    detectedLang?: string
  ): string {
    const langLine = detectedLang ? `LANGUAGE: ${detectedLang}. You MUST write ALL code in ${detectedLang}.\n` : '';
    return `${langLine}You are Amelia, a senior software engineer. OUTPUT MODIFIED CODE FILES ONLY.
Task: ${userRequest}

EXISTING CODE:
${existingFilesContext}

${analysis ? `ANALYSIS:\n${analysis.substring(0, 1500)}\n` : ''}${architecture ? `ARCHITECTURE:\n${architecture.substring(0, 1500)}\n` : ''}
RULES:
- Modify the existing files as needed. Do NOT recreate files from scratch.
- Only output files that need changes or new files.
- Show the FULL content of each modified file.
${detectedLang ? `- You MUST use ${detectedLang}. Do NOT use any other language.\n` : ''}
OUTPUT FORMAT (MANDATORY):
For incrementally editing existing files, you MUST use the diff format to save time and tokens.
\`\`\`diff
FILE: path/to/existing-file.ext
<<<<
old exact lines snippet to replace
====
new lines snippet replacement
>>>>
\`\`\`
(You can output multiple \`<<<< ... ==== ... >>>>\` blocks within the same diff if needed).

For entirely new files:
\`\`\`FILE: path/to/new-file.ext
...full code...
\`\`\`

You MUST output code using the formats above. Do not describe what you would do. Write the actual code.`;
  }


}
