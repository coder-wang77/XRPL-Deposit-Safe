// Promise-based database wrapper for better async/await support
import db from "../db.js";

/**
 * Promisified database methods for cleaner async/await code
 */
export const dbPromise = {
  /**
   * Execute a query and return all rows
   */
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  /**
   * Execute a query and return first row
   */
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  /**
   * Execute a query and return run result with lastID
   */
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },
};

export default dbPromise;
