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
      this.lazyInitRagServices(context.workspaceRoot);
      if (this.indexingService && this.contextEngine) {
        this.log('Building Structural/Semantic Context...');
        // Fire-and-forget background indexing (Tier 2 baseline)
        this.indexingService.indexWorkspace(context.workspaceRoot, this);

        // Fetch Tier 1 (Structural) + Tier 2 (Vector Fallback)
        existingFilesContext = await this.contextEngine.getTieredContext(userRequest, 8);
        this.log(`Retrieved Tiered context chunks. Size: ${existingFilesContext.length} chars`);
      }
    }
    const hasExistingCode = existingFilesContext.length > 0;

    // Detect target language from the user request
    const detectedLang = this.detectLanguage(userRequest);

    // Build the prompt based on mode
    let prompt: string;
    if (editMode || hasExistingCode) {
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

    let buffer = '';
    try {
      await this.llmService.streamGenerate(prompt, undefined, (token: string) => {
        buffer += token;
      });
      completedTasks.push('Generated code from LLM');
    } catch (error) {
      issues.push({
        severity: 'critical',
        description: 'Code generation failed',
        context: `Error: ${error}`
      });
      this.generateFeedback(completedTasks, issues, suggestions, context.workspaceRoot);
      return buffer;
    }

    // Parse and write generated code files
    let generatedFiles: Array<{ name: string; content: string }> = [];
    if (context.workspaceRoot) {
      generatedFiles = this.parseCodeFiles(buffer);
      this.log(`Parsed ${generatedFiles.length} code files from LLM output`);
      completedTasks.push(`Parsed ${generatedFiles.length} files`);

      for (const file of generatedFiles) {
        try {
          const filePath = `${context.workspaceRoot}/${file.name}`;
          // Use updateFile for existing files, createFile for new ones
          if (fs.existsSync(filePath)) {
            await this.fileService.updateFile(filePath, file.content);
            this.log(`Updated existing file: ${file.name}`);
          } else {
            await this.fileService.createFile(filePath, file.content);
            this.log(`Created new file: ${file.name}`);
          }
          this.changeTracker.recordChange(filePath, file.content);
          this.log(`Generated code file: ${file.name}`);
          completedTasks.push(`Created ${file.name}`);
        } catch (err) {
          this.log(`Failed to write code file ${file.name}: ${err}`, 'error');
          issues.push({
            severity: 'high',
            description: `Failed to write ${file.name}`,
            context: `Error: ${err}`
          });
        }
      }

      // Save full output as reference
      const implPath = `${context.workspaceRoot}/IMPLEMENTATION.md`;
      try {
        await this.fileService.createFile(implPath, buffer);
        this.changeTracker.recordChange(implPath, buffer);
        this.log(`Implementation reference saved to ${implPath}`);
        completedTasks.push('Saved implementation reference');
      } catch (err) {
        this.log(`Failed to write implementation reference: ${err}`, 'error');
        issues.push({
          severity: 'medium',
          description: 'Failed to save implementation reference',
          context: `Error: ${err}`
        });
      }

      // Run quality checks
      await this.runQualityChecks(context.workspaceRoot, completedTasks, issues, suggestions);
    }

    // Generate feedback
    this.generateFeedback(completedTasks, issues, suggestions, context.workspaceRoot);

    return buffer;
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
          this.log(`npm install failed: ${error.message}`, 'warn');
          issues.push({
            severity: 'medium',
            description: 'npm install failed',
            context: error.message
          });
          suggestions.push('Check package.json for dependency issues');
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

  private parseCodeFiles(content: string): Array<{ name: string; content: string }> {
    const files: Array<{ name: string; content: string }> = [];

    // TIER 1: Try FILE:/EDIT: format first (preferred)
    // Pattern A: Inline format (```FILE: name\ncontent```)
    const inlineRegex = /```(?:FILE|EDIT):\s*([^\n]+)\n([\s\S]*?)```/g;
    let match;
    while ((match = inlineRegex.exec(content)) !== null) {
      const filename = match[1].trim();
      const filecontent = match[2].trim();
      if (filename && filecontent) {
        files.push({ name: filename, content: filecontent });
      }
    }

    // Pattern B: Split format (FILE: name\n```lang\ncontent```)
    const splitRegex = /(?:^|\n)(?:FILE|EDIT):\s*([^\n]+)\s*\n+\s*```(?:\w+)?\s*\n([\s\S]*?)```/g;
    while ((match = splitRegex.exec(content)) !== null) {
      const filename = match[1].trim();
      const filecontent = match[2].trim();
      if (filename && filecontent && !files.some(f => f.name === filename)) {
        files.push({ name: filename, content: filecontent });
      }
    }

    // TIER 3: Raw format (# file: name ... content ...)
    // Handles cases where LLM dumps raw text with comment headers and NO code fences
    const rawFileRegex = /(?:^|\n)(?:#|\/\/)\s*file:\s*([^\n]+)\s*\n([\s\S]*?)(?=\n(?:#|\/\/)\s*file:|$)/gi;
    while ((match = rawFileRegex.exec(content)) !== null) {
      const filename = match[1].trim();
      let filecontent = match[2].trim();

      // If content is wrapped in fences, unwrap it (mixed format)
      if (filecontent.startsWith('```') && filecontent.endsWith('```')) {
        filecontent = filecontent.replace(/^```(?:\w+)?\s*\n/, '').replace(/\n```$/, '');
      }

      if (filename && filecontent && !files.some(f => f.name === filename)) {
        files.push({ name: filename, content: filecontent });
      }
    }

    if (files.length > 0) {
      this.log(`Parsed ${files.length} files using FILE:/EDIT: format`);
      return files;
    }

    // TIER 2: Fallback — extract any fenced code block with language identifier
    this.log('No FILE:/EDIT: blocks found, falling back to language-tagged code blocks');
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
- Include README.md and package.json if applicable.
${detectedLang ? `- You MUST use ${detectedLang}. Do NOT use any other language.\n` : ''}
OUTPUT FORMAT (MANDATORY):
Wrap each file in a code block labeled with FILE: like this:

\`\`\`FILE: index.html
<!DOCTYPE html>...
\`\`\`

\`\`\`FILE: styles.css
body { ... }
\`\`\`

You MUST output complete code using the format above. Do not describe what you would do. Write the actual code.`;
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
For modified files:
\`\`\`EDIT: path/to/existing-file.ext
...full modified content...
\`\`\`

For new files:
\`\`\`FILE: path/to/new-file.ext
...code...
\`\`\`

You MUST output code using the format above. Do not describe what you would do. Write the actual code.`;
  }


}
