import { DatabaseSync } from "node:sqlite";
import { drizzle as drizzleProxy } from "drizzle-orm/pg-proxy";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { Table, SQL, Param, is, sql } from "drizzle-orm";
import pg from "pg";
import fs from "fs";
import os from "os";
import path from "path";
import * as schema from "./schema";

const { Pool } = pg;

type AppDb = NodePgDatabase<typeof schema>;

let dbInstance: AppDb;
let sqliteDb: DatabaseSync | null = null;
let pgPool: pg.Pool | null = null;

class SqlitePgDialect extends PgDialect {
  override buildInsertQuery({ table, values: valuesOrSelect, onConflict, returning, withList }: any) {
    const valuesSqlList: any[] = [];
    const columns = table[(Table as any).Symbol.Columns];
    const colEntries = Object.entries(columns).filter(([_, col]: any) => !col.shouldDisableInsert());
    const insertOrder = colEntries.map(([, column]: any) => sql.identifier((this as any).casing?.getColumnCasing(column) || column.name));
    const values = valuesOrSelect;
    valuesSqlList.push(sql.raw("values "));
    for (const [valueIndex, value] of values.entries()) {
      const valueList: any[] = [];
      for (const [fieldName, col] of colEntries as any) {
        const colValue = value[fieldName];
        if (colValue === void 0 || (is(colValue, Param) && colValue.value === void 0)) {
          if (col.columnType === "PgSerial") {
            valueList.push(sql`null`);
          } else if (col.default !== null && col.default !== void 0) {
            if (is(col.default, SQL)) {
              valueList.push(sql`CURRENT_TIMESTAMP`);
            } else {
              valueList.push(sql.param(col.default, col));
            }
          } else if (col.defaultFn !== void 0) {
            const defaultFnResult = col.defaultFn();
            valueList.push(is(defaultFnResult, SQL) ? defaultFnResult : sql.param(defaultFnResult, col));
          } else if (col.notNull) {
            if (col.dataType === "number" || col.dataType === "boolean") valueList.push(sql`0`);
            else if (col.dataType === "date") valueList.push(sql`CURRENT_TIMESTAMP`);
            else if (col.dataType === "json") valueList.push(sql`'{}'`);
            else valueList.push(sql`''`);
          } else {
            valueList.push(sql`null`);
          }
        } else {
          valueList.push(colValue);
        }
      }
      valuesSqlList.push(valueList);
      if (valueIndex < values.length - 1) valuesSqlList.push(sql`, `);
    }
    const withSql = (this as any).buildWithCTE(withList);
    const valuesSql = sql.join(valuesSqlList);
    const returningSql = returning ? sql` returning ${(this as any).buildSelection(returning, { isSingleTable: true })}` : void 0;
    const onConflictSql = onConflict ? sql` on conflict ${onConflict}` : void 0;
    return sql`${withSql}insert into ${table} ${insertOrder} ${valuesSql}${onConflictSql}${returningSql}`;
  }
}

function normalizeSqliteParam(val: any): any {
  if (val === undefined || val === null) return null;
  if (typeof val === "boolean") return val ? 1 : 0;
  if (val instanceof Date) return val.toISOString().replace("T", " ").replace(/Z$/, "");
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(val)) {
    return val.replace("T", " ").replace(/Z$/, "");
  }
  if (typeof val === "object" && !(val instanceof Uint8Array)) {
    return JSON.stringify(val);
  }
  return val;
}

function translatePgSqlToSqlite(queryStr: string, params: any[]): { sqlText: string; boundParams: any[] } {
  const boundParams: any[] = [];
  let sqlText = queryStr
    .replace(/::(int|integer|text|jsonb|json|boolean|timestamp|numeric|float8|varchar)\b/gi, "")
    .replace(/\bILIKE\b/gi, "LIKE")
    .replace(/\$(\d+)/g, (_match, idxStr) => {
      const idx = Number(idxStr) - 1;
      boundParams.push(normalizeSqliteParam(params[idx]));
      return "?";
    });
  return { sqlText, boundParams };
}

function initSqliteFallback(forceReset = false) {
  const preferredDir = process.env.PGDATA_DIR || path.join(process.cwd(), ".data");
  let dataDir = preferredDir;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    dataDir = path.join(os.tmpdir(), "ai-business-hunter-sqlite-v4");
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch {}
  }
  const dbFilePath = path.join(dataDir, "vanguard.sqlite");
  try {
    if (sqliteDb) {
      try {
        sqliteDb.close();
      } catch {}
      sqliteDb = null;
    }
    if (forceReset && fs.existsSync(dbFilePath)) {
      fs.rmSync(dbFilePath, { force: true });
    }
    fs.mkdirSync(dataDir, { recursive: true });
    sqliteDb = new DatabaseSync(dbFilePath);
    sqliteDb.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  } catch {
    sqliteDb = new DatabaseSync(":memory:");
  }

  dbInstance = drizzleProxy(
    async (queryStr, params, method) => {
      if (!sqliteDb) initSqliteFallback();
      const { sqlText, boundParams } = translatePgSqlToSqlite(queryStr, params);
      const stmt = sqliteDb!.prepare(sqlText);
      const isReturningOrSelect = /^\s*(select\b|with\b|pragma\b)|\breturning\b/i.test(sqlText);
      if (method === "all" || isReturningOrSelect) {
        stmt.setReturnArrays(true);
        const rawRows = stmt.all(...boundParams) as unknown as any[][];
        const colMeta = stmt.columns ? stmt.columns() : [];
        const rows = rawRows.map((row) =>
          row.map((val, c) => {
            if (val === null || val === undefined) return null;
            const cType = String(colMeta[c]?.type || "").toUpperCase();
            if (cType.includes("BOOL")) return Boolean(val);
            if (cType.includes("TIMESTAMP") && typeof val === "string") {
              return val.replace("T", " ").replace(/Z$/, "");
            }
            return val;
          })
        );
        return { rows };
      } else {
        stmt.run(...boundParams);
        return { rows: [] };
      }
    },
    { schema },
    () => new SqlitePgDialect()
  ) as unknown as AppDb;
}

