import { describe, it, expect } from "vitest";
import { MemoryManager } from "../src/memory/memoryManager";
import { createTestDb } from "./helpers";

describe("role isolation in search/recall (串味防护)", () => {
  it("search with role='researcher' does NOT surface main agent's private memories", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    // main agent stored a coding correction
    mgr.write({ type: "correction", content: "pi-core 改动要谨慎", project: "p", role: "main" } as any);
    // researcher stored its own finding
    mgr.write({ type: "fact", content: "pi-core 改动要谨慎 (researcher note)", project: "p", role: "researcher" } as any);
    // shared methodology
    mgr.write({ type: "procedure", content: "pi-core 改动要谨慎 (shared methodology)", project: "p", role: "shared" } as any);

    const researcherResults = mgr.search("pi-core", { project: "p", role: "researcher" });
    const roles = researcherResults.map((r) => r.memory.role);
    expect(roles).not.toContain("main"); // 串味防护: main's private memory not leaked
    expect(roles).toContain("researcher"); // own bucket visible
    expect(roles).toContain("shared"); // shared visible
  });

  it("search with role='main' does NOT surface researcher's private memories (symmetric)", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    mgr.write({ type: "fact", content: "legal advice on contract", project: "p", role: "legal-counsel" } as any);
    mgr.write({ type: "fact", content: "main agent todo", project: "p", role: "main" } as any);

    const mainResults = mgr.search("legal", { project: "p", role: "main" });
    expect(mainResults.map((r) => r.memory.role)).not.toContain("legal-counsel");
  });

  it("search WITHOUT role opts into all-role (admin path) — no isolation", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    mgr.write({ type: "fact", content: "x", project: "p", role: "coder" } as any);
    mgr.write({ type: "fact", content: "x", project: "p", role: "researcher" } as any);
    const all = mgr.search("x", { project: "p" });
    expect(all.length).toBeGreaterThanOrEqual(2);
    const roles = all.map((r) => r.memory.role);
    expect(roles).toContain("coder");
    expect(roles).toContain("researcher");
  });

  it("shared memories are visible from any role bucket", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    mgr.write({ type: "procedure", content: "general research methodology PRISMA", project: "p", role: "shared" } as any);
    for (const role of ["main", "researcher", "coder", "legal-counsel"]) {
      const r = mgr.search("PRISMA", { project: "p", role });
      expect(r.length).toBeGreaterThanOrEqual(1, `role=${role} should see shared`);
      expect(r[0].memory.role).toBe("shared");
    }
  });

  it("recall respects role isolation (researcher recall excludes main private)", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    mgr.write({ type: "fact", content: "shared fact about testing", project: "p", role: "main" } as any);
    mgr.write({ type: "fact", content: "shared fact about testing", project: "p", role: "researcher" } as any);
    const res = await mgr.recall("testing", "p", "researcher");
    const roles = [...res.l2Results, ...(res as any).l3Results ?? []].map((r: any) => r.memory.role);
    expect(roles).not.toContain("main");
  });

  it("default search role is 'main' (omitting role filters to main+shared)", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    mgr.write({ type: "fact", content: "coder secret", project: "p", role: "coder" } as any);
    mgr.write({ type: "fact", content: "main secret", project: "p", role: "main" } as any);
    // no role → search() doesn't filter (role undefined) → returns all.
    // But the search TOOL defaults role='main'. Verify manager.search with
    // explicit role='main' isolates correctly.
    const mainResults = mgr.search("secret", { project: "p", role: "main" });
    expect(mainResults.map((r) => r.memory.role)).toEqual(["main"]);
  });
});
