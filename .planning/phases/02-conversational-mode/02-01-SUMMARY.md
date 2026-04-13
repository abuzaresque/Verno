---
plan: 02-01
status: complete
key-files:
  created:
    - src/services/workspace/WorkspaceIntelligence.ts
  modified:
    - src/services/conversationEngine.ts
    - src/services/planning/PlanStateService.ts
    - src/extension.ts
---

# Summary: Plan 02-01 — SDLC-Aware ConversationEngine

## What Was Built
Transformed ConversationEngine from a generic chat assistant into a fully SDLC-aware advisor that knows what the user is working on and tailors every response accordingly.

## Tasks Completed
- [x] **WorkspaceIntelligence** service created at `src/services/workspace/WorkspaceIntelligence.ts`
  - `getSnapshot()` — reads active editor, package.json, PlanStateService, recent open files
  - `detectStack()` — async inspection of package.json, requirements.txt, Gemfile, pom.xml, go.mod, Cargo.toml
  - `detectFramework()` — fast sync detection (nextjs / react / vue / angular / express / nestjs / vscode-extension)
  - `detectContext()` — classifies active file as: security / api / test / ui / config / data / general
  - `getActiveFileContent()` — returns first N lines of active file for inclusion in the prompt
- [x] **PlanStateService** extended with `getCurrentPhaseLabel()` — returns human-readable pipeline step label
- [x] **ConversationEngine** rewritten:
  - Constructor now accepts `WorkspaceIntelligence`, `ConfigService`, and `Logger`
  - `buildSystemPrompt(snapshot)` produces rich SDLC system prompt with stack, active file, file context, SDLC state
  - 7 context-specific advisory modes (security/api/test/ui/config/data/general), each with tailored instructions
  - All LLM calls use `configService.getApiKey()` — no plaintext settings access
  - Fast-path classification using Groq llama-3.1-8b-instant
  - Main model: Anthropic claude-3-5-sonnet (fallback to Groq llama-3.1-70b-versatile)
  - Proactive pipeline nudge every 3 turns when `hasPendingPipeline` is true
- [x] **extension.ts** wired: `WorkspaceIntelligence` instantiated and injected into `ConversationEngine`

## Verification
- [x] TypeScript compile: 0 errors
- [x] `.env` + `dotenv` language → fileContext = 'security' → OWASP-grounded response
- [x] `*Controller.ts` / `*router.ts` → fileContext = 'api' → REST/auth guidance
- [x] `*.test.ts` / `*.spec.ts` → fileContext = 'test' → coverage + edge case guidance
- [x] Workspace snapshot includes correct framework from package.json
- [x] Pipeline nudge surfaces after 3 turns when pending steps exist
