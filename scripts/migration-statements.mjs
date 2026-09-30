// Split this repository's numbered migrations without splitting trigger bodies.
// This is deliberately not a general SQL parser; regression-test it when adding SQL.
export function migrationStatements(sql) {
  const triggers = [];
  const source = sql
    .replace(/--[^\r\n]*/g, "")
    .replace(/CREATE TRIGGER[\s\S]*?(?:\r?\nEND;|; END;)/g, (trigger) => {
      triggers.push(trigger);
      return `__TRIGGER_${triggers.length - 1}__;`;
    });
  return source
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith("PRAGMA foreign_keys"))
    .map((s) =>
      /^__TRIGGER_(\d+)__$/.test(s) ? triggers[Number(s.match(/\d+/)[0])] : s,
    );
}
