"use strict";
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
exports.OrchestratorAgent = void 0;
const BaseAgent_1 = require("../base/BaseAgent");
const FileChangeTracker_1 = require("../../services/file/FileChangeTracker");
const CodeGeneratorAgent_1 = require("../specialized/CodeGeneratorAgent");
const DocumentationAgent_1 = require("../specialized/DocumentationAgent");
const TestGeneratorAgent_1 = require("../specialized/TestGeneratorAgent");
const MultiAgentManager_1 = require("../MultiAgentManager");
const AnalystAgent_1 = require("../BMAD/AnalystAgent");
const ArchitectAgent_1 = require("../BMAD/ArchitectAgent");
const UXDesignerAgent_1 = require("../BMAD/UXDesignerAgent");
const DeveloperAgent_1 = require("../BMAD/DeveloperAgent");
const CodeReviewAgent_1 = require("../BMAD/CodeReviewAgent");
const ProductManagerAgent_1 = require("../BMAD/ProductManagerAgent");
const QAEngineerAgent_1 = require("../BMAD/QAEngineerAgent");
const TechWriterAgent_1 = require("../BMAD/TechWriterAgent");
const QuickFlowSoloDevAgent_1 = require("../BMAD/QuickFlowSoloDevAgent");
const todo_1 = require("../../services/todo");
const project_1 = require("../../services/project");
const feedback_1 = require("../../services/feedback");
const PlanStateService_1 = require("../../services/planning/PlanStateService");
const ContextBuilder_1 = require("../../services/workflow/ContextBuilder");
const vscode = __importStar(require("vscode"));
/** Available agents the planner can assign */
const AVAILABLE_AGENTS = {
    analyst: 'Business Analyst (Mary) - Requirements analysis, market research',
    architect: 'System Architect (Winston) - Architecture design, tech stack',
    uxdesigner: 'UX Designer (Sally) - User experience, interface design',
    pm: 'Product Manager - Feature prioritization, roadmap',
    qa: 'QA Engineer - Test strategy, quality assurance',
    techwriter: 'Tech Writer - Documentation, API docs',
    developer: 'Developer (Amelia) - Code implementation (ONLY code generator)',
    codereview: 'Code Reviewer - Validates code completeness, correctness, and quality (runs after developer)',
};
class OrchestratorAgent extends BaseAgent_1.BaseAgent {
    logger;
    agentRegistry;
    llmService;
    fileService;
    name = 'OrchestratorAgent';
    description = 'Plans and orchestrates multi-agent workflows. Creates plans, assigns agents, collects feedback, and coordinates code generation.';
    changeTracker;
    todoService;
    projectAnalyzer;
    feedbackService;
    planStateService;
    constructor(logger, agentRegistry, llmService, fileService, changeTracker) {
        super(logger);
        this.logger = logger;
        this.agentRegistry = agentRegistry;
        this.llmService = llmService;
        this.fileService = fileService;
        this.changeTracker = changeTracker || new FileChangeTracker_1.FileChangeTracker();
        this.registerSpecializedAgents();
    }
    /**
     * Initialize enhanced services for TODO, feedback, and plan state
     */
    initializeEnhancedServices(workspaceRoot) {
        if (!this.todoService) {
            this.todoService = new todo_1.TodoService(workspaceRoot);
            this.projectAnalyzer = new project_1.ProjectAnalyzer(workspaceRoot);
            this.feedbackService = new feedback_1.FeedbackService(workspaceRoot);
            this.planStateService = new PlanStateService_1.PlanStateService(workspaceRoot);
            this.log('Enhanced orchestrator services initialized');
        }
    }
    registerSpecializedAgents() {
        const codeGenerator = new CodeGeneratorAgent_1.CodeGeneratorAgent(this.logger, this.llmService, this.fileService);
        const documentationAgent = new DocumentationAgent_1.DocumentationAgent(this.logger, this.llmService, this.fileService);
        const testGenerator = new TestGeneratorAgent_1.TestGeneratorAgent(this.logger, this.llmService, this.fileService);
        this.agentRegistry.register('codeGenerator', codeGenerator);
        this.agentRegistry.register('documentationAgent', documentationAgent);
        this.agentRegistry.register('testGenerator', testGenerator);
        // Register BMAD multi-stage manager
        const multiManager = new MultiAgentManager_1.MultiAgentManager(this.logger, this.agentRegistry, this.llmService, this.fileService);
        this.agentRegistry.register('multiManager', multiManager);
        // Register BMAD agents with FileChangeTracker for diff tracking
        this.agentRegistry.register('analyst', new AnalystAgent_1.AnalystAgent(this.logger, this.llmService, this.fileService, this.changeTracker));
        this.agentRegistry.register('architect', new ArchitectAgent_1.ArchitectAgent(this.logger, this.llmService, this.fileService, this.changeTracker));
        this.agentRegistry.register('uxdesigner', new UXDesignerAgent_1.UXDesignerAgent(this.logger, this.llmService, this.fileService, this.changeTracker));
        this.agentRegistry.register('developer', new DeveloperAgent_1.DeveloperAgent(this.logger, this.llmService, this.fileService, this.changeTracker));
        this.agentRegistry.register('pm', new ProductManagerAgent_1.ProductManagerAgent(this.logger, this.llmService, this.fileService, this.changeTracker));
        this.agentRegistry.register('qa', new QAEngineerAgent_1.QAEngineerAgent(this.logger, this.llmService, this.fileService, this.changeTracker));
        this.agentRegistry.register('techwriter', new TechWriterAgent_1.TechWriterAgent(this.logger, this.llmService, this.fileService, this.changeTracker));
        this.agentRegistry.register('quickflowdev', new QuickFlowSoloDevAgent_1.QuickFlowSoloDevAgent(this.logger, this.llmService, this.fileService, this.changeTracker));
        this.agentRegistry.register('codereview', new CodeReviewAgent_1.CodeReviewAgent(this.logger, this.llmService, this.fileService, this.changeTracker));
    }
    // ==========================================
    // SDLC INTERCEPT AND INJECTION
    // ==========================================
    async startSDLCFlow(topic) {
        await vscode.commands.executeCommand('verno.startSDLC', topic);
    }
    async onPRDApproved(prd, context) {
        this.log('PRD Approved. Triggering BMAD execution pipeline.');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }
        const prdString = JSON.stringify(prd, null, 2);
        // Inject PRD into agent context
        const agentContext = new ContextBuilder_1.ContextBuilder()
            .setWorkspaceRoot(workspaceRoot)
            .setMetadata({
            userRequest: `[APPROVED PRD ATTACHED]\n\nPlease implement the features described in this PRD:\n\n${prdString}`,
            mode: 'plan',
            timestamp: new Date().toISOString()
        })
            .build();
        try {
            await this.executePlan(agentContext);
            vscode.window.showInformationMessage('BMAD Planning phase completed based on PRD!');
        }
        catch (err) {
            vscode.window.showErrorMessage(`BMAD Pipeline failed: ${err.message}`);
        }
    }
    // ==========================================
    // BACKWARD-COMPATIBLE EXECUTE (runs both)
    // ==========================================
    async execute(context) {
        const mode = context.metadata?.mode;
        if (mode === 'plan') {
            return this.executePlan(context);
        }
        return this.executeCode(context);
    }
    // ==========================================
    // PLAN MODE: Generate plan + run non-coding agents
    // ==========================================
    async executePlan(context) {
        if (!this.validateContext(context)) {
            throw new Error('Invalid context provided to OrchestratorAgent');
        }
        this.log('Starting PLAN phase — plan generation + non-coding agents');
        try {
            const userRequest = context.metadata?.userRequest;
            if (!userRequest) {
                throw new Error('No user request found in context');
            }
            const conversationHistory = context.metadata?.conversationHistory || '';
            // Initialize services
            if (context.workspaceRoot) {
                this.initializeEnhancedServices(context.workspaceRoot);
            }
            // Check for existing plan — reuse if request hasn't changed
            const existingState = this.planStateService?.loadPlanState() ?? null;
            let plan;
            if (existingState && existingState.userRequest === userRequest) {
                this.log('Reusing existing plan (request unchanged)');
                plan = existingState.plan;
            }
            else {
                // Generate a new plan with full project context
                plan = await this.generatePlan(userRequest, conversationHistory, context.workspaceRoot);
                this.log(`New plan generated: ${plan.steps.length} steps, code generation: ${plan.includeCodeGeneration}`);
            }
            // If plan has no steps (just a conversation/clarification), return the plan summary
            if (plan.steps.length === 0) {
                return plan.summary;
            }
            // Create plan state — separate planning steps from coding steps
            const planState = this.planStateService.createFromPlan(plan, userRequest);
            // Create TODO list from plan
            if (this.todoService) {
                const todos = plan.steps.map((step) => ({
                    title: step.task,
                    description: `Agent: ${step.agentName} — ${step.reason}`,
                    assignedAgent: step.agentName,
                    status: 'pending',
                    dependencies: [],
                    priority: 'high',
                }));
                this.todoService.createTodoList('Orchestrator', todos);
                this.log(`Created ${todos.length} TODO items from plan`);
            }
            // Execute ONLY non-coding agents
            const planningResults = [];
            for (const step of plan.steps) {
                // Skip coding-phase agents — they run in CODE mode
                if (PlanStateService_1.CODING_PHASE_AGENTS.has(step.agentId)) {
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
                const agentContext = {
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
                }
                catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    this.log(`Step ${step.step} failed: ${errMsg}`, 'error');
                    planningResults.push(`### ❌ ${step.agentName} Failed\n${errMsg}`);
                    planState.agentOutputs[step.agentId] = `[FAILED] ${errMsg}`;
                }
            }
            // Persist the plan state with completed planning steps and pending coding steps
            this.planStateService.savePlanState(planState);
            this.log('Plan state persisted to disk');
            // Build final output
            const pendingCodingSteps = plan.steps.filter(s => PlanStateService_1.CODING_PHASE_AGENTS.has(s.agentId));
            const results = [`## 📋 Project Plan\n${plan.summary}`];
            if (planningResults.length > 0) {
                results.push(`<details>\n<summary>📝 View Planning & Architecture Details</summary>\n\n${planningResults.join('\n\n---\n\n')}\n</details>`);
            }
            if (pendingCodingSteps.length > 0) {
                const pendingList = pendingCodingSteps.map(s => `- **${s.agentName}**: ${s.task}`).join('\n');
                results.push(`## ⏳ Pending (run CODE to execute)\n${pendingList}`);
            }
            return results.join('\n\n---\n\n');
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`Plan phase error: ${errorMsg}`, 'error');
            throw error;
        }
    }
    // ==========================================
    // CODE MODE: Run pending coding agents
    // ==========================================
    async executeCode(context) {
        if (!this.validateContext(context)) {
            throw new Error('Invalid context provided to OrchestratorAgent');
        }
        this.log('Starting CODE phase — running coding/testing/documentation agents');
        try {
            const userRequest = context.metadata?.userRequest;
            if (!userRequest) {
                throw new Error('No user request found in context');
            }
            const conversationHistory = context.metadata?.conversationHistory || '';
            // Initialize services
            if (context.workspaceRoot) {
                this.initializeEnhancedServices(context.workspaceRoot);
            }
            // Load plan state
            const planState = this.planStateService?.loadPlanState() ?? null;
            const hasPendingTasks = planState && planState.pendingSteps.some(id => PlanStateService_1.CODING_PHASE_AGENTS.has(id));
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
                const newPlanState = this.planStateService.loadPlanState();
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
                return await this.runPendingCodingAgents(context, planState, conversationHistory);
            }
            // CASE 5: Both code and agent responses exist — edit mode with agent context
            this.log('Both code and agent responses exist — edit mode with full context');
            return await this.runEditWithAgentContext(context, planState, conversationHistory);
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`Code phase error: ${errorMsg}`, 'error');
            throw error;
        }
    }
    // ==========================================
    // PRIVATE: Run pending coding agents
    // ==========================================
    async runPendingCodingAgents(context, planState, conversationHistory) {
        const results = [`## 📋 Executing Pending Code Tasks`];
        const agentOutputs = { ...planState.agentOutputs };
        // Get project context for the coding agents
        let projectContext = '';
        if (this.projectAnalyzer) {
            try {
                projectContext = await this.projectAnalyzer.getProjectContext();
            }
            catch {
                projectContext = '';
            }
        }
        // Find pending coding steps in plan order
        const pendingCodingSteps = planState.plan.steps.filter(s => planState.pendingSteps.includes(s.agentId) && PlanStateService_1.CODING_PHASE_AGENTS.has(s.agentId));
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
            const agentContext = {
                workspaceRoot: context.workspaceRoot,
                selectedText: context.selectedText,
                filePath: context.filePath,
                fileContent: context.fileContent,
                metadata: {
                    ...context.metadata,
                    // Use the plan step's task as the primary request, with the original plan request as context
                    userRequest: `${step.task}\n\nOriginal Request: ${planState.userRequest}`,
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
            }
            catch (err) {
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
                        const testContext = {
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
                }
                catch (testErr) {
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
    async runCodeReviewWithRetry(context, agentOutputs, results, conversationHistory, projectContext) {
        const reviewAgent = this.agentRegistry.get('codereview');
        if (!reviewAgent) {
            return;
        }
        this.log('Running CodeReviewAgent to validate generated code...');
        const reviewContext = {
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
            // If review found skeleton code, retry DeveloperAgent once with feedback
            if (reviewResult.includes('FAIL') && reviewResult.includes('keleton')) {
                this.log('Review detected skeleton code — retrying DeveloperAgent with feedback...');
                results.push(`\n## 🔄 Retrying Code Generation (skeleton code detected)\n`);
                const devAgent = this.agentRegistry.get('developer');
                if (devAgent) {
                    const retryContext = {
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
                        const retryReviewContext = {
                            ...reviewContext,
                            metadata: { ...reviewContext.metadata, previousOutputs: agentOutputs },
                        };
                        const retryReview = await reviewAgent.execute(retryReviewContext);
                        agentOutputs['codereview'] = retryReview;
                        results.push(`\n## 🔍 Code Review (Retry)\n${retryReview}`);
                    }
                    catch (retryErr) {
                        const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                        this.log(`DeveloperAgent retry failed: ${retryErrMsg}`, 'error');
                        results.push(`\n## ❌ Code Generation Retry Failed\n${retryErrMsg}`);
                    }
                }
            }
        }
        catch (reviewErr) {
            const reviewErrMsg = reviewErr instanceof Error ? reviewErr.message : String(reviewErr);
            this.log(`CodeReviewAgent failed: ${reviewErrMsg}`, 'error');
            results.push(`\n## ⚠️ Code Review Skipped\n${reviewErrMsg}`);
        }
    }
    // ==========================================
    // PRIVATE: Edit-only mode (existing code, no agent responses)
    // ==========================================
    async runEditOnlyMode(context, conversationHistory) {
        const results = [`## 🔧 Edit Mode — Modifying Existing Code`];
        let projectContext = '';
        if (this.projectAnalyzer) {
            try {
                projectContext = await this.projectAnalyzer.getProjectContext();
            }
            catch {
                projectContext = '';
            }
        }
        const devAgent = this.agentRegistry.get('developer');
        if (!devAgent) {
            throw new Error('DeveloperAgent not found in registry');
        }
        // Use the original plan request if available, not the current input
        const planState = this.planStateService?.loadPlanState() ?? null;
        const effectiveRequest = planState?.userRequest || context.metadata?.userRequest || 'implement feature';
        const devContext = {
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
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            results.push(`\n## ❌ Code Edit Failed\n${errMsg}`);
        }
        return results.join('\n\n---\n\n');
    }
    // ==========================================
    // PRIVATE: Edit with agent context (both code and agent responses exist)
    // ==========================================
    async runEditWithAgentContext(context, planState, conversationHistory) {
        const results = [`## 🔧 Edit Mode — Modifying Code with Agent Context`];
        let projectContext = '';
        if (this.projectAnalyzer) {
            try {
                projectContext = await this.projectAnalyzer.getProjectContext();
            }
            catch {
                projectContext = '';
            }
        }
        const devAgent = this.agentRegistry.get('developer');
        if (!devAgent) {
            throw new Error('DeveloperAgent not found in registry');
        }
        const devContext = {
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
        }
        catch (err) {
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
    async generatePlan(userRequest, conversationHistory, workspaceRoot) {
        // Get rich project context (structure, language, frameworks, dependencies)
        let projectContext = '';
        if (this.projectAnalyzer) {
            try {
                projectContext = await this.projectAnalyzer.getProjectContext();
            }
            catch {
                projectContext = 'Project analysis unavailable';
            }
        }
        const agentList = Object.entries(AVAILABLE_AGENTS)
            .map(([id, desc]) => `  - "${id}": ${desc}`)
            .join('\n');
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

## Project Context (Current Repository State)
${projectContext || 'No project context available (new project)'}

## Conversation History
${conversationHistory ? conversationHistory.substring(0, 3000) : 'No previous conversation'}

## User Request
${userRequest}

Respond with ONLY valid JSON (no markdown fencing):
{
  "summary": "Brief description of what the plan will accomplish",
  "includeCodeGeneration": true,
  "steps": [
    { "step": 1, "agentId": "analyst", "agentName": "Business Analyst", "task": "Analyze requirements for...", "reason": "Need to understand..." },
    { "step": 2, "agentId": "architect", "agentName": "System Architect", "task": "Design architecture for...", "reason": "Need system design..." },
    { "step": 3, "agentId": "developer", "agentName": "Developer", "task": "Implement code for...", "reason": "Generate the actual code" }
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
        }
        catch (parseErr) {
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
exports.OrchestratorAgent = OrchestratorAgent;
//# sourceMappingURL=OrchestratorAgent.js.map