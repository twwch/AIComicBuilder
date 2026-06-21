# AI Comic Builder — Project Harness

## Project Overview

AI Comic Builder is a Next.js web application for creating comic/manga storyboards with AI-assisted panel generation, 4-grid video synthesis (via ComfyUI + LTX-2.3), and auto-dubbing. Uses SQLite (better-sqlite3 via Drizzle ORM) for storage, OpenAI GPT models for LLM tasks, and ComfyUI for video generation.

- **Runtime**: Node.js 20+
- **Package manager**: pnpm (lockfile: `pnpm-lock.yaml`)
- **Database**: SQLite via better-sqlite3 + drizzle-orm
- **Frontend**: Next.js 15 + React 19 + Tailwind CSS 4
- **AI**: OpenAI (GPT, gpt-image-2), ComfyUI (image/video)
- **OS**: Windows (primary dev), Linux (CNB deployment)

## Completion Criteria

A task is **NOT complete** until ALL of these pass with exit code 0:

- `npm run lint -- --quiet` — ESLint passes
- `npx tsc --noEmit` — TypeScript type-checks
- `next build` — Production build succeeds

If any command fails (exit code ≠ 0), the task is not done. Re-read errors, fix them, and re-run all three commands.

## First Session Boot Sequence

Every new session MUST:
1. Read `PROGRESS.md` to understand current state
2. Read root `AGENTS.md` (this file) for project rules
3. If `setup.ps1` or `setup.sh` exists, verify environment matches

## Session State Rules

- Update `PROGRESS.md` after completing any sub-task or reaching a checkpoint
- Session context > 70% full? Stop, update PROGRESS.md with complete checkpoint, then start a fresh session
- Conflicts with existing code: source code is the single source of truth — update PROGRESS.md to reflect reality

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **AIComicBuilder** (6038 symbols, 10994 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/AIComicBuilder/context` | Codebase overview, check index freshness |
| `gitnexus://repo/AIComicBuilder/clusters` | All functional areas |
| `gitnexus://repo/AIComicBuilder/processes` | All execution flows |
| `gitnexus://repo/AIComicBuilder/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
