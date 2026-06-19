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
 * Known limitation: this does NOT prevent last-writer-wins data loss when two
 * processes both mutate the same shared DB and flush — that needs file
 * locking. pi is single-process-per-session by convention; concurrent edits
 * to one shared DB are out of scope. See README.
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
