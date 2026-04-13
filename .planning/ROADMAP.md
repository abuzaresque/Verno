# Roadmap: Verno

## Overview

Verno owns the full 9-phase Software Development Life Cycle — from debate-driven requirements through deployed, monitored, and documented software — all inside VSCode. The roadmap is grouped by SDLC phase. Quick wins (GitHub integration, self-healing code gen, sprint auto-planner, security persona, changelog sync) are front-loaded into the first three milestones.

## Phases

- [ ] **Phase 1: Security & Extension Foundation** — SecretStorage, webview guards, metadata, provider cleanup
- [ ] **Phase 2: Conversational Mode Upgrade** — SDLC-aware advisor with real-time workspace intelligence
- [ ] **Phase 3: PRD Hardening (SDLC Phase 1)** — Security persona, ambiguity detector, version diffing, traceability matrix
- [ ] **Phase 4: Planning & Estimation (SDLC Phase 2)** — Story point agent, sprint auto-planner, dependency graph
- [ ] **Phase 5: Architecture & Design (SDLC Phase 3)** — ADRs, Mermaid diagrams, OpenAPI contracts
- [ ] **Phase 6: Self-Healing Code Generation (SDLC Phase 4)** — Error retry loop, conflict resolver, incremental diffs
- [ ] **Phase 7: Testing & QA (SDLC Phase 5)** — Unit test auto-gen, E2E scaffolding, coverage sidebar
- [ ] **Phase 8: CI/CD & GitHub Integration (SDLC Phase 6)** — GitHub Actions, Dockerfile/K8s, repo detection, PR creation
- [ ] **Phase 9: Monitoring & Observability (SDLC Phase 7)** — OpenTelemetry, Grafana dashboards, runbooks
- [ ] **Phase 10: Security & Compliance (SDLC Phase 8)** — OWASP checklists, secret scanning, GDPR flags
- [ ] **Phase 11: Documentation & Knowledge Base (SDLC Phase 9)** — README sync, changelog gen, JSDoc
- [ ] **Phase 12: Multi-Provider LLM & Streaming UI** — Anthropic + OpenAI providers, streaming markdown renderer
- [ ] **Phase 13: Agent Test Coverage & CI for Verno** — MockLLMService, unit tests, GitHub Actions for extension itself
- [ ] **Phase 14: Polish, Documentation & VSIX Package** — FYP packaging, onboarding, final VSIX

## Phase Details

### Phase 1: Security & Extension Foundation
**Goal**: Fix critical security issues (SecretStorage, webview guards) and extension metadata. Clean baseline before any new feature work.
**Depends on**: Nothing (first phase)
**Requirements**: SEC-04, SEC-05, EXT-04
**Success Criteria** (what must be TRUE):
  1. API keys stored in VSCode SecretStorage — not prompted via dialog on repeat sessions
  2. Webview panels reject unknown message types with a logged warning
  3. Extension output channel not auto-opened on activation
  4. Agent artifacts write to `.verno/` only — not workspace root
  5. Extension version 0.2.0, publisher not "yourname"
**Plans**: 3 plans

Plans:
- [x] 01-01: Secure API Key Storage — migrate to vscode.SecretStorage
- [x] 01-02: Webview Message Security — allowlist validation + CSP audit
- [x] 01-03: Extension Metadata & Logger Polish — version, publisher, output paths

### Phase 2: Conversational Mode Upgrade
**Goal**: Transform the basic chat mode into a true SDLC-aware conversational advisor that interprets workspace context and delivers real-time insights.
**Depends on**: Phase 1
**Requirements**: MOD-01
**Success Criteria** (what must be TRUE):
  1. Conversational mode detects active file type and tailors its response (security for .env, architecture for services/)
  2. User can ask "what are the vulnerabilities in this file?" and get an OWASP-backed answer
  3. ConversationEngine includes workspace summary in system prompt automatically
  4. Mode clearly communicated in UI (toggle: Conversational ↔ Development)
**Plans**: 2 plans

