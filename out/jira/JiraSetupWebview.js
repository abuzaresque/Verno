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
exports.JiraSetupWebview = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const JiraAuthService_1 = require("./JiraAuthService");
const JiraApiService_1 = require("./JiraApiService");
class JiraSetupWebview {
    static currentPanel;
    panel;
    context;
    logger;
    currentDomain = '';
    currentEmail = '';
    currentToken = '';
    constructor(panel, context, logger) {
        this.panel = panel;
        this.context = context;
        this.logger = logger;
        this.panel.webview.html = this.getHtml();
        this.panel.onDidDispose(() => this.dispose());
        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'validate':
                    await this.handleValidate(msg.domain, msg.email, msg.token);
                    break;
                case 'selectProject':
                    await this.handleSelectProject(msg.projectKey);
                    break;
            }
        });
    }
    static createOrShow(context, logger) {
        if (JiraSetupWebview.currentPanel) {
            JiraSetupWebview.currentPanel.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel('jiraSetup', 'Jira Setup', vscode.ViewColumn.One, { enableScripts: true });
        JiraSetupWebview.currentPanel = new JiraSetupWebview(panel, context, logger);
    }
    dispose() {
        JiraSetupWebview.currentPanel = undefined;
        this.panel.dispose();
    }
    async handleValidate(domain, email, token) {
        this.currentDomain = JiraAuthService_1.JiraAuthService.getInstance(this.context).formatDomain(domain);
        this.currentEmail = email;
        this.currentToken = token;
        const auth = JiraAuthService_1.JiraAuthService.getInstance(this.context);
        const isValid = await auth.validateCredentials({ domain: this.currentDomain, email, apiToken: token });
        if (!isValid) {
            this.panel.webview.postMessage({ type: 'validationResult', success: false, error: 'Authentication failed. Check your domain, email, and API token.' });
            return;
        }
        // Fetch projects
        try {
            const api = new JiraApiService_1.JiraApiService({ domain: this.currentDomain, email, apiToken: token }, this.logger);
            const projects = await api.listProjects();
            this.panel.webview.postMessage({ type: 'validationResult', success: true, projects });
        }
        catch (e) {
            this.panel.webview.postMessage({ type: 'validationResult', success: false, error: 'Failed to fetch projects: ' + e.message });
        }
    }
    async handleSelectProject(projectKey) {
        try {
            const api = new JiraApiService_1.JiraApiService({ domain: this.currentDomain, email: this.currentEmail, apiToken: this.currentToken }, this.logger);
            // JiraFieldValidator logic
            const issueTypes = await api.getIssueTypes(projectKey);
            const storyPointsFieldId = await api.discoverFields();
            const hasEpic = issueTypes.includes('Epic');
            const hasStory = issueTypes.includes('Story');
            if (!hasEpic || !hasStory) {
                this.panel.webview.postMessage({ type: 'setupComplete', success: false, error: `Project ${projectKey} is missing required issue types (Epic, Story). Found: ${issueTypes.join(', ')}` });
                return;
            }
            // Save credentials to secret store
            const auth = JiraAuthService_1.JiraAuthService.getInstance(this.context);
            await auth.saveCredentials({ domain: this.currentDomain, email: this.currentEmail, apiToken: this.currentToken });
            // Save config to .verno/jira-config.json
            const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (wsRoot) {
                const configPath = path.join(wsRoot, '.verno', 'jira-config.json');
                const vernoDir = path.dirname(configPath);
                if (!fs.existsSync(vernoDir))
                    fs.mkdirSync(vernoDir, { recursive: true });
                fs.writeFileSync(configPath, JSON.stringify({
                    projectKey,
                    issueTypes,
                    storyPointsFieldId
                }, null, 2), 'utf-8');
            }
            this.panel.webview.postMessage({ type: 'setupComplete', success: true });
            vscode.window.showInformationMessage(`Jira configured for project ${projectKey}`);
            setTimeout(() => this.dispose(), 1500);
        }
        catch (e) {
            this.panel.webview.postMessage({ type: 'setupComplete', success: false, error: 'Verification failed: ' + e.message });
        }
    }
    getHtml() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; max-width: 500px; margin: 0 auto; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: 600; }
        input, select { width: 100%; padding: 8px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
        button { padding: 10px 15px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; width: 100%; font-weight: bold; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .error { color: var(--vscode-errorForeground); margin-top: 10px; padding: 10px; border: 1px solid var(--vscode-errorForeground); display: none; }
        .success { color: #4caf50; margin-top: 10px; display: none; }
        #step2 { display: none; margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--vscode-panel-border); }
    </style>
</head>
<body>
    <h2>Jira Integration Setup</h2>
    
    <div id="step1">
        <p>Connect Verno to your Jira instance to auto-push SDLC tasks.</p>
        <div class="form-group">
            <label>Domain</label>
            <input type="text" id="domain" placeholder="your-company.atlassian.net" />
        </div>
        <div class="form-group">
            <label>Email</label>
            <input type="text" id="email" placeholder="you@company.com" />
        </div>
        <div class="form-group">
            <label>API Token</label>
            <input type="password" id="token" placeholder="Create at id.atlassian.com/manage-profile/security/api-tokens" />
        </div>
        <button id="validateBtn">Connect</button>
        <div id="authError" class="error"></div>
    </div>

    <div id="step2">
        <h3>Select Project</h3>
        <p>Choose the target project for your generated Epics and Stories.</p>
        <div class="form-group">
            <select id="projectSelect"></select>
        </div>
        <button id="saveBtn">Save & Verify</button>
        <div id="setupError" class="error"></div>
        <div id="setupSuccess" class="success">Jira configured successfully! You can close this tab.</div>
    </div>

    <script nonce="nonceValue">
        const vscode = acquireVsCodeApi();
        
        document.getElementById('validateBtn').addEventListener('click', () => {
            document.getElementById('authError').style.display = 'none';
            document.getElementById('validateBtn').textContent = 'Connecting...';
            document.getElementById('validateBtn').disabled = true;
            
            vscode.postMessage({
                type: 'validate',
                domain: document.getElementById('domain').value,
                email: document.getElementById('email').value,
                token: document.getElementById('token').value
            });
        });

        document.getElementById('saveBtn').addEventListener('click', () => {
            const pk = document.getElementById('projectSelect').value;
            if(!pk) return;
            document.getElementById('setupError').style.display = 'none';
            document.getElementById('saveBtn').textContent = 'Verifying...';
            document.getElementById('saveBtn').disabled = true;

            vscode.postMessage({ type: 'selectProject', projectKey: pk });
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'validationResult') {
                document.getElementById('validateBtn').textContent = 'Connect';
                document.getElementById('validateBtn').disabled = false;
                
                if (message.success) {
                    document.getElementById('step1').style.opacity = '0.5';
                    document.getElementById('step2').style.display = 'block';
                    
                    const select = document.getElementById('projectSelect');
                    select.innerHTML = '';
                    message.projects.forEach(p => {
                        const opt = document.createElement('option');
                        opt.value = p.key;
                        opt.textContent = p.name + ' (' + p.key + ')';
                        select.appendChild(opt);
                    });
                } else {
                    document.getElementById('authError').textContent = message.error;
                    document.getElementById('authError').style.display = 'block';
                }
            } else if (message.type === 'setupComplete') {
                document.getElementById('saveBtn').textContent = 'Save & Verify';
                document.getElementById('saveBtn').disabled = false;

                if (message.success) {
                    document.getElementById('setupSuccess').style.display = 'block';
                    document.getElementById('saveBtn').style.display = 'none';
                } else {
                    document.getElementById('setupError').textContent = message.error;
                    document.getElementById('setupError').style.display = 'block';
                }
            }
        });
    </script>
</body>
</html>`;
    }
}
exports.JiraSetupWebview = JiraSetupWebview;
//# sourceMappingURL=JiraSetupWebview.js.map