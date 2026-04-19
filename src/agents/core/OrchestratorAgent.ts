/**
 * Orchestrator Agent (Planner) - Manages plan-driven multi-agent workflows
 *
 * Architecture:
 * 1. PLAN mode: Generates plan, runs NON-coding agents, persists plan state
 * 2. CODE mode: Loads plan state, runs CODING agents (developer, codereview, qa, techwriter)
 *
 * Plan state is persisted in .verno/plan-state/plan.json between invocations.
 * Old plans are backed up with timestamps in .verno/plan-state/history/.
 */

import { BaseAgent } from '../base/BaseAgent';
import { IAgentContext } from '../../types';
import { AgentRegistry } from '../base/AgentRegistry';
import { LLMService } from '../../services/llm';
import { FileService } from '../../services/file/FileService';
import { FileChangeTracker } from '../../services/file/FileChangeTracker';
import { CodeGeneratorAgent } from '../specialized/CodeGeneratorAgent';
import { DocumentationAgent } from '../specialized/DocumentationAgent';
import { TestGeneratorAgent } from '../specialized/TestGeneratorAgent';
import { MultiAgentManager } from '../MultiAgentManager';
import { AnalystAgent } from '../BMAD/AnalystAgent';
import { ArchitectAgent } from '../BMAD/ArchitectAgent';
import { UXDesignerAgent } from '../BMAD/UXDesignerAgent';
import { DeveloperAgent } from '../BMAD/DeveloperAgent';
import { CodeReviewAgent } from '../BMAD/CodeReviewAgent';
import { ProductManagerAgent } from '../BMAD/ProductManagerAgent';
import { QAEngineerAgent } from '../BMAD/QAEngineerAgent';
import { TechWriterAgent } from '../BMAD/TechWriterAgent';
import { QuickFlowSoloDevAgent } from '../BMAD/QuickFlowSoloDevAgent';
import { TodoService } from '../../services/todo';
import { ProjectAnalyzer } from '../../services/project';
import { FeedbackService } from '../../services/feedback';
import {
  PlanStateService,
  PersistedPlanState,
  ExecutionPlan,
  PlanStep,
  CODING_PHASE_AGENTS,
} from '../../services/planning/PlanStateService';
import { PRDDocument } from '../../types/sdlc';
import { ContextBuilder } from '../../services/workflow/ContextBuilder';
import { VernoArtifactService } from '../../services/artifact/VernoArtifactService';
import * as vscode from 'vscode';

/** Available agents the planner can assign */
const AVAILABLE_AGENTS: Record<string, string> = {
  analyst: 'Business Analyst (Mary) - Requirements analysis, market research',
  architect: 'System Architect (Winston) - Architecture design, tech stack',
  uxdesigner: 'UX Designer (Sally) - User experience, interface design',
  pm: 'Product Manager - Feature prioritization, roadmap',
  qa: 'QA Engineer - Test strategy, quality assurance',
  techwriter: 'Tech Writer - Documentation, API docs',
  developer: 'Developer (Amelia) - Code implementation (ONLY code generator)',
  codereview: 'Code Reviewer - Validates code completeness, correctness, and quality (runs after developer)',
};

export class OrchestratorAgent extends BaseAgent {
  name = 'OrchestratorAgent';
  description = 'Plans and orchestrates multi-agent workflows. Creates plans, assigns agents, collects feedback, and coordinates code generation.';
  private changeTracker: FileChangeTracker;
  private todoService?: TodoService;
  private projectAnalyzer?: ProjectAnalyzer;
  private feedbackService?: FeedbackService;
  private planStateService?: PlanStateService;

  constructor(
    protected logger: any,
    private agentRegistry: AgentRegistry,
    private llmService: LLMService,
    private fileService: FileService,
    changeTracker?: FileChangeTracker
  ) {
    super(logger);
    this.changeTracker = changeTracker || new FileChangeTracker();
    this.registerSpecializedAgents();
  }

  /**
   * Initialize enhanced services for TODO, feedback, and plan state
   */
  private initializeEnhancedServices(workspaceRoot: string): void {
    if (!this.todoService) {
      this.todoService = new TodoService(workspaceRoot);
      this.projectAnalyzer = new ProjectAnalyzer(workspaceRoot);
      this.feedbackService = new FeedbackService(workspaceRoot);
      this.planStateService = new PlanStateService(workspaceRoot);
      this.log('Enhanced orchestrator services initialized');
    }
  }