Plans:
- [x] 02-01: SDLC-Aware ConversationEngine — workspace-context system prompt, mode detection
- [ ] 02-02: Mode Toggle UI — sidebar toggle, context-aware response templates

### Phase 3: PRD Hardening (SDLC Phase 1)
**Goal**: Make PRD generation industry-grade — with a security persona, ambiguity detection, version tracking, and a traceability matrix.
**Depends on**: Phase 1
**Requirements**: PRD-01, PRD-02, PRD-03, PRD-04
**Success Criteria** (what must be TRUE):
  1. Debate has 8 agents (Security added as 8th)
  2. PRD flags vague requirements inline (e.g. ⚠️ "should be fast" → add SLO)
  3. PRD revision history persisted — diff visible between v1 and v2
  4. Traceability matrix links each PRD section to generated Epics
**Plans**: 3 plans

Plans:
- [ ] 03-01: Security Persona in Debate — 8th agent with OWASP/GDPR focus
- [ ] 03-02: Ambiguity Detector + PRD Versioning — flag vague terms, persist revisions
- [ ] 03-03: Requirements Traceability Matrix — link PRD sections to Epic IDs

### Phase 4: Planning & Estimation (SDLC Phase 2)
**Goal**: Add story point estimation, sprint auto-planning, and dependency graph visualization to the Jira sync pipeline.
**Depends on**: Phase 3
**Requirements**: PLN-01, PLN-02, PLN-03
**Success Criteria** (what must be TRUE):
  1. Every Story has a Fibonacci story point estimate set by EstimationAgent
  2. Dependency graph rendered in sidebar showing which stories block which
  3. Sprint planner distributes stories into sprints given a capacity input (e.g. 40 SP/sprint)
  4. Sprint assignments synced to Jira sprints
**Plans**: 3 plans

Plans:
- [ ] 04-01: EstimationAgent — Fibonacci story point sizing per Story
- [ ] 04-02: Dependency Graph — block/depend relationship detection + sidebar visualization
- [ ] 04-03: Sprint Auto-Planner — capacity-input sprint distribution + Jira sprint sync

### Phase 5: Architecture & Design (SDLC Phase 3)
**Goal**: Extend ArchitectAgent to produce ADRs, Mermaid diagrams, and OpenAPI contracts alongside ARCHITECTURE.md.
**Depends on**: Phase 3
**Requirements**: ARC-01, ARC-02, ARC-03
**Success Criteria** (what must be TRUE):
  1. Every architectural decision in ARCHITECTURE.md has a corresponding ADR file
  2. Mermaid sequence, component, and ER diagrams generated and renderable in VSCode
  3. API-first projects get an OpenAPI 3.1 spec generated from the architecture debate
**Plans**: 3 plans

Plans:
- [ ] 05-01: Architecture Decision Records (ADRs) — per-decision log with rationale
- [ ] 05-02: Mermaid Diagram Generator — sequence, component, and ER diagrams
- [ ] 05-03: OpenAPI Contract Designer — OpenAPI 3.1 spec from debate analysis

### Phase 6: Self-Healing Code Generation (SDLC Phase 4)
**Goal**: Make code generation self-correcting — detect TypeScript/ESLint errors post-generation and re-run with error context until passing.
**Depends on**: Phase 5
**Requirements**: COD-01, COD-02, COD-03
**Success Criteria** (what must be TRUE):
  1. After code gen, if `tsc --noEmit` fails, DeveloperAgent re-generates with error context (max 3 retries)
  2. If two agents produce changes to the same file, ConflictResolverAgent merges them
  3. Only changed sections regenerated on re-run (diff-aware prompt construction)
  4. Self-healing loop visible in sidebar with attempt counter
**Plans**: 3 plans

Plans:
- [ ] 06-01: Self-Healing Loop — error-detect → re-generate cycle in DeveloperAgent
- [ ] 06-02: Multi-Agent Conflict Resolver — same-file edit detection + merge agent
- [ ] 06-03: Incremental Diff Generation — diff-aware prompt, regenerate changed sections only

