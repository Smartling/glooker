import mysql from 'mysql2/promise';
import type { DB } from './index';

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

  return {
    execute: <T = any>(sql: string, params?: any[]): Promise<[T[], any]> =>
      pool.execute(sql, params) as Promise<[T[], any]>,
  };
}