  private registerSpecializedAgents(): void {
    const codeGenerator = new CodeGeneratorAgent(this.logger, this.llmService, this.fileService);
    const documentationAgent = new DocumentationAgent(this.logger, this.llmService, this.fileService);
    const testGenerator = new TestGeneratorAgent(this.logger, this.llmService, this.fileService);

    this.agentRegistry.register('codeGenerator', codeGenerator);
    this.agentRegistry.register('documentationAgent', documentationAgent);
    this.agentRegistry.register('testGenerator', testGenerator);

    // Register BMAD multi-stage manager
    const multiManager = new MultiAgentManager(this.logger, this.agentRegistry, this.llmService, this.fileService);
    this.agentRegistry.register('multiManager', multiManager as any);

    // Register BMAD agents with FileChangeTracker for diff tracking
    this.agentRegistry.register('analyst', new AnalystAgent(this.logger, this.llmService, this.fileService, this.changeTracker) as any);
    this.agentRegistry.register('architect', new ArchitectAgent(this.logger, this.llmService, this.fileService, this.changeTracker) as any);
    this.agentRegistry.register('uxdesigner', new UXDesignerAgent(this.logger, this.llmService, this.fileService, this.changeTracker) as any);
    this.agentRegistry.register('developer', new DeveloperAgent(this.logger, this.llmService, this.fileService, this.changeTracker) as any);
    this.agentRegistry.register('pm', new ProductManagerAgent(this.logger, this.llmService, this.fileService, this.changeTracker) as any);
    this.agentRegistry.register('qa', new QAEngineerAgent(this.logger, this.llmService, this.fileService, this.changeTracker) as any);
    this.agentRegistry.register('techwriter', new TechWriterAgent(this.logger, this.llmService, this.fileService, this.changeTracker) as any);
    this.agentRegistry.register('quickflowdev', new QuickFlowSoloDevAgent(this.logger, this.llmService, this.fileService, this.changeTracker) as any);
    this.agentRegistry.register('codereview', new CodeReviewAgent(this.logger, this.llmService, this.fileService, this.changeTracker) as any);
  }

  // ==========================================
  // SDLC INTERCEPT AND INJECTION
  // ==========================================

  public async startSDLCFlow(topic: string): Promise<void> {
    await vscode.commands.executeCommand('verno.startSDLC', topic);
  }

  public async onPRDApproved(prd: PRDDocument, context: vscode.ExtensionContext, agentPanel?: any): Promise<void> {
    this.log('PRD Approved. Triggering BMAD execution pipeline.');
    
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }

    const prdString = JSON.stringify(prd, null, 2);
    
    // Inject PRD into agent context
    const agentContext = new ContextBuilder()
        .setWorkspaceRoot(workspaceRoot)
        .setMetadata({
            userRequest: `[APPROVED PRD ATTACHED]\n\nPlease implement the features described in this PRD:\n\n${prdString}`,
            mode: 'plan',
            timestamp: new Date().toISOString()
        })
        .build();

