import mysql from 'mysql2/promise';
import type { DB } from './index';

const SCHEDULES_SCHEMA = `
CREATE TABLE IF NOT EXISTS schedules (
  id             VARCHAR(36)  NOT NULL PRIMARY KEY,
  org            VARCHAR(255) NOT NULL,
  period_days    INT          NOT NULL,
  cron_expr      VARCHAR(100) NOT NULL,
  timezone       VARCHAR(50)  NOT NULL DEFAULT 'UTC',
  enabled        TINYINT      NOT NULL DEFAULT 1,
  test_mode      TINYINT      NOT NULL DEFAULT 0,
  last_run_at    DATETIME,
  last_report_id VARCHAR(36),
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (last_report_id) REFERENCES reports(id) ON DELETE SET NULL
);
`;

export function createMySQLDB(): DB {
  const pool = mysql.createPool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT || 3306),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'glooker',
    waitForConnections: true,
    connectionLimit:    10,
  });

  // Auto-create schedules table if it doesn't exist
  pool.execute(SCHEDULES_SCHEMA).catch(console.error);

  return {
    execute: <T = any>(sql: string, params?: any[]): Promise<[T[], any]> =>
      pool.execute(sql, params) as Promise<[T[], any]>,
  };
}
