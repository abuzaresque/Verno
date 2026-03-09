"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenBudget = void 0;
/**
 * Lightweight token budget manager.
 * Fresh instance per getContext() call to avoid leaking state between requests.
 */
class TokenBudget {
    maxTokens;
    consumed = 0;
    constructor(maxTokens = 12000) {
        this.maxTokens = maxTokens;
    }
    /** Estimate token count: ~3.5 chars per token for code */
    static estimateTokens(text) {
        return Math.ceil(text.length / 3.5);
    }
    /** Can we fit this text within our remaining budget? */
    canFit(text) {
        return this.remaining() >= TokenBudget.estimateTokens(text);
    }
    /** Consume budget for a piece of text. Returns true if it fit, false if truncated. */
    consume(text) {
        const tokens = TokenBudget.estimateTokens(text);
        if (tokens <= this.remaining()) {
            this.consumed += tokens;
            return true;
        }
        // Partial consume — caller must handle truncation
        this.consumed = this.maxTokens;
        return false;
    }
    /** Remaining token budget */
    remaining() {
        return Math.max(0, this.maxTokens - this.consumed);
    }
    /** Reset budget (use if reusing instance, though fresh-per-call is preferred) */
    reset() {
        this.consumed = 0;
    }
}
exports.TokenBudget = TokenBudget;
//# sourceMappingURL=TokenBudget.js.map