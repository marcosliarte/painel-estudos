const path = require("path");
const { app } = require("electron");
const Database = require("better-sqlite3");

let db = null;

function initDatabase() {
  const dbPath = path.join(app.getPath("userData"), "painel_estudos.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS study_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      subject TEXT NOT NULL,
      minutes INTEGER NOT NULL DEFAULT 0,
      questions INTEGER NOT NULL DEFAULT 0,
      UNIQUE(date, subject)
    );

    CREATE TABLE IF NOT EXISTS mistake_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      subject TEXT NOT NULL,
      topic TEXT NOT NULL,
      reason TEXT NOT NULL,
      lesson TEXT NOT NULL DEFAULT '',
      revised INTEGER NOT NULL DEFAULT 0
    );
  `);

  return db;
}

function getDb() {
  if (!db) throw new Error("Banco de dados ainda não foi inicializado");
  return db;
}

module.exports = { initDatabase, getDb };
