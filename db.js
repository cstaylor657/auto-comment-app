const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(':memory:'); // Use file.db in prod

db.serialize(() => {
  db.run(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fb_user_id TEXT UNIQUE
    )
  `);

  db.run(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      platform TEXT,
      account_id TEXT,
      name TEXT,
      access_token TEXT,
      enabled INTEGER DEFAULT 1,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
});

module.exports = db;
