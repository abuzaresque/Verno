/**
 * Lightweight token budget manager.
 * Fresh instance per getContext() call to avoid leaking state between requests.
 */
export class TokenBudget {
    private maxTokens: number;
    private consumed: number = 0;

    constructor(maxTokens: number = 12000) {
        this.maxTokens = maxTokens;
    }

    /** Estimate token count: ~3.5 chars per token for code */
    static estimateTokens(text: string): number {
        return Math.ceil(text.length / 3.5);
    }

    /** Can we fit this text within our remaining budget? */
    canFit(text: string): boolean {
        return this.remaining() >= TokenBudget.estimateTokens(text);
    }

    /** Consume budget for a piece of text. Returns true if it fit, false if truncated. */
    consume(text: string): boolean {
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
    remaining(): number {
        return Math.max(0, this.maxTokens - this.consumed);
    }

    /** Reset budget (use if reusing instance, though fresh-per-call is preferred) */
    reset(): void {
        this.consumed = 0;
    }
}
