import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
const key = Symbol.for("humeto.postgres");
const state = (globalThis[key] ||= {
  pools: new Map(),
  context: new AsyncLocalStorage(),
});
pg.types.setTypeParser(20, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw new Error("Database integer exceeds safe application range.");
  return n;
});
pg.types.setTypeParser(1700, (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER)
    throw new Error("Database numeric exceeds safe application range.");
  return n;
});
function poolFor(url) {
  if (!url)
    throw new Error(
      "DATABASE_URL is required. Run the documented PostgreSQL setup.",
    );
  if (!state.pools.has(url)) {
    const pool = new pg.Pool({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 15000,
      application_name: "humeto",
    });
    pool.on("error", () => console.error("PostgreSQL idle connection failed."));
    state.pools.set(url, pool);
  }
  return state.pools.get(url);
}
// Keep the existing parameterized repository call shape; all I/O is asynchronous.
// Question marks inside quoted SQL strings/identifiers are never parameters.
export function parameters(sql) {
  let index = 0,
    quote = "",
    out = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      out += c;
      if (c === quote) {
        if (sql[i + 1] === quote) {
          out += sql[++i];
        } else quote = "";
      }
    } else if (c === "'" || c === '"') {
      quote = c;
      out += c;
    } else if (c === "?") out += "$" + ++index;
    else out += c;
  }
  return out;
}
export function database(url = process.env.DATABASE_URL) {
  const pool = () => poolFor(url);
  async function query(sql, values = []) {
    const active = state.context.getStore();
    if (active?.url === url) {
      const result = active.tail.then(() => active.client.query(sql, values));
      active.tail = result.then(
        () => {},
        (error) => {
          active.failure ||= error;
        },
      );
      return result;
    }
    return pool().query(sql, values);
  }
  return {
    prepare(sql) {
      const text = parameters(sql);
      return {
        async all(...values) {
          return (await query(text, values)).rows;
        },
        async get(...values) {
          return (await query(text, values)).rows[0];
        },
        async run(...values) {
          return { changes: (await query(text, values)).rowCount };
        },
      };
    },
    async exec(sql) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql))
        throw new Error(
          "Use transaction() so all statements share a checked-out connection.",
        );
      await query(sql);
    },
    query,
    async transaction(fn) {
      const active = state.context.getStore();
      if (active?.url === url) return fn();
      for (let attempt = 0; ; attempt++) {
        const client = await pool().connect();
        const context = { url, client, tail: Promise.resolve(), failure: null };
        try {
          await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
          const result = await state.context.run(context, fn);
          await context.tail;
          if (context.failure) throw context.failure;
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await context.tail;
          await client.query("ROLLBACK").catch(() => {});
          if (!["40001", "40P01"].includes(error.code) || attempt >= 4)
            throw error;
        } finally {
          client.release();
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 10 + Math.random() * 30),
        );
      }
    },
    async close() {
      const p = state.pools.get(url);
      if (p) {
        state.pools.delete(url);
        await p.end();
      }
    },
  };
}
