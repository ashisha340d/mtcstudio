'use strict';
const mysql = require('mysql2/promise');

const MYSQL_CONFIG = {
  host: '192.168.1.5',
  user: 'root',
  password: 'Nepal@Narayan113',
  database: 'munchtim_mtcstudio',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  port: 9900,
};

const pool = mysql.createPool(MYSQL_CONFIG);

async function dbAll(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function dbGet(sql, params = []) {
  const rows = await dbAll(sql, params);
  return rows[0];
}

async function dbRun(sql, params = []) {
  const [result] = await pool.query(sql, params);
  return { lastInsertRowid: result.insertId, changes: result.affectedRows, insertId: result.insertId };
}

async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tx = {
      dbAll: async (sql, params = []) => { const [rows] = await conn.query(sql, params); return rows; },
      dbGet: async (sql, params = []) => { const [rows] = await conn.query(sql, params); return rows[0]; },
      dbRun: async (sql, params = []) => {
        const [result] = await conn.query(sql, params);
        return { lastInsertRowid: result.insertId, changes: result.affectedRows, insertId: result.insertId };
      },
    };
    const result = await fn(tx);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { MYSQL_CONFIG, pool, dbAll, dbGet, dbRun, transaction };
