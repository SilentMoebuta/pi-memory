---
name: pi-memory
description: Persistent three-tier memory (L1 auto-summary, L2 session summaries, L3 SQLite knowledge) for the pi agent. Use when the user asks to remember/forget something, when learning a reusable preference/decision/fact/procedure/correction worth keeping across sessions, or before starting work to recall relevant prior context. Provides memory_write/search/recall/forget/status tools and /memory-consolidate|/memory-status|/memory-export commands.
---

# Pi Memory

Layered memory system for pi agent. Stores facts, decisions, preferences, procedures, and corrections across sessions.

## When to Use

- User asks "remember this" or "don't forget"
- You learn a new preference, pattern, or decision worth keeping
- Before starting work, you can recall relevant context
- User runs `/memory-consolidate` to trigger cleanup

## Memory Tiers

| Tier | What | Access |
|------|------|--------|
| L1 | MEMORY.md auto-summary | Injected at session start |
| L2 | Session summaries | Keyword search via memory_recall |
| L3 | Long-term knowledge | Stored in SQLite, cross-project |

## Tools

- `memory_write` — Store a new fact, decision, preference, procedure, or correction
- `memory_search` — Search memories by keyword
- `memory_recall` — Recursive L2→L3 recall for complex queries
- `memory_forget` — Remove incorrect or outdated memories
- `memory_status` — View memory statistics

## Consolidation

Run `/memory-consolidate` periodically to:
- Decay old, unused memories
- Merge duplicates
- Promote frequently-accessed memories
