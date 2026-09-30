// Daily costs are shared by API, checker, alert and AI Workers. Keep headroom
// for migrations, accounting, concurrency and other apps in the same account.
export const PROJECT_DAILY_READ_BUDGET = 3_000_000;
export const PROJECT_DAILY_WRITE_BUDGET = 60_000;

export function databaseRetryDelay(): number {
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  // Cap each wait at 12 hours; retry again if the UTC reset is further away.
  return Math.min(
    43200,
    Math.max(1, Math.ceil((midnight.getTime() - Date.now()) / 1000)),
  );
}

export class DatabaseBudgetError extends Error {
  constructor() {
    super(
      "PROJECT_DAILY_BUDGET: Monitoring is temporarily paused to protect the free daily database allowance. It resets at midnight UTC.",
    );
  }
}

export function isDatabaseLimit(error: unknown): boolean {
  return (
    error instanceof Error &&
    /PROJECT_DAILY_BUDGET|D1's free tier daily|exceeded.*daily.*(read|write|row).*limit/i.test(
      error.message,
    )
  );
}

type Cost = { rows_read?: number; rows_written?: number };

export async function databaseBudget(db: D1Database) {
  // Fixed date per invocation: work spanning midnight belongs to the day it
  // started, never silently increments a newly-reset day's ledger.
  const date = new Date().toISOString().slice(0, 10);
  const current = await db
    .prepare(
      "SELECT rows_read,rows_written FROM platform_daily_budget WHERE usage_date=?",
    )
    .bind(date)
    .first<{ rows_read: number; rows_written: number }>();
  let reads = 1;
  let writes = 0;
  let finished = false;
  const originals = new WeakMap<object, D1PreparedStatement>();
  function check() {
    if (
      (current?.rows_read ?? 0) + reads >= PROJECT_DAILY_READ_BUDGET ||
      (current?.rows_written ?? 0) + writes >= PROJECT_DAILY_WRITE_BUDGET
    )
      throw new DatabaseBudgetError();
  }
  check();
  function account(result: { meta?: Cost }) {
    reads += result.meta?.rows_read ?? 0;
    writes += result.meta?.rows_written ?? 0;
  }
  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    const wrapped = {
      bind(...args: unknown[]) {
        return wrap(statement.bind(...args));
      },
      async all<T>() {
        check();
        const result = await statement.all<T>();
        account(result);
        return result;
      },
      async run<T>() {
        check();
        const result = await statement.run<T>();
        account(result);
        return result;
      },
      async first<T>(column?: string) {
        // D1 first() discards meta. Execute all() to retain accurate row costs.
        check();
        const result = await statement.all<Record<string, unknown>>();
        account(result);
        const row = result.results[0];
        return (row ? (column ? row[column] : row) : null) as T | null;
      },
      async raw<T>(options?: { columnNames?: boolean }) {
        // No runtime caller uses raw(); fail closed rather than bypass metering.
        throw new Error("Unmetered raw database access is disabled");
      },
    } as D1PreparedStatement;
    originals.set(wrapped, statement);
    return wrapped;
  }
  const measured = {
    prepare(sql: string) {
      return wrap(db.prepare(sql));
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      check();
      const result = await db.batch<T>(
        statements.map((s) => originals.get(s) ?? s),
      );
      result.forEach(account);
      return result;
    },
  } as D1Database;
  return {
    DB: measured,
    async finish() {
      if (finished) return;
      finished = true;
      // Atomic addition preserves increments from concurrent invocations.
      // Include a conservative allowance for this ledger write's own cost.
      await db
        .prepare(
          `INSERT INTO platform_daily_budget(usage_date,rows_read,rows_written) VALUES(?,?,?)
        ON CONFLICT(usage_date) DO UPDATE SET rows_read=rows_read+excluded.rows_read,rows_written=rows_written+excluded.rows_written`,
        )
        .bind(date, reads + 4, writes + 2)
        .run();
    },
  };
}
