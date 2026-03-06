import * as fs from 'fs';
import * as path from 'path';

interface TsConfigPaths {
    [alias: string]: string[];
}

export class ImportTracer {
    private workspaceRoot: string;
    private pathAliases: Map<string, string> = new Map(); // '@/components' → 'src/components'
    private maxDepsPerFile: number;
    private maxDepth: number;

    constructor(workspaceRoot: string, maxDepsPerFile: number = 20, maxDepth: number = 3) {
        this.workspaceRoot = workspaceRoot;
        this.maxDepsPerFile = maxDepsPerFile;
        this.maxDepth = maxDepth;
        this.loadPathAliases();
    }

    /**
     * Read tsconfig.json → compilerOptions.paths and build alias map.
     * Handles: "@/components/*" → ["src/components/*"]
     */
    private loadPathAliases(): void {
        try {
            const tsconfigPath = path.join(this.workspaceRoot, 'tsconfig.json');
            if (!fs.existsSync(tsconfigPath)) return;

            const rawContent = fs.readFileSync(tsconfigPath, 'utf-8');
            // Strip single-line comments (tsconfig allows them)
            const stripped = rawContent.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
            const tsconfig = JSON.parse(stripped);
            const paths: TsConfigPaths = tsconfig?.compilerOptions?.paths;
            const baseUrl: string = tsconfig?.compilerOptions?.baseUrl || '.';

            if (!paths) return;

            for (const [alias, targets] of Object.entries(paths)) {
                if (targets.length === 0) continue;
                // Strip trailing /* from alias and target
                const cleanAlias = alias.replace(/\/\*$/, '');
                const cleanTarget = targets[0].replace(/\/\*$/, '');
                const resolvedTarget = path.resolve(this.workspaceRoot, baseUrl, cleanTarget);
                this.pathAliases.set(cleanAlias, resolvedTarget);
            }
        } catch {
            // tsconfig parsing failed — no aliases available
        }
    }

    /**
     * Resolves dependencies recursively with cycle detection and depth limiting.
     * The `visited` set is SHARED across the entire request (not per-branch).
     */
    resolveDependencies(
        filePath: string,
        visited: Set<string> = new Set(),
        depth: number = 0
    ): string[] {
        // Cycle guard: skip if already visited
        if (visited.has(filePath)) return [];
        visited.add(filePath);

        // Depth guard
        if (depth > this.maxDepth) return [];

        const directDeps = this.extractImports(filePath);
        const allDeps: string[] = [...directDeps];

        // Recurse into direct deps (shared visited set prevents cycles)
        for (const dep of directDeps) {
            if (!visited.has(dep)) {
                const transitiveDeps = this.resolveDependencies(dep, visited, depth + 1);
                allDeps.push(...transitiveDeps);
            }
        }

        return [...new Set(allDeps)];
    }

    /**
     * Extract direct imports from a single file.
     * Handles: ES6 imports, re-exports, dynamic imports, CommonJS require.
     */
    private extractImports(filePath: string): string[] {
        const deps: string[] = [];
        try {
            const content = fs.readFileSync(filePath, 'utf-8');

            // Combined regex patterns:
            // 1. import ... from '...'
            // 2. import('...')  (dynamic import — static string only, not template literals)
            // 3. require('...')
            // 4. export { ... } from '...'
            // 5. export * from '...'
            const patterns = [
                /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,        // ES6 import
                /export\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g,            // re-export named
                /export\s+\*\s+(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/g,   // re-export star
                /(?:await\s+)?import\(\s*['"]([^'"]+)['"]\s*\)/g,            // dynamic import (static string only)
                /require\(\s*['"]([^'"]+)['"]\s*\)/g,                         // CommonJS
            ];

            for (const regex of patterns) {
                let match;
                while ((match = regex.exec(content)) !== null) {
                    const importPath = match[1];
                    const resolvedPath = this.resolveImportPath(filePath, importPath);
                    if (resolvedPath && fs.existsSync(resolvedPath)) {
                        deps.push(resolvedPath);
                    }
                    // Barrel file cap: stop collecting if too many
                    if (deps.length >= this.maxDepsPerFile) break;
                }
                if (deps.length >= this.maxDepsPerFile) break;
            }
        } catch {
            // Unreadable file
        }

        return [...new Set(deps)];
    }

    /**
     * Resolve an import path to an absolute file path.
     * Handles: relative paths, path aliases, directory index files.
     */
    private resolveImportPath(sourceFile: string, importPath: string): string | null {
        // Skip bare node_modules specifiers (no dot prefix, no alias match)
        if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
            // Check if it matches a path alias
            for (const [alias, resolved] of this.pathAliases.entries()) {
                if (importPath === alias || importPath.startsWith(alias + '/')) {
                    const remainder = importPath.substring(alias.length);
                    importPath = resolved + remainder;
                    return this.tryResolveFile(importPath);
                }
            }
            // Bare specifier with no alias match → external package, skip
            return null;
        }

        const dir = path.dirname(sourceFile);
        const target = path.resolve(dir, importPath);
        return this.tryResolveFile(target);
    }

    private tryResolveFile(target: string): string | null {
        // Exact file
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
            return target;
        }

        // Try common extensions
        const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.css'];
        for (const ext of extensions) {
            if (fs.existsSync(target + ext)) {
                return target + ext;
            }
        }

        // Directory → index file
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
            for (const ext of extensions) {
                const indexFile = path.join(target, `index${ext}`);
                if (fs.existsSync(indexFile)) {
                    return indexFile;
                }
            }
        }

        return null;
    }

    /**
     * Reads the file and formats it as context for the LLM.
     */
    getFileContext(filePath: string): string {
        try {
            const relativePath = path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/');
            const content = fs.readFileSync(filePath, 'utf-8');
            return `[STRUCTURAL DEP] FILE: ${relativePath}\n\`\`\`\n${content}\n\`\`\`\n`;
        } catch {
            return '';
        }
    }
}
