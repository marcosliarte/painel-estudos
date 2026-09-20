const { Notification } = require("electron");

function registerNotifyHandlers(ipcMain) {
  ipcMain.handle("notify:show", async (_event, { title, body }) => {
    if (!Notification.isSupported()) return { ok: false };
    new Notification({ title: title || "Painel de Estudos", body: body || "" }).show();
    return { ok: true };
  });
}

module.exports = { registerNotifyHandlers };
