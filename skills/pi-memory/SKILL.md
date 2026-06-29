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
| L3 | Long-term knowledge | Stored in SQLite, per-(project, role) |

## Just-in-Time Injection (P1-7)

The常驻 memory block (L1, injected once at session start via `before_agent_start`)
shows only a **memory index** (type + count per bucket), NOT memory content.
To retrieve actual memory text, call the `memory_recall` tool on-demand with a
query. This keeps the常驻 block tiny (~137 token for a 5-memory project vs the
old ~2300 token top-N pre-fetch) and avoids bloating context on every turn
(even a `hello`).

This is **结构性强制** (structural enforcement, not a prompt hint): the常驻
block literally has no content to read, so the LLM must call `memory_recall`
to get prior context. Research-backed (Letta/MemGPT/Claude Code all use this
分层注入 pattern; Anthropic memory-tool calls it 'just-in-time context
retrieval').

- `before_agent_start` injects the index once (re-injected after session
  switch/fork/compact — the常驻 block lives in system prompt, not messages,
  so compaction只压 messages不动常驻).
- `memory_recall(query, project, role)` returns L2 + L3 full text on-demand.
- Sub-sessions (spawn_role) inherit the same极小 index (no full父 block).

RESEARCH CAVEAT: the <800 token budget + index entry limits are推理需实战
验证 (noted in code); tune via `config.memory.l1_token_budget`.

## Per-Role Isolation (v3+) & Retention (v3+)

Memories are partitioned by `(project, role)` to prevent **串味** (memory
homogenization — one role's private memories leaking into another's search).

**Role归属 rules** (research: `multi_agent_memory_isolation_research.md`,
`main_agent_persona_memory_research.md`):

| Session | `role` bucket | Why |
|---|---|---|
| Main agent (default, or in-place `/role` persona switch) | `main` | In-place switch is a behavior overlay, not identity. Mask-induced memory fragmentation avoided (aligns with Letta). |
| `spawn_role` subagent | the role name (e.g. `researcher`, `coder`) | Spawned roles are independent buckets (aligns with Claude Code/CrewAI/Letta). |
| Cross-role generic knowledge (methodology) | `shared` | Opt-in read-only namespace; visible from any role bucket. |

The agent **self-identifies** via the `role` param on `memory_write`/
`memory_search`/`memory_recall` (agentic pattern — role name is not in session
headers; pi-memory infers from the param). Default `main`.

**Retention** (research: `memory_retention_strategy_research.md`):
- L3 is **permanent** — no time-based archiving (30/90d archiving removed; had
  no industry precedent). recency decay only lowers confidence for ranking,
  never deletes.
- **refresh-on-access**: search/recall results get confidence restored
  (MIN(1.0, +0.2)) + last_access updated (aligns with LangGraph
  refresh_on_read, GenAgents recency).
- **importance** (v4): intrinsic hardness dimension (fact/procedure high,
  preference low) — high-importance硬事实 outranks decayed low-importance in
  ranking. Default values are推理需实战验证.
- Forgetting is **explicit** (forget tool) or conflict-merge, never time-driven.

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