### Phase 7: Testing & QA (SDLC Phase 5)
**Goal**: Auto-generate unit tests per generated file, scaffold Playwright E2E tests, and show live coverage in sidebar.
**Depends on**: Phase 6
**Requirements**: TST-01, TST-02, TST-03, TST-04
**Success Criteria** (what must be TRUE):
  1. For each generated `.ts` file, a corresponding `.test.ts` stub is generated
  2. User flows in PRD generate Playwright E2E test scaffolds
  3. Coverage percentage badge visible in sidebar after `npm test`
  4. MockLLMService injectable — DeveloperAgent + OrchestratorAgent have unit tests
**Plans**: 3 plans

Plans:
- [ ] 07-01: Unit Test Auto-Generator — per-file test stubs via TestGeneratorAgent
- [ ] 07-02: E2E Playwright Scaffolding — generate test files from PRD user flows
- [ ] 07-03: Coverage Badge + MockLLMService — sidebar badge, agent unit tests

### Phase 8: CI/CD & GitHub Integration (SDLC Phase 6)
**Goal**: Detect the user's GitHub repo and auto-scaffold GitHub Actions workflows, Dockerfiles, and Kubernetes manifests.
**Depends on**: Phase 7
**Requirements**: CIC-01, CIC-02, CIC-03, CIC-04
**Success Criteria** (what must be TRUE):
  1. Verno detects if workspace is a GitHub repo (via `git remote`)
  2. Generates `.github/workflows/ci.yml` tailored to detected stack
  3. Dockerfile and docker-compose generated for containerisable services
  4. Kubernetes manifests generated for services with Docker support
  5. PR creation command available after code gen
**Plans**: 3 plans

Plans:
- [ ] 08-01: GitHub Repository Integration — repo detection, branch info, PR creation
- [ ] 08-02: CI/CD Scaffold — GitHub Actions workflows per detected stack
- [ ] 08-03: Container & K8s Manifests — Dockerfile, docker-compose, K8s YAML

### Phase 9: Monitoring & Observability (SDLC Phase 7)
**Goal**: Generated code ships with generated observability — OpenTelemetry snippets, Grafana dashboards, and operational runbooks.
**Depends on**: Phase 8
**Requirements**: MON-01, MON-02, MON-03
**Success Criteria** (what must be TRUE):
  1. Generated services include OpenTelemetry instrumentation hooks
  2. Grafana dashboard JSON generated per service
  3. Runbook generated covering common failure modes from architecture
**Plans**: 2 plans

Plans:
- [ ] 09-01: OpenTelemetry Instrumentation Generator — service-level OTel snippets
- [ ] 09-02: Grafana Dashboard + Runbook Generator — dashboard JSON + ops runbook

### Phase 10: Security & Compliance (SDLC Phase 8)
**Goal**: Shift security left — OWASP checklists in PRD, GDPR/HIPAA flags, secret scanning before commits.
**Depends on**: Phase 3
**Requirements**: SEC-01, SEC-02, SEC-03
**Success Criteria** (what must be TRUE):
  1. OWASP checklist generated per PRD feature (e.g. injection, auth, data exposure)
  2. PRD sections with PII/health data auto-flagged for GDPR/HIPAA review
  3. Secret scanner runs before any git commit and blocks if secrets detected
**Plans**: 2 plans

Plans:
- [ ] 10-01: OWASP Checklist Generator + GDPR/HIPAA Flags — PRD compliance layer
- [ ] 10-02: Pre-Commit Secret Scanner — git hook injection + Verno command

### Phase 11: Documentation & Knowledge Base (SDLC Phase 9)
**Goal**: Regenerate README sections when code changes, generate changelogs from Conventional Commits, auto-generate JSDoc from BMAD code.
**Depends on**: Phase 6
**Requirements**: DOC-01, DOC-02, DOC-03
**Success Criteria** (what must be TRUE):
  1. On file save, Verno detects if a READMEsection is stale and offers to regenerate
  2. `verno.generateChangelog` command produces CHANGELOG.md from git history
  3. JSDoc generated for all exported functions in BMAD-generated files
