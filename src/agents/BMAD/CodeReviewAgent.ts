import { BaseAgent } from '../base/BaseAgent';
import { IAgentContext } from '../../types';
import { LLMService } from '../../services/llm';
import { FileService } from '../../services/file/FileService';
import { FileChangeTracker } from '../../services/file/FileChangeTracker';
import { FeedbackService, IssueSeverity } from '../../services/feedback';
import * as childProcess from 'child_process';
import * as util from 'util';
import * as fs from 'fs';

const exec = util.promisify(childProcess.exec);

/**
 * Code Review Agent — runs after DeveloperAgent to validate generated code.
 *
 * Checks for:
 *  - Skeleton / stub code (empty bodies, TODO comments, placeholder logic)
 *  - Structural quality via LLM review
 *  - TypeScript compilation errors (if applicable)
 *  - Test execution (if test script exists)
 *
 * Produces a CODE_REVIEW.md report and returns a structured verdict.
 */
export class CodeReviewAgent extends BaseAgent {
    name = 'codereview';
    description = 'Code Reviewer — validates generated code for completeness, correctness, and quality';
    private feedbackService?: FeedbackService;

    constructor(
        protected logger: any,
        private llmService: LLMService,
        private fileService: FileService,
        private changeTracker: FileChangeTracker
    ) {
        super(logger);
    }

    async execute(context: IAgentContext): Promise<string> {
        this.log('Running Code Review Agent — validating generated code');

        if (context.workspaceRoot) {
            this.feedbackService = new FeedbackService(context.workspaceRoot);
        }

        const completedTasks: string[] = [];
        const issues: Array<{ severity: IssueSeverity; description: string; context: string }> = [];
        const suggestions: string[] = [];

        // Get the developer's output
        const previousOutputs = (context.metadata?.previousOutputs || {}) as Record<string, string>;
        const developerOutput = previousOutputs['developer'] || '';

        if (!developerOutput) {
            const msg = 'No developer output found to review.';
            this.log(msg, 'warn');
            return msg;
        }

        // ── 1. Parse code files from developer output ──
        const files = this.parseCodeFiles(developerOutput);
        this.log(`Parsed ${files.length} files from developer output`);
        completedTasks.push(`Parsed ${files.length} files for review`);

        // ── 2. Static skeleton detection ──
        const skeletonIssues = this.detectSkeletonCode(files);
        if (skeletonIssues.length > 0) {
            for (const issue of skeletonIssues) {
                issues.push(issue);
            }
            this.log(`Found ${skeletonIssues.length} skeleton code issues`, 'warn');
        } else {
            completedTasks.push('No skeleton code detected — all functions have implementations');
        }

        // ── 3. LLM-based quality review ──
        const llmReview = await this.llmQualityReview(files, context.metadata?.userRequest as string);
        completedTasks.push('Completed LLM quality review');

        // ── 4. Compilation & test checks (if workspace exists) ──
        let compilationResult = '';
        let testResult = '';
        if (context.workspaceRoot) {
            compilationResult = await this.checkCompilation(context.workspaceRoot, completedTasks, issues);
            testResult = await this.checkTests(context.workspaceRoot, completedTasks, issues);
        }

        // ── 5. Determine verdict ──
        const hasCritical = issues.some(i => i.severity === 'critical' || i.severity === 'high');
        const hasSkeletons = skeletonIssues.length > 0;
        const verdict = hasSkeletons ? 'FAIL — Skeleton code detected' :
            hasCritical ? 'NEEDS FIXES — Critical issues found' :
                'PASS — Code looks complete and functional';

        // ── 6. Build report ──
        const report = this.buildReport(files, skeletonIssues, llmReview, compilationResult, testResult, verdict, issues);

        // Save report
        if (context.workspaceRoot) {
            const reportPath = `${context.workspaceRoot}/CODE_REVIEW.md`;
            try {
                await this.fileService.createFile(reportPath, report);
                this.changeTracker.recordChange(reportPath, report);
                this.log(`Review report saved to ${reportPath}`);
                completedTasks.push('Saved code review report');
            } catch (err) {
                this.log(`Failed to write review report: ${err}`, 'error');
                issues.push({
                    severity: 'medium',
                    description: 'Failed to save review report',
                    context: `Error: ${err}`
                });
            }
        }

        // Generate feedback
        if (this.feedbackService && context.workspaceRoot) {
            const nextSteps = hasSkeletons
                ? ['Re-run DeveloperAgent with review feedback to fix skeleton code']
                : hasCritical
                    ? ['Fix critical issues and re-run quality checks']
                    : ['Code is ready for deployment', 'Consider additional manual testing'];

            this.feedbackService.createFeedback(
                'CodeReviewAgent',
                completedTasks,
                hasSkeletons ? ['Fix skeleton code'] : [],
                issues,
                suggestions,
                nextSteps
            );
        }

        return report;
    }

