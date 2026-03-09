import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { VectorStore, VectorDocument } from './VectorStore';
import { EmbeddingService } from './EmbeddingService';
import { SymbolChunker, SymbolChunk } from './SymbolChunker';

export class IndexingService {
    private vectorStore: VectorStore;
    private embeddingService: EmbeddingService;
    private symbolChunker: SymbolChunker;
    private isIndexing: boolean = false;
    private hasIndexed: boolean = false;
    private lastIndexedAt: number = 0;

    // Fix 4: Persisted file hashes to avoid re-embedding unchanged files
    private fileHashes: Map<string, string> = new Map();
    private hashCachePath: string = '';

    // Fix 6: Dirty file tracking for incremental re-indexing
    private dirtyFiles: Set<string> = new Set();

    constructor(vectorStore: VectorStore, embeddingService: EmbeddingService, symbolChunker: SymbolChunker, workspaceRoot: string) {
        this.vectorStore = vectorStore;
        this.embeddingService = embeddingService;
        this.symbolChunker = symbolChunker;

        // Persist hashes to .verno/ for cross-restart stability
        const vernoDir = path.join(workspaceRoot, '.verno');
        if (!fs.existsSync(vernoDir)) {
            fs.mkdirSync(vernoDir, { recursive: true });
        }
        this.hashCachePath = path.join(vernoDir, 'index-hashes.json');
        this.loadHashCache();
    }

    /** Fix 6: Mark a file as dirty (call this on file save from VS Code watcher) */
    markDirty(filePath: string): void {
        this.dirtyFiles.add(filePath);
    }

    /** Public getter so ContextEngine can check if index is available */
    get indexReady(): boolean {
        return this.hasIndexed;
    }

    /** Public getter so ContextEngine can note stale context */
    get currentlyIndexing(): boolean {
        return this.isIndexing;
    }

    /**
     * Full workspace index — lazy on first request.
     * Subsequent calls only re-index dirty files (incremental).
     */
    async indexWorkspace(workspaceRoot: string, logger: any): Promise<void> {
        if (this.isIndexing) return;

        // If already indexed, only re-index dirty files (async, non-blocking)
        if (this.hasIndexed) {
            if (this.dirtyFiles.size > 0) {
                this.isIndexing = true;
                const filesToReindex = [...this.dirtyFiles];
                this.dirtyFiles.clear();
                try {
                    await this.indexFiles(filesToReindex, workspaceRoot, logger);
                } finally {
                    this.isIndexing = false;
                    this.lastIndexedAt = Date.now();
                }
            }
            return;
        }

        // First-time full index
        this.isIndexing = true;
        try {
            logger.log('Starting workspace RAG indexing...');
            await this.embeddingService.initialize();

            const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.css', '.html', '.md']);
            const ignoreDirs = new Set(['node_modules', '.git', '.vscode', 'out', 'dist', 'build', '.verno', '.next', 'coverage']);

            const files: string[] = [];
            const scan = (dir: string) => {
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (ignoreDirs.has(entry.name)) continue;
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            scan(fullPath);
                        } else if (entry.isFile()) {
                            const ext = path.extname(entry.name);
                            if (codeExtensions.has(ext)) {
                                files.push(fullPath);
                            }
                        }
                    }
                } catch {
                    // ignore unreadable
                }
            };

            scan(workspaceRoot);
            logger.log(`Found ${files.length} files to index.`);

            // Fix 4: Clean up vectors for files that no longer exist on disk
            const existingPaths = new Set(files);
            for (const cachedPath of this.fileHashes.keys()) {
                if (!existingPaths.has(cachedPath)) {
                    this.vectorStore.deleteByFilePath(cachedPath);
                    this.fileHashes.delete(cachedPath);
                    logger.log(`Cleaned up stale vectors for deleted file: ${cachedPath}`);
                }
            }

            await this.indexFiles(files, workspaceRoot, logger);
            this.hasIndexed = true;
            this.lastIndexedAt = Date.now();
            this.saveHashCache();
            logger.log(`Indexing complete. ${this.vectorStore.getDocumentCount()} chunks stored.`);
        } finally {
            this.isIndexing = false;
        }
    }

    /** Index a list of files, skipping unchanged ones (hash check) */
    private async indexFiles(files: string[], workspaceRoot: string, logger: any): Promise<void> {
        for (const filePath of files) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                if (content.length > 500000) continue; // skip huge files

                // Fix 4: Hash check — skip if unchanged
                const hash = crypto.createHash('sha256').update(content).digest('hex');
                if (this.fileHashes.get(filePath) === hash) {
                    continue; // File unchanged, skip re-embedding
                }

                // Clear old vectors for this file
                this.vectorStore.deleteByFilePath(filePath);

                // Fix 5: Symbol-level chunking via tree-sitter
                const chunks = await this.symbolChunker.extractSymbols(content, filePath);
                const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');

                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    const embedding = await this.embeddingService.generateEmbedding(chunk.content);

                    const doc: VectorDocument = {
                        id: `${relativePath}#${chunk.symbolName}#${i}`,
                        filePath,
                        content: `FILE: ${relativePath} | ${chunk.symbolType}: ${chunk.symbolName} (L${chunk.startLine}-L${chunk.endLine})\n${chunk.content}`,
                        embedding,
                        hash,
                        symbolName: chunk.symbolName,
                        symbolType: chunk.symbolType,
                    };

                    this.vectorStore.upsert(doc);
                }

                // Update hash cache
                this.fileHashes.set(filePath, hash);
            } catch (err) {
                logger.log(`Failed to index file ${filePath}: ${err}`, 'warn');
            }
        }

        this.saveHashCache();
    }

    /** Retrieve relevant chunks for a prompt, with optional symbol-name re-ranking */
    async retrieveContext(query: string, k: number = 10, symbolHints: string[] = []): Promise<string> {
        await this.embeddingService.initialize();
        const queryEmbedding = await this.embeddingService.generateEmbedding(query);
        const topDocs = this.vectorStore.queryTopK(queryEmbedding, k, symbolHints);

        if (topDocs.length === 0) return '';
        return topDocs.map(d => `### ${d.symbolName || 'chunk'} (${d.symbolType || 'unknown'}):\n\`\`\`\n${d.content}\n\`\`\``).join('\n\n');
    }

    // --- Hash persistence ---
    private loadHashCache(): void {
        try {
            if (fs.existsSync(this.hashCachePath)) {
                const data = JSON.parse(fs.readFileSync(this.hashCachePath, 'utf-8'));
                this.fileHashes = new Map(Object.entries(data));
            }
        } catch {
            this.fileHashes = new Map();
        }
    }

    private saveHashCache(): void {
        try {
            const data = Object.fromEntries(this.fileHashes.entries());
            fs.writeFileSync(this.hashCachePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch {
            // Non-critical: hash persistence failure
        }
    }
}
