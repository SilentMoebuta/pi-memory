# pi-memory

Persistent, three-tier (L1/L2/L3) memory for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent). Stores facts, decisions, preferences, procedures and corrections per project, auto-injects relevant context at session start, and consolidates (decay / archive / merge / promote) over time.

## Install

```
pi install git:github.com/SilentMoebuta/pi-memory
```

## Architecture

```
~/.pi/agent/memory/
├── agent.db            # SQLite (via sql.js) — all memories + consolidation state
├── config.toml         # tunables (budgets, consolidation, search)
├── MEMORY.md           # L1 auto-generated index (regen on shutdown)
└── sessions/<project>/ # L2 per-session summaries (agent_end writes one)
```

- **L1** (`ContextInjector`): top memories injected into the system prompt once per session via `before_agent_start`.
- **L2** (`SessionWriter`): per-session markdown summary (last response + tool calls) written on `agent_end`.
- **L3** (`memory_recall`): cross-project + consolidated memories surfaced by `memory_recall`.

## Tools (model-facing)

| Tool | Description |
|---|---|
| `memory_write` | Write a fact/decision/preference/procedure/correction. |
| `memory_search` | BM25 keyword search (with CJK jieba + bigram fallback). |
| `memory_recall` | Recursive L2/L3 recall for a query. |
| `memory_forget` | Soft-delete a memory by id. |
| `memory_status` | Counts, type/status distribution, decay status. |

## Commands

| Command | Description |
|---|---|
| `/memory-status` | View memory statistics and health. |
| `/memory-consolidate` | Run decay/merge/promote + steer agent to extract from session summaries. |
| `/memory-export [project]` | Export memories as JSON (optional project filter). |

## Configuration (`config.toml`)

```toml
[memory]
l1_token_budget = 1500   # injected into system prompt
l2_token_budget = 800

[consolidation]
auto_consolidate_on_end = true
min_interval_minutes = 30
merge_similarity_threshold = 0.6   # jaccard
promote_min_sessions = 3
decay_days = 30                    # confidence *= 0.8 after this age
archive_days = 90                  # active -> archived after this age

[search]
bm25_k1 = 1.5
bm25_b = 0.75
max_results = 20
```

## Data flow

1. `session_start` → `before_agent_start` injects L1 context (once).
2. Each turn → model calls `memory_write` / `memory_search` / `memory_recall`.
3. `agent_end` → writes L2 session summary + lightweight decay if interval elapsed;
   also schedules a debounced DB flush (belt-and-suspenders durability).
4. `session_shutdown` → regenerates `MEMORY.md` (L1) + final immediate DB flush.

## Durability & concurrency

- **Per-mutation flush:** memories are persisted to `agent.db` via a debounced
  (500ms) atomic write after every `memory_write` / `memory_forget` /
  consolidation mutation, plus a final immediate flush on `session_shutdown`
  and a debounced flush on `agent_end`. This survives SIGKILL / OOM / crashes
  that bypass the shutdown handler with at most one debounced window of loss.
- **Crash-safe atomic write:** each flush writes a unique temp file
  (`agent.db.<pid>.<ms>.tmp`), `fsync`s it, then renames. The unique temp
  name prevents collisions between concurrent pi processes; `fsync` before
  rename forces bytes to stable storage so a power loss cannot leave a
  truncated/empty DB.
- **Known limitation — concurrent same-DB writes:** pi is single-process-per-
  session by convention. If two processes both open the same project's
  `agent.db` and both mutate it, the last writer wins on flush and the
  other's writes are silently lost — file locking is not implemented. Do
  not run two pi sessions against the same project concurrently if you
  need both writers' memories preserved.

## Development

```
npm test        # vitest (46 tests)
npm run build   # tsc --noEmit
```

## License

MIT
