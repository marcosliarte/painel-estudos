const Subject = require("../models/Subject");
const StudyEntry = require("../models/StudyEntry");
const MistakeEntry = require("../models/MistakeEntry");

function registerSubjectsHandlers(ipcMain) {
  ipcMain.handle("subjects:list", async () => {
    return Subject.list();
  });

  ipcMain.handle("subjects:add", async (_event, name) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) return { ok: false, reason: "empty" };
    if (Subject.exists(trimmed)) return { ok: false, reason: "duplicate" };
    Subject.add(trimmed);
    return { ok: true };
  });

  ipcMain.handle("subjects:remove", async (_event, name) => {
    Subject.remove(name);
    StudyEntry.removeBySubject(name);
    MistakeEntry.removeBySubject(name);
    return { ok: true };
  });
}

module.exports = { registerSubjectsHandlers };
