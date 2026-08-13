const MistakeEntry = require("../models/MistakeEntry");

function registerMistakesHandlers(ipcMain) {
  ipcMain.handle("mistakes:list", async () => {
    return MistakeEntry.list();
  });

  ipcMain.handle("mistakes:add", async (_event, { subject, topic, reason, lesson }) => {
    return MistakeEntry.add({ subject, topic, reason, lesson });
  });

  ipcMain.handle("mistakes:toggleRevised", async (_event, id) => {
    return MistakeEntry.toggleRevised(id);
  });

  ipcMain.handle("mistakes:remove", async (_event, id) => {
    MistakeEntry.remove(id);
    return { ok: true };
  });
}

module.exports = { registerMistakesHandlers };
