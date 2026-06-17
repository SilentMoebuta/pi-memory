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

  it('should inject L1 and L2 context on first call', () => {
    const result = injector.buildContext('test-project');
    expect(result).toContain('Memory');
    expect(result.length).toBeGreaterThan(0);
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
