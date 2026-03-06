

export interface SymbolChunk {
    symbolName: string;
    symbolType: 'function' | 'class' | 'method' | 'arrow_function' | 'unknown';
    content: string;
    startLine: number;
    endLine: number;
    filePath: string;
}

// Tree-sitter node types we care about for JS/TS
const SYMBOL_NODE_TYPES = new Set([
    'function_declaration',
    'class_declaration',
    'method_definition',
    'export_statement',
]);

// For lexical_declaration, we only want arrow fns / function expressions
const LEXICAL_DECLARATION = 'lexical_declaration';
const ARROW_FN_TYPES = new Set(['arrow_function', 'function_expression', 'function']);

// Map file extensions to tree-sitter grammar file names
const EXT_TO_GRAMMAR: Record<string, string> = {
    '.ts': 'tree-sitter-typescript',
    '.tsx': 'tree-sitter-tsx',
    '.js': 'tree-sitter-javascript',
    '.jsx': 'tree-sitter-javascript',
    '.py': 'tree-sitter-python',
    '.go': 'tree-sitter-go',
    '.rs': 'tree-sitter-rust',
    '.java': 'tree-sitter-java',
};

// Python-specific symbol node types
const PYTHON_SYMBOL_TYPES = new Set([
    'function_definition',
    'class_definition',
    'decorated_definition',
]);

export class SymbolChunker {
    private parserReady = false;
    private Parser: any = null;
    private loadedLanguages: Map<string, any> = new Map();
    private extensionPath: string;

    constructor(extensionPath: string) {
        this.extensionPath = extensionPath;
    }

    private async initParser(): Promise<void> {
        if (this.parserReady) return;

        const TreeSitter = await import('web-tree-sitter');
        const TreeSitterParser = TreeSitter.default;

        // Correct WASM path resolution for VS Code extension context
        const wasmPath = require.resolve('web-tree-sitter/web-tree-sitter.wasm');
        await (TreeSitterParser as any).init({
            locateFile: () => wasmPath
        });

        this.Parser = TreeSitterParser;
        this.parserReady = true;
    }

    private async getLanguage(ext: string): Promise<any> {
        if (this.loadedLanguages.has(ext)) {
            return this.loadedLanguages.get(ext);
        }

        const grammarName = EXT_TO_GRAMMAR[ext];
        if (!grammarName) return null;

        try {
            const grammarPath = require.resolve(`tree-sitter-wasms/out/${grammarName}.wasm`);
            const lang = await this.Parser.Language.load(grammarPath);
            this.loadedLanguages.set(ext, lang);
            return lang;
        } catch (e) {
            return null;
        }
    }

    /**
     * Extract symbol-level chunks from a file using tree-sitter AST.
     * Falls back to character-based chunking if the language isn't supported.
     */
    async extractSymbols(fileContent: string, filePath: string): Promise<SymbolChunk[]> {
        const ext = filePath.substring(filePath.lastIndexOf('.'));

        // Non-parseable extensions: fall back to character chunking
        if (!EXT_TO_GRAMMAR[ext]) {
            return this.fallbackChunk(fileContent, filePath);
        }

        await this.initParser();
        const language = await this.getLanguage(ext);

        if (!language) {
            return this.fallbackChunk(fileContent, filePath);
        }

        const parser = new this.Parser();
        parser.setLanguage(language);
        const tree = parser.parse(fileContent);
        const chunks: SymbolChunk[] = [];

        const isPython = ext === '.py';
        const symbolTypes = isPython ? PYTHON_SYMBOL_TYPES : SYMBOL_NODE_TYPES;

        this.walkTree(tree.rootNode, fileContent, filePath, chunks, symbolTypes, isPython);
        parser.delete();

        // If tree-sitter found nothing useful, fall back
        if (chunks.length === 0) {
            return this.fallbackChunk(fileContent, filePath);
        }

        return chunks;
    }

