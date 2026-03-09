
export class EmbeddingService {
    private extractor: any = null;
    private isInitializing = false;
    private initPromise: Promise<void> | null = null;

    async initialize() {
        if (this.extractor) return;
        if (this.initPromise) return this.initPromise;

        this.isInitializing = true;
        this.initPromise = (async () => {
            // Use Xenova's generic feature extraction pipeline for embeddings
            // 'Xenova/all-MiniLM-L6-v2' is a lightweight embedding model
            const { pipeline } = await import('@xenova/transformers');
            this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                quantized: true, // Use quantized model to save memory/speed
            });
            this.isInitializing = false;
        })();

        await this.initPromise;
    }

    async generateEmbedding(text: string): Promise<number[]> {
        await this.initialize();

        // Generate output. Output is a tensor.
        const output = await this.extractor(text, { pooling: 'mean', normalize: true });

        // Convert tensor to regular number array
        return Array.from(output.data);
    }
}
