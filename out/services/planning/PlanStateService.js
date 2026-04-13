"use strict";
/**
 * Plan State Service: Persists execution plan state between PLAN and CODE phases.
 * Stores plan, agent outputs, and pending/completed step lists.
 * Supports timestamped backups of previous plans.
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
exports.PlanStateService = exports.CODING_PHASE_AGENTS = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** Agents that belong to the CODE phase (deferred during PLAN) */
exports.CODING_PHASE_AGENTS = new Set([
    'developer',
    'codereview',
    'qa',
    'techwriter',
    'testGenerator',
]);
/**
 * Service for managing plan state persistence between PLAN and CODE phases
 */
class PlanStateService {
    workspaceRoot;
    planStateDir;
    planStatePath;
    backupDir;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.planStateDir = path.join(workspaceRoot, '.verno', 'plan-state');
        this.planStatePath = path.join(this.planStateDir, 'plan.json');
        this.backupDir = path.join(this.planStateDir, 'history');
        this.ensureDirectoryExists();
    }
    /**
     * Save plan state to disk (backs up existing state first)
     */
    savePlanState(state) {
        // Backup existing plan before overwriting
        this.backupPlanState();
        state.updatedAt = Date.now();
        fs.writeFileSync(this.planStatePath, JSON.stringify(state, null, 2), 'utf-8');
    }
    /**
     * Load plan state from disk
     */
    loadPlanState() {
        if (!fs.existsSync(this.planStatePath)) {
            return null;
        }
        try {
            const data = fs.readFileSync(this.planStatePath, 'utf-8');
            return JSON.parse(data);
        }
        catch {
            return null;
        }
    }
    /**
     * Check if there are pending coding-phase steps
     */
    hasPendingCodingSteps() {
        const state = this.loadPlanState();
        if (!state) {
            return false;
        }
        return state.pendingSteps.some(id => exports.CODING_PHASE_AGENTS.has(id));
    }
    /**
     * Get all pending steps (coding-phase agents)
     */
    getPendingSteps() {
        const state = this.loadPlanState();
        if (!state) {
            return [];
        }
        return state.plan.steps.filter(s => state.pendingSteps.includes(s.agentId));
    }
    /**
     * Get completed agent outputs
     */
    getAgentOutputs() {
        const state = this.loadPlanState();
        if (!state) {
            return {};
        }
        return state.agentOutputs;
    }
    /**
     * Mark a step as complete and store its output
     */
    markStepComplete(agentId, output) {
        const state = this.loadPlanState();
        if (!state) {
            return;
        }
        state.agentOutputs[agentId] = output;
        state.completedSteps = [...new Set([...state.completedSteps, agentId])];
        state.pendingSteps = state.pendingSteps.filter(id => id !== agentId);
        state.updatedAt = Date.now();
        fs.writeFileSync(this.planStatePath, JSON.stringify(state, null, 2), 'utf-8');
    }
    /**
     * Create an initial plan state from a generated plan
     */
    createFromPlan(plan, userRequest, conversationId) {
        const allAgentIds = plan.steps.map(s => s.agentId);
        const state = {
            plan,
            agentOutputs: {},
            completedSteps: [],
            pendingSteps: allAgentIds,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            userRequest,
            conversationId,
        };
        return state;
    }
    /**
     * Check if a plan state exists on disk
     */
    hasPlanState() {
        return fs.existsSync(this.planStatePath);
    }
    /**
     * Clear the current plan state
     */
    clearPlanState() {
        this.backupPlanState();
        if (fs.existsSync(this.planStatePath)) {
            fs.unlinkSync(this.planStatePath);
        }
    }
    /**
     * Backup the current plan state with a timestamp
     */
    backupPlanState() {
        if (!fs.existsSync(this.planStatePath)) {
            return;
        }
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
        try {
            const data = fs.readFileSync(this.planStatePath, 'utf-8');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(this.backupDir, `plan-${timestamp}.json`);
            fs.writeFileSync(backupPath, data, 'utf-8');
        }
        catch {
            // Silently ignore backup errors
        }
    }
    /**
     * Get list of backup plans (most recent first)
     */
    getBackupPlans() {
        if (!fs.existsSync(this.backupDir)) {
            return [];
        }
        return fs.readdirSync(this.backupDir)
            .filter(f => f.endsWith('.json'))
            .sort()
            .reverse()
            .map(f => ({
            path: path.join(this.backupDir, f),
            timestamp: f.replace('plan-', '').replace('.json', ''),
        }));
    }
    /**
     * Ensure plan state directory exists
     */
    ensureDirectoryExists() {
        if (!fs.existsSync(this.planStateDir)) {
            fs.mkdirSync(this.planStateDir, { recursive: true });
        }
    }
}
exports.PlanStateService = PlanStateService;
//# sourceMappingURL=PlanStateService.js.map