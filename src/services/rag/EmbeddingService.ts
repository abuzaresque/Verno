
export class EmbeddingService {
    private extractor: any = null;
    private isInitializing = false;
    private initPromise: Promise<void> | null = null;
    /** True when @xenova/transformers failed to load (e.g. sharp native binary missing). */
    private unavailable = false;

    async initialize() {
        // Already initialized, already failed, or already in-flight
        if (this.extractor || this.unavailable) { return; }
        if (this.initPromise) { return this.initPromise; }

        this.isInitializing = true;
        this.initPromise = (async () => {
            try {
                // Use Xenova's generic feature extraction pipeline for embeddings
                // 'Xenova/all-MiniLM-L6-v2' is a lightweight embedding model
                const { pipeline } = await import('@xenova/transformers');
                this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                    quantized: true, // Use quantized model to save memory/speed
                });
            } catch (err: any) {
                // @xenova/transformers requires the 'sharp' native module for image ops.
                // On Windows, 'sharp' may not have pre-built binaries available, causing a
                // hard crash here. We catch it and mark the service as unavailable so the
                // RAG pipeline degrades gracefully instead of crashing the Developer Agent.
                console.warn(
                    `[EmbeddingService] @xenova/transformers failed to load — ` +
                    `native module (sharp) likely missing on this platform. ` +
                    `RAG semantic context will be disabled. Error: ${err?.message ?? err}`
                );
                this.unavailable = true;
            } finally {
                this.isInitializing = false;
            }
        })();

        await this.initPromise;
    }

    async generateEmbedding(text: string): Promise<number[]> {
        await this.initialize();

        // If the embedding model is unavailable (native module failure), return an empty
        // vector — callers must handle an empty array as "no embedding available".
        if (this.unavailable || !this.extractor) { return []; }

        // Generate output. Output is a tensor.
        const output = await this.extractor(text, { pooling: 'mean', normalize: true });

        // Convert tensor to regular number array
        return Array.from(output.data);
    }

    /** Whether the embedding service is functional (false when sharp is missing). */
    get isAvailable(): boolean {
        return !this.unavailable && this.extractor !== null;
    }
}
