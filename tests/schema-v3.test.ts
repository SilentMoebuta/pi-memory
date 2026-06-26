import { describe, it } from "vitest";
import { expect } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import {
  CREATE_TABLES,
  INIT_VERSION,
  MIGRATE_V2_STATEMENTS,
  MIGRATE_V3_STATEMENTS,
  SCHEMA_VERSION,
} from "../src/memory/schema";

let SQL: any = null;
async function ensureSql(): Promise<any> {
  if (!SQL) SQL = await initSqlJs();
  return SQL;
}

// Build a DB at a given schema version, to test migration FROM that version.
async function buildDbAtVersion(version: 1 | 2 | 3): Promise<Database> {
  const SQL = await ensureSql();
  const db = new SQL.Database();
  db.run(CREATE_TABLES);
  db.run(INIT_VERSION);
  if (version >= 2) {
    for (const stmt of MIGRATE_V2_STATEMENTS) {
      try { db.run(stmt); } catch { /* idempotent */ }
    }
  }
  if (version >= 3) {
    for (const stmt of MIGRATE_V3_STATEMENTS) {
      try { db.run(stmt); } catch { /* idempotent */ }
    }
  }
  return db;
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const res = db.exec(`PRAGMA table_info(${table})`);
  if (!res.length) return false;
  const rows = res[0].values as unknown[][];
  return rows.some((r) => r[1] === column);
}

describe("schema v3 migration (role isolation)", () => {
  it("SCHEMA_VERSION bumped to 3", () => {
    expect(SCHEMA_VERSION).toBe(3);
  });

  it("MIGRATE_V3_STATEMENTS adds 'role' column to memories table", async () => {
    const db = await buildDbAtVersion(2); // pre-v3
    expect(hasColumn(db, "memories", "role")).toBe(false);
    for (const stmt of MIGRATE_V3_STATEMENTS) {
      try { db.run(stmt); } catch { /* idempotent */ }
    }
    expect(hasColumn(db, "memories", "role")).toBe(true);
  });

  it("existing v2 rows get role='main' default after migration (no data loss, no NULL)", async () => {
    const db = await buildDbAtVersion(2);
    const now = Date.now();
    db.run(
      `INSERT INTO memories (id, type, content, confidence, access_count, created_at, project, source, status)
       VALUES ('m1', 'fact', 'pre-v3 memory', 1.0, 0, ?, 'p1', 'agent', 'active')`,
      [now]
    );
    for (const stmt of MIGRATE_V3_STATEMENTS) {
      try { db.run(stmt); } catch { /* idempotent */ }
    }
    const res = db.exec("SELECT role FROM memories WHERE id = 'm1'");
    const role = res[0].values[0][0];
    expect(role).toBe("main");
  });

  it("v3 migration is idempotent (running twice does not error)", async () => {
    const db = await buildDbAtVersion(3);
    expect(() => {
      for (const stmt of MIGRATE_V3_STATEMENTS) {
        try { db.run(stmt); } catch { /* expected: column already exists */ }
      }
    }).not.toThrow();
    expect(hasColumn(db, "memories", "role")).toBe(true);
  });

  it("new rows inserted post-migration get role='main' default when role omitted", async () => {
    const db = await buildDbAtVersion(3);
    const now = Date.now();
    db.run(
      `INSERT INTO memories (id, type, content, confidence, access_count, created_at, project, source, status)
       VALUES ('m2', 'fact', 'post-v3 memory no role', 1.0, 0, ?, 'p1', 'agent', 'active')`,
      [now]
    );
    const res = db.exec("SELECT role FROM memories WHERE id = 'm2'");
    expect(res[0].values[0][0]).toBe("main");
  });

  it("role column accepts 'main', 'shared', and arbitrary role names (researcher/coder/etc.)", async () => {
    const db = await buildDbAtVersion(3);
    const now = Date.now();
    const roles = ["main", "shared", "researcher", "coder", "legal-counsel"];
    for (let i = 0; i < roles.length; i++) {
      db.run(
        `INSERT INTO memories (id, type, content, confidence, access_count, created_at, project, source, status, role)
         VALUES (?, 'fact', ?, 1.0, 0, ?, 'p1', 'agent', 'active', ?)`,
        [`m${i}`, `role test ${roles[i]}`, now, roles[i]]
      );
    }
    const res = db.exec("SELECT role FROM memories ORDER BY id");
    const stored = res[0].values.map((r) => r[0]);
    expect(stored.sort()).toEqual([...roles].sort());
  });
});

// ── Step 2: write/get carry role ────────────────────────────────────────────

import { MemoryManager } from "../src/memory/memoryManager";
import { createTestDb } from "./helpers";

describe("role in write/get (isolation write path)", () => {
  it("write with role='researcher' stores role='researcher'", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const m = mgr.write({ type: "fact", content: "researcher finding", project: "p", role: "researcher" } as any);
    expect(m.role).toBe("researcher");
    expect(mgr.get(m.id)!.role).toBe("researcher");
  });

  it("write without role defaults to 'main' (main agent)", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const m = mgr.write({ type: "fact", content: "main agent fact", project: "p" });
    expect(m.role).toBe("main");
  });

  it("write with role='shared' stores shared (cross-role namespace)", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const m = mgr.write({ type: "procedure", content: "generic research methodology", project: "p", role: "shared" } as any);
    expect(m.role).toBe("shared");
  });

  it("getAll returns role field on memories", async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    mgr.write({ type: "fact", content: "a", project: "p", role: "coder" } as any);
    mgr.write({ type: "fact", content: "b", project: "p" });
    const all = mgr.getAll("p");
    expect(all.some((m) => m.role === "coder")).toBe(true);
    expect(all.some((m) => m.role === "main")).toBe(true);
  });
});
