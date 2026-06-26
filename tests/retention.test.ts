import { describe, it, expect } from "vitest";
import { MemoryManager } from "../src/memory/memoryManager";
import { ConsolidationEngine } from "../src/consolidation/engine";
import { createTestDb } from "./helpers";

describe("retention: L3 permanent + recency only压排序 (cancel archive)", () => {
  it("memory older than archiveDays stays 'active' (not archived) — L3 permanent", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const engine = new ConsolidationEngine(mgr);
    // insert a memory 200 days old, never accessed
    const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
    const m = mgr.write({ type: "fact", content: "ancient schema fact", project: "p" } as any);
    // backdate createdAt + lastAccess=null
    mgr.runSql("UPDATE memories SET created_at = ?, last_access = NULL WHERE id = ?", [old, m.id]);
    // run decay with archiveDays=90 (would have archived before)
    engine.runDecay("p", 30, 90);
    const after = mgr.get(m.id)!;
    expect(after.status).toBe("active"); // NOT archived — L3 permanent
  });

  it("recency decay still lowers confidence for ranking (压排序, not delete)", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const engine = new ConsolidationEngine(mgr);
    const old = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60d, past decayDays=30
    const m = mgr.write({ type: "fact", content: "stale fact", project: "p", confidence: 1.0 } as any);
    mgr.runSql("UPDATE memories SET created_at = ?, last_access = NULL WHERE id = ?", [old, m.id]);
    engine.runDecay("p", 30, 90);
    const after = mgr.get(m.id)!;
    expect(after.status).toBe("active");
    expect(after.confidence).toBeLessThan(1.0); // decayed (ranking signal)
    expect(after.confidence).toBeGreaterThan(0); // not zeroed/deleted
  });

  it("access (refresh-on-access) restores confidence —访问复活", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const engine = new ConsolidationEngine(mgr);
    const old = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const m = mgr.write({ type: "fact", content: "revive me", project: "p", confidence: 1.0 } as any);
    mgr.runSql("UPDATE memories SET created_at = ?, last_access = NULL WHERE id = ?", [old, m.id]);
    engine.runDecay("p", 30, 90);
    const decayed = mgr.get(m.id)!;
    expect(decayed.confidence).toBeLessThan(1.0);
    // access via search with refreshOnAccess (the tool-level access path) —
    // a surfaced result gets confidence restored toward 1.0 + last_access set.
    const hits = mgr.search("revive", { project: "p", role: "main", refreshOnAccess: true });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const revived = mgr.get(m.id)!;
    expect(revived.confidence).toBeGreaterThan(decayed.confidence); // 访问复活
    expect(revived.lastAccess).not.toBeNull();
  });
});

describe("consolidation: per-role (no cross-role merge, shared read-only)", () => {
  it("runMerge does not merge across roles (researcher dup + coder dup stay separate)", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const engine = new ConsolidationEngine(mgr);
    // two identical-content memories but different roles
    mgr.write({ type: "fact", content: "dup xyz", project: "p", confidence: 1.0, role: "researcher" } as any);
    mgr.write({ type: "fact", content: "dup xyz", project: "p", confidence: 0.5, role: "coder" } as any);
    const { merged } = await engine.runMerge("p", 0.6);
    expect(merged).toBe(0); // NOT merged — different roles, no串味
    const all = mgr.getAll("p");
    expect(all.filter((m) => m.status === "superseded").length).toBe(0);
  });

  it("runMerge merges within same role (researcher dup + dup)", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const engine = new ConsolidationEngine(mgr);
    mgr.write({ type: "fact", content: "dup abc", project: "p", confidence: 1.0, role: "researcher" } as any);
    mgr.write({ type: "fact", content: "dup abc", project: "p", confidence: 0.5, role: "researcher" } as any);
    const { merged } = await engine.runMerge("p", 0.6);
    expect(merged).toBe(1); // merged within same role
  });

  it("shared memories are not merged into role-private buckets (read-only namespace)", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const engine = new ConsolidationEngine(mgr);
    mgr.write({ type: "fact", content: "shared methodology", project: "p", confidence: 1.0, role: "shared" } as any);
    mgr.write({ type: "fact", content: "shared methodology", project: "p", confidence: 0.5, role: "researcher" } as any);
    const { merged } = await engine.runMerge("p", 0.6);
    // shared is read-only — researcher's dup should NOT supersede the shared one
    const shared = mgr.getAll("p").find((m) => m.role === "shared");
    expect(shared!.status).toBe("active"); // shared untouched
  });
});
