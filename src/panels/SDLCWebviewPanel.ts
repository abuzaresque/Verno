import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DebateOrchestrator } from '../agents/DebateOrchestrator';
import { LLMService } from '../services/llm';
import { Logger } from '../utils/logger';
import { DebateMessage, PRDDocument, Epic, SyncStatus } from '../types/sdlc';
import { JiraAuthService } from '../jira/JiraAuthService';
import { JiraSetupWebview } from '../jira/JiraSetupWebview';
import { JiraSyncService } from '../jira/JiraSyncService';
import { validateWebviewMessage, generateNonce } from '../utils/webviewSecurity';
import { VernoArtifactService } from '../services/artifact/VernoArtifactService';
import { SprintPlannerAgent } from '../agents/BMAD/SprintPlannerAgent';
import { SprintPlan } from '../types/sprint';

/** Allowlist of message types accepted by the SDLC panel. */
const SDLC_ALLOWED_TYPES = [
    'start-debate', 'approve-prd', 'revise-prd', 'push-jira',
    'retry-item', 'complete-flow', 'load-state', 'open-jira-setup',
    'generateSprintPlan'
] as const;

interface SDLCState {
    currentPhase: 'TOPIC_INPUT' | 'DEBATE' | 'PRD_REVIEW' | 'TASK_BREAKDOWN' | 'JIRA_PUSH' | 'COMPLETE';
    topic: string;
    debateMessages: DebateMessage[];
    prdDocument: PRDDocument | null;
    epics: Epic[];
}

export class SDLCWebviewPanel {
    public static currentPanel: SDLCWebviewPanel | undefined;
    public readonly panel: vscode.WebviewPanel;
    private readonly context: vscode.ExtensionContext;
    private readonly logger: Logger;
    private readonly llmService: LLMService;

    private state: SDLCState = {
        currentPhase: 'TOPIC_INPUT',
        topic: '',
        debateMessages: [],
        prdDocument: null,
        epics: []
    };

