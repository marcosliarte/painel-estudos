const fs = require("fs/promises");
const { dialog } = require("electron");
const Subject = require("../models/Subject");
const StudyEntry = require("../models/StudyEntry");
const MistakeEntry = require("../models/MistakeEntry");
const Flashcard = require("../models/Flashcard");

function registerBackupHandlers(ipcMain, getMainWindow) {
  ipcMain.handle("backup:export", async () => {
    const subjects = Subject.list();
    const studyEntries = StudyEntry.findAll();
    const mistakes = MistakeEntry.list();
    const flashcards = Flashcard.list();

    const data = {
      version: 3,
      exportedAt: new Date().toISOString(),
      subjects,
      studyEntries: studyEntries.map((e) => ({
        date: e.date,
        subject: e.subject,
        minutes: e.minutes,
        questions: e.questions,
      })),
      mistakes: mistakes.map((e) => ({
        ts: e.ts,
        subject: e.subject,
        topic: e.topic,
        reason: e.reason,
        lesson: e.lesson,
        revised: e.revised,
      })),
      flashcards: flashcards.map((c) => ({
        subject: c.subject,
        front: c.front,
        back: c.back,
        createdAt: c.createdAt,
        box: c.box,
        nextReview: c.nextReview,
      })),
    };

    const win = getMainWindow();
    const today = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Salvar backup",
      defaultPath: `backup-estudos-${today}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false, reason: "canceled" };

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    return { ok: true, filePath };
  });

  ipcMain.handle("backup:import", async () => {
    const win = getMainWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Restaurar backup",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled || !filePaths.length) return { ok: false, reason: "canceled" };

    let data;
    try {
      const raw = await fs.readFile(filePaths[0], "utf-8");
      data = JSON.parse(raw);
    } catch (e) {
      return { ok: false, reason: "invalid-file" };
    }

    if (Array.isArray(data.subjects)) {
      Subject.removeAll();
      Subject.insertMany(data.subjects);
    }
    if (Array.isArray(data.studyEntries)) {
      StudyEntry.removeAll();
      StudyEntry.insertMany(data.studyEntries);
    }
    if (Array.isArray(data.mistakes)) {
      MistakeEntry.removeAll();
      MistakeEntry.insertMany(data.mistakes);
    }
    if (Array.isArray(data.flashcards)) {
      Flashcard.removeAll();
      Flashcard.insertMany(data.flashcards);
    }
    return { ok: true };
  });
}

module.exports = { registerBackupHandlers };