    private walkTree(
        node: any,
        source: string,
        filePath: string,
        chunks: SymbolChunk[],
        symbolTypes: Set<string>,
        isPython: boolean
    ): void {
        // Check if this node is a symbol we want
        if (symbolTypes.has(node.type)) {
            const chunk = this.nodeToChunk(node, source, filePath, isPython);
            if (chunk) {
                chunks.push(chunk);
                return; // Don't recurse into children of captured symbols
            }
        }

        // Special handling: lexical_declaration → only if child is arrow_function/function_expression
        if (node.type === LEXICAL_DECLARATION && !isPython) {
            if (this.isArrowFunctionDeclaration(node)) {
                const chunk = this.nodeToChunk(node, source, filePath, isPython);
                if (chunk) {
                    chunks.push(chunk);
                    return;
                }
            }
            // Plain `const MAX = 3` → skip, don't add as chunk
            return;
        }

        // Recurse into children
        for (let i = 0; i < node.childCount; i++) {
            this.walkTree(node.child(i), source, filePath, chunks, symbolTypes, isPython);
        }
    }

    /**
     * Check: lexical_declaration → variable_declarator → arrow_function | function_expression
     */
    private isArrowFunctionDeclaration(node: any): boolean {
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child.type === 'variable_declarator') {
                for (let j = 0; j < child.childCount; j++) {
                    const valueNode = child.child(j);
                    if (ARROW_FN_TYPES.has(valueNode.type)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private nodeToChunk(node: any, source: string, filePath: string, isPython: boolean): SymbolChunk | null {
        const content = node.text;
        if (!content || content.length < 10) return null; // Skip trivially small nodes

        const symbolName = this.extractSymbolName(node, isPython);
        const symbolType = this.mapNodeType(node.type);

        return {
            symbolName,
            symbolType,
            content,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            filePath,
        };
    }

    private extractSymbolName(node: any, isPython: boolean): string {
        // Try common name child nodes
        const nameNode = node.childForFieldName('name');
        if (nameNode) return nameNode.text;

        // For lexical_declaration: name is inside variable_declarator
        if (node.type === LEXICAL_DECLARATION) {
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child.type === 'variable_declarator') {
                    const name = child.childForFieldName('name');
                    if (name) return name.text;
                }
            }
        }

        // For export_statement: dig into the declaration
        if (node.type === 'export_statement') {
            const decl = node.childForFieldName('declaration');
            if (decl) {
                const name = decl.childForFieldName('name');
                if (name) return name.text;
            }
        }

        return '<anonymous>';
    }

    private mapNodeType(type: string): SymbolChunk['symbolType'] {
        switch (type) {
            case 'function_declaration':
            case 'function_definition':
                return 'function';
            case 'class_declaration':
            case 'class_definition':
                return 'class';
            case 'method_definition':
                return 'method';
            case LEXICAL_DECLARATION:
                return 'arrow_function';
            default:
                return 'unknown';
        }
    }

    /**
     * Fallback: character-based sliding window for non-parseable files (CSS, HTML, MD)
     */
    private fallbackChunk(content: string, filePath: string, chunkSize = 500, overlap = 100): SymbolChunk[] {
        const chunks: SymbolChunk[] = [];
        if (content.length <= chunkSize) {
            chunks.push({
                symbolName: '<file>',
                symbolType: 'unknown',
                content,
                startLine: 1,
                endLine: content.split('\n').length,
                filePath,
            });
            return chunks;
        }

        const lines = content.split('\n');
        let charIndex = 0;
        let lineIndex = 0;

        while (charIndex < content.length) {
            const slice = content.substring(charIndex, charIndex + chunkSize);
            const sliceLines = slice.split('\n').length;
            chunks.push({
                symbolName: `<chunk:${lineIndex + 1}>`,
                symbolType: 'unknown',
                content: slice,
                startLine: lineIndex + 1,
                endLine: lineIndex + sliceLines,
                filePath,
            });
            charIndex += chunkSize - overlap;
            lineIndex += sliceLines - Math.floor(overlap / 40); // approximate line offset
        }

        return chunks;
    }
}