    private debateOrchestrator: DebateOrchestrator;
    private artifacts: VernoArtifactService | null = null;

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, logger: Logger, llmService: LLMService) {
        this.panel = panel;
        this.context = context;
        this.logger = logger;
        this.llmService = llmService;
        this.debateOrchestrator = new DebateOrchestrator(llmService, logger);

        // Initialize artifact service if workspace is open
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (root) { this.artifacts = new VernoArtifactService(root); }

        this.panel.onDidDispose(() => this.dispose());
        this.panel.webview.onDidReceiveMessage(async (message) => {
            this.logger.info(`[SDLCWebviewPanel] Received message: ${JSON.stringify(message)}`);
            if (!validateWebviewMessage(message, SDLC_ALLOWED_TYPES, this.logger)) { return; }
            const msg = message as any; // type validated above
            switch (msg.type) {
                case 'start-debate':
                    this.state.topic = msg.topic;
                    this.setPhase('DEBATE');
                    await this.runDebateFlow();
                    break;
                case 'approve-prd':
                    this.setPhase('TASK_BREAKDOWN');
                    await this.decomposePRD();
                    break;
                case 'revise-prd':
                    this.state.debateMessages = [];
                    this.state.topic = msg.feedback;
                    this.setPhase('DEBATE');
                    await this.runDebateFlow(msg.feedback);
                    break;
                case 'push-jira':
                    this.setPhase('JIRA_PUSH');
                    await this.pushToJira(msg.dryRun);
                    break;
                case 'retry-item':
                    await this.pushToJira(false);
                    break;
                case 'complete-flow':
                    this.setPhase('COMPLETE');
                    if (this.state.prdDocument) {
                        await vscode.commands.executeCommand('verno.startBMADAfterSDLC', this.state.prdDocument);
                    }
                    break;
                case 'load-state':
                    this.loadState();
                    break;
                case 'open-jira-setup':
                    JiraSetupWebview.createOrShow(this.context, this.logger);
                    break;
                case 'generateSprintPlan':
                    await this.generateSprintPlan(msg.capacity);
                    break;
            }
        });
    }

    public static createOrShow(context: vscode.ExtensionContext, logger: Logger, llmService: LLMService, topic?: string, prd?: PRDDocument) {
        logger.info('[SDLCWebviewPanel] createOrShow triggered, prd: ' + (prd?.title ?? topic));
        if (SDLCWebviewPanel.currentPanel) {
            SDLCWebviewPanel.currentPanel.panel.reveal();
            if (prd) {
                // PRD already built — jump straight to review
                SDLCWebviewPanel.currentPanel.state.prdDocument = prd;
                SDLCWebviewPanel.currentPanel.setPhase('PRD_REVIEW');
                SDLCWebviewPanel.currentPanel.panel.webview.postMessage({ type: 'prd-ready', payload: prd });
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel('sdlcFlow', 'Verno — PRD Review', vscode.ViewColumn.Beside, { enableScripts: true });
        SDLCWebviewPanel.currentPanel = new SDLCWebviewPanel(panel, context, logger, llmService);
        SDLCWebviewPanel.currentPanel.panel.webview.html = SDLCWebviewPanel.currentPanel.getHtml(SDLCWebviewPanel.currentPanel.panel.webview);

        if (prd) {
            // Debate already done in sidebar — jump straight to PRD review
            SDLCWebviewPanel.currentPanel.state.prdDocument = prd;

            // Save state immediately prior to timeout so that if the webview 
            // requests load-state it gets the correct phase
            SDLCWebviewPanel.currentPanel.state.currentPhase = 'PRD_REVIEW';
            SDLCWebviewPanel.currentPanel.saveState();

            // Keep timeout as a fallback but allow load-state to trigger render natively
            setTimeout(() => {
                SDLCWebviewPanel.currentPanel?.panel.webview.postMessage({ type: 'phase-changed', phase: 'PRD_REVIEW' });
                SDLCWebviewPanel.currentPanel?.panel.webview.postMessage({ type: 'prd-ready', payload: prd });
            }, 800); // increased timeout to allow larger webview to hook events
        } else if (topic) {
            // Legacy: show topic input with pre-filled topic
            setTimeout(() => {
                SDLCWebviewPanel.currentPanel?.panel.webview.postMessage({ type: 'init-topic', topic });
            }, 800);
        }
    }

    public dispose() {
        SDLCWebviewPanel.currentPanel = undefined;
        this.panel.dispose();
    }

    private setPhase(phase: SDLCState['currentPhase']) {
        this.state.currentPhase = phase;
        this.saveState();
        this.panel.webview.postMessage({ type: 'phase-changed', phase });
    }

    private getWorkspaceRoot(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    private saveState() {
        if (!this.artifacts) {
            const root = this.getWorkspaceRoot();
            if (root) { this.artifacts = new VernoArtifactService(root); }
        }
        this.artifacts?.writeJSON('sdlc-state.json', this.state);
    }

    private loadState() {
        const root = this.getWorkspaceRoot();
        if (root) {
            if (!this.artifacts) { this.artifacts = new VernoArtifactService(root); }
            const saved = this.artifacts.readJSON<SDLCState>('sdlc-state.json');
            if (saved) {
                this.state = saved;
            }
        }
        this.panel.webview.postMessage({ type: 'state-loaded', state: this.state });
    }

    private async runDebateFlow(feedback?: string) {
        try {
            const topic = feedback ? `Feedback on previous PRD: ${feedback}` : this.state.topic;
            this.logger.info(`[SDLCWebviewPanel] Starting debate flow for topic: ${topic}`);

            const prd = await this.debateOrchestrator.runDebate(topic, (msg) => {
                this.state.debateMessages.push(msg);
                this.saveState();
                this.panel.webview.postMessage({ type: 'debate-message', payload: msg });
            });

            this.state.prdDocument = prd;
            this.setPhase('PRD_REVIEW');
            this.panel.webview.postMessage({ type: 'prd-ready', payload: prd });
            this.saveState();
            this.logger.info(`[SDLCWebviewPanel] PRD generation complete for ${prd.title}`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error('[SDLCWebviewPanel] Debate flow failed', error as Error);
            this.panel.webview.postMessage({
                type: 'debate-message',
                payload: {
                    agent: 'System',
                    content: `❌ Error: ${msg}. Please check your API keys or connection.`,
                    type: 'error'
                }
            });
            vscode.window.showErrorMessage(`Verno SDLC Error: ${msg}`);
        }
    }

    private async decomposePRD() {
        try {
            if (!this.state.prdDocument) return;

            this.logger.info('[SDLCWebviewPanel] Decomposing PRD into Epics and Stories...');
            const prompt = `You are a Technical Agile Coach. Decompose the following PRD into Epics, Stories, and SubTasks.
Crucially, DIVIDE THESE TASKS exclusively among the 7 BMAD Agents: 
['analyst', 'architect', 'ux', 'developer', 'pm', 'qa', 'techwriter'].
Ensure there are specific tasks distributed for everyone (e.g., QA tasks, Docs tasks, Architecture tasks).

PRD:
${JSON.stringify(this.state.prdDocument.sections)}

Respond ONLY with valid JSON matching this structure:
[
  {
    "id": "e1",
    "title": "Epic Title",
    "description": "Epic description",
    "syncStatus": "pending",
    "assignedAgent": "pm",
    "stories": [
      {
        "id": "s1",
        "title": "Story Title",
        "description": "Story description",
        "storyPoints": 3,
        "priority": "High",
        "status": "To Do",
        "syncStatus": "pending",
        "parentEpicId": "e1",
        "assignedAgent": "architect",
        "subtasks": [
          { "id": "st1", "title": "Subtask title", "status": "To Do", "syncStatus": "pending", "parentStoryId": "s1", "assignedAgent": "developer" }
        ]
      }
    ]
  }
]`;

            let prdJson = await this.llmService.generateText(prompt);

            // Robust JSON extraction
            const jsonMatch = prdJson.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (jsonMatch) {
                prdJson = jsonMatch[0];
            } else {
                prdJson = prdJson.replace(/```json/gi, '').replace(/```/g, '').trim();
            }

            this.state.epics = JSON.parse(prdJson);
            if (!this.artifacts) {
                const root = this.getWorkspaceRoot();
                if (root) { this.artifacts = new VernoArtifactService(root); }
            }
            if (this.artifacts) {
                this.artifacts.write('tasks.md', `<h1>Generated Tasks</h1><pre>${JSON.stringify(this.state.epics, null, 2)}</pre>`);
                this.artifacts.writeJSON('tasks.json', this.state.epics);
            }
            this.saveState();
            this.panel.webview.postMessage({ type: 'tasks-ready', payload: this.state.epics });

            const isAuth = await JiraAuthService.getInstance(this.context).isAuthenticated();
            this.panel.webview.postMessage({ type: 'jira-status', isAuth });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error('[SDLCWebviewPanel] PRD decomposition failed', error as Error);
            vscode.window.showErrorMessage(`Verno Task Generation Error: ${msg}. Check logs and retry.`);
            this.panel.webview.postMessage({ type: 'tasks-ready', payload: [] });
        }
    }

    private async pushToJira(dryRun: boolean) {
        const auth = JiraAuthService.getInstance(this.context);
        const creds = await auth.getCredentials();
        if (!creds) {
            vscode.window.showErrorMessage('Jira credentials not found.');
            return;
        }

        const root = this.getWorkspaceRoot();
        if (!root) return;

        let config: any = {};
        try {
            config = JSON.parse(fs.readFileSync(path.join(root, '.verno', 'jira-config.json'), 'utf-8'));
        } catch (e) {
            vscode.window.showErrorMessage('Jira config missing. Run Jira Setup first.');
            return;
        }

        const syncService = new JiraSyncService(this.logger);

        await syncService.syncEpics(
            this.state.epics,
            creds,
            config.projectKey,
            { storyPointsFieldId: config.storyPointsFieldId },
            config.issueTypes,
            (itemId, status) => {
                this.panel.webview.postMessage({ type: 'sync-update', payload: { itemId, syncStatus: status } });
            },
            dryRun
        );

        this.saveState();
    }

    private async generateSprintPlan(capacity: number): Promise<void> {
        if (!this.state.epics || this.state.epics.length === 0) {
            vscode.window.showErrorMessage('No epics available. Complete task breakdown first.');
            return;
        }
        const agent = new SprintPlannerAgent(this.logger);
        const plan: SprintPlan = agent.plan(this.state.epics, capacity);
        this.panel.webview.postMessage({ type: 'sprintPlanReady', payload: plan });
        this.logger.info(`[SDLCWebviewPanel] Sprint plan generated: ${plan.sprints.length} sprints`);
    }

    private getNonce() {
        return generateNonce();
    }

    private getHtml(webview: vscode.Webview) {
        const nonce = this.getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <style>
        :root {
            --background: oklch(0.2046 0 0);
            --foreground: oklch(0.9219 0 0);
            --card: oklch(0.2686 0 0);
            --card-foreground: oklch(0.9219 0 0);
            --popover: oklch(0.2686 0 0);
            --popover-foreground: oklch(0.9219 0 0);
            --primary: oklch(0.7686 0.1647 70.0804);
            --primary-foreground: oklch(0 0 0);
            --secondary: oklch(0.2686 0 0);
            --secondary-foreground: oklch(0.9219 0 0);
            --muted: oklch(0.2393 0 0);
            --muted-foreground: oklch(0.7155 0 0);
            --accent: oklch(0.4732 0.1247 46.2007);
            --accent-foreground: oklch(0.9243 0.1151 95.7459);
            --destructive: oklch(0.6368 0.2078 25.3313);
            --destructive-foreground: oklch(1.0000 0 0);
            --border: oklch(0.3715 0 0);
        }
        body { 
            font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
            background: var(--background); 
            color: var(--foreground); 
            padding: 30px; 
            max-width: 900px;
            margin: 0 auto;
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
        }
        h1, h2, h3, h4 { letter-spacing: -0.02em; font-weight: 600; margin-bottom: 1rem; color: var(--foreground); }
        .section { 
            display: none; 
            margin-bottom: 40px; 
            animation: spatialFade 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            opacity: 0;
            transform: translateY(10px) scale(0.98);
        }
        .active { display: block; }
        @keyframes spatialFade {
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        
        .chat-msg { 
            margin: 12px 0; 
            padding: 16px; 
            border-radius: 8px; 
            background: var(--card);
            border: 1px solid var(--border);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.05);
            backdrop-filter: blur(10px);
        }
        .chat-msg b { color: var(--primary); font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.05em; }
        
        button { 
            padding: 10px 20px; 
            background: var(--primary); 
            color: var(--primary-foreground); 
            border: none; 
            border-radius: 6px;
            cursor: pointer; 
            margin-right: 12px; 
            font-weight: 600;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            box-shadow: 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 1px rgba(255,255,255,0.2);
        }
        button:hover { 
            filter: brightness(1.1); 
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.2);
        }
        button:active { transform: translateY(0); filter: brightness(0.9); }
        
        textarea, input { 
            width: 100%; 
            padding: 12px; 
            box-sizing: border-box; 
            background: var(--muted); 
            color: var(--foreground); 
            border: 1px solid var(--border); 
            border-radius: 6px;
            margin-bottom: 20px; 
            transition: border-color 0.2s;
            font-family: inherit;
        }
        textarea:focus, input:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 2px hsla(var(--accent), 0.2);
        }
        
        .prd-section { 
            margin-bottom: 30px; 
            border-left: 2px solid var(--border); 
            padding-left: 20px; 
            background: var(--card);
            padding: 20px 20px 20px 24px;
            border-radius: 0 8px 8px 0;
        }
        .prd-section h4 { color: var(--primary); }
        .prd-section.security-section { border-left-color: var(--accent); }
        .prd-section.security-section h4 { color: var(--accent); }
        
        .pill { 
            display: inline-block; 
            padding: 4px 8px; 
            font-size: 0.75rem; 
            font-weight: 600;
            letter-spacing: 0.05em;
            border-radius: 12px; 
            background: var(--muted); 
            color: var(--muted-foreground); 
            margin-left: 12px; 
            text-transform: uppercase;
        }
        .pill.pending { background: rgba(243,156,18,0.2); color: #f39c12; border: 1px solid rgba(243,156,18,0.4); }
        .pill.pushed { background: rgba(46,204,113,0.2); color: #2ecc71; border: 1px solid rgba(46,204,113,0.4); }
        .pill.failed { background: rgba(231,76,60,0.2); color: #e74c3c; border: 1px solid rgba(231,76,60,0.4); }
        
        .compliance-flags { margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
        .flag-badge { 
            padding: 4px 10px; 
            border-radius: 4px; 
            font-size: 11px; 
            font-weight: 700; 
            letter-spacing: 0.05em;
        }
        .flag-gdpr { background: rgba(52,152,219,0.1); border: 1px solid rgba(52,152,219,0.3); color: #3498db; }
        .flag-hipaa { background: rgba(231,76,60,0.1); border: 1px solid rgba(231,76,60,0.3); color: #e74c3c; }
        .flag-owasp { background: rgba(230,126,34,0.1); border: 1px solid rgba(230,126,34,0.3); color: #e67e22; }
        
        .chat-msg.security-agent { 
            border: 1px solid rgba(231,76,60,0.3); 
            background: linear-gradient(to right, rgba(231,76,60,0.05), transparent); 
        }
    </style>
</head>
<body>
    <h1>PRD Review &amp; Task Planning</h1>

    <!-- PRE-LOAD Check -->
    <div id="loading" class="section active" style="text-align:center; padding:40px; opacity:0.7;">
        <div style="font-size:24px; margin-bottom:8px;">⚙️</div>
        <div>Loading SDLC Workspace…</div>
        <div style="font-size:11px; margin-top:8px; opacity:0.5;">Please wait while the AI syncs with your project.</div>
    </div>

    <!-- TOPIC_INPUT -->
    <div id="TOPIC_INPUT" class="section">
        <h3>What are we building today?</h3>
        <textarea id="topicInput" rows="4" placeholder="Describe the feature or application..."></textarea>
        <button id="startDebateBtn">Start PRD Generation (AI Debate)</button>
    </div>

    <!-- DEBATE -->
    <div id="DEBATE" class="section">
        <h3>Agent Debate in Progress...</h3>
        <div id="debateLog"></div>
        <div id="debateSpinner">Generating next response...</div>
    </div>

    <!-- PRD_REVIEW -->
    <div id="PRD_REVIEW" class="section">
        <h3>Review Product Requirements Document</h3>
        <div id="prdContent" style="background:var(--vscode-editor-inactiveSelectionBackground); padding: 15px; border-radius:5px; margin-bottom:15px; height: 300px; overflow-y:auto;"></div>
        <button id="approvePrdBtn">Approve & Generate Tasks</button>
        <textarea id="revisionFeedback" rows="2" placeholder="Feedback for revision..."></textarea>
        <button id="revisePrdBtn">Request Revision</button>
    </div>

    <!-- TASK_BREAKDOWN & JIRA_PUSH -->
    <div id="TASK_BREAKDOWN" class="section">
        <h3>Task Breakdown</h3>
        <div id="epicsList"></div>
        
        <!-- Sprint Planner -->
        <div id="sprintPlannerSection" style="margin-top:20px; border-top:1px solid var(--vscode-panel-border); padding-top:20px; display:none;">
            <h4>⚡ Sprint Planner</h4>
            <label>Team Capacity: <input type="number" id="capacityInput" value="40" min="1" style="width:80px;"> story points per sprint</label>
            <button id="generateSprintBtn" style="margin-left:10px;">Generate Sprint Plan</button>
            <div id="sprintPlanOutput" style="margin-top:15px;"></div>
        </div>

        <div id="jiraControls" style="margin-top:20px; border-top:1px solid var(--vscode-panel-border); padding-top:20px;">
            <div id="setupMsg">You need to connect Jira first. <button id="setupJiraBtn">Setup Jira</button></div>
            <div id="pushActions" style="display:none;">
                <button id="dryRunBtn">Dry Run Sync</button>
                <button id="pushJiraBtn">Push to Jira</button>
            </div>
            <button id="skipJiraBtn">Skip Jira & Continue to Code</button>
        </div>
    </div>

    <script nonce="${nonce}">
        console.log('[SDLCWebviewPanel] Script Loaded');
        const vscode = acquireVsCodeApi();
        
        let state = null;
        let isJiraAuth = false;

        console.log('[SDLCWebviewPanel] Posting load-state message');
        vscode.postMessage({ type: 'load-state' });

        window.addEventListener('message', e => {
            console.log('[SDLCWebviewPanel] Webview received message:', e.data);
            const msg = e.data;
            if (msg.type === 'state-loaded') {
                state = msg.state;
                showSection(state.currentPhase);
                if (state.debateMessages && state.debateMessages.length > 0) state.debateMessages.forEach(appendDebateMsg);
                if (state.prdDocument) renderPRD(state.prdDocument);
                if (state.epics && state.epics.length > 0) renderEpics(state.epics);
            } else if (msg.type === 'init-topic') {
                // Legacy path only: pre-fill topic input without auto-triggering debate
                const ti = document.getElementById('topicInput');
                if (ti) ti.value = msg.topic;
                showSection('TOPIC_INPUT');
            } else if (msg.type === 'phase-changed') {
                showSection(msg.phase);
            } else if (msg.type === 'debate-message') {
                document.getElementById('debateSpinner').style.display = msg.payload.type === 'consensus' ? 'none' : 'block';
                appendDebateMsg(msg.payload);
            } else if (msg.type === 'prd-ready') {
                renderPRD(msg.payload);
            } else if (msg.type === 'tasks-ready') {
                renderEpics(msg.payload);
                document.getElementById('sprintPlannerSection').style.display = 'block';
            } else if (msg.type === 'jira-status') {
                isJiraAuth = msg.isAuth;
                if(isJiraAuth) {
                    document.getElementById('setupMsg').style.display = 'none';
                    document.getElementById('pushActions').style.display = 'block';
                }
            } else if (msg.type === 'sync-update') {
                const p = document.getElementById('status-'+msg.payload.itemId);
                if(p) {
                    p.className = 'pill ' + msg.payload.syncStatus;
                    p.innerText = msg.payload.syncStatus.toUpperCase();
                }
            } else if (msg.type === 'sprintPlanReady') {
                renderSprintPlan(msg.payload);
            }
        });

        function showSection(id) {
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            if(id==='JIRA_PUSH') id = 'TASK_BREAKDOWN';
            if(id==='COMPLETE') return;
            const el = document.getElementById(id);
            if(el) el.classList.add('active');
        }

        function appendDebateMsg(m) {
            const d = document.createElement('div');
            const isSecurityAgent = m.agentId === 'security';
            d.className = 'chat-msg' + (isSecurityAgent ? ' security-agent' : '');
            const agentLabel = isSecurityAgent
                ? '<b style="color:#e74c3c">🔐 SECURITY (Round ' + m.round + '):</b>'
                : '<b>' + m.agentId.toUpperCase() + ' (Round ' + m.round + '):</b>';
            d.innerHTML = agentLabel + ' <br/> ' + m.content;
            document.getElementById('debateLog').appendChild(d);
        }

        function renderPRD(prd) {
            try {
                let html = '<h2>' + (prd.title || 'Product Requirements Document') + '</h2>';
                if (!prd.sections || !Array.isArray(prd.sections)) {
                    document.getElementById('prdContent').innerHTML = html + '<p>No valid sections output from AI.</p>';
                    return;
                }
                prd.sections.forEach(s => {
                    const sTitle = typeof s.title === 'string' ? s.title : 'Section';
                    const isSecSection = sTitle.toLowerCase().includes('security');
                    const cssClass = 'prd-section' + (isSecSection ? ' security-section' : '');
                    
                    let textContent = '';
                    if (typeof s.content === 'string') textContent = s.content;
                    else if (s.content) textContent = JSON.stringify(s.content);
                    
                    // Content: replace literal \\n and newlines with <br/>
                    const contentHtml = textContent
                        .replace(/\\\\n/g, '<br/>')
                        .replace(/\\n/g, '<br/>');
                    let flagsHtml = '';
                    if (s.complianceFlags && s.complianceFlags.length > 0) {
                        flagsHtml = '<div class="compliance-flags">';
                        s.complianceFlags.forEach(flag => {
                            let cls = 'flag-badge ';
                            if (flag.includes('GDPR')) cls += 'flag-gdpr';
                            else if (flag.includes('HIPAA')) cls += 'flag-hipaa';
                            else cls += 'flag-owasp';
                            flagsHtml += '<span class="' + cls + '">' + flag + '</span>';
                        });
                        flagsHtml += '</div>';
                    }
                    html += '<div class="' + cssClass + '"><h4>' + sTitle + '</h4><div>' + contentHtml + '</div>' + flagsHtml + '</div>';
                });
                document.getElementById('prdContent').innerHTML = html;
            } catch (err) {
                console.error('[Webview] Failed to render PRD:', err);
                document.getElementById('prdContent').innerHTML = '<div style="color:var(--destructive)">Failed to render PRD. See logs.</div>';
            }
        }

        function renderEpics(epics) {
            let html = '';
            epics.forEach(e => {
                let ag = e.assignedAgent ? ' <span style="color:#a855f7;font-size:10px;">[' + e.assignedAgent.toUpperCase() + ']</span>' : '';
                html += '<div><b>Epic:</b> ' + e.title + ag + ' <span class="pill ' + e.syncStatus + '" id="status-' + e.id + '">' + e.syncStatus.toUpperCase() + '</span></div>';
                e.stories.forEach(s => {
                    let sag = s.assignedAgent ? ' <span style="color:#a855f7;font-size:10px;">[' + s.assignedAgent.toUpperCase() + ']</span>' : '';
                    html += '<div style="margin-left:20px;"><b>Story:</b> ' + s.title + sag + '  <span class="pill ' + s.syncStatus + '" id="status-' + s.id + '">' + s.syncStatus.toUpperCase() + '</span></div>';
                    s.subtasks.forEach(st => {
                        let stag = st.assignedAgent ? ' <span style="color:#a855f7;font-size:10px;">[' + st.assignedAgent.toUpperCase() + ']</span>' : '';
                        html += '<div style="margin-left:40px;"><b>Subtask:</b> ' + st.title + stag + '  <span class="pill ' + st.syncStatus + '" id="status-' + st.id + '">' + st.syncStatus.toUpperCase() + '</span></div>';
                    });
                });
            });
            document.getElementById('epicsList').innerHTML = html;
        }

        function renderSprintPlan(plan) {
            let html = '<h4>Sprint Plan — ' + plan.sprints.length + ' sprints (' + plan.totalStoryPoints + ' SP total)</h4>';
            plan.sprints.forEach(sprint => {
                const pct = plan.capacityPerSprint > 0 ? Math.round((sprint.totalPoints / plan.capacityPerSprint) * 100) : 0;
                html += '<details style="margin-bottom:10px; border:1px solid var(--vscode-panel-border); border-radius:4px; padding:8px;">';
                html += '<summary style="cursor:pointer; font-weight:600;">' + sprint.name + ' — ' + sprint.totalPoints + '/' + plan.capacityPerSprint + ' SP';
                html += ' <span style="font-size:11px; opacity:0.7;">(' + pct + '%)</span></summary>';
                html += '<div style="margin-top:8px;">';
                sprint.stories.forEach(s => {
                    const isCritical = plan.criticalPath.includes(s.id);
                    const icon = isCritical ? '⚡ ' : '';
                    const pts = s.storyPoints !== undefined ? ' [' + s.storyPoints + ' SP]' : '';
                    html += '<div style="padding:4px 0; font-size:12px;">' + icon + s.title + '<span style="opacity:0.6;">' + pts + '</span></div>';
                });
                html += '</div></details>';
            });
            document.getElementById('sprintPlanOutput').innerHTML = html;
        }

        document.getElementById('generateSprintBtn').addEventListener('click', () => {
            const cap = parseInt(document.getElementById('capacityInput').value, 10) || 40;
            vscode.postMessage({ type: 'generateSprintPlan', capacity: cap });
        });
        document.getElementById('startDebateBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'start-debate', topic: document.getElementById('topicInput').value });
        });
        document.getElementById('approvePrdBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'approve-prd' });
        });
        document.getElementById('revisePrdBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'revise-prd', feedback: document.getElementById('revisionFeedback').value });
        });
        document.getElementById('setupJiraBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'open-jira-setup' });
        });
        document.getElementById('dryRunBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'push-jira', dryRun: true });
        });
        document.getElementById('pushJiraBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'push-jira', dryRun: false });
        });
        document.getElementById('skipJiraBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'complete-flow' });
        });
    </script>
</body>
</html>`;
    }
}
