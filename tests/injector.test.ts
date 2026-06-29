import { describe, it, expect, beforeAll } from 'vitest';
import { Database } from 'sql.js';
import { createTestDb, insertMemory } from './helpers';
import { MemoryManager } from '../src/memory/memoryManager';
import { ContextInjector } from '../src/context/injector';

describe('ContextInjector', () => {
  let db: Database;
  let manager: MemoryManager;
  let injector: ContextInjector;

  beforeAll(async () => {
    db = await createTestDb();
    manager = new MemoryManager(db);
    injector = new ContextInjector(manager);
  });

  it('v3: empty memory DB → empty context (no index to show)', () => {
    const result = injector.buildContext('test-project');
    expect(result).toBe(''); // no memories → no常驻 block
  });

  it('should not exceed token budget', () => {
    for (let i = 0; i < 50; i++) {
      insertMemory(db, {
        type: 'fact',
        content: `Memory ${i}: important project information about architecture and design patterns`,
        project: 'test-project',
      });
    }
    const result = injector.buildContext('test-project');
    expect(result.length).toBeLessThan(8000);
  });

  it('should skip injection after first call (once per session)', () => {
    injector.reset();
    const first = injector.buildContext('test-project');
    const second = injector.buildContext('test-project');
    expect(second).toBe('');
  });
});

// ── P1-7: just-in-time injection (极小常驻索引 + 结构性强制) ────────────────

describe('P1-7: just-in-time injection', () => {
  it('常驻块是索引格式(类型计数), 不是 top-N 正文行', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const inj = new ContextInjector(mgr);
    mgr.write({ type: 'fact', content: '事实记忆正文一'.repeat(20), project: 'p' });
    mgr.write({ type: 'decision', content: '决策记忆正文二'.repeat(20), project: 'p' });
    const result = inj.buildContext('p');
    // 索引格式: 含类型计数(如 'fact' 出现), 不是 top-N 正文行
    expect(result).toMatch(/fact/i);
    expect(result).toMatch(/decision/i);
    // 不应是 '- [fact] <正文前 N 字>' 这种预取正文行格式
    expect(result).not.toMatch(/^- \[fact\]/m);
  });

  it('常驻块不含记忆正文全文(结构性强制)', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const inj = new ContextInjector(mgr);
    const longContent = '这是一段非常长的项目记忆正文内容, 包含架构决策细节 API 契约 schema 定义等, 如果被预取进常驻会膨胀上下文'.repeat(3);
    mgr.write({ type: 'fact', content: longContent, project: 'p' });
    const result = inj.buildContext('p');
    const longPhrase = 'API 契约 schema 定义等, 如果被预取进常驻会膨胀上下文'.repeat(2);
    expect(result).not.toContain(longPhrase);
  });

  it('常驻预算 < 800 token (~3200 chars)', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const inj = new ContextInjector(mgr);
    for (let i = 0; i < 20; i++) {
      mgr.write({ type: 'fact', content: `记忆 ${i}: 一些项目信息关于架构和设计模式`.repeat(5), project: 'p' });
    }
    const result = inj.buildContext('p');
    expect(result.length).toBeLessThan(3200);
  });

  it('常驻块引导 LLM 用 memory_recall 按需拉正文', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const inj = new ContextInjector(mgr);
    mgr.write({ type: 'fact', content: 'some memory', project: 'p' });
    const result = inj.buildContext('p');
    expect(result.toLowerCase()).toMatch(/recall|memory_recall|按需|retrieve/);
  });
});
