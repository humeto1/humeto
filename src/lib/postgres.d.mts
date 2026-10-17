export type Row = Record<string, any>;
export type Database = {
  prepare(sql: string): {
    all(...values: any[]): Promise<Row[]>;
    get(...values: any[]): Promise<Row | undefined>;
    run(...values: any[]): Promise<{ changes: number }>;
  };
  exec(sql: string): Promise<void>;
  query(
    sql: string,
    values?: any[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
  transaction<T>(fn: () => Promise<T> | T): Promise<T>;
  close(): Promise<void>;
};
export function database(url?: string): Database;
export function parameters(sql: string): string;
