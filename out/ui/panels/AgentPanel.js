"use strict";
/**
 * VS Code sidebar panel for agent status
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
exports.AgentPanel = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class AgentPanel {
    context;
    webviewView;
    conversationHistory = [];
    coverageInterval;
    lastCoveragePct = -1;
    constructor(context) {
        this.context = context;
        this.startCoveragePolling();
    }
    startCoveragePolling() {
        this.coverageInterval = setInterval(() => this.checkCoverage(), 5000);
    }
    checkCoverage() {
        try {
            const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!wsPath)
                return;
            const summaryPath = path.join(wsPath, 'coverage', 'coverage-summary.json');
            if (fs.existsSync(summaryPath)) {
                const data = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
                const pct = data?.total?.lines?.pct || (data?.total?.statements?.pct);
                if (typeof pct === 'number' && pct !== this.lastCoveragePct) {
                    this.lastCoveragePct = pct;
                    this.updateCoverage(pct);
                }
            }
        }
        catch (e) {
            // quiet fail
        }
    }
    /**
     * Set the webview view from the sidebar provider
     */
    setWebviewView(webviewView) {
        this.webviewView = webviewView;
    }
    /**
     * Send a message to the sidebar webview
     */
    postMessage(message) {
        if (this.webviewView) {
            this.webviewView.webview.postMessage(message);
        }
    }
    /**
     * Notify that recording has started
     */
    notifyRecordingStarted() {
        this.postMessage({ type: 'recordingStarted' });
    }
    /**
     * Notify that recording has stopped
     */
    notifyRecordingStopped() {
        this.postMessage({ type: 'recordingStopped' });
    }
    /**
     * Notify that processing has started
     */
    notifyProcessingStarted() {
        this.postMessage({ type: 'processingStarted' });
    }
    /**
     * Notify that processing is complete
     */
    notifyProcessingComplete() {
        this.postMessage({ type: 'processingComplete' });
    }
    /**
     * Update agent status (legacy method for compatibility)
     */
    updateStatus(agentName, status) {
        // Status updates are handled through notification methods
    }
    /**
     * Display conversation history
     */
    displayConversation(messages) {
        this.conversationHistory = messages;
        this.postMessage({
            type: 'conversationHistory',
            messages: messages
        });
    }
    /**
     * Add a new message to conversation
     */
    /**
     * Add a new message to conversation
     * @param silent If true, adds to history but does not send to webview (prevents double echo)
     */
    addMessage(role, content, options) {
        const message = {
            role,
            content,
            timestamp: new Date().toISOString()
        };
        this.conversationHistory.push(message);
        if (!options?.silent) {
            this.postMessage({
                type: 'newMessage',
                message
            });
        }
    }
    /**
     * Show thinking indicator
     */
    showThinking(show) {
        this.postMessage({
            type: 'thinking',
            show
        });
    }
    /**
     * Clear conversation
     */
    clearConversation() {
        this.conversationHistory = [];
        this.postMessage({ type: 'clearConversation' });
    }
    /**
     * Send context usage update
     */
    updateContextUsage(used, total) {
        this.postMessage({
            type: 'contextUsage',
            used,
            total
        });
    }
    /**
     * Send coverage update to the sidebar badge
     */
    updateCoverage(percentage) {
        this.postMessage({
            type: 'coverageUpdate',
            percentage
        });
    }
}
exports.AgentPanel = AgentPanel;
//# sourceMappingURL=AgentPanel.js.map