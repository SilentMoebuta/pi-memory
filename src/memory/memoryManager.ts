import { Database } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import { Memory, MemoryInput, MemoryStatus, MemoryType, SearchOptions, SearchResult, RecallResult, MemoryStats } from '../types';
import { BM25Index, tokenize } from './search';
import { cosineSimilarity, fuseHybrid } from './hybrid';

export class MemoryManager {
  // BM25 cache: rebuilt on demand, invalidated on any mutation to `memories`.
  private bm25Cache: { project: string | undefined; status: MemoryStatus | undefined; asOf: number | undefined; docs: string[]; memories: Memory[]; index: BM25Index } | null = null;

  /** Optional hook fired after any mutation that should trigger a debounced
   *  DB persist (set by the extension to durably flush writes to disk). */
  onMutation?: () => void;

  constructor(private db: Database, private opts?: { embedder?: (text: string) => Promise<Float32Array> }) {}

  /** Invalidate the BM25 cache (call after any mutation to `memories`). */
  private invalidateSearchCache(): void {
    this.bm25Cache = null;
  }

  write(input: MemoryInput): Memory {
    const id = uuidv4();
    const now = Date.now();
    const role = input.role ?? 'main';
    const importance = input.importance ?? this._defaultImportance(input.type);
    this.invalidateSearchCache();
    this.db.run(
      `INSERT INTO memories (id, type, content, confidence, access_count, created_at, session_id, project, source, status, valid_from, role, importance)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [id, input.type, input.content, input.confidence ?? 1.0, now, input.sessionId ?? null, input.project ?? 'default', input.source ?? 'agent', now, role, importance]
    );
    this.onMutation?.();
    return this.get(id)!;
  }

  /** Type-based default importance. RESEARCH CAVEAT (memory_retention_strategy_research.md):
   *  exact values are推理需实战验证; the ranking MECHANISM (importance as a
   *  dimension抗 recency decay) is强证据 (GenAgents, CrewAI importance_weight 0.4). */
  private _defaultImportance(type: MemoryType): number {
    switch (type) {
      case 'fact': return 0.8;       // schema/API/config contracts — hard, stable
      case 'procedure': return 0.8; // repeatable how-to — stable
      case 'correction': return 0.6; // lessons learned — moderately stable
      case 'decision': return 0.6;  // choices — moderate
      case 'preference': return 0.3; // transient taste — soft, decays fast
      default: return 0.5;
    }
  }

  get(id: string): Memory | null {
    this.db.run('UPDATE memories SET access_count = access_count + 1, last_access = ? WHERE id = ? AND status != ?',
      [Date.now(), id, 'deleted']);

    const rows = this.db.exec(
      'SELECT id, type, content, confidence, access_count, last_access, created_at, session_id, project, source, status, superseded_by, valid_from, valid_to, role, importance FROM memories WHERE id = ?',
      [id]
    );
    if (!rows.length || !rows[0].values.length) return null;

    const row = rows[0].values[0];
    return this._rowToMemory(row);
  }

  forget(id: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    this.invalidateSearchCache();
    this.db.run('UPDATE memories SET status = ? WHERE id = ?', ['deleted', id]);
    this.onMutation?.();
    return true;
  }

  // Public DB access methods (for consolidation engine)
  runSql(sql: string, params?: any[]): void {
    if (params) this.db.run(sql, params);
    else this.db.run(sql);
    // Invalidate cache + trigger persist when the SQL mutates the `memories` table.
    if (/\bmemories\b/i.test(sql)) {
      this.invalidateSearchCache();
      this.onMutation?.();
    }
  }

  execSql(sql: string, params?: any[]): any {
    return this.db.exec(sql, params);
  }

  search(query: string, opts?: SearchOptions): SearchResult[] {
    // Wildcard / undefined project means "all projects" (used by regenL1Index).
    const projectFilter = opts?.project && opts.project !== '*' ? opts.project : undefined;
    let memories = this.getAll(projectFilter, opts?.status);
    // GM-7: when asOf is set, keep only memories valid at that timestamp
    // (valid_from <= asOf, valid_to NULL-or-after asOf). Omit asOf = unfiltered.
    if (opts?.asOf !== undefined) {
      memories = memories.filter(m =>
        (m.validFrom === null || m.validFrom <= opts.asOf!) &&
        (m.validTo === null || m.validTo > opts.asOf!)
      );
    }
    // v3: per-role isolation — when opts.role is set, keep only memories in
    // the caller's own bucket OR the shared (cross-role) namespace. Prevents
    // 串味: a spawned researcher's search does not surface main agent's or
    // coder's private memories. Omit role to search across all (admin/regen).
    if (opts?.role !== undefined) {
      memories = memories.filter(m => m.role === opts.role || m.role === 'shared');
    }
    if (memories.length === 0) return [];

    // Empty query: BM25 gives every doc score 0 (filtered out), so skip BM25
    // and return by recency/confidence (fallback ranking).
    if (!query || query.trim().length === 0) {
      let results: SearchResult[] = memories.map(m => ({ memory: m, score: 0 }));
      if (opts?.type) {
        results = results.filter(r => r.memory.type === opts.type);
      }
      results.sort((a, b) => {
        // v4: importance primary (硬事实抗衰减), then confidence (recency), then recency.
        if (b.memory.importance !== a.memory.importance) {
          return b.memory.importance - a.memory.importance;
        }
        if (b.memory.confidence !== a.memory.confidence) {
          return b.memory.confidence - a.memory.confidence;
        }
        return b.memory.createdAt - a.memory.createdAt;
      });
      const limit = opts?.limit ?? 20;
      const sliced = results.slice(0, limit);
      return opts?.refreshOnAccess ? this._refreshOnAccess(sliced) : sliced;
    }

    // BM25 with caching: reuse index when project/status scope unchanged.
    const docs = memories.map(m => m.content);
    if (!this.bm25Cache || this.bm25Cache.project !== projectFilter || this.bm25Cache.status !== opts?.status || this.bm25Cache.asOf !== opts?.asOf) {
      const index = new BM25Index();
      index.addDocuments(docs);
      this.bm25Cache = { project: projectFilter, status: opts?.status, asOf: opts?.asOf, docs, memories, index };
    }
    const index = this.bm25Cache.index;

    const bm25Results = index.search(query);
    let results: SearchResult[] = bm25Results.map(r => ({
      memory: memories[r.index],
      score: r.score,
    }));

    if (opts?.type) {
      results = results.filter(r => r.memory.type === opts.type);
    }

    const limit = opts?.limit ?? 20;
    const sliced = results.slice(0, limit);
    return opts?.refreshOnAccess ? this._refreshOnAccess(sliced) : sliced;
  }

  /** v3 refresh-on-access: when memories are surfaced in search results (the
   *  true "access" event — not internal get() reads), restore their confidence
   *  toward 1.0 (capped) + update last_access. Research: LangGraph
   *  refresh_on_read=true (default), GenAgents recency decays since last
   *  retrieval. Idempotent at 1.0. Batched single UPDATE per result set. */
  private _refreshOnAccess(results: SearchResult[]): SearchResult[] {
    if (results.length === 0) return results;
    const now = Date.now();
    for (const r of results) {
      this.db.run(
        'UPDATE memories SET last_access = ?, confidence = MIN(1.0, confidence + 0.2) WHERE id = ? AND status != ?',
        [now, r.memory.id, 'deleted']
      );
    }
    // Re-fetch updated confidence so returned SearchResult reflects the bump.
    return results.map((r) => ({ ...r, memory: this._readRaw(r.memory.id) ?? r.memory }));
  }

  /** Read a memory by id WITHOUT side effects (no access_count bump, no
   *  refresh) — used by _refreshOnAccess to reflect post-update state. */
  private _readRaw(id: string): Memory | null {
    const rows = this.db.exec(
      'SELECT id, type, content, confidence, access_count, last_access, created_at, session_id, project, source, status, superseded_by, valid_from, valid_to, role, importance FROM memories WHERE id = ?',
      [id]
    );
    if (!rows.length || !rows[0].values.length) return null;
    return this._rowToMemory(rows[0].values[0]);
  }

  /** GM-1+GM-2: hybrid retrieval — over-fetch BM25 candidates, then rerank by
   *  additive fusion of normalized BM25 + cosine similarity (via the injected
   *  embedder). Falls back to plain BM25 (`search`) when no embedder is
   *  configured or the query is empty — so the default (hybrid=false) path is
   *  unchanged. Embeddings are computed on-the-fly (no per-memory BLOB storage);
   *  storage is a YAGNI optimization pending a measurable perf need. */
  async searchHybrid(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const embedder = this.opts?.embedder;
    if (!embedder || !query || query.trim().length === 0) {
      return this.search(query, opts);
    }
    // Over-fetch candidates so semantic rerank has room to surface matches that
    // BM25 ranked lower.
    const overFetchLimit = (opts?.limit ?? 20) * 4;
    const candidates = this.search(query, { ...opts, limit: overFetchLimit });
    if (candidates.length === 0) return [];

    const queryVec = await embedder(query);
    const queryLen = tokenize(query).length;
    const scored = await Promise.all(candidates.map(async (r) => {
      const memVec = await embedder(r.memory.content);
      const cosine = cosineSimilarity(queryVec, memVec);
      const fused = fuseHybrid({ bm25Raw: r.score, queryLen, cosine }, { bm25: 1.0, semantic: 1.0 });
      return { memory: r.memory, score: fused };
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, opts?.limit ?? 20);
  }

  /** GM-1+GM-2: recall uses hybrid retrieval when an embedder is configured,
   *  else plain BM25 search. */
  async recall(query: string, project: string, role: string = 'main', refreshOnAccess: boolean = false): Promise<RecallResult> {
    const searchFn = this.opts?.embedder ? this.searchHybrid.bind(this) : this.search.bind(this);
    const l2Results = await searchFn(query, { project, role, limit: 5, refreshOnAccess });
    const l3Results = await searchFn(query, { role, limit: 5, refreshOnAccess });
    const l3Filtered = l3Results.filter(r =>
      r.memory.project !== project || r.memory.source === 'consolidated'
    );

    const seen = new Set<string>();
    const combined: SearchResult[] = [];
    for (const r of [...l2Results, ...l3Filtered]) {
      if (!seen.has(r.memory.id)) {
        seen.add(r.memory.id);
        combined.push(r);
      }
    }
    combined.sort((a, b) => b.score - a.score);

    return {
      l2Results,
      l3Results: l3Filtered,
      combined: combined.slice(0, 10),
    };
  }

  getStats(project?: string): MemoryStats {
    const params: any[] = ['deleted'];
    let projectFilter = '';
    if (project) {
      projectFilter = ' AND project = ?';
      params.push(project);
    }

    const totalRow = this.db.exec(
      `SELECT COUNT(*) FROM memories WHERE status != ?${projectFilter}`, params
    );
    const total = (totalRow[0]?.values[0][0] as number) || 0;

    const typeRow = this.db.exec(
      `SELECT type, COUNT(*) FROM memories WHERE status != ?${projectFilter} GROUP BY type`, params
    );
    const byType: Record<string, number> = {};
    if (typeRow.length) {
      for (const row of typeRow[0].values) {
        byType[row[0] as string] = row[1] as number;
      }
    }

    const statusRow = this.db.exec(
      `SELECT status, COUNT(*) FROM memories WHERE status != 'deleted'${projectFilter} GROUP BY status`,
      project ? [project] : []
    );
    const byStatus: Record<string, number> = {};
    if (statusRow.length) {
      for (const row of statusRow[0].values) {
        byStatus[row[0] as string] = row[1] as number;
      }
    }

    const projectRow = this.db.exec(
      `SELECT project, COUNT(*) FROM memories WHERE status != 'deleted' GROUP BY project`, []
    );
    const byProject: Record<string, number> = {};
    if (projectRow.length) {
      for (const row of projectRow[0].values) {
        byProject[row[0] as string] = row[1] as number;
      }
    }

    const avgParams: any[] = [];
    if (project) avgParams.push(project);
    const avgConfRow = this.db.exec(
      `SELECT AVG(confidence) FROM memories WHERE status = 'active'${projectFilter}`, avgParams
    );
    const avgConfidence = (avgConfRow[0]?.values[0][0] as number) || 0;

    const lastConsRow = this.db.exec(
      `SELECT MAX(last_processed_at) FROM consolidation_cursor${project ? ' WHERE project = ?' : ''}`,
      project ? [project] : []
    );
    const lastConsolidation = (lastConsRow[0]?.values[0][0] as number) || null;

    return {
      total,
      byType: byType as any,
      byStatus: byStatus as any,
      byProject,
      lastConsolidation,
      avgConfidence,
    };
  }
  getAll(project?: string, status?: MemoryStatus): Memory[] {
    // Wildcard '*' means all projects (used by regenL1Index / context injection).
    const effectiveProject = project && project !== '*' ? project : undefined;
    let sql = 'SELECT id, type, content, confidence, access_count, last_access, created_at, session_id, project, source, status, superseded_by, valid_from, valid_to, role, importance FROM memories WHERE status != ?';
    const params: any[] = ['deleted'];
    if (effectiveProject) { sql += ' AND project = ?'; params.push(effectiveProject); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    const rows = this.db.exec(sql, params);
    if (!rows.length) return [];
    return rows[0].values.map((row: any[]) => this._rowToMemory(row));
  }

  private _rowToMemory(row: any[]): Memory {
    return {
      id: row[0], type: row[1], content: row[2],
      confidence: row[3], accessCount: row[4],
      lastAccess: row[5], createdAt: row[6],
      sessionId: row[7], project: row[8],
      source: row[9], status: row[10],
      supersededBy: row[11],
      validFrom: row[12] ?? null,
      validTo: row[13] ?? null,
      role: row[14] ?? 'main',
      importance: row[15] ?? 0.5,
    };
  }
}
