import { Database } from "bun:sqlite";
import type { TxSql } from "../src/actors/shared.ts";

/** An in-memory SQLite behind the same `Sql` the actors use, for testing SQL without a server. */
export function memorySql(): { db: Database; sql: TxSql } {
  const db = new Database(":memory:");
  const sql: TxSql = {
    execute: async (q: string, ...args: unknown[]) => db.query(q).all(...(args as never[])),
    transaction: async (fn) => {
      db.run("BEGIN");
      try {
        const out = await fn(sql);
        db.run("COMMIT");
        return out;
      } catch (err) {
        db.run("ROLLBACK");
        throw err;
      }
    },
  };
  return { db, sql };
}
