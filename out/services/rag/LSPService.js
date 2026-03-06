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
exports.LSPService = void 0;
const vscode = __importStar(require("vscode"));
/**
 * LSP Hover Integration Service.
 * Uses VS Code's built-in language server to resolve type information
 * for symbols under the cursor or at specific positions.
 *
 * This gives us type data that no amount of file chunking can replicate:
 * inferred return types, generic parameters, interface shapes, etc.
 */
class LSPService {
    /**
     * Get hover (type) information for a symbol at (line, character) in a file.
     * Wraps `vscode.commands.executeCommand('vscode.executeHoverProvider', ...)`.
     */
    async getHoverInfo(fileUri, line, character) {
        try {
            const position = new vscode.Position(line, character);
            const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', fileUri, position);
            if (!hovers || hovers.length === 0)
                return null;
            // Merge all hover contents into a single string
            const parts = [];
            for (const hover of hovers) {
                for (const content of hover.contents) {
                    if (typeof content === 'string') {
                        parts.push(content);
                    }
                    else if (content instanceof vscode.MarkdownString) {
                        parts.push(content.value);
                    }
                    else if ('value' in content) {
                        // MarkedString { language, value }
                        parts.push(content.value);
                    }
                }
            }
            const typeSignature = parts.join('\n').trim();
            if (!typeSignature)
                return null;
            // Try to extract the symbol name from the document at the position
            const doc = await vscode.workspace.openTextDocument(fileUri);
            const wordRange = doc.getWordRangeAtPosition(position);
            const symbolName = wordRange ? doc.getText(wordRange) : '<unknown>';
            return {
                symbolName,
                typeSignature,
                documentation: '', // hover often includes docs inline in typeSignature
                filePath: fileUri.fsPath,
                line,
                character,
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Get type definitions for a symbol (go-to-type-definition).
     * Uses `vscode.executeTypeDefinitionProvider`.
     */
    async getTypeDefinition(fileUri, line, character) {
        try {
            const position = new vscode.Position(line, character);
            const locations = await vscode.commands.executeCommand('vscode.executeTypeDefinitionProvider', fileUri, position);
            if (!locations || locations.length === 0)
                return null;
            // Read the first type definition's source
            const loc = locations[0];
            const targetUri = 'targetUri' in loc ? loc.targetUri : loc.uri;
            const targetRange = 'targetRange' in loc ? loc.targetRange : loc.range;
            const doc = await vscode.workspace.openTextDocument(targetUri);
            // Grab a reasonable range around the definition (the type + a few surrounding lines)
            const startLine = Math.max(0, targetRange.start.line - 2);
            const endLine = Math.min(doc.lineCount - 1, targetRange.end.line + 10);
            const range = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);
            return doc.getText(range);
        }
        catch {
            return null;
        }
    }
    /**
     * Resolve types for all symbols the user mentions in their request.
     * Scans the active editor (or a specified file) for matching symbol names
     * and fetches their hover info.
     */
    async resolveSymbolTypes(symbolHints, fileUri) {
        const results = [];
        if (symbolHints.length === 0)
            return results;
        // Use the active editor's document, or the provided fileUri
        const targetUri = fileUri || vscode.window.activeTextEditor?.document.uri;
        if (!targetUri)
            return results;
        try {
            const doc = await vscode.workspace.openTextDocument(targetUri);
            const text = doc.getText();
            const resolvedNames = new Set();
            for (const hint of symbolHints) {
                if (resolvedNames.has(hint))
                    continue;
                // Find the first occurrence of this symbol in the document
                const idx = text.indexOf(hint);
                if (idx === -1)
                    continue;
                const pos = doc.positionAt(idx);
                const info = await this.getHoverInfo(targetUri, pos.line, pos.character);
                if (info) {
                    results.push(info);
                    resolvedNames.add(hint);
                }
                // Cap at 10 type lookups per request to avoid LSP overload
                if (results.length >= 10)
                    break;
            }
        }
        catch {
            // LSP not available or document can't be opened
        }
        return results;
    }
    /**
     * Format LSP type info as context for the LLM prompt.
     */
    static formatForPrompt(typeInfos) {
        if (typeInfos.length === 0)
            return '';
        const header = '[LSP TYPE DEFINITIONS]\n';
        const blocks = typeInfos.map(info => `// ${info.symbolName} (${info.filePath}:${info.line + 1})\n${info.typeSignature}`).join('\n\n');
        return `${header}\`\`\`typescript\n${blocks}\n\`\`\`\n`;
    }
}
exports.LSPService = LSPService;
//# sourceMappingURL=LSPService.js.map