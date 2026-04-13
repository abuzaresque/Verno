"use strict";
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
exports.SDLCWebviewPanel = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const DebateOrchestrator_1 = require("../agents/DebateOrchestrator");
const JiraAuthService_1 = require("../jira/JiraAuthService");
const JiraSetupWebview_1 = require("../jira/JiraSetupWebview");
const JiraSyncService_1 = require("../jira/JiraSyncService");
class SDLCWebviewPanel {
    static currentPanel;
    panel;
    context;
    logger;
    llmService;
    state = {
        currentPhase: 'TOPIC_INPUT',
        topic: '',
        debateMessages: [],
        prdDocument: null,
        epics: []
    };
    debateOrchestrator;
    constructor(panel, context, logger, llmService) {
        this.panel = panel;
        this.context = context;
        this.logger = logger;
        this.llmService = llmService;
        this.debateOrchestrator = new DebateOrchestrator_1.DebateOrchestrator(llmService, logger);
        this.panel.onDidDispose(() => this.dispose());
        this.panel.webview.onDidReceiveMessage(async (msg) => {
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
                    JiraSetupWebview_1.JiraSetupWebview.createOrShow(this.context, this.logger);
                    break;
            }
        });
    }
    static createOrShow(context, logger, llmService, topic) {
        if (SDLCWebviewPanel.currentPanel) {
            SDLCWebviewPanel.currentPanel.panel.reveal();
            if (topic) {
                SDLCWebviewPanel.currentPanel.panel.webview.postMessage({ type: 'init-topic', topic });
            }
            return;
        }
        const panel = vscode.window.createWebviewPanel('sdlcFlow', 'Verno SDLC Orchestrator', vscode.ViewColumn.One, { enableScripts: true });
        SDLCWebviewPanel.currentPanel = new SDLCWebviewPanel(panel, context, logger, llmService);
        SDLCWebviewPanel.currentPanel.panel.webview.html = SDLCWebviewPanel.currentPanel.getHtml();
        if (topic) {
            setTimeout(() => {
                SDLCWebviewPanel.currentPanel?.panel.webview.postMessage({ type: 'init-topic', topic });
            }, 500);
        }
    }
    dispose() {
        SDLCWebviewPanel.currentPanel = undefined;
        this.panel.dispose();
    }
    setPhase(phase) {
        this.state.currentPhase = phase;
        this.saveState();
        this.panel.webview.postMessage({ type: 'phase-changed', phase });
    }
    getWorkspaceRoot() {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }
    saveState() {
        const root = this.getWorkspaceRoot();
        if (!root)
            return;
        const dir = path.join(root, '.verno');
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'sdlc-state.json'), JSON.stringify(this.state, null, 2), 'utf-8');
    }
    loadState() {
        const root = this.getWorkspaceRoot();
        if (!root)
            return;
        const p = path.join(root, '.verno', 'sdlc-state.json');
        if (fs.existsSync(p)) {
            try {
                this.state = JSON.parse(fs.readFileSync(p, 'utf-8'));
                this.panel.webview.postMessage({ type: 'state-loaded', state: this.state });
            }
            catch (e) { }
        }
    }
    async runDebateFlow(feedback) {
        const topic = feedback ? `Feedback on previous PRD: ${feedback}` : this.state.topic;
        const prd = await this.debateOrchestrator.runDebate(topic, (msg) => {
            this.state.debateMessages.push(msg);
            this.saveState();
            this.panel.webview.postMessage({ type: 'debate-message', payload: msg });
        });
        this.state.prdDocument = prd;
        this.setPhase('PRD_REVIEW');
        this.panel.webview.postMessage({ type: 'prd-ready', payload: prd });
    }
    async decomposePRD() {
        if (!this.state.prdDocument)
            return;
        this.logger.info('Decomposing PRD into Epics and Stories...');
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
        let result = await this.llmService.generateText(prompt);
        result = result.replace(/```json/g, '').replace(/```/g, '').trim();
        try {
            this.state.epics = JSON.parse(result);
            const root = this.getWorkspaceRoot();
            if (root) {
                fs.writeFileSync(path.join(root, '.verno', 'tasks.md'), `<h1>Generated Tasks</h1><pre>${JSON.stringify(this.state.epics, null, 2)}</pre>`, 'utf-8');
            }
            this.saveState();
            this.panel.webview.postMessage({ type: 'tasks-ready', payload: this.state.epics });
            const isAuth = await JiraAuthService_1.JiraAuthService.getInstance(this.context).isAuthenticated();
            this.panel.webview.postMessage({ type: 'jira-status', isAuth });
        }
        catch (e) {
            this.logger.error('Failed to decompose PRD: ' + e);
            vscode.window.showErrorMessage('Decomposition failed. See logs.');
        }
    }
    async pushToJira(dryRun) {
        const auth = JiraAuthService_1.JiraAuthService.getInstance(this.context);
        const creds = await auth.getCredentials();
        if (!creds) {
            vscode.window.showErrorMessage('Jira credentials not found.');
            return;
        }
        const root = this.getWorkspaceRoot();
        if (!root)
            return;
        let config = {};
        try {
            config = JSON.parse(fs.readFileSync(path.join(root, '.verno', 'jira-config.json'), 'utf-8'));
        }
        catch (e) {
            vscode.window.showErrorMessage('Jira config missing. Run Jira Setup first.');
            return;
        }
        const syncService = new JiraSyncService_1.JiraSyncService(this.logger);
        await syncService.syncEpics(this.state.epics, creds, config.projectKey, { storyPointsFieldId: config.storyPointsFieldId }, config.issueTypes, (itemId, status) => {
            this.panel.webview.postMessage({ type: 'sync-update', payload: { itemId, syncStatus: status } });
        }, dryRun);
        this.saveState();
    }
    getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
    getHtml() {
        const nonce = this.getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <style>
        body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-foreground); padding: 20px; }
        .section { display: none; margin-bottom: 30px; }
        .active { display: block; }
        .chat-msg { margin: 10px 0; padding: 10px; border-radius: 5px; background: var(--vscode-textBlockQuote-background); }
        .chat-msg b { color: var(--vscode-textLink-foreground); }
        button { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; margin-right: 10px; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        textarea, input { width: 100%; padding: 8px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); margin-bottom: 15px; }
        .prd-section { margin-bottom: 20px; }
        .pill { display: inline-block; padding: 2px 6px; font-size: 10px; border-radius: 10px; background: #666; color: #fff; margin-left: 10px; }
        .pill.pending { background: #f39c12; }
        .pill.pushed { background: #2ecc71; }
        .pill.failed { background: #e74c3c; }
    </style>
</head>
<body>
    <h1>SDLC Orchestrator</h1>

    <!-- PRE-LOAD Check -->
    <div id="loading" class="section active">Loading state...</div>

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
        const vscode = acquireVsCodeApi();
        
        let state = null;
        let isJiraAuth = false;

        vscode.postMessage({ type: 'load-state' });

        window.addEventListener('message', e => {
            const msg = e.data;
            if (msg.type === 'state-loaded') {
                state = msg.state;
                if (state.currentPhase !== 'TOPIC_INPUT') {
                    showSection(state.currentPhase);
                    if (state.debateMessages) state.debateMessages.forEach(appendDebateMsg);
                    if (state.prdDocument) renderPRD(state.prdDocument);
                    if (state.epics && state.epics.length>0) renderEpics(state.epics);
                } else {
                    showSection('TOPIC_INPUT');
                }
            } else if (msg.type === 'init-topic') {
                document.getElementById('topicInput').value = msg.topic;
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
            d.className = 'chat-msg';
            d.innerHTML = '<b>' + m.agentId.toUpperCase() + ' (Round ' + m.round + '):</b> <br/> ' + m.content;
            document.getElementById('debateLog').appendChild(d);
        }

        function renderPRD(prd) {
            let html = '<h2>' + prd.title + '</h2>';
            prd.sections.forEach(s => {
                html += '<div class="prd-section"><h4>' + s.title + '</h4><div>' + s.content.replace(/\\n/g, '<br/>') + '</div></div>';
            });
            document.getElementById('prdContent').innerHTML = html;
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
exports.SDLCWebviewPanel = SDLCWebviewPanel;
//# sourceMappingURL=SDLCWebviewPanel.js.map