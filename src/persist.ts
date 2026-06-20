import * as fs from 'fs';

/**
 * Atomically persist a DB export to `dbPath`.
 *
 * Writes a unique temp file (per-pid + per-ms) so concurrent pi processes
 * cannot collide on the same `agent.db.tmp`, fsyncs it, then renames.
 *
 * The unique tmp name + rename-atomic swap protects against:
 *  - concurrent tmp-file collisions (two processes writing the same tmp path)
 *  - corruption of the existing DB during a crash mid-write (rename is atomic)
 *  - truncated/empty DB after a hard power loss between write and disk flush
 *    (fsync before rename forces the bytes to stable storage first)
 *
 * Known limitation (mitigated by GM-13 locking in acquireLock above): without
 * a DB-level lock, two processes both mutating the same shared DB and flushing
 * would lose data last-writer-wins. `acquireLock` lets the extension detect a
 * concurrent live writer and go read-only instead of clobbering it. See README.
 */
export function persistDatabase(exportData: () => Buffer, dbPath: string): void {
  const buffer = exportData();
  const tmpPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, buffer);
  // fsync the temp file before rename so a hard crash between write and disk
  // flush cannot leave a truncated/empty renamed DB.
  const fd = fs.openSync(tmpPath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, dbPath);
}

/**
 * GM-13: exclusive lockfile for the memory DB.
 *
 * `acquireLock` creates a lockfile atomically (O_EXCL) holding the owner's
 * pid. A second acquirer sees the existing file and — if the recorded pid is
 * still alive — is told the lock is held (`acquired: false`) so the extension
 * can switch to read-only mode instead of silently clobbering the holder's DB
 * (the documented last-writer-wins data-loss class). A stale lockfile whose
 * holder has crashed is stolen automatically.
 *
 * This is a lockfile dance (not `flock`/`fcntl`) so it stays zero-dependency
 * and works across processes by pid-liveness. Same-process re-acquire is
 * blocked (the lockfile records our own pid, which is alive) — matching the
 * cross-process semantics a single process would observe.
 */
export interface LockHandle {
  acquired: boolean;
  lockPath: string;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(lockPath: string): LockHandle {
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
    return { acquired: true, lockPath };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  // Lockfile exists — steal it only if the recorded holder is dead.
  try {
    const holderPid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
    if (Number.isFinite(holderPid) && holderPid > 0 && isPidAlive(holderPid)) {
      return { acquired: false, lockPath };
    }
  } catch {
    // unreadable / non-numeric -> treat as stale and steal below
  }
  try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
    return { acquired: true, lockPath };
  } catch {
    return { acquired: false, lockPath };
  }
}

export function releaseLock(handle: LockHandle): void {
  if (!handle.acquired) return;
  try { fs.unlinkSync(handle.lockPath); } catch { /* already gone */ }
}

export interface DebouncedFlush {
  /** Schedule a debounced flush (resets the timer on each call). */
  schedule(): void;
  /** Flush immediately and cancel any pending scheduled flush. */
  flushNow(): void;
  /** True if a flush is currently scheduled (for tests). */
  isPending(): boolean;
}

/**
 * Debounced flush: coalesce rapid mutations into one disk write.
 *
 * `schedule()` resets the timer so a burst of writes triggers one flush after
 * `delay` ms of quiet. `flushNow()` (used by session_shutdown / agent_end
 * belt-and-suspenders) cancels the pending timer and writes immediately.
 */
export function createDebouncedFlush(flush: () => void, delay = 500): DebouncedFlush {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = () => {
    timer = null;
    try {
      flush();
    } catch (err) {
      console.error('[pi-memory] debounced flush failed:', err);
    }
  };

  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delay);
    },
    flushNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        flush();
      } catch (err) {
        console.error('[pi-memory] flush failed:', err);
      }
    },
    isPending() {
      return timer !== null;
    },
  };
}
