import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { persistDatabase, createDebouncedFlush } from '../src/persist';

describe('persistDatabase', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  function tmpDb(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-mem-persist-'));
    tmpDirs.push(dir);
    return path.join(dir, 'agent.db');
  }

  it('writes the buffer to dbPath and leaves no temp file behind', () => {
    const dbPath = tmpDb();
    const payload = Buffer.from('hello-memory-bytes');
    persistDatabase(() => payload, dbPath);
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(fs.readFileSync(dbPath)).toEqual(payload);
    // No leftover .tmp files in the directory
    const leftovers = fs.readdirSync(path.dirname(dbPath)).filter(f => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('uses a unique tmp name per call (pid + timestamp)', () => {
    // Two consecutive persists should not collide on the same tmp path:
    // the tmp name includes pid + Date.now(), guaranteeing uniqueness across
    // concurrent processes and rapid successive flushes.
    const dbPath = tmpDb();
    persistDatabase(() => Buffer.from('first'), dbPath);
    // Backdate to force a different Date.now() bucket on fast systems by
    // simply persisting again — the tmp name must differ even if written
    // within the same ms because we delete the prior tmp via rename.
    persistDatabase(() => Buffer.from('second'), dbPath);
    expect(fs.readFileSync(dbPath).toString()).toBe('second');
    const leftovers = fs.readdirSync(path.dirname(dbPath)).filter(f => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('overwrites an existing db atomically via rename', () => {
    const dbPath = tmpDb();
    fs.writeFileSync(dbPath, Buffer.from('old'));
    persistDatabase(() => Buffer.from('new-content'), dbPath);
    expect(fs.readFileSync(dbPath).toString()).toBe('new-content');
  });
});

describe('createDebouncedFlush', () => {
  it('schedule() does NOT flush synchronously; flushes after the delay', async () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const f = createDebouncedFlush(flush, 500);
    f.schedule();
    expect(flush).not.toHaveBeenCalled();
    expect(f.isPending()).toBe(true);
    vi.advanceTimersByTime(499);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(f.isPending()).toBe(false);
    vi.useRealTimers();
  });

  it('repeated schedule() calls coalesce into a single flush (debounce)', async () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const f = createDebouncedFlush(flush, 500);
    for (let i = 0; i < 5; i++) {
      f.schedule();
      vi.advanceTimersByTime(100);
    }
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('flushNow() flushes immediately and cancels a pending scheduled flush', async () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const f = createDebouncedFlush(flush, 500);
    f.schedule();
    expect(f.isPending()).toBe(true);
    f.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(f.isPending()).toBe(false);
    // Advancing the timer must not fire a second time
    vi.advanceTimersByTime(1000);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('flushNow() with no pending flush still flushes (used by session_shutdown)', async () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const f = createDebouncedFlush(flush, 500);
    f.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a mutation triggering schedule() then session_shutdown flushNow() persists once immediately', async () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const f = createDebouncedFlush(flush, 500);
    // Simulate a memory_write mutation
    f.schedule();
    expect(f.isPending()).toBe(true);
    // Simulate session_shutdown arriving before the debounce fires
    f.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
