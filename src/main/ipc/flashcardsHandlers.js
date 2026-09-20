const Flashcard = require("../models/Flashcard");

function registerFlashcardsHandlers(ipcMain) {
  ipcMain.handle("flashcards:list", async () => {
    return Flashcard.list();
  });

  ipcMain.handle("flashcards:listDue", async () => {
    return Flashcard.listDue();
  });

  ipcMain.handle("flashcards:add", async (_event, { subject, front, back }) => {
    return Flashcard.add({ subject, front, back });
  });

  ipcMain.handle("flashcards:update", async (_event, { id, front, back }) => {
    return Flashcard.update(id, { front, back });
  });

  ipcMain.handle("flashcards:review", async (_event, { id, correct }) => {
    return Flashcard.review(id, !!correct);
  });

  ipcMain.handle("flashcards:remove", async (_event, id) => {
    Flashcard.remove(id);
    return { ok: true };
  });
}

module.exports = { registerFlashcardsHandlers };
