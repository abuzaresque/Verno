/**
 * VS Code sidebar panel for agent status
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export class AgentPanel {
  private webviewView?: vscode.WebviewView;
  private conversationHistory: ConversationMessage[] = [];
  private coverageInterval?: any;
  private lastCoveragePct: number = -1;

  constructor(private context: vscode.ExtensionContext) { 
    this.startCoveragePolling();
  }

  private startCoveragePolling() {
    this.coverageInterval = setInterval(() => this.checkCoverage(), 5000);
  }

  private checkCoverage() {
    try {
      const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!wsPath) return;
      const summaryPath = path.join(wsPath, 'coverage', 'coverage-summary.json');
      if (fs.existsSync(summaryPath)) {
        const data = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
        const pct = data?.total?.lines?.pct || (data?.total?.statements?.pct);
        if (typeof pct === 'number' && pct !== this.lastCoveragePct) {
          this.lastCoveragePct = pct;
          this.updateCoverage(pct);
        }
      }
    } catch (e) {
      // quiet fail
    }
  }

  /**
   * Set the webview view from the sidebar provider
   */
  setWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
  }

  /**
   * Send a message to the sidebar webview
   */
  postMessage(message: any): void {
    if (this.webviewView) {
      this.webviewView.webview.postMessage(message);
    }
  }

  /**
   * Notify that recording has started
   */
  notifyRecordingStarted(): void {
    this.postMessage({ type: 'recordingStarted' });
  }

  /**
   * Notify that recording has stopped
   */
  notifyRecordingStopped(): void {
    this.postMessage({ type: 'recordingStopped' });
  }

  /**
   * Notify that processing has started
   */
  notifyProcessingStarted(): void {
    this.postMessage({ type: 'processingStarted' });
  }

  /**
   * Notify that processing is complete
   */
  notifyProcessingComplete(): void {
    this.postMessage({ type: 'processingComplete' });
  }

  /**
   * Update agent status (legacy method for compatibility)
   */
  updateStatus(agentName: string, status: string): void {
    // Status updates are handled through notification methods
  }

  /**
   * Display conversation history
   */
  displayConversation(messages: ConversationMessage[]) {
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
  addMessage(role: 'user' | 'assistant' | 'system', content: string, options?: { silent?: boolean }) {
    const message: ConversationMessage = {
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
  showThinking(show: boolean) {
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
  updateContextUsage(used: number, total: number) {
    this.postMessage({
      type: 'contextUsage',
      used,
      total
    });
  }

  /**
   * Send coverage update to the sidebar badge
   */
  updateCoverage(percentage: number) {
    this.postMessage({
      type: 'coverageUpdate',
      percentage
    });
  }
}