const rawDbUrl = (process.env.DATABASE_URL || "").trim();
if (/^postgres(ql)?:\/\//i.test(rawDbUrl)) {
  const needsSsl =
    Boolean(process.env.RENDER) ||
    /sslmode=require|render\.com|dpg-|neon\.tech|supabase\.co|aws\.neon\.tech|cockroachlabs/i.test(rawDbUrl) ||
    process.env.PGSSLMODE === "require";
  pgPool = new Pool({
    connectionString: rawDbUrl,
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 6000,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  pgPool.on("error", (err) => {
    console.error("[db] Unexpected error on idle PostgreSQL client (handled safely):", err.message);
  });
  dbInstance = drizzlePg(pgPool, { schema });
} else {
  initSqliteFallback();
}

export const db = new Proxy({} as AppDb, {
  get(_target, prop, receiver) {
    const value = Reflect.get(dbInstance, prop, receiver);
    return typeof value === "function" ? value.bind(dbInstance) : value;
  },
});
export * from "./schema";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS site_config (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_accounts (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'gmail',
  host TEXT NOT NULL DEFAULT 'smtp.gmail.com',
  port INTEGER NOT NULL DEFAULT 587,
  secure BOOLEAN NOT NULL DEFAULT false,
  "user" TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT 'AI Business Hunter',
  from_email TEXT NOT NULL DEFAULT '',
  imap_enabled BOOLEAN NOT NULL DEFAULT false,
  imap_host TEXT NOT NULL DEFAULT 'imap.gmail.com',
  imap_port INTEGER NOT NULL DEFAULT 993,
  active BOOLEAN NOT NULL DEFAULT true,
  sent_count INTEGER NOT NULL DEFAULT 0,
  daily_limit INTEGER NOT NULL DEFAULT 0,
  sent_today INTEGER NOT NULL DEFAULT 0,
  last_sent_day TEXT NOT NULL DEFAULT '',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  last_error_at TIMESTAMP,
  auto_paused BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS automation_settings (
  id SERIAL PRIMARY KEY,
  auto_hunt_enabled BOOLEAN NOT NULL DEFAULT false,
  hunt_category TEXT NOT NULL DEFAULT 'Restaurant',
  hunt_city TEXT NOT NULL DEFAULT 'Austin',
  hunt_country TEXT NOT NULL DEFAULT 'USA',
  hunt_count INTEGER NOT NULL DEFAULT 10,
  hunt_extra_context TEXT NOT NULL DEFAULT '',
  hunt_interval_hours INTEGER NOT NULL DEFAULT 24,
  auto_score BOOLEAN NOT NULL DEFAULT true,
  auto_email BOOLEAN NOT NULL DEFAULT false,
  email_delay_minutes INTEGER NOT NULL DEFAULT 20,
  auto_reply BOOLEAN NOT NULL DEFAULT false,
  follow_up_enabled BOOLEAN NOT NULL DEFAULT false,
  follow_up_days INTEGER NOT NULL DEFAULT 4,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  run_stats JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_tracking (
  id SERIAL PRIMARY KEY,
  tracking_id TEXT NOT NULL UNIQUE,
  prospect_email TEXT NOT NULL DEFAULT '',
  email_type TEXT NOT NULL DEFAULT 'outreach',
  subject TEXT NOT NULL DEFAULT '',
  opens INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  first_open_at TIMESTAMP,
  last_open_at TIMESTAMP,
  first_click_at TIMESTAMP,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_tracking_email ON email_tracking(prospect_email);

CREATE TABLE IF NOT EXISTS follow_up_queue (
  id SERIAL PRIMARY KEY,
  prospect_email TEXT NOT NULL,
  business_name TEXT NOT NULL DEFAULT '',
  original_subject TEXT NOT NULL DEFAULT '',
  original_body TEXT NOT NULL DEFAULT '',
  first_sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  follow_up_sent_at TIMESTAMP,
  follow_up_days INTEGER NOT NULL DEFAULT 4,
  account_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inbox_replies (
  id SERIAL PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  account_id INTEGER,
  prospect_email TEXT NOT NULL DEFAULT '',
  business_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  classification TEXT NOT NULL DEFAULT 'other',
  ai_response TEXT NOT NULL DEFAULT '',
  ai_replied_at TIMESTAMP,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS external_api_keys (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS website_reports (
  report_id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  analysis_data JSONB DEFAULT '{}'::jsonb,
  report_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_viewed TIMESTAMP,
  last_viewed TIMESTAMP,
  total_views INTEGER NOT NULL DEFAULT 0,
  proposal_requested BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  last_notified_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS affiliate_campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  email_subject TEXT NOT NULL DEFAULT '',
  email_template TEXT NOT NULL DEFAULT '',
  affiliate_link TEXT NOT NULL DEFAULT '',
  send_interval_minutes INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'draft',
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  total_contacts INTEGER NOT NULL DEFAULT 0,
  opens_count INTEGER NOT NULL DEFAULT 0,
  clicks_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS affiliate_contacts (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL,
  business_name TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  generated_message TEXT NOT NULL DEFAULT '',
  generated_subject TEXT NOT NULL DEFAULT '',
  tracking_id TEXT NOT NULL DEFAULT '',
  sent_at TIMESTAMP,
  error_msg TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_affiliate_contacts_campaign ON affiliate_contacts(campaign_id);

CREATE TABLE IF NOT EXISTS crm_prospects (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  company_size TEXT NOT NULL DEFAULT '1-10',
  service TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'lead',
  priority TEXT NOT NULL DEFAULT 'medium',
  deal_value INTEGER NOT NULL DEFAULT 2500,
  source TEXT NOT NULL DEFAULT 'ai_hunter',
  ai_score INTEGER,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS user_id INTEGER;

CREATE TABLE IF NOT EXISTS saas_users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  plan_id TEXT NOT NULL DEFAULT 'starter',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  subscription_status TEXT NOT NULL DEFAULT 'active',
  hunts_used_this_month INTEGER NOT NULL DEFAULT 0,
  emails_sent_this_month INTEGER NOT NULL DEFAULT 0,
  audits_run_this_month INTEGER NOT NULL DEFAULT 0,
  ai_employee_runs_used_this_month INTEGER NOT NULL DEFAULT 0,
  credits_balance INTEGER NOT NULL DEFAULT 250,
  status TEXT NOT NULL DEFAULT 'active',
  email_verified BOOLEAN NOT NULL DEFAULT false,
  auth_provider TEXT NOT NULL DEFAULT 'email',
  session_token TEXT NOT NULL DEFAULT '',
  last_login_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS saas_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT '',
  monthly_price INTEGER NOT NULL DEFAULT 49,
  annual_price INTEGER NOT NULL DEFAULT 39,
  monthly_hunt_limit INTEGER NOT NULL DEFAULT 500,
  monthly_email_limit INTEGER NOT NULL DEFAULT 2500,
  max_email_accounts INTEGER NOT NULL DEFAULT 3,
  bulk_hunt_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_pilot_enabled BOOLEAN NOT NULL DEFAULT false,
  ai_employee_runs_limit INTEGER NOT NULL DEFAULT 10,
  hunter_intel_enabled BOOLEAN NOT NULL DEFAULT true,
  smtp_failover_enabled BOOLEAN NOT NULL DEFAULT true,
  lemon_checkout_url TEXT NOT NULL DEFAULT '',
  lemon_variant_id TEXT NOT NULL DEFAULT '',
  features JSONB DEFAULT '[]'::jsonb,
  is_popular BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS saas_payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  user_email TEXT NOT NULL,
  user_name TEXT NOT NULL DEFAULT '',
  plan_id TEXT NOT NULL,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  amount_usd INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  crypto_network TEXT NOT NULL DEFAULT '',
  wallet_address TEXT NOT NULL DEFAULT '',
  tx_hash_or_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_activities (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_email TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_messages (
  id SERIAL PRIMARY KEY,
  thread_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  user_email TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  sender_role TEXT NOT NULL DEFAULT 'user',
  sender_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  read_by_user BOOLEAN NOT NULL DEFAULT false,
  read_by_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_saas_users_token ON saas_users(session_token);
CREATE INDEX IF NOT EXISTS idx_crm_prospects_user ON crm_prospects(user_id);
CREATE INDEX IF NOT EXISTS idx_saas_payments_user ON saas_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_user ON user_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_user ON support_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id);

CREATE TABLE IF NOT EXISTS generated_websites (
  site_id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL DEFAULT '',
  business_name TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'USA',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  original_website TEXT NOT NULL DEFAULT '',
  detection_status TEXT NOT NULL DEFAULT 'no_website',
  original_score INTEGER NOT NULL DEFAULT 0,
  theme_id TEXT NOT NULL DEFAULT 'valley_craft',
  site_config JSONB DEFAULT '{}'::jsonb,
  site_url TEXT NOT NULL DEFAULT '',
  pitch_subject TEXT NOT NULL DEFAULT '',
  pitch_body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready',
  total_views INTEGER NOT NULL DEFAULT 0,
  funnel_submissions_count INTEGER NOT NULL DEFAULT 0,
  funnel_submissions JSONB DEFAULT '[]'::jsonb,
  claim_requested BOOLEAN NOT NULL DEFAULT false,
  claim_data JSONB DEFAULT '{}'::jsonb,
  created_by_email TEXT NOT NULL DEFAULT 'jwandersonar@gmail.com',
  first_viewed_at TIMESTAMP,
  last_viewed_at TIMESTAMP,
  claimed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_generated_websites_creator_created ON generated_websites(created_by_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_websites_prospect ON generated_websites(prospect_id);
CREATE INDEX IF NOT EXISTS idx_crm_prospects_updated ON crm_prospects(updated_at DESC);

CREATE TABLE IF NOT EXISTS saved_search_filters (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  filters_json JSONB DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_saved_search_filters_user ON saved_search_filters(user_id);

CREATE TABLE IF NOT EXISTS custom_report_templates (
  id SERIAL PRIMARY KEY,
  report_code TEXT NOT NULL UNIQUE,
  user_id INTEGER,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  metrics_config JSONB DEFAULT '{}'::jsonb,
  generated_snapshot JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_custom_report_templates_user ON custom_report_templates(user_id);

CREATE TABLE IF NOT EXISTS crm_integrations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  auth_type TEXT NOT NULL DEFAULT 'private_app_token',
  instance_url TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT '',
  portal_or_org_id TEXT NOT NULL DEFAULT '',
  sync_direction TEXT NOT NULL DEFAULT 'bidirectional',
  auto_sync_on_import BOOLEAN NOT NULL DEFAULT true,
  auto_sync_on_stage_change BOOLEAN NOT NULL DEFAULT true,
  field_mapping JSONB DEFAULT '{}'::jsonb,
  stage_mapping JSONB DEFAULT '{}'::jsonb,
  last_sync_at TIMESTAMP,
  last_sync_status TEXT NOT NULL DEFAULT 'idle',
  total_synced_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_crm_integrations_user ON crm_integrations(user_id);

CREATE TABLE IF NOT EXISTS crm_sync_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  integration_id INTEGER,
  provider TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'push',
  action TEXT NOT NULL DEFAULT '',
  records_processed INTEGER NOT NULL DEFAULT 0,
  records_succeeded INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_crm_sync_logs_user ON crm_sync_logs(user_id);

CREATE TABLE IF NOT EXISTS ai_employees (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  name TEXT NOT NULL DEFAULT 'Alex — Senior AI Sales Employee',
  role TEXT NOT NULL DEFAULT 'Autonomous Lead Discovery & Outreach Specialist',
  description TEXT NOT NULL DEFAULT 'Autonomous AI employee for finding qualified B2B prospects, deep website diagnostics, tailored offer synthesis, and managed cold outreach sequences.',
  avatar TEXT NOT NULL DEFAULT '🕵️',
  status TEXT NOT NULL DEFAULT 'active',
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_employee_runs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  employee_id INTEGER NOT NULL DEFAULT 1,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  progress INTEGER NOT NULL DEFAULT 0,
  current_task_index INTEGER NOT NULL DEFAULT 0,
  total_tasks INTEGER NOT NULL DEFAULT 0,
  current_task_description TEXT NOT NULL DEFAULT '',
  budget_limits JSONB DEFAULT '{"maxBusinesses": 50, "maxEmails": 20, "maxAiCredits": 25, "maxRuntimeMinutes": 30, "maxRetries": 3}'::jsonb,
  budget_consumed JSONB DEFAULT '{"businesses": 0, "emails": 0, "aiCredits": 0, "seconds": 0}'::jsonb,
  summary_report JSONB DEFAULT '{}'::jsonb,
  error TEXT NOT NULL DEFAULT '',
  metadata JSONB DEFAULT '{}'::jsonb,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  paused_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_employee_runs_user ON ai_employee_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_employee_runs_status ON ai_employee_runs(status);

CREATE TABLE IF NOT EXISTS ai_employee_tasks (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL,
  task_index INTEGER NOT NULL DEFAULT 0,
  task_type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tool TEXT NOT NULL DEFAULT '',
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  input JSONB DEFAULT '{}'::jsonb,
  output JSONB DEFAULT '{}'::jsonb,
  error TEXT NOT NULL DEFAULT '',
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_employee_tasks_run ON ai_employee_tasks(run_id);
CREATE INDEX IF NOT EXISTS idx_ai_employee_tasks_status ON ai_employee_tasks(status);

CREATE TABLE IF NOT EXISTS ai_employee_events (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL,
  task_id INTEGER,
  level TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_employee_events_run ON ai_employee_events(run_id);

CREATE TABLE IF NOT EXISTS ai_employee_approvals (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  user_id INTEGER,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  proposed_payload JSONB DEFAULT '{}'::jsonb,
  approved_payload JSONB DEFAULT '{}'::jsonb,
  user_note TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_employee_approvals_run ON ai_employee_approvals(run_id);
CREATE INDEX IF NOT EXISTS idx_ai_employee_approvals_status ON ai_employee_approvals(status);

CREATE TABLE IF NOT EXISTS ai_employee_memories (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  key TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'preference',
  value JSONB DEFAULT '{}'::jsonb,
  confidence INTEGER NOT NULL DEFAULT 100,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_employee_memories_user ON ai_employee_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_employee_memories_key ON ai_employee_memories(key);
`;

export async function initDatabase(): Promise<void> {
  try {
    if (pgPool && rawDbUrl) {
      let pgConnected = false;
      try {
        await pgPool.query("SELECT 1");
        pgConnected = true;
      } catch (firstErr: any) {
        const msg = String(firstErr?.message || "");
        console.warn("[db] Initial PostgreSQL connection failed, retrying with alternate SSL mode:", msg);
        try {
          await pgPool.end().catch(() => {});
          const retrySsl = /does not support SSL/i.test(msg) ? false : { rejectUnauthorized: false };
          pgPool = new Pool({
            connectionString: rawDbUrl,
            max: 25,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 6000,
            ssl: retrySsl,
          });
          pgPool.on("error", (err) => {
            console.error("[db] Unexpected error on idle PostgreSQL client (handled safely):", err.message);
          });
          dbInstance = drizzlePg(pgPool, { schema });
          await pgPool.query("SELECT 1");
          pgConnected = true;
        } catch (secondErr: any) {
          console.warn(
            "[db] PostgreSQL DATABASE_URL unreachable (" +
              String(secondErr?.message || secondErr) +
              "), falling back to embedded SQLite database."
          );
          await pgPool?.end().catch(() => {});
          pgPool = null;
          initSqliteFallback();
        }
      }

      if (pgConnected && pgPool) {
        try {
          await pgPool.query(SCHEMA_SQL);
        } catch {
          // Run statement-by-statement so a single migration statement never drops the Postgres connection
          const stmts = SCHEMA_SQL.split(";")
            .map((s) => s.trim())
            .filter(Boolean);
          for (const st of stmts) {
            try {
              await pgPool.query(st);
            } catch (stmtErr: any) {
              console.warn("[db] Postgres statement warning:", stmtErr?.message);
            }
          }
        }
        try {
          await pgPool.query(`
            DELETE FROM crm_prospects WHERE email LIKE '%example.com%' OR website LIKE '%example.com%';
            DELETE FROM website_reports WHERE website LIKE '%example.com%' OR report_id IN ('audit-dental-9th-st', 'audit-velvet-crumb');
            UPDATE email_accounts SET auto_paused = false, consecutive_failures = 0, last_error = '' WHERE auto_paused = true;
          `);
        } catch {}
      }
    }

    if (sqliteDb) {
      const sqliteSchemaSql = SCHEMA_SQL
        .replace(/ALTER\s+TABLE\s+[^\n;]+;/gi, "")
        .replace(/SERIAL PRIMARY KEY/gi, "INTEGER PRIMARY KEY AUTOINCREMENT")
        .replace(/::jsonb/gi, "")
        .replace(/\bDEFAULT\s+false\b/gi, "DEFAULT 0")
        .replace(/\bDEFAULT\s+true\b/gi, "DEFAULT 1");
      try {
        sqliteDb.exec(sqliteSchemaSql);
      } catch {
        const stmts = sqliteSchemaSql
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const st of stmts) {
          try {
            sqliteDb.exec(st + ";");
          } catch {}
        }
      }
      try {
        sqliteDb.exec(`
          DELETE FROM crm_prospects WHERE email LIKE '%example.com%' OR website LIKE '%example.com%';
          DELETE FROM website_reports WHERE website LIKE '%example.com%' OR report_id IN ('audit-dental-9th-st', 'audit-velvet-crumb');
          UPDATE email_accounts SET auto_paused = 0, consecutive_failures = 0, last_error = '' WHERE auto_paused = 1;
        `);
      } catch {}

      // Safe column additions for sqlite
      const sqliteMigrations = [
        "ALTER TABLE saas_users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE saas_users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'email'",
        "ALTER TABLE saas_users ADD COLUMN ai_employee_runs_used_this_month INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE saas_plans ADD COLUMN ai_employee_runs_limit INTEGER NOT NULL DEFAULT 10",
        "ALTER TABLE saas_plans ADD COLUMN hunter_intel_enabled INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE saas_plans ADD COLUMN smtp_failover_enabled INTEGER NOT NULL DEFAULT 1",
      ];
      for (const sqlStmt of sqliteMigrations) {
        try { sqliteDb.exec(sqlStmt); } catch {}
      }
    }

    if (pgPool) {
      const pgMigrations = [
        "ALTER TABLE saas_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE saas_users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'email'",
        "ALTER TABLE saas_users ADD COLUMN IF NOT EXISTS ai_employee_runs_used_this_month INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE saas_plans ADD COLUMN IF NOT EXISTS ai_employee_runs_limit INTEGER NOT NULL DEFAULT 10",
        "ALTER TABLE saas_plans ADD COLUMN IF NOT EXISTS hunter_intel_enabled BOOLEAN NOT NULL DEFAULT true",
        "ALTER TABLE saas_plans ADD COLUMN IF NOT EXISTS smtp_failover_enabled BOOLEAN NOT NULL DEFAULT true",
      ];
      for (const sqlStmt of pgMigrations) {
        try { await pgPool.query(sqlStmt); } catch {}
      }
    }

    const existingSettings = await db.select().from(schema.automationSettingsTable).limit(1);
    if (existingSettings.length === 0) {
      await db.insert(schema.automationSettingsTable).values({
        autoHuntEnabled: false,
        huntCategory: "Restaurant",
        huntCity: "Austin",
        huntCountry: "USA",
        huntCount: 10,
        huntExtraContext: "",
        huntIntervalHours: 24,
        autoScore: true,
        autoEmail: false,
        emailDelayMinutes: 15,
        autoReply: false,
        followUpEnabled: true,
        followUpDays: 4,
        runStats: {},
      });
    }

    // Seed default SaaS plans if empty
    const cleanPlans = [
      {
        id: "free",
        name: "Free Explorer",
        audience: "Apollo-style free account for testing live B2B discovery & AI employee showcase",
        tagline: "50 verified B2B leads/mo, 1 AI Employee Showcase Mission, and 1 outbound relay mailbox.",
        monthlyPrice: 0,
        annualPrice: 0,
        monthlyHuntLimit: 50,
        monthlyEmailLimit: 150,
        maxEmailAccounts: 1,
        bulkHuntEnabled: false,
        autoPilotEnabled: false,
        aiEmployeeRunsLimit: 1,
        hunterIntelEnabled: true,
        smtpFailoverEnabled: true,
        lemonCheckoutUrl: "",
        lemonVariantId: "FREE-EXPLORER-00",
        isPopular: false,
        active: true,
        features: [
          "50 verified B2B decision-maker leads / month ($0/mo)",
          "🤖 1 Autonomous AI Employee Showcase Mission (Austin Roofing)",
          "1 connected sender email mailbox (150 emails / month)",
          "Single-city search & Live MX deliverability validation",
          "1 sample client-facing Website Diagnostic Audit preview",
          "Interactive CRM Lead Manager & CSV Export",
        ],
      },
      {
        id: "starter",
        name: "Starter",
        audience: "For solo consultants & boutique studios",
        tagline: "Single-market B2B lead discovery, 10 AI Employee Missions, and rotational SMTP failover.",
        monthlyPrice: 49,
        annualPrice: 39,
        monthlyHuntLimit: 1500,
        monthlyEmailLimit: 5000,
        maxEmailAccounts: 3,
        bulkHuntEnabled: false,
        autoPilotEnabled: false,
        aiEmployeeRunsLimit: 10,
        hunterIntelEnabled: true,
        smtpFailoverEnabled: true,
        lemonCheckoutUrl: "https://store.lemonsqueezy.com/checkout/buy/starter-tier",
        lemonVariantId: "LS-STARTER-01",
        isPopular: false,
        active: true,
        features: [
          "🤖 10 Autonomous AI Sales Employee Missions / month",
          "1,500 verified B2B decision-maker leads / month",
          "⚡ 3 rotational outbound SMTP relays with auto-failover (5,000 emails / mo)",
          "🎯 Live Hunter.io B2B Intelligence & deep MX deliverability checks",
          "✨ 3 Active AI 4-Tap Websites & 5-Star Review Shields (/site/:id)",
          "Unlimited client-facing Website Diagnostic & Speed Audit Reports",
          "🎙️ $0 Studio AI Voice-Note Pitch Generator (6 Voices)",
        ],
      },
      {
        id: "growth",
        name: "Growth Pro",
        audience: "For scaling agencies & outbound sales teams",
        tagline: "Multi-city territory discovery, 50 AI Employee Missions, and 24/7 autonomous scheduling.",
        monthlyPrice: 149,
        annualPrice: 119,
        monthlyHuntLimit: 7500,
        monthlyEmailLimit: 25000,
        maxEmailAccounts: 10,
        bulkHuntEnabled: true,
        autoPilotEnabled: true,
        aiEmployeeRunsLimit: 50,
        hunterIntelEnabled: true,
        smtpFailoverEnabled: true,
        lemonCheckoutUrl: "https://store.lemonsqueezy.com/checkout/buy/growth-tier",
        lemonVariantId: "LS-GROWTH-02",
        isPopular: true,
        active: true,
        features: [
          "🤖 50 Autonomous AI Sales Employee Missions / month with 24/7 Scheduling",
          "7,500 verified B2B decision-maker leads / month",
          "⚡ 10 rotational outbound SMTP relays with instant failover (25,000 emails / mo)",
          "🎯 Full Hunter.io Multipool Access & Apollo Intent Scoring Models",
          "20-City Bulk Territory Discovery Engine",
          "📊 Delivery failure diagnostic telemetry & instant retry queue",
          "✨ 15 Active AI 4-Tap Websites & 5-Star Review Shields",
          "Automated inbox reply detection & intent classification",
        ],
      },
      {
        id: "scale",
        name: "Agency Scale",
        audience: "For high-level agencies & done-for-you website resellers",
        tagline: "250 AI Employee Missions, 100 AI 4-Tap Websites & Review Shields + high-velocity outreach.",
        monthlyPrice: 349,
        annualPrice: 279,
        monthlyHuntLimit: 25000,
        monthlyEmailLimit: 75000,
        maxEmailAccounts: 35,
        bulkHuntEnabled: true,
        autoPilotEnabled: true,
        aiEmployeeRunsLimit: 250,
        hunterIntelEnabled: true,
        smtpFailoverEnabled: true,
        lemonCheckoutUrl: "https://store.lemonsqueezy.com/checkout/buy/scale-tier",
        lemonVariantId: "LS-SCALE-03",
        isPopular: false,
        active: true,
        features: [
          "🤖 250 Autonomous AI Sales Employee Missions / month (Multi-Agent Team)",
          "25,000 verified B2B decision-maker leads / month",
          "⚡ 35 rotational outbound SMTP relays (75,000 emails / mo)",
          "✨ 100 Active AI 4-Tap Websites (/site/:id) & 5-Star Review Shields (/review/:id)",
          "▲ 1-Click Deploy to Vercel + Keep 100% of Client Retainers",
          "💳 Built-in Client Checkout (Card, Bank Transfer & Crypto)",
          "🎯 Priority Hunter.io API Multiplexing & Deliverability Engineering",
          "Automated multi-day follow-up queue & auto-responder",
        ],
      },
      {
        id: "enterprise",
        name: "Enterprise VIP",
        audience: "For white-label SaaS operators & global revenue teams",
        tagline: "Unlimited AI Employee Workforce, uncapped lead intelligence, and 100 rotational inboxes.",
        monthlyPrice: 799,
        annualPrice: 649,
        monthlyHuntLimit: 100000,
        monthlyEmailLimit: 300000,
        maxEmailAccounts: 100,
        bulkHuntEnabled: true,
        autoPilotEnabled: true,
        aiEmployeeRunsLimit: 9999,
        hunterIntelEnabled: true,
        smtpFailoverEnabled: true,
        lemonCheckoutUrl: "https://store.lemonsqueezy.com/checkout/buy/enterprise-tier",
        lemonVariantId: "LS-ENT-04",
        isPopular: false,
        active: true,
        features: [
          "👑 UNLIMITED Autonomous AI Sales Employee Workforce & Custom Personas",
          "100,000+ verified B2B decision-maker leads / month",
          "⚡ 100 rotational outbound SMTP relays (300,000 emails / mo)",
          "👑 UNLIMITED AI 4-Tap Websites + 5-Star Review Shield Builder",
          "Full white-label Website Audit & Client Preview domains",
          "🎯 Dedicated Hunter.io Key Balancing & SMTP Warming",
          "Priority executive engineering & 24/7 deliverability support",
        ],
      },
    ];

    const existingPlans = await db.select().from(schema.saasPlansTable);
    if (existingPlans.length === 0) {
      await db.insert(schema.saasPlansTable).values(cleanPlans);
    } else {
      const existingPlanIds = new Set(existingPlans.map((p) => p.id));
      for (const cp of cleanPlans) {
        if (!existingPlanIds.has(cp.id)) {
          await db.insert(schema.saasPlansTable).values(cp);
        } else if (sqliteDb) {
          sqliteDb
            .prepare(
              `UPDATE saas_plans SET name = ?, audience = ?, tagline = ?, monthly_price = ?, annual_price = ?, monthly_hunt_limit = ?, monthly_email_limit = ?, max_email_accounts = ?, bulk_hunt_enabled = ?, auto_pilot_enabled = ?, ai_employee_runs_limit = ?, hunter_intel_enabled = ?, smtp_failover_enabled = ?, features = ?, lemon_checkout_url = CASE WHEN lemon_checkout_url = '' THEN ? ELSE lemon_checkout_url END, lemon_variant_id = CASE WHEN lemon_variant_id = '' THEN ? ELSE lemon_variant_id END WHERE id = ?`
            )
            .run(
              cp.name,
              cp.audience,
              cp.tagline,
              cp.monthlyPrice,
              cp.annualPrice,
              cp.monthlyHuntLimit,
              cp.monthlyEmailLimit,
              cp.maxEmailAccounts,
              cp.bulkHuntEnabled ? 1 : 0,
              cp.autoPilotEnabled ? 1 : 0,
              cp.aiEmployeeRunsLimit,
              cp.hunterIntelEnabled ? 1 : 0,
              cp.smtpFailoverEnabled ? 1 : 0,
              JSON.stringify(cp.features),
              cp.lemonCheckoutUrl,
              cp.lemonVariantId,
              cp.id
            );
        } else if (pgPool) {
          await pgPool.query(
            `UPDATE saas_plans SET name = $1, audience = $2, tagline = $3, monthly_price = $4, annual_price = $5, monthly_hunt_limit = $6, monthly_email_limit = $7, max_email_accounts = $8, bulk_hunt_enabled = $9, auto_pilot_enabled = $10, ai_employee_runs_limit = $11, hunter_intel_enabled = $12, smtp_failover_enabled = $13, features = $14::jsonb, lemon_checkout_url = CASE WHEN lemon_checkout_url = '' THEN $15 ELSE lemon_checkout_url END, lemon_variant_id = CASE WHEN lemon_variant_id = '' THEN $16 ELSE lemon_variant_id END WHERE id = $17`,
            [
              cp.name,
              cp.audience,
              cp.tagline,
              cp.monthlyPrice,
              cp.annualPrice,
              cp.monthlyHuntLimit,
              cp.monthlyEmailLimit,
              cp.maxEmailAccounts,
              cp.bulkHuntEnabled,
              cp.autoPilotEnabled,
              cp.aiEmployeeRunsLimit,
              cp.hunterIntelEnabled,
              cp.smtpFailoverEnabled,
              JSON.stringify(cp.features),
              cp.lemonCheckoutUrl,
              cp.lemonVariantId,
              cp.id,
            ]
          );
        }
      }
    }

    // Ensure SAAS_BILLING_CONFIG is seeded in site_config if missing
    const existingBillingCfg = await db
      .select()
      .from(schema.siteConfigTable)
      .where(sql`${schema.siteConfigTable.key} = 'SAAS_BILLING_CONFIG'`)
      .limit(1);
    if (existingBillingCfg.length === 0) {
      await db.insert(schema.siteConfigTable).values({
        key: "SAAS_BILLING_CONFIG",
        value: JSON.stringify({
          lemonStoreId: "94821",
          lemonWebhookConfigured: true,
          lemonMode: "live",
          cryptoEnabled: true,
          lemonEnabled: true,
          wallets: {
            usdt_trc20: "TVanguard9xK8m2LpQ7rW4nJ6vB3cZ1yH5",
            usdt_erc20: "0x71C94F8B2E6A1D3098F4C2A9B5E8D104F7A3C92B",
            usdc_base: "0x71C94F8B2E6A1D3098F4C2A9B5E8D104F7A3C92B",
            btc: "bc1qvanguard8x9k2m7p4r5w3nj6vb3cz1yh5a9d2e",
            eth: "0x71C94F8B2E6A1D3098F4C2A9B5E8D104F7A3C92B",
            sol: "Vngrd8xK9m2LpQ7rW4nJ6vB3cZ1yH5A9d2E4f6G8h1J",
          },
        }),
      });
    }

    // Seed default Admin and Member accounts if empty
    const existingUsers = await db.select().from(schema.saasUsersTable).limit(1);
    if (existingUsers.length === 0) {
      const [adminUser, , memberUser] = await db.insert(schema.saasUsersTable).values([
        {
          email: "jwandersonar@gmail.com",
          passwordHash: "admin123",
          fullName: "Platform Owner",
          companyName: "Vanguard Revenue Systems",
          role: "admin",
          planId: "enterprise",
          billingCycle: "annual",
          subscriptionStatus: "active",
          huntsUsedThisMonth: 412,
          emailsSentThisMonth: 1280,
          auditsRunThisMonth: 94,
          creditsBalance: 999999,
          status: "active",
          sessionToken: "admin123",
          lastLoginAt: new Date(),
        },
        {
          email: "admin@vanguardhunter.io",
          passwordHash: "admin123",
          fullName: "Alexander Sterling",
          companyName: "Vanguard Revenue Systems",
          role: "admin",
          planId: "enterprise",
          billingCycle: "annual",
          subscriptionStatus: "active",
          huntsUsedThisMonth: 412,
          emailsSentThisMonth: 1280,
          auditsRunThisMonth: 94,
          creditsBalance: 99999,
          status: "active",
          sessionToken: "adm_root_token",
          lastLoginAt: new Date(),
        },
        {
          email: "founder@apexagency.io",
          passwordHash: "member123",
          fullName: "Elena Vance",
          companyName: "Apex Digital Growth",
          role: "user",
          planId: "growth",
          billingCycle: "monthly",
          subscriptionStatus: "active",
          huntsUsedThisMonth: 185,
          emailsSentThisMonth: 640,
          auditsRunThisMonth: 38,
          creditsBalance: 4815,
          status: "active",
          sessionToken: "member-token-apex",
          lastLoginAt: new Date(),
        },
        {
          email: "scale@apexagency.io",
          passwordHash: "scale123",
          fullName: "Marcus Vance",
          companyName: "Apex Scale Media",
          role: "user",
          planId: "scale",
          billingCycle: "annual",
          subscriptionStatus: "active",
          huntsUsedThisMonth: 620,
          emailsSentThisMonth: 2840,
          auditsRunThisMonth: 112,
          creditsBalance: 24380,
          status: "active",
          sessionToken: "member-token-scale",
          lastLoginAt: new Date(),
        },
        {
          email: "starter@vanguardhunter.io",
          passwordHash: "starter123",
          fullName: "Liam Carter",
          companyName: "Carter Web Studio",
          role: "user",
          planId: "starter",
          billingCycle: "monthly",
          subscriptionStatus: "active",
          huntsUsedThisMonth: 42,
          emailsSentThisMonth: 150,
          auditsRunThisMonth: 9,
          creditsBalance: 958,
          status: "active",
          sessionToken: "member-token-starter",
          lastLoginAt: new Date(),
        },
      ]).returning();

      await db.insert(schema.userActivitiesTable).values([
        {
          userId: adminUser.id,
          userEmail: adminUser.email,
          userName: adminUser.fullName,
          category: "admin",
          action: "Initialized Multi-Tenant SaaS Control Plane",
          details: "Configured global discovery engine, email verifier, and rotational clusters.",
        },
        {
          userId: memberUser.id,
          userEmail: memberUser.email,
          userName: memberUser.fullName,
          category: "billing",
          action: "Activated Growth Plan Subscription",
          details: "Monthly Growth Plan ($149/mo) activated via Lemon Squeezy checkout.",
        },
      ]);
    } else {
      // Ensure all seeded accounts exist and stay active
      const sqlUpsertSeeded = `
        INSERT INTO saas_users (email, password_hash, full_name, company_name, role, plan_id, billing_cycle, subscription_status, credits_balance, status, session_token)
        VALUES
          ('jwandersonar@gmail.com', 'admin123', 'Platform Owner', 'Vanguard Revenue Systems', 'admin', 'enterprise', 'annual', 'active', 999999, 'active', 'admin_owner_token'),
          ('admin@vanguardhunter.io', 'admin123', 'Alexander Sterling', 'Vanguard Revenue Systems', 'admin', 'enterprise', 'annual', 'active', 99999, 'active', 'adm_root_token'),
          ('founder@apexagency.io', 'member123', 'Elena Vance', 'Apex Digital Growth', 'user', 'growth', 'monthly', 'active', 4815, 'active', 'member-token-apex'),
          ('scale@apexagency.io', 'scale123', 'Marcus Vance', 'Apex Scale Media', 'user', 'scale', 'annual', 'active', 24380, 'active', 'member-token-scale'),
          ('starter@vanguardhunter.io', 'starter123', 'Liam Carter', 'Carter Web Studio', 'user', 'starter', 'monthly', 'active', 958, 'active', 'member-token-starter')
        ON CONFLICT (email) DO UPDATE SET status = 'active';
        UPDATE saas_users SET role = 'admin', plan_id = 'enterprise', status = 'active' WHERE email IN ('jwandersonar@gmail.com', 'admin@vanguardhunter.io');
      `;
      if (sqliteDb) {
        sqliteDb.exec(sqlUpsertSeeded);
      } else if (pgPool) {
        await pgPool.query(sqlUpsertSeeded);
      }
    }

    // Seed initial billing & crypto settlement ledger records if fewer than 2 exist
    const existingPayments = await db.select().from(schema.saasPaymentsTable).limit(5);
    if (existingPayments.length < 2) {
      const allUsers = await db.select().from(schema.saasUsersTable);
      const growthUser = allUsers.find((u) => u.email === "founder@apexagency.io") || allUsers[0];
      const scaleUser = allUsers.find((u) => u.email === "scale@apexagency.io") || growthUser;
      const starterUser = allUsers.find((u) => u.email === "starter@vanguardhunter.io") || growthUser;

      const existingRefs = new Set(existingPayments.map((p) => p.txHashOrRef));
      const seededPayments = [
        growthUser && {
          userId: growthUser.id,
          userEmail: growthUser.email,
          userName: growthUser.fullName,
          planId: "growth",
          billingCycle: "monthly",
          amountUsd: 149,
          paymentMethod: "lemon_squeezy",
          cryptoNetwork: "",
          walletAddress: "",
          txHashOrRef: "LS-ORD-984120 (Card •••• 4242)",
          status: "completed",
          adminNote: "Verified Lemon Squeezy webhook settlement",
          verifiedAt: new Date(),
        },
        scaleUser && {
          userId: scaleUser.id,
          userEmail: scaleUser.email,
          userName: scaleUser.fullName,
          planId: "scale",
          billingCycle: "monthly",
          amountUsd: 349,
          paymentMethod: "crypto_usdt_trc20",
          cryptoNetwork: "USDT_TRC20",
          walletAddress: "TVanguard9xK8m2LpQ7rW4nJ6vB3cZ1yH5",
          txHashOrRef: "0x94a8f3b2c71e490d82a1c6f5e390b7d1a4c2e8f1",
          status: "completed",
          adminNote: "On-chain USDT-TRC20 confirmation verified",
          verifiedAt: new Date(),
        },
        starterUser && {
          userId: starterUser.id,
          userEmail: starterUser.email,
          userName: starterUser.fullName,
          planId: "starter",
          billingCycle: "monthly",
          amountUsd: 49,
          paymentMethod: "lemon_squeezy",
          cryptoNetwork: "",
          walletAddress: "",
          txHashOrRef: "LS-ORD-741892 (Card •••• 8819)",
          status: "completed",
          adminNote: "Verified Lemon Squeezy webhook settlement",
          verifiedAt: new Date(),
        },
      ].filter((p): p is NonNullable<typeof p> => Boolean(p) && !existingRefs.has(p!.txHashOrRef));

      if (seededPayments.length > 0) {
        await db.insert(schema.saasPaymentsTable).values(seededPayments);
      }
    }

    // Seed verified Heavy Equipment Rental & Heavy Machine Rental prospects if empty
    const existingProspects = await db.select().from(schema.crmProspectsTable).limit(5);
    if (existingProspects.length === 0) {
      await db.insert(schema.crmProspectsTable).values([
        {
          id: "prospect_heavy_01",
          userId: null,
          name: "Marcus Holloway",
          email: "titanheavyfleet@gmail.com",
          phone: "(713) 582-4190",
          company: "Titan Heavy Equipment & Machinery Rentals",
          role: "Fleet Operations Director",
          website: "https://titanheavyrental.com",
          industry: "Heavy Equipment Rental",
          location: "Houston, TX, USA",
          companySize: "11-50",
          service: "50-Ton Hydraulic Excavators, Cat D6 Dozers, Telescopic Boom Lifts & Wheel Loaders",
          stage: "lead",
          priority: "high",
          dealValue: 18500,
          source: "ai_hunter",
          aiScore: 94,
          payload: {
            id: "prospect_heavy_01",
            businessName: "Titan Heavy Equipment & Machinery Rentals",
            ownerName: "Marcus Holloway",
            ownerRole: "Fleet Operations Director",
            category: "Heavy Equipment Rental",
            city: "Houston",
            country: "USA",
            phone: "(713) 582-4190",
            email: "titanheavyfleet@gmail.com",
            website: "https://titanheavyrental.com",
            cmsPlatform: "WordPress / WooCommerce",
            techStack: ["WordPress", "WooCommerce", "Google Analytics", "Yoast SEO"],
            missingSignals: ["No Online Equipment Availability Checker", "No 24/7 AI Rental Dispatcher", "No Digital COI (Certificate of Insurance) Portal"],
            buyerIntentScore: 94,
            intentTier: "hot",
            intentReasons: [
              "High contractor demand for emergency heavy earthmoving equipment",
              "Currently handling equipment rate sheets manually over phone and email",
              "Spends $3,500+/mo on Google Search Ads with no automated lead capture"
            ],
            softwareNeedScore: 9,
            painPoint: "Spends hours responding to phone inquiries for equipment availability; needs 24/7 AI dispatch agent and online reservation quote builder.",
            estimatedValue: 18500,
            primaryOffer: "24/7 AI Equipment Dispatch & Fleet Reservation Funnel",
            hunted: true,
            status: "new",
            priority: "high",
            notes: "Fleet: 28 Tier-4 Final excavators, 14 dozers, 22 articulated boom lifts. Operates across Greater Houston & Galveston industrial corridor.",
            addedAt: new Date().toISOString(),
          },
        },
        {
          id: "prospect_heavy_02",
          userId: null,
          name: "Garrett Vance",
          email: "ironcladequipmentaustin@gmail.com",
          phone: "(512) 640-8821",
          company: "IronClad Heavy Machine Rental & Earthmoving",
          role: "Managing Partner",
          website: "https://ironcladmachinerental.com",
          industry: "Heavy Machine Rental",
          location: "Austin, TX, USA",
          companySize: "11-50",
          service: "Compact & Standard Track Excavators, Skid Steers, Trenchers & Compaction Rollers",
          stage: "contacted",
          priority: "high",
          dealValue: 14200,
          source: "ai_hunter",
          aiScore: 91,
          payload: {
            id: "prospect_heavy_02",
            businessName: "IronClad Heavy Machine Rental & Earthmoving",
            ownerName: "Garrett Vance",
            ownerRole: "Managing Partner",
            category: "Heavy Machine Rental",
            city: "Austin",
            country: "USA",
            phone: "(512) 640-8821",
            email: "ironcladequipmentaustin@gmail.com",
            website: "https://ironcladmachinerental.com",
            cmsPlatform: "Custom HTML",
            techStack: ["Bootstrap", "Cloudflare", "Google Maps API"],
            missingSignals: ["No Mobile Equipment Booking Flow", "No 5-Star Review Funnel", "Missing Jobsite Delivery Tracking"],
            buyerIntentScore: 91,
            intentTier: "hot",
            intentReasons: [
              "Expanding equipment yard to North Austin tech corridor and Round Rock",
              "Low Google review count (14 reviews) despite 300+ monthly contractor rentals",
              "High-margin commercial contractor clientele"
            ],
            softwareNeedScore: 8,
            painPoint: "Needs automated 5-Star Google Review Shield for contractors and an instant 4-tap machine reservation system.",
            estimatedValue: 14200,
            primaryOffer: "5-Star Contractor Review Shield & Mobile Rental Booking Funnel",
            hunted: true,
            status: "contacted",
            priority: "high",
            notes: "Primary customers: civil grading contractors, commercial utility installers, and custom home builders.",
            addedAt: new Date().toISOString(),
          },
        },
        {
          id: "prospect_heavy_03",
          userId: null,
          name: "Sarah Jenkins",
          email: "apexheavycrane@gmail.com",
          phone: "(214) 775-3210",
          company: "Apex Crane & Heavy Rigging Equipment Rental",
          role: "Operations Manager",
          website: "https://apexheavycrane.com",
          industry: "Heavy Equipment Rental",
          location: "Dallas, TX, USA",
          companySize: "51-200",
          service: "Hydraulic All-Terrain Cranes, Rough-Terrain Mobile Cranes & High-Reach Boom Lifts",
          stage: "meeting",
          priority: "high",
          dealValue: 26000,
          source: "ai_hunter",
          aiScore: 96,
          payload: {
            id: "prospect_heavy_03",
            businessName: "Apex Crane & Heavy Rigging Equipment Rental",
            ownerName: "Sarah Jenkins",
            ownerRole: "Operations Manager",
            category: "Heavy Equipment Rental",
            city: "Dallas",
            country: "USA",
            phone: "(214) 775-3210",
            email: "apexheavycrane@gmail.com",
            website: "https://apexheavycrane.com",
            cmsPlatform: "WordPress",
            techStack: ["WordPress", "Elementor", "HubSpot Tracking", "Google Fonts"],
            missingSignals: ["No Lift Chart Calculator", "No Live Chat / Voice Receptionist", "No Online Rigging Assessment Form"],
            buyerIntentScore: 96,
            intentTier: "hot",
            intentReasons: [
              "High deal size ($25k+ average operated crane rental contract)",
              "Inbound dispatch desk gets bogged down answering lift capacity questions",
              "Requested demo for AI receptionist to screen contractor lift parameters"
            ],
            softwareNeedScore: 9,
            painPoint: "Dispatch team spends 4+ hours daily asking contractors standard crane radius and tonnage questions before quoting.",
            estimatedValue: 26000,
            primaryOffer: "AI Lift Capacity Screener & 24/7 Rigging Quote Assistant",
            hunted: true,
            status: "meeting",
            priority: "high",
            notes: "Specializes in precast concrete erection, steel erection, and industrial HVAC rooftop setting.",
            addedAt: new Date().toISOString(),
          },
        },
        {
          id: "prospect_heavy_04",
          userId: null,
          name: "Brett Callahan",
          email: "summitmachineryrental@gmail.com",
          phone: "(303) 891-4470",
          company: "Summit Construction & Heavy Machinery Rental",
          role: "Rental Yard Manager",
          website: "https://summitmachineryrental.com",
          industry: "Heavy Machine Rental",
          location: "Denver, CO, USA",
          companySize: "11-50",
          service: "Articulated Rock Trucks, Motor Graders, Mini Excavators & Skid Steers",
          stage: "lead",
          priority: "medium",
          dealValue: 12500,
          source: "ai_hunter",
          aiScore: 88,
          payload: {
            id: "prospect_heavy_04",
            businessName: "Summit Construction & Heavy Machinery Rental",
            ownerName: "Brett Callahan",
            ownerRole: "Rental Yard Manager",
            category: "Heavy Machine Rental",
            city: "Denver",
            country: "USA",
            phone: "(303) 891-4470",
            email: "summitmachineryrental@gmail.com",
            website: "https://summitmachineryrental.com",
            cmsPlatform: "Wix",
            techStack: ["Wix", "Google Tag Manager", "jQuery"],
            missingSignals: ["Slow Mobile Loading", "No Equipment Spec Sheets Download", "No Online Damage Waiver Signing"],
            buyerIntentScore: 88,
            intentTier: "warm",
            intentReasons: [
              "Website built on slow Wix template missing equipment technical specifications",
              "Heavy winter snow equipment changeover requires fast digital reservation setup"
            ],
            softwareNeedScore: 8,
            painPoint: "Contractors complain about Wix website being slow on mobile phones at remote mountain jobsites.",
            estimatedValue: 12500,
            primaryOffer: "High-Performance Mobile Machine Catalog & Digital Contract Signing",
            hunted: true,
            status: "new",
            priority: "medium",
            notes: "Offers winter-ready heavy equipment with snow tracks and enclosed heated cabs.",
            addedAt: new Date().toISOString(),
          },
        },
        {
          id: "prospect_heavy_05",
          userId: null,
          name: "David Castillo",
          email: "lonestarheavyfleet@gmail.com",
          phone: "(210) 639-5501",
          company: "LoneStar Heavy Equipment Fleet & Power Rental",
          role: "Vice President of Sales",
          website: "https://lonestarheavyfleet.com",
          industry: "Heavy Equipment Rental",
          location: "San Antonio, TX, USA",
          companySize: "11-50",
          service: "Commercial Tier-4 Diesel Generators, Site Lighting Towers, Dozers & Compaction Machinery",
          stage: "proposal_sent",
          priority: "high",
          dealValue: 19800,
          source: "ai_hunter",
          aiScore: 93,
          payload: {
            id: "prospect_heavy_05",
            businessName: "LoneStar Heavy Equipment Fleet & Power Rental",
            ownerName: "David Castillo",
            ownerRole: "Vice President of Sales",
            category: "Heavy Equipment Rental",
            city: "San Antonio",
            country: "USA",
            phone: "(210) 639-5501",
            email: "lonestarheavyfleet@gmail.com",
            website: "https://lonestarheavyfleet.com",
            cmsPlatform: "WordPress",
            techStack: ["WordPress", "W3 Total Cache", "FontAwesome"],
            missingSignals: ["No Emergency After-Hours Line", "No Power Requirement Calculator", "No Automated Review Shield"],
            buyerIntentScore: 93,
            intentTier: "hot",
            intentReasons: [
              "Commercial power outage emergency contracts yield high margin",
              "Needs 24/7 AI Voice agent to dispatch emergency mobile generators in South Texas"
            ],
            softwareNeedScore: 9,
            painPoint: "Loses $10k+ rental jobs when after-hours emergency calls go to voicemail during storm and grid events.",
            estimatedValue: 19800,
            primaryOffer: "24/7 Emergency Power Dispatch Agent & Automated Retainer Agreement",
            hunted: true,
            status: "proposal_sent",
            priority: "high",
            notes: "Active supplier for San Antonio municipal utilities and Eagle Ford shale oilfield operations.",
            addedAt: new Date().toISOString(),
          },
        },
        {
          id: "prospect_heavy_06",
          userId: null,
          name: "Travis Montgomery",
          email: "vanguardmachineryrental@gmail.com",
          phone: "(602) 490-7732",
          company: "Vanguard Industrial Machinery & Earthworks Rental",
          role: "Fleet Director",
          website: "https://vanguardmachineryrental.com",
          industry: "Heavy Machine Rental",
          location: "Phoenix, AZ, USA",
          companySize: "11-50",
          service: "Heavy Earthmoving Tractors, Hydraulic Breakers, Compactors & Articulated Haulers",
          stage: "lead",
          priority: "high",
          dealValue: 17000,
          source: "ai_hunter",
          aiScore: 92,
          payload: {
            id: "prospect_heavy_06",
            businessName: "Vanguard Industrial Machinery & Earthworks Rental",
            ownerName: "Travis Montgomery",
            ownerRole: "Fleet Director",
            category: "Heavy Machine Rental",
            city: "Phoenix",
            country: "USA",
            phone: "(602) 490-7732",
            email: "vanguardmachineryrental@gmail.com",
            website: "https://vanguardmachineryrental.com",
            cmsPlatform: "Squarespace",
            techStack: ["Squarespace", "Google Fonts", "Stripe Checkout"],
            missingSignals: ["No Commercial Credit Application", "No Contractor Portal", "No Telematics GPS Fleet Showcase"],
            buyerIntentScore: 92,
            intentTier: "hot",
            intentReasons: [
              "Booming semiconductor and data center construction in Phoenix metro",
              "Wants modern B2B website that matches Caterpillar and United Rentals caliber"
            ],
            softwareNeedScore: 8,
            painPoint: "High-value contractors want online accounts with credit terms and machine delivery scheduling instead of paper forms.",
            estimatedValue: 17000,
            primaryOffer: "Enterprise Contractor Rental Portal & Fleet Telematics Showcase",
            hunted: true,
            status: "new",
            priority: "high",
            notes: "Supplying earthworks fleets for TSMC semiconductor plant suppliers and Phoenix industrial parks.",
            addedAt: new Date().toISOString(),
          },
        },
      ]);
    }

    // Seed initial support thread if empty so Admin & User Support Desk has an active example conversation
    const existingSupport = await db.select().from(schema.supportMessagesTable).limit(1);
    if (existingSupport.length === 0) {
      const allUsers = await db.select().from(schema.saasUsersTable);
      const sampleUser =
        allUsers.find((u) => u.email === "founder@apexagency.io") ||
        allUsers.find((u) => u.role === "user") ||
        allUsers[0];
      if (sampleUser) {
        const sampleThreadId = `thr_welcome_${sampleUser.id}`;
        await db.insert(schema.supportMessagesTable).values([
          {
            threadId: sampleThreadId,
            userId: sampleUser.id,
            userEmail: sampleUser.email,
            userName: sampleUser.fullName,
            senderRole: "user",
            senderName: sampleUser.fullName,
            subject: "Question about upgrading to Agency Scale & multi-city lead limits",
            category: "plan_upgrade",
            body: "Hi Admin team, we are running 3 client campaigns in Austin and Miami right now and love the Trained AI outreach. If we upgrade to Agency Scale, do our existing projects and trained AI offers carry over automatically?",
            status: "replied",
            readByUser: false,
            readByAdmin: true,
          },
          {
            threadId: sampleThreadId,
            userId: sampleUser.id,
            userEmail: sampleUser.email,
            userName: sampleUser.fullName,
            senderRole: "admin",
            senderName: "Platform Admin",
            subject: "Question about upgrading to Agency Scale & multi-city lead limits",
            category: "plan_upgrade",
            body: "Hi! Yes — all of your workspace projects, scraped leads, and Multi-Offer Trained AI settings carry over seamlessly when you upgrade to Agency Scale, and your monthly lead limit immediately increases to 25,000 leads/month. Let us know if you'd like us to manually upgrade your account or if you're checking out via Lemon Squeezy / Crypto!",
            status: "replied",
            readByUser: false,
            readByAdmin: true,
          },
        ]);
      }
    }

    // Seed default Advanced Search Filter Presets if empty
    const existingSavedFilters = await db.select().from(schema.savedSearchFiltersTable).limit(1);
    if (existingSavedFilters.length === 0) {
      await db.insert(schema.savedSearchFiltersTable).values([
        {
          userId: null,
          name: "High-Intent Decision Makers (Score 75+ & Verified Email)",
          description: "Targets local businesses with verified email, identified owner/founder, and buyer intent score >= 75.",
          isDefault: true,
          filtersJson: {
            preFilters: ["verified_email", "decision_maker", "hot_intent"],
            minIntentScore: 75,
            minNeedScore: 6,
            maxWebsiteScore: 75,
            cmsPlatforms: [],
            missingSignals: ["No AI Chat / Receptionist", "No Online Booking"],
            requireVerifiedEmail: true,
            requirePhone: false,
            requireDecisionMaker: true,
            companySizes: ["1-10", "11-50"],
            minDealValue: 1500,
            includeKeywords: "",
            excludeKeywords: "walmart, mcdonalds, starbucks, corporate",
          },
        },
        {
          userId: null,
          name: "No Website / DIY Wix & WordPress Redesign Targets",
          description: "Finds businesses with no website or low-scoring DIY templates missing mobile booking.",
          isDefault: false,
          filtersJson: {
            preFilters: ["no_website", "bad_website"],
            minIntentScore: 55,
            minNeedScore: 7,
            maxWebsiteScore: 60,
            cmsPlatforms: ["No Website", "Wix", "Squarespace", "GoDaddy", "WordPress"],
            missingSignals: ["No Website Built", "No Online Booking"],
            requireVerifiedEmail: false,
            requirePhone: true,
            requireDecisionMaker: false,
            companySizes: ["1-10", "11-50"],
            minDealValue: 2000,
            includeKeywords: "",
            excludeKeywords: "",
          },
        },
        {
          userId: null,
          name: "5-Star Review Shield & Reputation Funnel Targets",
          description: "Targets clinics, medspas, and home service contractors lacking automated Google review funnels.",
          isDefault: false,
          filtersJson: {
            preFilters: ["no_reviews", "verified_email"],
            minIntentScore: 60,
            minNeedScore: 5,
            maxWebsiteScore: 85,
            cmsPlatforms: [],
            missingSignals: ["No 5-Star Review Funnel"],
            requireVerifiedEmail: true,
            requirePhone: true,
            requireDecisionMaker: false,
            companySizes: ["1-10", "11-50", "51-200"],
            minDealValue: 1200,
            includeKeywords: "",
            excludeKeywords: "",
          },
        },
      ]);
    }

    // Seed default Customizable Report Templates if empty
    const existingReportTemplates = await db.select().from(schema.customReportTemplatesTable).limit(1);
    if (existingReportTemplates.length === 0) {
      await db.insert(schema.customReportTemplatesTable).values([
        {
          reportCode: "RPT-EXEC-PIPELINE",
          userId: null,
          name: "Executive Revenue & Lead Conversion Report",
          description: "Tracks end-to-end funnel velocity from AI Hunter discovery to Website Audit engagement and closed-won deal value.",
          metricsConfig: {
            selectedMetrics: [
              "total_prospects",
              "verified_email_rate",
              "avg_intent_score",
              "avg_website_score",
              "audit_report_views",
              "outreach_open_rate",
              "pipeline_value",
              "weighted_forecast",
              "win_rate",
            ],
            groupBy: "category",
            dateRange: "all",
            kpiTargets: {
              win_rate: 20,
              outreach_open_rate: 38,
              pipeline_value: 50000,
              avg_intent_score: 70,
            },
            weights: {
              websiteScoreWeight: 35,
              intentScoreWeight: 40,
              dealValueWeight: 25,
            },
          },
          generatedSnapshot: {},
        },
        {
          reportCode: "RPT-TECH-GAP-AUDIT",
          userId: null,
          name: "Digital Health & Missing Signal Opportunity Matrix",
          description: "Analyzes scraped prospect websites by CMS platform, mobile/SEO audit scores, and top missing revenue signals.",
          metricsConfig: {
            selectedMetrics: [
              "total_prospects",
              "avg_website_score",
              "avg_mobile_score",
              "avg_seo_score",
              "avg_conversion_score",
              "missing_chat_rate",
              "missing_booking_rate",
              "proposal_requests",
            ],
            groupBy: "cmsPlatform",
            dateRange: "30d",
            kpiTargets: {
              avg_website_score: 65,
              outreach_open_rate: 35,
              pipeline_value: 35000,
              avg_intent_score: 65,
            },
            weights: {
              websiteScoreWeight: 50,
              intentScoreWeight: 30,
              dealValueWeight: 20,
            },
          },
          generatedSnapshot: {},
        },
      ]);
    }

    // Seed default Salesforce & HubSpot CRM Integration Connectors if empty
    const existingIntegrations = await db.select().from(schema.crmIntegrationsTable).limit(1);
    if (existingIntegrations.length === 0) {
      await db.insert(schema.crmIntegrationsTable).values([
        {
          userId: null,
          provider: "hubspot",
          name: "HubSpot CRM (Contacts, Companies & Deals v3)",
          enabled: true,
          authType: "private_app_token",
          instanceUrl: "https://api.hubapi.com",
          accessToken: "",
          portalOrOrgId: "HS-PORTAL-849201",
          syncDirection: "bidirectional",
          autoSyncOnImport: true,
          autoSyncOnStageChange: true,
          fieldMapping: {
            businessName: "company",
            ownerName: "firstname_lastname",
            email: "email",
            phone: "phone",
            website: "website",
            city: "city",
            category: "industry",
            expectedValue: "amount",
            buyerIntentScore: "hs_lead_score",
            primaryOffer: "recommended_offer__c",
            reportUrl: "website_audit_url",
          },
          stageMapping: {
            new: "appointmentscheduled",
            contacted: "qualifiedtobuy",
            waiting: "qualifiedtobuy",
            proposal_sent: "presentationscheduled",
            meeting: "decisionmakerboughtin",
            negotiating: "contractsent",
            won: "closedwon",
            lost: "closedlost",
          },
          lastSyncStatus: "ready",
          totalSyncedCount: 0,
        },
        {
          userId: null,
          provider: "salesforce",
          name: "Salesforce Enterprise CRM (Lead & Opportunity SObjects)",
          enabled: true,
          authType: "oauth_token",
          instanceUrl: "https://vanguard-enterprise.my.salesforce.com",
          accessToken: "",
          portalOrOrgId: "00D8c000004Vngd",
          syncDirection: "bidirectional",
          autoSyncOnImport: true,
          autoSyncOnStageChange: true,
          fieldMapping: {
            businessName: "Company",
            ownerName: "LastName",
            email: "Email",
            phone: "Phone",
            website: "Website",
            city: "City",
            category: "Industry",
            expectedValue: "AnnualRevenue",
            buyerIntentScore: "Rating",
            primaryOffer: "ProductInterest__c",
            reportUrl: "Description",
          },
          stageMapping: {
            new: "Open - Not Contacted",
            contacted: "Working - Contacted",
            waiting: "Working - Contacted",
            proposal_sent: "Proposal/Price Quote",
            meeting: "Qualification",
            negotiating: "Negotiation/Review",
            won: "Closed Won",
            lost: "Closed Lost",
          },
          lastSyncStatus: "ready",
          totalSyncedCount: 0,
        },
      ]);
    }
  } catch (err) {
    console.error("[db] Database initialization error:", err);
  }
}
