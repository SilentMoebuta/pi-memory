import { describe, it, expect } from "vitest";
import { MemoryManager } from "../src/memory/memoryManager";
import { createTestDb } from "./helpers";

describe("importance ranking (硬事实抗衰减)", () => {
  it("write assigns type-based importance default (fact/procedure high, preference low)", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const fact = mgr.write({ type: "fact", content: "API contract X", project: "p" } as any);
    const proc = mgr.write({ type: "procedure", content: "deploy steps", project: "p" } as any);
    const pref = mgr.write({ type: "preference", content: "likes vitest", project: "p" } as any);
    expect(fact.importance).toBeGreaterThan(pref.importance);
    expect(proc.importance).toBeGreaterThan(pref.importance);
  });

  it("high-importance硬事实 ranks above decayed low-importance even after long no-access", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    // old, decayed, but high-importance fact (schema/API)
    const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
    const hard = mgr.write({ type: "fact", content: "critical schema contract", project: "p", confidence: 0.4 } as any);
    mgr.runSql("UPDATE memories SET created_at = ?, last_access = NULL, confidence = 0.4 WHERE id = ?", [old, hard.id]);
    // recent but low-importance preference
    const soft = mgr.write({ type: "preference", content: "critical schema contract preference note", project: "p", confidence: 1.0 } as any);
    // empty-query fallback ranking: importance primary, then confidence
    const results = mgr.search("", { project: "p", role: "main", limit: 10 });
    const hardIdx = results.findIndex(r => r.memory.id === hard.id);
    const softIdx = results.findIndex(r => r.memory.id === soft.id);
    expect(hardIdx).toBeGreaterThanOrEqual(0);
    expect(softIdx).toBeGreaterThanOrEqual(0);
    expect(hardIdx).toBeLessThan(softIdx); //硬事实 ranks higher despite decay
  });

  it("explicit importance param overrides type default", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const m = mgr.write({ type: "fact", content: "x", project: "p", importance: 0.9 } as any);
    expect(m.importance).toBe(0.9);
  });
});
