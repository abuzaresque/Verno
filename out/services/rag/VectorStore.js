"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VectorStore = void 0;
class VectorStore {
    documents = new Map();
    upsert(doc) {
        this.documents.set(doc.id, doc);
    }
    deleteByFilePath(filePath) {
        for (const [id, doc] of this.documents.entries()) {
            if (doc.filePath === filePath) {
                this.documents.delete(id);
            }
        }
    }
    /** Returns top K similar documents, with optional symbol-name re-ranking */
    queryTopK(queryEmbedding, k = 5, symbolHints = []) {
        const lowerHints = symbolHints.map(h => h.toLowerCase());
        const scoredDocs = Array.from(this.documents.values()).map(doc => {
            let score = this.cosineSimilarity(queryEmbedding, doc.embedding);
            // Fix 7: Boost if symbolName partially matches any hint in the user prompt
            // Use .includes() in both directions for partial match (AuthService ↔ AuthServiceImpl)
            if (doc.symbolName && lowerHints.length > 0) {
                const lowerSymbol = doc.symbolName.toLowerCase();
                const hasMatch = lowerHints.some(hint => lowerSymbol.includes(hint) || hint.includes(lowerSymbol));
                if (hasMatch) {
                    score = Math.min(score * 1.5, 1.0); // Capped at 1.0 to preserve normalized range
                }
            }
            return { doc, score };
        });
        scoredDocs.sort((a, b) => b.score - a.score);
        return scoredDocs.slice(0, k).map(scored => scored.doc);
    }
    getDocumentCount() {
        return this.documents.size;
    }
    clear() {
        this.documents.clear();
    }
    cosineSimilarity(vecA, vecB) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0)
            return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}
exports.VectorStore = VectorStore;
//# sourceMappingURL=VectorStore.js.map