    // ════════════════════════════════════════════
    // Skeleton Detection
    // ════════════════════════════════════════════

    /**
     * Statically detect skeleton / stub code patterns in generated files.
     */
    detectSkeletonCode(
        files: Array<{ name: string; content: string }>
    ): Array<{ severity: IssueSeverity; description: string; context: string }> {
        const issues: Array<{ severity: IssueSeverity; description: string; context: string }> = [];

        const placeholderPatterns = [
            /\/\/\s*TODO/i,
            /\/\/\s*implement/i,
            /\/\/\s*add\s+(your\s+)?logic/i,
            /\/\/\s*code\s+for\s+handling/i,
            /\/\/\s*\.\.\./,
            /\/\/\s*complete\s+implementation/i,
            /\/\/\s*add\s+here/i,
            /\/\/\s*placeholder/i,
            /\/\/\s*stub/i,
        ];

        // Pattern for empty function bodies: => { }, () { }, { \n  }
        const emptyBodyPatterns = [
            /=>\s*\{\s*\}/,                          // arrow fn: => { }
            /\)\s*\{\s*\}/,                           // regular fn: ) { }
            /=>\s*\{\s*\n\s*\}/,                      // multiline arrow: => {\n  }
            /\)\s*\{\s*\n\s*\}/,                       // multiline regular: ) {\n  }
        ];

        for (const file of files) {
            // Check placeholders
            for (const pattern of placeholderPatterns) {
                const match = file.content.match(pattern);
                if (match) {
                    issues.push({
                        severity: 'critical',
                        description: `Skeleton code in ${file.name}: placeholder comment found`,
                        context: `Pattern matched: "${match[0]}" — file should contain real implementation, not placeholders`
                    });
                }
            }

            // Check empty bodies
            for (const pattern of emptyBodyPatterns) {
                if (pattern.test(file.content)) {
                    issues.push({
                        severity: 'critical',
                        description: `Skeleton code in ${file.name}: empty function body detected`,
                        context: 'Function has empty body {} — must contain real implementation logic'
                    });
                }
            }

            // Check for very short files (likely stubs)
            const lines = file.content.split('\n').filter(l => l.trim().length > 0);
            if (lines.length < 3 && !file.name.endsWith('.json') && !file.name.endsWith('.env')) {
                issues.push({
                    severity: 'high',
                    description: `Suspiciously short file: ${file.name} (${lines.length} non-empty lines)`,
                    context: 'File may be a stub — expected more substantial implementation'
                });
            }
        }

        return issues;
    }

    // ════════════════════════════════════════════
    // LLM Quality Review
    // ════════════════════════════════════════════

    private async llmQualityReview(
        files: Array<{ name: string; content: string }>,
        userRequest: string
    ): Promise<string> {
        if (files.length === 0) {
            return 'No files to review.';
        }

        const filesSummary = files.map(f =>
            `### ${f.name}\n\`\`\`\n${f.content.substring(0, 3000)}\n\`\`\``
        ).join('\n\n');

        const prompt = `You are a senior code reviewer. Review the following generated code files for quality and correctness.

User's original request: ${userRequest || 'Not specified'}

## Generated Files:
${filesSummary.substring(0, 12000)}

## Review Checklist:
1. Does each function have a REAL implementation (not empty bodies or placeholder comments)?
2. Are imports correct and used?
3. Is error handling present and meaningful?
4. Do route handlers actually process requests (parse body, call models, return responses)?
5. Are models/schemas complete with field definitions?
6. Would this code actually run without errors?
7. Are there any logical bugs or missing pieces?

Provide a concise review with:
- ISSUES: specific problems found (if any)
- VERDICT: PASS, NEEDS_FIXES, or FAIL
- SUGGESTIONS: improvements to consider

Be direct and specific. If the code is just skeleton/template code with empty bodies, say FAIL clearly.`;

        try {
            const review = await this.llmService.generateText(prompt);
            return review;
        } catch (error) {
            this.log(`LLM quality review failed: ${error}`, 'warn');
            return `LLM review unavailable: ${error}`;
        }
    }

    // ════════════════════════════════════════════
    // Compilation & Test Checks
    // ════════════════════════════════════════════

    private async checkCompilation(
        workspaceRoot: string,
        completedTasks: string[],
        issues: Array<{ severity: IssueSeverity; description: string; context: string }>
    ): Promise<string> {
        try {
            const tsconfigExists = fs.existsSync(`${workspaceRoot}/tsconfig.json`);
            if (!tsconfigExists) {
                return 'TypeScript compilation skipped — no tsconfig.json found';
            }

            this.log('Running TypeScript compilation check...');
            const { stdout, stderr } = await exec('npx tsc --noEmit', {
                cwd: workspaceRoot,
                timeout: 30000
            });
            completedTasks.push('TypeScript compilation passed');
            return 'TypeScript compilation: PASSED';
        } catch (error: any) {
            const errMsg = error.message?.substring(0, 500) || String(error);
            issues.push({
                severity: 'high',
                description: 'TypeScript compilation failed',
                context: errMsg
            });
            return `TypeScript compilation: FAILED\n${errMsg}`;
        }
    }

    private async checkTests(
        workspaceRoot: string,
        completedTasks: string[],
        issues: Array<{ severity: IssueSeverity; description: string; context: string }>
    ): Promise<string> {
        try {
            const packageJsonPath = `${workspaceRoot}/package.json`;
            if (!fs.existsSync(packageJsonPath)) {
                return 'Test execution skipped — no package.json found';
            }

            const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');

            let packageJson: any;
            try {
                packageJson = JSON.parse(packageJsonContent);
            } catch {
                // package.json is malformed (e.g. corrupted by diff markers during code gen).
                // Do not add a test failure issue for this — it's not a test issue.
                this.log('package.json is not valid JSON (may be corrupted by diff markers) — skipping test execution', 'warn');
                return 'Test execution skipped — package.json could not be parsed (check for diff marker corruption)';
            }

            if (!packageJson.scripts?.test) {
                return 'Test execution skipped — no test script in package.json';
            }

            this.log('Running tests...');
            const { stdout } = await exec('npm test', {
                cwd: workspaceRoot,
                timeout: 60000
            });
            completedTasks.push('All tests passed');
            return `Tests: PASSED\n${stdout.substring(0, 500)}`;
        } catch (error: any) {
            const errMsg = error.message?.substring(0, 500) || String(error);
            issues.push({
                severity: 'high',
                description: 'Tests failed',
                context: errMsg
            });
            return `Tests: FAILED\n${errMsg}`;
        }
    }


    // ════════════════════════════════════════════
    // Report Builder
    // ════════════════════════════════════════════

    private buildReport(
        files: Array<{ name: string; content: string }>,
        skeletonIssues: Array<{ severity: IssueSeverity; description: string; context: string }>,
        llmReview: string,
        compilationResult: string,
        testResult: string,
        verdict: string,
        allIssues: Array<{ severity: IssueSeverity; description: string; context: string }>
    ): string {
        let report = `# 🔍 Code Review Report\n\n`;
        report += `**Verdict: ${verdict}**\n\n`;
        report += `**Files Reviewed:** ${files.length}\n`;
        report += `**Issues Found:** ${allIssues.length}\n`;
        report += `**Critical/High:** ${allIssues.filter(i => i.severity === 'critical' || i.severity === 'high').length}\n\n`;

        report += `---\n\n`;

        // Skeleton detection results
        report += `## 1. Skeleton Code Detection\n\n`;
        if (skeletonIssues.length === 0) {
            report += `✅ **No skeleton code detected.** All functions appear to have real implementations.\n\n`;
        } else {
            report += `❌ **${skeletonIssues.length} skeleton code issue(s) found:**\n\n`;
            for (const issue of skeletonIssues) {
                report += `- 🔴 **${issue.description}**\n  ${issue.context}\n\n`;
            }
        }

        // LLM review
        report += `## 2. Quality Review (AI)\n\n${llmReview}\n\n`;

        // Compilation
        if (compilationResult) {
            report += `## 3. Compilation\n\n${compilationResult}\n\n`;
        }

        // Tests
        if (testResult) {
            report += `## 4. Tests\n\n${testResult}\n\n`;
        }

        // Files reviewed
        report += `## 5. Files Reviewed\n\n`;
        for (const file of files) {
            const lineCount = file.content.split('\n').length;
            report += `- \`${file.name}\` (${lineCount} lines)\n`;
        }
        report += '\n';

        return report;
    }

    // ════════════════════════════════════════════
    // Utility
    // ════════════════════════════════════════════

    private parseCodeFiles(content: string): Array<{ name: string; content: string }> {
        const files: Array<{ name: string; content: string }> = [];
        const seen = new Set<string>();

        const extractNewCode = (rawContent: string) => {
            const hunkRegex = /<{3,}[^\n]*\n[\s\S]*?={3,}[^\n]*\n([\s\S]*?)>{3,}/g;
            let newCode = '';
            let hunkMatch;
            let found = false;
            while ((hunkMatch = hunkRegex.exec(rawContent)) !== null) {
                found = true;
                newCode += hunkMatch[1].replace(/\n$/, '') + '\n\n';
            }
            return found ? newCode.trim() : rawContent;
        };

        const add = (name: string, rawContent: string) => {
            const n = name.trim().replace(/^`+|`+$/g, '').trim();
            if (!n || seen.has(n) || rawContent.trim().length === 0) { return; }
            seen.add(n);
            files.push({ name: n, content: extractNewCode(rawContent).trim() });
        };

        let match;

        // Pass 0: ```diff FILE: ... ``` blocks
        const diffRegex = /```diff\s*\n(?:FILE|EDIT):\s*([^\n]+)\s*\n([\s\S]*?)```/g;
        while ((match = diffRegex.exec(content)) !== null) {
            add(match[1], match[2]);
        }

        // Pass 1a: ```FILE: name\ncontent``` (inline fenced)
        const inlineRegex = /```(?:FILE|EDIT):\s*([^\n]+)\n([\s\S]*?)```/g;
        while ((match = inlineRegex.exec(content)) !== null) {
            add(match[1], match[2]);
        }

        // Pass 1b: FILE: name\n```lang\ncontent``` (split fenced)
        const splitRegex = /(?:^|\n)(?:FILE|EDIT):\s*([^\n]+)\s*\n+\s*```(?:\w+)?\s*\n([\s\S]*?)```/g;
        while ((match = splitRegex.exec(content)) !== null) {
            add(match[1], match[2]);
        }

        // Pass 1c: Bare FILE: / NEW FILE: blocks without backtick fences
        const bareFileRegex =
            /(?:^|\n)(?:#{1,6}\s+)?(?:NEW\s+)?(?:FILE|EDIT):\s*`?([^\n`]+?)`?\s*\n((?:(?!\n(?:#{0,6}\s+)?(?:NEW\s+)?(?:FILE|EDIT):|```)(?:.|\n))*)/gi;
        while ((match = bareFileRegex.exec(content)) !== null) {
            let filecontent = match[2].trim();
            if (filecontent.startsWith('```') && filecontent.includes('\n')) {
                filecontent = filecontent.replace(/^```(?:\w+)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
            }
            add(match[1], filecontent);
        }

        // Pass 2: # file: / // file: raw headers
        const rawFileRegex = /(?:^|\n)(?:#|\/\/)\s*file:\s*([^\n]+)\s*\n([\s\S]*?)(?=\n(?:#|\/\/)\s*file:|$)/gi;
        while ((match = rawFileRegex.exec(content)) !== null) {
            let filecontent = match[2].trim();
            if (filecontent.startsWith('```') && filecontent.endsWith('```')) {
                filecontent = filecontent.replace(/^```(?:\w+)?\s*\n/, '').replace(/\n```$/, '');
            }
            add(match[1], filecontent);
        }

        return files;
    }
}
