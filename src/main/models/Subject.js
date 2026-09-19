const { getDb } = require("../db");

function list() {
  return getDb().prepare("SELECT name FROM subjects ORDER BY created_at ASC").all().map((r) => r.name);
}

function exists(name) {
  return !!getDb().prepare("SELECT 1 FROM subjects WHERE name = ?").get(name);
}

function add(name) {
  getDb().prepare("INSERT INTO subjects (name, created_at) VALUES (?, ?)").run(name, Date.now());
}

function remove(name) {
  getDb().prepare("DELETE FROM subjects WHERE name = ?").run(name);
}

function rename(oldName, newName) {
  getDb().prepare("UPDATE subjects SET name = ? WHERE name = ?").run(newName, oldName);
}

function removeAll() {
  getDb().prepare("DELETE FROM subjects").run();
}

function insertMany(names) {
  const stmt = getDb().prepare("INSERT INTO subjects (name, created_at) VALUES (?, ?)");
  const insert = getDb().transaction((list) => {
    list.forEach((n) => stmt.run(n, Date.now()));
  });
  insert(names);
}

module.exports = { list, exists, add, remove, rename, removeAll, insertMany };
