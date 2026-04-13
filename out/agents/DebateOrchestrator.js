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
exports.DebateOrchestrator = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class DebateOrchestrator {
    llmService;
    logger;
    constructor(llmService, logger) {
        this.llmService = llmService;
        this.logger = logger;
    }
    getWorkspaceRoot() {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }
    async runDebate(topic, onMessage, previousMessages = []) {
        this.logger.info(`Starting debate on topic: ${topic}`);
        const agents = [
            { id: 'analyst', role: 'Business Analyst (Focus on business requirements, KPIs, and user value)' },
            { id: 'architect', role: 'System Architect (Focus on backend scalability, data models, and API design)' },
            { id: 'ux', role: 'UX Designer (Focus on user flows, interfaces, and accessibility)' },
            { id: 'developer', role: 'Developer (Focus on code structure, technical feasibility, and components)' },
            { id: 'pm', role: 'Product Manager (Focus on scope, milestones, and prioritization)' },
            { id: 'qa', role: 'QA Engineer (Focus on edge cases, testability, and test plans)' },
            { id: 'techwriter', role: 'Technical Writer (Focus on documentation, readability, and API references)' }
        ];
        let history = [...previousMessages];
        const numRounds = 3;
        for (let round = 1; round <= numRounds; round++) {
            this.logger.info(`--- Debate Round ${round} ---`);
            for (const agent of agents) {
                const prompt = this.buildPrompt(topic, agent.role, history, round);
                const response = await this.llmService.generateText(prompt);
                const msg = {
                    agentId: agent.id,
                    content: response.trim(),
                    round: round,
                    timestamp: Date.now(),
                    type: (round === 1) ? 'argument' : 'counter'
                };
                history.push(msg);
                onMessage(msg);
            }
        }
        this.logger.info(`--- Convergence / Consensus ---`);
        const pmAgent = agents.find(a => a.id === 'pm');
        const convergencePrompt = `You are the ${pmAgent.role}. The 3-round debate among the 7 BMAD agents has concluded.
Original Topic: ${topic}
Here is the full debate transcript:
${history.map(m => `[${m.agentId.toUpperCase()}]: ${m.content}`).join('\n\n')}

Your internal task is to synthesize the debate into a single executive consensus summary. Resolve disagreements. If full consensus was not naturally reached, make a final executive decision and document the trade-offs. This will be the foundation for the PRD. Keep it concise but authoritative.`;
        const convergenceResponse = await this.llmService.generateText(convergencePrompt);
        const convergenceMsg = {
            agentId: 'analyst',
            content: convergenceResponse.trim(),
            round: numRounds + 1,
            timestamp: Date.now(),
            type: 'consensus'
        };
        history.push(convergenceMsg);
        onMessage(convergenceMsg);
        this.logger.info(`--- Generating PRD ---`);
        const prdPrompt = `You are a Technical Product Manager. Based on the following debate and executive summary, generate a formal Product Requirements Document (PRD).
Original Topic: ${topic}

Debate History & Summary:
${history.map(m => `[${m.agentId.toUpperCase()}]: ${m.content}`).join('\n\n')}

Respond ONLY with valid JSON matching this exact array of sections layout:
[
  { "title": "Overview", "content": "..." },
  { "title": "Problem Statement", "content": "..." },
  { "title": "Goals & Non-Goals", "content": "..." },
  { "title": "User Stories", "content": "..." },
  { "title": "Technical Specifications", "content": "..." },
  { "title": "Acceptance Criteria", "content": "..." },
  { "title": "Risks & Mitigations", "content": "..." }
]
Ensure the content uses markdown formatting where appropriate.`;
        let prdJson = await this.llmService.generateText(prdPrompt);
        // Clean markdown fencing if present
        prdJson = prdJson.replace(/```json/g, '').replace(/```/g, '').trim();
        let sections = [];
        try {
            sections = JSON.parse(prdJson);
        }
        catch (e) {
            this.logger.error(`Failed to parse PRD JSON: ${e}`);
            // Fallback section
            sections = [{ title: "Overview and Synthesis", content: convergenceResponse }];
        }
        const prdDocument = {
            title: `PRD: ${topic.substring(0, 50)}...`,
            sections: sections,
            status: 'draft'
        };
        this.writePRDToFile(prdDocument);
        return prdDocument;
    }
    buildPrompt(topic, role, history, round) {
        let historyText = history.length === 0 ? "No prior messages." : history.map(m => `[${m.agentId.toUpperCase()}]: ${m.content}`).join('\n\n');
        return `You are acting as the ${role} in a team debate about the following feature/project:
Topic: ${topic}

Here is the debate history so far:
${historyText}

This is Round ${round}.
If Round 1: State your initial technical/product perspective, identifying key priorities and potential challenges from your domain's perspective.
If Round > 1: Respond to your colleagues' points. Defend your domain's needs, suggest compromises, or highlight flaws in their proposals.

Keep your response under 150 words. Be direct, professional, and firmly represent your specific role's priorities.`;
    }
    writePRDToFile(prd) {
        const root = this.getWorkspaceRoot();
        if (!root)
            return;
        const dir = path.join(root, '.verno');
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, 'PRD.md');
        let md = `# ${prd.title}\n\n`;
        md += `Status: **${prd.status.toUpperCase()}**\n\n`;
        for (const section of prd.sections) {
            md += `## ${section.title}\n${section.content}\n\n`;
        }
        fs.writeFileSync(filePath, md, 'utf-8');
        this.logger.info(`PRD written to ${filePath}`);
    }
}
exports.DebateOrchestrator = DebateOrchestrator;
//# sourceMappingURL=DebateOrchestrator.js.map