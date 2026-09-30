import type { DatabaseSync } from "node:sqlite";
export function d1(sqlite: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          return statement;
        },
        async first(column?: string) {
          const row = sqlite.prepare(sql).get(...(args as never[]));
          return row ? (column ? row[column] : row) : null;
        },
        async all() {
          return {
            success: true,
            results: sqlite.prepare(sql).all(...(args as never[])),
          };
        },
        async run() {
          const result = sqlite.prepare(sql).run(...(args as never[]));
          return {
            success: true,
            results: [],
            meta: { changes: Number(result.changes) },
          };
        },
        execute() {
          const stmt = sqlite.prepare(sql);
          const results = stmt.columns().length
            ? stmt.all(...(args as never[]))
            : (stmt.run(...(args as never[])), []);
          return { success: true, results };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ execute: () => unknown }>) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => s.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}