    try {
        if (agentPanel) {
            agentPanel.addMessage('system', '📝 **Phase 1: Planning** - Running Analysts & Architects to break down PRD...');
        }

        const planOutput = await this.executePlan(agentContext);
        
        if (agentPanel) {
            agentPanel.showThinking(false);
            agentPanel.addMessage('assistant', `**Plan Output:**\n\n${planOutput}`);
            agentPanel.addMessage('system', '💻 **Phase 2: Coding** - Handing off to Developer and QA agents...');
            agentPanel.showThinking(true);
        }

        // Automatically shift into CODE mode and execute the coding agents
        agentContext.metadata!.mode = 'code';
        const codeOutput = await this.executeCode(agentContext);

        if (agentPanel) {
            agentPanel.showThinking(false);
            agentPanel.addMessage('assistant', `**Execution Complete:**\n\n${codeOutput}`);
            agentPanel.addMessage('system', '✅ **BMAD Pipeline Finished!** Your codebase has been updated.');
        }

        vscode.window.showInformationMessage('BMAD Pipeline fully completed!');
    } catch (err: any) {
        if (agentPanel) {
            agentPanel.showThinking(false);
            agentPanel.addMessage('system', `❌ BMAD Pipeline failed: ${err.message}`);
        }
        vscode.window.showErrorMessage(`BMAD Pipeline failed: ${err.message}`);
    }
  }

  // ==========================================
  // BACKWARD-COMPATIBLE EXECUTE (runs both)
  // ==========================================

  async execute(context: IAgentContext): Promise<string> {
    const mode = context.metadata?.mode as string;
    if (mode === 'plan') {
      return this.executePlan(context);
    }
    return this.executeCode(context);
  }

  // ==========================================
  // PLAN MODE: Generate plan + run non-coding agents
  // ==========================================

  async executePlan(context: IAgentContext): Promise<string> {
    if (!this.validateContext(context)) {
      throw new Error('Invalid context provided to OrchestratorAgent');
    }

    this.log('Starting PLAN phase — plan generation + non-coding agents');

    try {
      const userRequest = context.metadata?.userRequest as string;
      if (!userRequest) {
        throw new Error('No user request found in context');
      }

      const conversationHistory = (context.metadata?.conversationHistory as string) || '';

      // Initialize services
      if (context.workspaceRoot) {
        this.initializeEnhancedServices(context.workspaceRoot);
      }

      // Check for existing plan — reuse if request hasn't changed
      const existingState = this.planStateService?.loadPlanState() ?? null;
      let plan: ExecutionPlan;

      if (existingState && existingState.userRequest === userRequest) {
        this.log('Reusing existing plan (request unchanged)');
        plan = existingState.plan;
      } else {
        // Generate a new plan with full project context
        plan = await this.generatePlan(userRequest, conversationHistory, context.workspaceRoot);
        this.log(`New plan generated: ${plan.steps.length} steps, code generation: ${plan.includeCodeGeneration}`);
      }

      // If plan has no steps (just a conversation/clarification), return the plan summary
      if (plan.steps.length === 0) {
        return plan.summary;
      }

      // Create plan state — separate planning steps from coding steps
      const planState = this.planStateService!.createFromPlan(plan, userRequest);

      // Create TODO list from plan
      if (this.todoService) {
        const todos = plan.steps.map((step) => ({
          title: step.task,
          description: `Agent: ${step.agentName} — ${step.reason}`,
          assignedAgent: step.agentName,
          status: 'pending' as const,
          dependencies: [] as string[],
          priority: 'high' as const,
        }));
        this.todoService.createTodoList('Orchestrator', todos);
        this.log(`Created ${todos.length} TODO items from plan`);
      }

      // Execute ONLY non-coding agents
      const planningResults: string[] = [];

      for (const step of plan.steps) {
        // Skip coding-phase agents — they run in CODE mode
        if (CODING_PHASE_AGENTS.has(step.agentId)) {
          this.log(`Deferring ${step.agentName} to CODE phase`);
          continue;
        }

        const agent = this.agentRegistry.get(step.agentId);
        if (!agent) {
          this.log(`Agent '${step.agentId}' not found, skipping step ${step.step}`, 'error');
          continue;
        }

        this.log(`Executing step ${step.step}: ${step.agentName} — ${step.task}`);

        // Build context with accumulated outputs
        const agentContext: IAgentContext = {
          workspaceRoot: context.workspaceRoot,
          selectedText: context.selectedText,
          filePath: context.filePath,
          fileContent: context.fileContent,
          metadata: {
            ...context.metadata,
            previousOutputs: planState.agentOutputs,
          },
        };

        try {
          const output = await agent.execute(agentContext);
          planState.agentOutputs[step.agentId] = output;
          planState.completedSteps.push(step.agentId);
          planState.pendingSteps = planState.pendingSteps.filter(id => id !== step.agentId);

          // Store feedback
          if (this.feedbackService) {
            this.feedbackService.createFeedback(step.agentName, [step.task], [], [], [], []);
          }

          // Mark TODO as complete
          if (this.todoService) {
            const todoList = this.todoService.getTodoList('Orchestrator');
            const matchingTask = todoList?.tasks.find(t => t.title === step.task);
            if (matchingTask) {
              this.todoService.updateTaskStatus('Orchestrator', matchingTask.id, 'completed');
            }
          }

          planningResults.push(`### ${step.agentName}\n${output}`);
          this.log(`Step ${step.step} completed: ${step.agentName}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.log(`Step ${step.step} failed: ${errMsg}`, 'error');
          planningResults.push(`### ❌ ${step.agentName} Failed\n${errMsg}`);
          planState.agentOutputs[step.agentId] = `[FAILED] ${errMsg}`;
        }
      }

      // Persist the plan state with completed planning steps and pending coding steps
      this.planStateService!.savePlanState(planState);
      this.log('Plan state persisted to disk');

      // Build final output
      const pendingCodingSteps = plan.steps.filter(s => CODING_PHASE_AGENTS.has(s.agentId));
      const results: string[] = [`## 📋 Project Plan\n${plan.summary}`];

      if (planningResults.length > 0) {
        results.push(`<details>\n<summary>📝 View Planning & Architecture Details</summary>\n\n${planningResults.join('\n\n---\n\n')}\n</details>`);
      }

      if (pendingCodingSteps.length > 0) {
        const pendingList = pendingCodingSteps.map(s => `- **${s.agentName}**: ${s.task}`).join('\n');
        results.push(`## ⏳ Pending (run CODE to execute)\n${pendingList}`);
      }

      return results.join('\n\n---\n\n');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log(`Plan phase error: ${errorMsg}`, 'error');
      throw error;
    }
  }

  // ==========================================
  // CODE MODE: Run pending coding agents
  // ==========================================

  async executeCode(context: IAgentContext): Promise<string> {
    if (!this.validateContext(context)) {
      throw new Error('Invalid context provided to OrchestratorAgent');
    }

    this.log('Starting CODE phase — running coding/testing/documentation agents');

    try {
      const userRequest = context.metadata?.userRequest as string;
      if (!userRequest) {
        throw new Error('No user request found in context');
      }

      const conversationHistory = (context.metadata?.conversationHistory as string) || '';

      // Initialize services
      if (context.workspaceRoot) {
        this.initializeEnhancedServices(context.workspaceRoot);
      }

      // Load plan state
      const planState = this.planStateService?.loadPlanState() ?? null;
      const hasPendingTasks = planState && planState.pendingSteps.some(id => CODING_PHASE_AGENTS.has(id));

      if (hasPendingTasks && planState) {
        // ---- CASE 1: Pending coding tasks exist — run them ----
        this.log('Found pending coding tasks — executing them');
        return await this.runPendingCodingAgents(context, planState, conversationHistory);
      }

      // ---- No pending tasks — detect situation ----
      this.log('No pending coding tasks found — detecting workspace state');

      const hasAgentResponses = planState && Object.keys(planState.agentOutputs).length > 0;
      const hasCodeFiles = this.projectAnalyzer ? !this.projectAnalyzer.isNewProject() : false;

      if (!hasCodeFiles && !hasAgentResponses) {
        // CASE 2: No code, no agent responses → run PLAN first, then CODE
        this.log('No code or agent responses — running full PLAN + CODE pipeline');
        await this.executePlan(context);
        // Reload the plan state after planning
        const newPlanState = this.planStateService!.loadPlanState();
        if (newPlanState) {
          return await this.runPendingCodingAgents(context, newPlanState, conversationHistory);
        }
        return 'Planning completed but no coding tasks were generated.';
      }

      if (hasCodeFiles && !hasAgentResponses) {
        // CASE 3: Code exists, no agent responses → edit-only mode
        this.log('Existing code detected, no agent responses — edit-only mode');
        return await this.runEditOnlyMode(context, conversationHistory);
      }

      if (hasAgentResponses && !hasCodeFiles) {
        // CASE 4: Agent responses exist, no code → generate code from agent outputs
        this.log('Agent responses found but no code — generating code from responses');
        return await this.runPendingCodingAgents(context, planState!, conversationHistory);
      }

      // CASE 5: Both code and agent responses exist — edit mode with agent context
      this.log('Both code and agent responses exist — edit mode with full context');
      return await this.runEditWithAgentContext(context, planState!, conversationHistory);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log(`Code phase error: ${errorMsg}`, 'error');
      throw error;
    }
  }

  // ==========================================
  // PRIVATE: Run pending coding agents
  // ==========================================

  private async runPendingCodingAgents(
    context: IAgentContext,
    planState: PersistedPlanState,
    conversationHistory: string
  ): Promise<string> {
    const results: string[] = [`## 📋 Executing Pending Code Tasks`];
    const agentOutputs = { ...planState.agentOutputs };

    // Get project context for the coding agents
    let projectContext = '';
    if (this.projectAnalyzer) {
      try {
        projectContext = await this.projectAnalyzer.getProjectContext();
      } catch {
        projectContext = '';
      }
    }

    // Find pending coding steps in plan order
    const pendingCodingSteps = planState.plan.steps.filter(
      s => planState.pendingSteps.includes(s.agentId) && CODING_PHASE_AGENTS.has(s.agentId)
    );

    for (const step of pendingCodingSteps) {
      // Skip codereview here — it runs inline after developer (with retry logic)
      if (step.agentId === 'codereview') {
        continue;
      }

      const agent = this.agentRegistry.get(step.agentId);
      if (!agent) {
        this.log(`Agent '${step.agentId}' not found, skipping`, 'error');
        continue;
      }

      this.log(`Running CODE step: ${step.agentName} — ${step.task}`);

      // ── Enrich developer task with sprint story details ─────────────────
      let enrichedUserRequest = `${step.task}\n\nOriginal Request: ${planState.userRequest}`;
      if (step.agentId === 'developer' && context.workspaceRoot) {
        try {
          const artifacts = new VernoArtifactService(context.workspaceRoot);
          const sprintPlan = artifacts.readJSON<any>('sprint-plan.json');
          if (sprintPlan && Array.isArray(sprintPlan.sprints) && sprintPlan.sprints.length > 0) {
            const activeSprint = sprintPlan.sprints[0];
            // Try to match the step task to a sprint story by ID or title keyword
            const matchedStory = activeSprint.stories?.find((s: any) => {
              const storyId = s.id ?? '';
              const storyTitle = s.title ?? s.name ?? '';
              return step.task.includes(storyId) || step.task.toLowerCase().includes(storyTitle.toLowerCase().substring(0, 20));
            }) ?? activeSprint.stories?.[0]; // fallback: first story

            if (matchedStory) {
              const ac = Array.isArray(matchedStory.acceptanceCriteria)
                ? matchedStory.acceptanceCriteria.map((c: string, i: number) => `  ${i + 1}. ${c}`).join('\n')
                : 'Not specified';
              enrichedUserRequest =
                `Implement Sprint Story [${matchedStory.id ?? 'S-?'}]: ${matchedStory.title ?? matchedStory.name ?? step.task}\n\n` +
                `Description: ${matchedStory.description ?? 'No description'}\n\n` +
                `Acceptance Criteria:\n${ac}\n\n` +
                `Original PRD Request: ${planState.userRequest}`;
              this.log(`[OrchestratorAgent] Developer task enriched with story: ${matchedStory.id} — ${matchedStory.title}`);
            }
          }
        } catch (enrichErr: any) {
          this.log(`Could not load sprint plan for task enrichment (non-fatal): ${enrichErr?.message ?? enrichErr}`, 'warn');
        }
      }

      const agentContext: IAgentContext = {
        workspaceRoot: context.workspaceRoot,
        selectedText: context.selectedText,
        filePath: context.filePath,
        fileContent: context.fileContent,
        metadata: {
          ...context.metadata,
          userRequest: enrichedUserRequest,
          previousOutputs: agentOutputs,
          conversationHistory,
          projectContext,
        },
      };

      try {
        const output = await agent.execute(agentContext);
        agentOutputs[step.agentId] = output;

        // Mark complete in plan state
        if (this.planStateService) {
          this.planStateService.markStepComplete(step.agentId, output);
        }

        // Mark TODO as complete
        if (this.todoService) {
          const todoList = this.todoService.getTodoList('Orchestrator');
          const matchingTask = todoList?.tasks.find(t => t.title === step.task);
          if (matchingTask) {
            this.todoService.updateTaskStatus('Orchestrator', matchingTask.id, 'completed');
          }
        }

        results.push(`\n## 💻 ${step.agentName}\n${output}`);
        this.log(`CODE step completed: ${step.agentName}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.log(`CODE step failed: ${errMsg}`, 'error');
        results.push(`\n## ❌ ${step.agentName} Failed\n${errMsg}`);
      }

      // Run code review after developer if both are pending
      if (step.agentId === 'developer' && agentOutputs['developer']) {
        const reviewStep = pendingCodingSteps.find(s => s.agentId === 'codereview');
        if (reviewStep) {
          await this.runCodeReviewWithRetry(context, agentOutputs, results, conversationHistory, projectContext);
          // Remove codereview from the loop's remaining steps
        }

        // Auto-generate unit tests after code generation
        try {
          this.log('Auto-generating unit tests for generated code...');
          const testGenAgent = this.agentRegistry.get('testGenerator');
          if (testGenAgent) {
            results.push(`\n## 🧪 Generating Unit Tests...`);
            const testContext: IAgentContext = {
              ...context,
              metadata: {
                ...context.metadata,
                codeAnalysis: agentOutputs['developer'],
              }
            };
            const testResult = await testGenAgent.execute(testContext);
            agentOutputs['testGenerator'] = testResult;
            results.push(`\n${testResult}`);
            if (this.planStateService) {
              this.planStateService.markStepComplete('testGenerator', testResult);
            }
            this.log('TestGeneratorAgent completed successfully');
          }
        } catch (testErr) {
          const errMsg = testErr instanceof Error ? testErr.message : String(testErr);
          this.log(`TestGeneratorAgent failed: ${errMsg}`, 'error');
          results.push(`\n## ⚠️ Unit Test Generation Skipped\n${errMsg}`);
        }
      }
    }

    return results.join('\n\n---\n\n');
  }

  // ==========================================
  // PRIVATE: Run code review with retry
  // ==========================================

  private async runCodeReviewWithRetry(
    context: IAgentContext,
    agentOutputs: Record<string, string>,
    results: string[],
    conversationHistory: string,
    projectContext: string
  ): Promise<void> {
    const reviewAgent = this.agentRegistry.get('codereview');
    if (!reviewAgent) { return; }

    this.log('Running CodeReviewAgent to validate generated code...');

    const reviewContext: IAgentContext = {
      workspaceRoot: context.workspaceRoot,
      selectedText: context.selectedText,
      filePath: context.filePath,
      fileContent: context.fileContent,
      metadata: {
        ...context.metadata,
        previousOutputs: agentOutputs,
      },
    };

    try {
      const reviewResult = await reviewAgent.execute(reviewContext);
      agentOutputs['codereview'] = reviewResult;
      results.push(`\n## 🔍 Code Review\n${reviewResult}`);
      this.log('CodeReviewAgent completed review');

      if (this.planStateService) {
        this.planStateService.markStepComplete('codereview', reviewResult);
      }

      // If review verdict is FAIL or NEEDS FIXES, retry developer once with full feedback
      // Check the actual **Verdict:** line that CodeReviewAgent.buildReport() writes,
      // not incidental words (e.g. "Skeleton Code Detection" heading or "Tests: FAILED").
      const verdictNeedsFix =
        reviewResult.includes('Verdict: FAIL') ||
        reviewResult.includes('Verdict: NEEDS FIXES') ||
        reviewResult.includes('VERDICT: FAIL') ||
        reviewResult.includes('VERDICT: NEEDS_FIXES');

      if (verdictNeedsFix) {
        const triggerReason = reviewResult.includes('Verdict: FAIL') || reviewResult.includes('VERDICT: FAIL')
          ? 'skeleton or critical code issues'
          : 'quality issues found (NEEDS FIXES)';
        this.log(`Review verdict requires fix — retrying DeveloperAgent (reason: ${triggerReason})...`);
        results.push(`\n## 🔄 Retrying Code Generation (${triggerReason})\\n`);


        const devAgent = this.agentRegistry.get('developer');
        if (devAgent) {
          const retryContext: IAgentContext = {
            workspaceRoot: context.workspaceRoot,
            selectedText: context.selectedText,
            filePath: context.filePath,
            fileContent: context.fileContent,
            metadata: {
              ...context.metadata,
              previousOutputs: agentOutputs,
              conversationHistory,
              projectContext,
              userRequest: `${context.metadata?.userRequest}\n\n--- CODE REVIEW FEEDBACK (YOUR PREVIOUS CODE WAS REJECTED) ---\nYour previous code output was REJECTED because it contained skeleton/stub code. The reviewer found:\n${reviewResult.substring(0, 2000)}\n\nYou MUST generate COMPLETE, WORKING code this time. Every function must have a real implementation. No empty bodies. No TODO comments. No placeholders.`,
            },
          };

          try {
            const retryResult = await devAgent.execute(retryContext);
            agentOutputs['developer'] = retryResult;
            results.push(`\n## 💻 Code Generation (Retry)\n${retryResult}`);

            if (this.planStateService) {
              this.planStateService.markStepComplete('developer', retryResult);
            }

            // Re-run review on retry output
            const retryReviewContext: IAgentContext = {
              ...reviewContext,
              metadata: { ...reviewContext.metadata, previousOutputs: agentOutputs },
            };
            const retryReview = await reviewAgent.execute(retryReviewContext);
            agentOutputs['codereview'] = retryReview;
            results.push(`\n## 🔍 Code Review (Retry)\n${retryReview}`);
          } catch (retryErr) {
            const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            this.log(`DeveloperAgent retry failed: ${retryErrMsg}`, 'error');
            results.push(`\n## ❌ Code Generation Retry Failed\n${retryErrMsg}`);
          }
        }
      }
    } catch (reviewErr) {
      const reviewErrMsg = reviewErr instanceof Error ? reviewErr.message : String(reviewErr);
      this.log(`CodeReviewAgent failed: ${reviewErrMsg}`, 'error');
      results.push(`\n## ⚠️ Code Review Skipped\n${reviewErrMsg}`);
    }
  }

  // ==========================================
  // PRIVATE: Edit-only mode (existing code, no agent responses)
  // ==========================================

  private async runEditOnlyMode(
    context: IAgentContext,
    conversationHistory: string
  ): Promise<string> {
    const results: string[] = [`## 🔧 Edit Mode — Modifying Existing Code`];

    let projectContext = '';
    if (this.projectAnalyzer) {
      try {
        projectContext = await this.projectAnalyzer.getProjectContext();
      } catch {
        projectContext = '';
      }
    }

    const devAgent = this.agentRegistry.get('developer');
    if (!devAgent) {
      throw new Error('DeveloperAgent not found in registry');
    }

    // Use the original plan request if available, not the current input
    const planState = this.planStateService?.loadPlanState() ?? null;
    const effectiveRequest = planState?.userRequest || (context.metadata?.userRequest as string) || 'implement feature';

    const devContext: IAgentContext = {
      workspaceRoot: context.workspaceRoot,
      selectedText: context.selectedText,
      filePath: context.filePath,
      fileContent: context.fileContent,
      metadata: {
        ...context.metadata,
        userRequest: effectiveRequest,
        previousOutputs: {},
        conversationHistory,
        projectContext,
        editMode: true,
      },
    };

    try {
      const codeResult = await devAgent.execute(devContext);
      results.push(`\n## 💻 Code Changes\n${codeResult}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push(`\n## ❌ Code Edit Failed\n${errMsg}`);
    }

    return results.join('\n\n---\n\n');
  }

  // ==========================================
  // PRIVATE: Edit with agent context (both code and agent responses exist)
  // ==========================================

  private async runEditWithAgentContext(
    context: IAgentContext,
    planState: PersistedPlanState,
    conversationHistory: string
  ): Promise<string> {
    const results: string[] = [`## 🔧 Edit Mode — Modifying Code with Agent Context`];

    let projectContext = '';
    if (this.projectAnalyzer) {
      try {
        projectContext = await this.projectAnalyzer.getProjectContext();
      } catch {
        projectContext = '';
      }
    }

    const devAgent = this.agentRegistry.get('developer');
    if (!devAgent) {
      throw new Error('DeveloperAgent not found in registry');
    }

    const devContext: IAgentContext = {
      workspaceRoot: context.workspaceRoot,
      selectedText: context.selectedText,
      filePath: context.filePath,
      fileContent: context.fileContent,
      metadata: {
        ...context.metadata,
        userRequest: planState.userRequest,
        previousOutputs: planState.agentOutputs,
        conversationHistory,
        projectContext,
        editMode: true,
      },
    };

    try {
      const codeResult = await devAgent.execute(devContext);
      results.push(`\n## 💻 Code Changes\n${codeResult}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push(`\n## ❌ Code Edit Failed\n${errMsg}`);
    }

    return results.join('\n\n---\n\n');
  }

  // ==========================================
  // PLAN GENERATION
  // ==========================================

  /**
   * Generate execution plan via LLM
   */
  private async generatePlan(
    userRequest: string,
    conversationHistory: string,
    workspaceRoot?: string
  ): Promise<ExecutionPlan> {
    // Get rich project context (structure, language, frameworks, dependencies)
    let projectContext = '';
    if (this.projectAnalyzer) {
      try {
        projectContext = await this.projectAnalyzer.getProjectContext();
      } catch {
        projectContext = 'Project analysis unavailable';
      }
    }

    // ── Load SDLC artifacts: PRD and Sprint Plan ────────────────────────────
    let prdSection = '';
    let sprintSection = '';
    if (workspaceRoot) {
      const artifacts = new VernoArtifactService(workspaceRoot);

      // Read approved PRD
      const prd = artifacts.readJSON<PRDDocument>('prd.json');
      if (prd && prd.sections && prd.sections.length > 0) {
        this.log(`[OrchestratorAgent] Loaded PRD: ${prd.sections.length} sections`);
        const prdText = prd.sections
          .map(s => `### ${s.title}\n${s.content}`)
          .join('\n\n')
          .substring(0, 3000); // token budget guard
        prdSection = `\n## Approved PRD\nThe following PRD was approved by the user. Your plan MUST implement it faithfully.\n\n${prdText}`;
      }

      // Read Sprint Plan — extract Sprint 1 stories (current sprint)
      const sprintPlan = artifacts.readJSON<any>('sprint-plan.json');
      if (sprintPlan && Array.isArray(sprintPlan.sprints) && sprintPlan.sprints.length > 0) {
        // Use Sprint 1 (index 0) as the active sprint
        const activeSprint = sprintPlan.sprints[0];
        this.log(`[OrchestratorAgent] Loaded Sprint Plan: ${activeSprint.stories?.length ?? 0} stories in ${activeSprint.name}`);
        if (activeSprint.stories && activeSprint.stories.length > 0) {
          const storyLines = activeSprint.stories.map((s: any, i: number) =>
            `${i + 1}. [${s.id ?? `S-${i + 1}`}] ${s.title ?? s.name ?? 'Story'} (${s.storyPoints ?? '?'} pts)\n   ${s.description ?? ''}\n   AC: ${Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria.join('; ') : 'N/A'}`
          ).join('\n\n');
          sprintSection = `\n## Active Sprint: ${activeSprint.name}\nThese are the stories committed for the current sprint. The developer steps MUST each implement one story, named as:\n  "task": "Implement [Story ID] — [Story Title]"\n\n${storyLines}`;
        }
      }
    }

    const agentList = Object.entries(AVAILABLE_AGENTS)
      .map(([id, desc]) => `  - "${id}": ${desc}`)
      .join('\n');

    const hasSprintStories = sprintSection.length > 0;

    const planPrompt = `You are an expert software project planner (the Orchestrator). Analyze the user's request and create an execution plan.

## Available Agents
${agentList}

## Rules
1. ONLY the "developer" agent can generate code files. No other agent writes code.
2. Other agents provide analysis, architecture, design, testing strategy, and documentation — their output feeds INTO the developer.
3. Include only agents that are relevant to the request. Small requests may only need the developer.
4. Order matters: analyst → architect → uxdesigner → pm → developer → qa → techwriter
5. Set "includeCodeGeneration" to true if the user wants code/implementation.
6. If the user is just asking a question or for clarification, return an empty steps array and put your conversational response in "summary".
7. Consider the current project state below — plan for MODIFICATIONS to existing code, not greenfield creation, if files already exist.
8. IMPORTANT: Each agent can appear AT MOST ONCE in the plan. Do NOT duplicate agents.
${hasSprintStories ? '9. CRITICAL: An Approved PRD and Sprint Plan exist (see below). You MUST align every step to the sprint stories. The developer task MUST reference the story ID and title.' : ''}

## Project Context (Current Repository State)
${projectContext || 'No project context available (new project)'}${prdSection}${sprintSection}

## Conversation History
${conversationHistory ? conversationHistory.substring(0, 2000) : 'No previous conversation'}

## User Request
${userRequest}

Respond with ONLY valid JSON (no markdown fencing):
{
  "summary": "Brief description of what the plan will accomplish",
  "includeCodeGeneration": true,
  "steps": [
    { "step": 1, "agentId": "analyst", "agentName": "Business Analyst", "task": "Analyze requirements for...", "reason": "Need to understand..." },
    { "step": 2, "agentId": "architect", "agentName": "System Architect", "task": "Design architecture for...", "reason": "Need system design..." },
    { "step": 3, "agentId": "developer", "agentName": "Developer", "task": "Implement [S-001] — Product listing page with filtering", "reason": "Implements Sprint 1 Story S-001" }
  ]
}`;

    const llmResponse = await this.llmService.generateText(planPrompt);
    this.log(`Plan LLM response: ${llmResponse.substring(0, 200)}...`);

    // Parse plan from LLM response
    try {
      // Try to extract JSON from the response (handle markdown fencing)
      let jsonStr = llmResponse;
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr);
      return {
        summary: parsed.summary || 'Executing plan...',
        steps: Array.isArray(parsed.steps) ? parsed.steps : [],
        includeCodeGeneration: parsed.includeCodeGeneration !== false,
      };
    } catch (parseErr) {
      this.log(`Failed to parse plan JSON, defaulting to developer - only: ${parseErr} `, 'error');
      // Fallback: just run developer
      return {
        summary: `Processing: ${userRequest} `,
        steps: [
          {
            step: 1,
            agentId: 'developer',
            agentName: 'Developer',
            task: userRequest,
            reason: 'Direct code generation (plan parsing failed)',
          },
        ],
        includeCodeGeneration: true,
      };
    }
  }
}
