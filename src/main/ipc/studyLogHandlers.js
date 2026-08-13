const StudyEntry = require("../models/StudyEntry");

function registerStudyLogHandlers(ipcMain) {
  ipcMain.handle("studyLog:getAll", async () => {
    const all = StudyEntry.findAll();
    const log = {};
    all.forEach((e) => {
      if (!log[e.date]) log[e.date] = {};
      log[e.date][e.subject] = { min: e.minutes, q: e.questions };
    });
    return log;
  });

  ipcMain.handle("studyLog:adjustMinutes", async (_event, { date, subject, delta }) => {
    const cur = StudyEntry.getOne(date, subject);
    const minutes = Math.max(0, (cur ? cur.minutes : 0) + delta);
    const entry = StudyEntry.setMinutes(date, subject, minutes);
    return { minutes: entry.minutes, questions: entry.questions };
  });

  ipcMain.handle("studyLog:adjustQuestions", async (_event, { date, subject, delta }) => {
    const cur = StudyEntry.getOne(date, subject);
    const questions = Math.max(0, (cur ? cur.questions : 0) + delta);
    const entry = StudyEntry.setQuestions(date, subject, questions);
    return { minutes: entry.minutes, questions: entry.questions };
  });

  ipcMain.handle("studyLog:setQuestions", async (_event, { date, subject, value }) => {
    const questions = Math.max(0, parseInt(value, 10) || 0);
    const entry = StudyEntry.setQuestions(date, subject, questions);
    return { minutes: entry.minutes, questions: entry.questions };
  });

  ipcMain.handle("studyLog:setMinutes", async (_event, { date, subject, value }) => {
    const minutes = Math.max(0, parseInt(value, 10) || 0);
    const entry = StudyEntry.setMinutes(date, subject, minutes);
    return { minutes: entry.minutes, questions: entry.questions };
  });

  ipcMain.handle("studyLog:clearDay", async (_event, date) => {
    StudyEntry.removeByDate(date);
    return { ok: true };
  });
}

module.exports = { registerStudyLogHandlers };
