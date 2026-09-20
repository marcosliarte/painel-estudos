const { getDb } = require("../db");

// Leitner: caixa 1 (nova/errou) revisa na hora; caixas seguintes espaçam mais.
const BOX_INTERVAL_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 };
const MAX_BOX = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

function nextReviewFor(box, from) {
  var days = BOX_INTERVAL_DAYS[box] !== undefined ? BOX_INTERVAL_DAYS[box] : 0;
  return from + days * DAY_MS;
}

function toPlain(row) {
  return {
    id: String(row.id),
    subject: row.subject,
    front: row.front,
    back: row.back,
    createdAt: row.created_at,
    box: row.box,
    nextReview: row.next_review,
  };
}

function list() {
  return getDb().prepare("SELECT * FROM flashcards ORDER BY created_at DESC").all().map(toPlain);
}

function listDue(now) {
  return getDb()
    .prepare("SELECT * FROM flashcards WHERE next_review <= ? ORDER BY next_review ASC")
    .all(now == null ? Date.now() : now)
    .map(toPlain);
}

function add({ subject, front, back }) {
  const now = Date.now();
  const info = getDb()
    .prepare(
      "INSERT INTO flashcards (subject, front, back, created_at, box, next_review) VALUES (?, ?, ?, ?, 1, ?)"
    )
    .run(subject, front, back, now, now);
  return toPlain(getDb().prepare("SELECT * FROM flashcards WHERE id = ?").get(info.lastInsertRowid));
}

function update(id, { front, back }) {
  const row = getDb().prepare("SELECT * FROM flashcards WHERE id = ?").get(Number(id));
  if (!row) return null;
  getDb()
    .prepare("UPDATE flashcards SET front = ?, back = ? WHERE id = ?")
    .run(front != null ? front : row.front, back != null ? back : row.back, row.id);
  return toPlain(getDb().prepare("SELECT * FROM flashcards WHERE id = ?").get(row.id));
}

function review(id, correct) {
  const row = getDb().prepare("SELECT * FROM flashcards WHERE id = ?").get(Number(id));
  if (!row) return null;
  const now = Date.now();
  const box = correct ? Math.min(MAX_BOX, row.box + 1) : 1;
  const next = nextReviewFor(box, now);
  getDb().prepare("UPDATE flashcards SET box = ?, next_review = ? WHERE id = ?").run(box, next, row.id);
  return toPlain(getDb().prepare("SELECT * FROM flashcards WHERE id = ?").get(row.id));
}

function remove(id) {
  getDb().prepare("DELETE FROM flashcards WHERE id = ?").run(Number(id));
}

function removeBySubject(subject) {
  getDb().prepare("DELETE FROM flashcards WHERE subject = ?").run(subject);
}

function renameSubject(oldName, newName) {
  getDb().prepare("UPDATE flashcards SET subject = ? WHERE subject = ?").run(newName, oldName);
}

function removeAll() {
  getDb().prepare("DELETE FROM flashcards").run();
}

function insertMany(cards) {
  const stmt = getDb().prepare(
    "INSERT INTO flashcards (subject, front, back, created_at, box, next_review) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insert = getDb().transaction((list) => {
    list.forEach((c) => {
      const createdAt = c.createdAt || Date.now();
      const box = c.box || 1;
      const nextReview = c.nextReview != null ? c.nextReview : createdAt;
      stmt.run(c.subject, c.front, c.back, createdAt, box, nextReview);
    });
  });
  insert(cards);
}

module.exports = {
  MAX_BOX,
  list,
  listDue,
  add,
  update,
  review,
  remove,
  removeBySubject,
  renameSubject,
  removeAll,
  insertMany,
};
