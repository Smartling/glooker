import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT || 3306),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'glooker',
  waitForConnections: true,
  connectionLimit:    10,
  // No timezone override — MySQL uses SYSTEM (ET), mysql2 will return raw strings
});

export default pool;
