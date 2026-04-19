import { BaseAgent } from '../base/BaseAgent';
import { IAgentContext } from '../../types';
import { LLMService } from '../../services/llm';
import { FileService } from '../../services/file/FileService';
import { FileChangeTracker } from '../../services/file/FileChangeTracker';

/**
 * Tech Writer Agent (Paige) - Technical Documentation
 * Loaded from src/agents/BMAD/tech-writer.agent.yaml
 */
export class TechWriterAgent extends BaseAgent {
  name = 'techwriter';
  description = 'Tech Writer - API docs, user guides, architecture documentation';

  constructor(
    protected logger: any,
    private llmService: LLMService,
    private fileService: FileService,
    private changeTracker: FileChangeTracker
  ) {
    super(logger);
  }

  async execute(context: IAgentContext): Promise<string> {
    this.log('Running Tech Writer (Paige) - Documentation');

    const previousOutputs = (context.metadata?.previousOutputs || {}) as Record<string, string>;
    const architecture = previousOutputs['architect'] || '';
    const analysis = previousOutputs['analyst'] || '';

    const prompt = `You are Paige, a technical writer specializing in software project documentation.

User Request / Project Summary: ${context.metadata?.userRequest || 'create documentation'}

${analysis ? `Project Analysis:\n${analysis.substring(0, 1000)}\n` : ''}${architecture ? `Architecture:\n${architecture.substring(0, 1000)}\n` : ''}
Write a comprehensive README.md for this project. The README must include ALL of these sections:

# [Project Name]

> One-line project description

## Overview
What the project does and why it exists.

## Features
Bullet list of key features.

## Getting Started
### Prerequisites
### Installation
\`\`\`bash
npm install
\`\`\`
### Running the App
\`\`\`bash
npm start
\`\`\`

## API Reference
Document each endpoint with method, path, description, and example request/response.

## Architecture
Brief description of the tech stack and how components interact.

## Security & Compliance
Security measures implemented (OWASP, GDPR, etc.).

## Troubleshooting
Common issues and fixes.

Format everything as valid Markdown. Be specific to this project — do not use placeholder text.`;

    let buffer = '';
    await this.llmService.streamGenerate(prompt, undefined, (token: string) => {
      buffer += token;
    });

    // Write README.md to workspace root (overwrites any existing README)
    if (context.workspaceRoot) {
      const readmePath = `${context.workspaceRoot}/README.md`;
      let cleanBuffer = buffer.trim();
      if (cleanBuffer.startsWith('```markdown')) {
        cleanBuffer = cleanBuffer.replace(/^```markdown\s*\n/, '').replace(/\n```\s*$/, '').trim();
      } else if (cleanBuffer.startsWith('```')) {
        cleanBuffer = cleanBuffer.replace(/^```(?:\w+)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
      }

      try {
        // Use updateFile with overwrite so an existing README is replaced
        await this.fileService.updateFile(readmePath, cleanBuffer, /* allowOverwrite */ true);
        this.changeTracker.recordChange(readmePath, cleanBuffer);
        this.log(`README.md saved to ${readmePath}`);
      } catch {
        // Fallback: try creating if updateFile fails (e.g. file doesn't exist yet)
        try {
          await this.fileService.createFile(readmePath, cleanBuffer);
          this.changeTracker.recordChange(readmePath, cleanBuffer);
          this.log(`README.md created at ${readmePath}`);
        } catch (err) {
          this.log(`Failed to write README.md: ${err}`, 'error');
        }
      }
    }

    return buffer;
  }
}
