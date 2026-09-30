import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
// @ts-expect-error Node deployment utility has no TS declaration.
import { migrationStatements } from "../scripts/migration-statements.mjs";
it("applies the exact migration statements used by isolated release setup", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  try {
    for (const file of readdirSync(new URL("../migrations", import.meta.url))
      .filter((f) => /^\d.*sql$/.test(f))
      .sort())
      for (const sql of migrationStatements(
        readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
      ))
        db.prepare(sql).run();
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND name='chat_quota'",
        )
        .get()?.name,
    ).toBe("chat_quota");
    expect(
      db.prepare("SELECT environment FROM monitors LIMIT 1").all(),
    ).toEqual([]);
  } finally {
    db.close();
  }
});
