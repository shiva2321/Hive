import { Pool, PoolClient } from "pg";
import { config } from "../config/env";
import { GraphStore } from "../storage/graph_store";

export class DatabaseManager {
  private static pgPool: Pool | null = null;
  private static localStore: GraphStore | null = null;

  public static getLocalStore(): GraphStore {
    if (!this.localStore) {
      this.localStore = new GraphStore(config.SQLITE_DB_PATH);
    }
    return this.localStore;
  }

  public static getPgPool(): Pool {
    if (!this.pgPool) {
      if (!config.DATABASE_URL) {
        throw new Error("DATABASE_URL is not configured for PostgreSQL mode.");
      }
      this.pgPool = new Pool({
        connectionString: config.DATABASE_URL,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      });

      this.pgPool.on("error", (err) => {
        console.error("Unexpected error on idle PostgreSQL client", err);
      });
    }
    return this.pgPool;
  }

  /**
   * Executes a database transaction with Row-Level Security tenant context set.
   */
  public static async withTenantClient<T>(
    tenantId: string,
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const pool = this.getPgPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Set RLS tenant context for this transaction
      await client.query("SET LOCAL app.current_tenant_id = $1", [tenantId]);
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public static async healthCheck(): Promise<{ postgres: boolean; sqlite: boolean; mode: string }> {
    let pgOk = false;
    let sqliteOk = false;

    if (config.STORAGE_MODE === "postgres" && config.DATABASE_URL) {
      try {
        const pool = this.getPgPool();
        const res = await pool.query("SELECT 1 as healthy");
        pgOk = res.rows[0]?.healthy === 1;
      } catch {
        pgOk = false;
      }
    }

    try {
      const stats = this.getLocalStore().getStats();
      sqliteOk = stats !== null;
    } catch {
      sqliteOk = false;
    }

    return {
      postgres: pgOk,
      sqlite: sqliteOk,
      mode: config.STORAGE_MODE
    };
  }

  public static async closeAll() {
    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
    }
    if (this.localStore) {
      this.localStore.close();
      this.localStore = null;
    }
  }
}
