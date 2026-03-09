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
exports.IndexingService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
class IndexingService {
    vectorStore;
    embeddingService;
    symbolChunker;
    isIndexing = false;
    hasIndexed = false;
    lastIndexedAt = 0;
    // Fix 4: Persisted file hashes to avoid re-embedding unchanged files
    fileHashes = new Map();
    hashCachePath = '';
    // Fix 6: Dirty file tracking for incremental re-indexing
    dirtyFiles = new Set();
    constructor(vectorStore, embeddingService, symbolChunker, workspaceRoot) {
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
    markDirty(filePath) {
        this.dirtyFiles.add(filePath);
    }
    /** Public getter so ContextEngine can check if index is available */
    get indexReady() {
        return this.hasIndexed;
    }
    /** Public getter so ContextEngine can note stale context */
    get currentlyIndexing() {
        return this.isIndexing;
    }
    /**
     * Full workspace index — lazy on first request.
     * Subsequent calls only re-index dirty files (incremental).
     */
    async indexWorkspace(workspaceRoot, logger) {
        if (this.isIndexing)
            return;
        // If already indexed, only re-index dirty files (async, non-blocking)
        if (this.hasIndexed) {
            if (this.dirtyFiles.size > 0) {
                this.isIndexing = true;
                const filesToReindex = [...this.dirtyFiles];
                this.dirtyFiles.clear();
                try {
                    await this.indexFiles(filesToReindex, workspaceRoot, logger);
                }
                finally {
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
            const files = [];
            const scan = (dir) => {
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (ignoreDirs.has(entry.name))
                            continue;
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            scan(fullPath);
                        }
                        else if (entry.isFile()) {
                            const ext = path.extname(entry.name);
                            if (codeExtensions.has(ext)) {
                                files.push(fullPath);
                            }
                        }
                    }
                }
                catch {
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
        }
        finally {
            this.isIndexing = false;
        }
    }
    /** Index a list of files, skipping unchanged ones (hash check) */
    async indexFiles(files, workspaceRoot, logger) {
        for (const filePath of files) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                if (content.length > 500000)
                    continue; // skip huge files
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
                    const doc = {
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
            }
            catch (err) {
                logger.log(`Failed to index file ${filePath}: ${err}`, 'warn');
            }
        }
        this.saveHashCache();
    }
    /** Retrieve relevant chunks for a prompt, with optional symbol-name re-ranking */
    async retrieveContext(query, k = 10, symbolHints = []) {
        await this.embeddingService.initialize();
        const queryEmbedding = await this.embeddingService.generateEmbedding(query);
        const topDocs = this.vectorStore.queryTopK(queryEmbedding, k, symbolHints);
        if (topDocs.length === 0)
            return '';
        return topDocs.map(d => `### ${d.symbolName || 'chunk'} (${d.symbolType || 'unknown'}):\n\`\`\`\n${d.content}\n\`\`\``).join('\n\n');
    }
    // --- Hash persistence ---
    loadHashCache() {
        try {
            if (fs.existsSync(this.hashCachePath)) {
                const data = JSON.parse(fs.readFileSync(this.hashCachePath, 'utf-8'));
                this.fileHashes = new Map(Object.entries(data));
            }
        }
        catch {
            this.fileHashes = new Map();
        }
    }
    saveHashCache() {
        try {
            const data = Object.fromEntries(this.fileHashes.entries());
            fs.writeFileSync(this.hashCachePath, JSON.stringify(data, null, 2), 'utf-8');
        }
        catch {
            // Non-critical: hash persistence failure
        }
    }
}
exports.IndexingService = IndexingService;
//# sourceMappingURL=IndexingService.js.map