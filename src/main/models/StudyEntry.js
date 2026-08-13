const { getDb } = require("../db");

function findAll() {
  return getDb().prepare("SELECT date, subject, minutes, questions FROM study_entries").all();
}

function getOne(date, subject) {
  return getDb().prepare("SELECT * FROM study_entries WHERE date = ? AND subject = ?").get(date, subject);
}

function setMinutes(date, subject, minutes) {
  getDb()
    .prepare(
      `INSERT INTO study_entries (date, subject, minutes, questions) VALUES (?, ?, ?, 0)
       ON CONFLICT(date, subject) DO UPDATE SET minutes = excluded.minutes`
    )
    .run(date, subject, minutes);
  return getOne(date, subject);
}

function setQuestions(date, subject, questions) {
  getDb()
    .prepare(
      `INSERT INTO study_entries (date, subject, minutes, questions) VALUES (?, ?, 0, ?)
       ON CONFLICT(date, subject) DO UPDATE SET questions = excluded.questions`
    )
    .run(date, subject, questions);
  return getOne(date, subject);
}

function removeBySubject(subject) {
  getDb().prepare("DELETE FROM study_entries WHERE subject = ?").run(subject);
}

function removeByDate(date) {
  getDb().prepare("DELETE FROM study_entries WHERE date = ?").run(date);
}

function removeAll() {
  getDb().prepare("DELETE FROM study_entries").run();
}

function insertMany(entries) {
  const stmt = getDb().prepare(
    "INSERT INTO study_entries (date, subject, minutes, questions) VALUES (?, ?, ?, ?)"
  );
  const insert = getDb().transaction((list) => {
    list.forEach((e) => stmt.run(e.date, e.subject, e.minutes || 0, e.questions || 0));
  });
  insert(entries);
}

module.exports = {
  findAll,
  getOne,
  setMinutes,
  setQuestions,
  removeBySubject,
  removeByDate,
  removeAll,
  insertMany,
};