**Plans**: 2 plans

Plans:
- [ ] 11-01: README Auto-Sync + JSDoc Generator — change-triggered doc regeneration
- [ ] 11-02: Changelog Generator — Conventional Commits parser → CHANGELOG.md

### Phase 12: Multi-Provider LLM & Streaming UI
**Goal**: Add Anthropic and OpenAI providers, add model selection dropdown, and render streaming markdown in chat.
**Depends on**: Phase 1
**Requirements**: EXT-01, EXT-02, EXT-03
**Success Criteria** (what must be TRUE):
  1. User selects Gemini / Groq / Anthropic / OpenAI from UI dropdown
  2. Selected provider + model persists across restarts
  3. Chat responses render markdown with syntax-highlighted code blocks
  4. Token usage visible in UI
**Plans**: 3 plans

Plans:
- [ ] 12-01: Anthropic Provider — claude-3-5-sonnet + claude-3-haiku with streaming
- [ ] 12-02: OpenAI Provider — gpt-4o + gpt-4o-mini with streaming
- [ ] 12-03: Provider Selector UI + Streaming Markdown — dropdown + marked.js renderer

### Phase 13: Agent Test Coverage & CI for Verno
**Goal**: Establish injectable MockLLMService, write agent/service unit tests, add GitHub Actions CI for the Verno extension itself.
**Depends on**: Phase 12
**Requirements**: TST-04
**Success Criteria** (what must be TRUE):
  1. `npm test` passes all unit tests with zero failures
  2. DeveloperAgent, OrchestratorAgent, DebateOrchestrator, ConversationEngine have test cases
  3. GitHub Actions CI runs lint → compile → test on every push to Verno's own repo
**Plans**: 2 plans

Plans:
- [ ] 13-01: MockLLMService + Agent Unit Tests — injectable mock, critical agent tests
- [ ] 13-02: Verno CI Pipeline — GitHub Actions for extension lint + compile + test

### Phase 14: Polish, Documentation & VSIX Package
**Goal**: Onboarding wizard, comprehensive docs, final VSIX package for FYP evaluation.
**Depends on**: Phase 11, Phase 13
**Requirements**: All remaining
**Success Criteria** (what must be TRUE):
  1. Fresh VSIX install works end-to-end: voice → debates → PRD → code → CI scaffold
  2. README has architecture diagram and full feature documentation
  3. `vsce package` produces valid 1.0.0 VSIX
  4. Manual smoke test: full 9-phase SDLC pipeline completes for a sample project
**Plans**: 2 plans

Plans:
- [ ] 14-01: UX Polish + Onboarding Wizard — mode toggle, welcome page, keyboard shortcuts
- [ ] 14-02: Final Docs + VSIX Package — README, CONTRIBUTING, vsce package 1.0.0

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security & Extension Foundation | 0/3 | Not started | - |
| 2. Conversational Mode Upgrade | 0/2 | Not started | - |
| 3. PRD Hardening (SDLC Ph.1) | 0/3 | Not started | - |
| 4. Planning & Estimation (SDLC Ph.2) | 0/3 | Not started | - |
| 5. Architecture & Design (SDLC Ph.3) | 0/3 | Not started | - |
| 6. Self-Healing Code Gen (SDLC Ph.4) | 0/3 | Not started | - |
| 7. Testing & QA (SDLC Ph.5) | 0/3 | Not started | - |
| 8. CI/CD & GitHub (SDLC Ph.6) | 0/3 | Not started | - |
| 9. Monitoring & Observability (SDLC Ph.7) | 0/2 | Not started | - |
| 10. Security & Compliance (SDLC Ph.8) | 0/2 | Not started | - |
| 11. Documentation & KB (SDLC Ph.9) | 0/2 | Not started | - |
| 12. Multi-Provider LLM & Streaming UI | 0/3 | Not started | - |
| 13. Agent Test Coverage & Verno CI | 0/2 | Not started | - |
| 14. Polish, Docs & VSIX Package | 0/2 | Not started | - |
