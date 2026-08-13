const { getDb } = require("../db");

function toPlain(row) {
  return {
    id: String(row.id),
    ts: row.ts,
    subject: row.subject,
    topic: row.topic,
    reason: row.reason,
    lesson: row.lesson,
    revised: !!row.revised,
  };
}

function list() {
  return getDb().prepare("SELECT * FROM mistake_entries ORDER BY ts DESC").all().map(toPlain);
}

function add({ subject, topic, reason, lesson }) {
  const info = getDb()
    .prepare(
      "INSERT INTO mistake_entries (ts, subject, topic, reason, lesson, revised) VALUES (?, ?, ?, ?, ?, 0)"
    )
    .run(Date.now(), subject, topic, reason, lesson || "");
  return toPlain(getDb().prepare("SELECT * FROM mistake_entries WHERE id = ?").get(info.lastInsertRowid));
}

function toggleRevised(id) {
  const row = getDb().prepare("SELECT * FROM mistake_entries WHERE id = ?").get(Number(id));
  if (!row) return null;
  getDb().prepare("UPDATE mistake_entries SET revised = ? WHERE id = ?").run(row.revised ? 0 : 1, row.id);
  return toPlain(getDb().prepare("SELECT * FROM mistake_entries WHERE id = ?").get(row.id));
}

function remove(id) {
  getDb().prepare("DELETE FROM mistake_entries WHERE id = ?").run(Number(id));
}

function removeBySubject(subject) {
  getDb().prepare("DELETE FROM mistake_entries WHERE subject = ?").run(subject);
}

function removeAll() {
  getDb().prepare("DELETE FROM mistake_entries").run();
}

function insertMany(entries) {
  const stmt = getDb().prepare(
    "INSERT INTO mistake_entries (ts, subject, topic, reason, lesson, revised) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insert = getDb().transaction((list) => {
    list.forEach((e) =>
      stmt.run(e.ts || Date.now(), e.subject, e.topic, e.reason, e.lesson || "", e.revised ? 1 : 0)
    );
  });
  insert(entries);
}

module.exports = { list, add, toggleRevised, remove, removeBySubject, removeAll, insertMany };
