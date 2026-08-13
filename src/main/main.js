const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { initDatabase } = require("./db");
const { registerSubjectsHandlers } = require("./ipc/subjectsHandlers");
const { registerStudyLogHandlers } = require("./ipc/studyLogHandlers");
const { registerMistakesHandlers } = require("./ipc/mistakesHandlers");
const { registerBackupHandlers } = require("./ipc/backupHandlers");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 800,
    minWidth: 480,
    minHeight: 560,
    title: "Painel de Estudos",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(async () => {
  try {
    initDatabase();
  } catch (err) {
    dialog.showErrorBox("Não foi possível abrir o banco de dados", err.message);
    app.quit();
    return;
  }

  registerSubjectsHandlers(ipcMain);
  registerStudyLogHandlers(ipcMain);
  registerMistakesHandlers(ipcMain);
  registerBackupHandlers(ipcMain, () => mainWindow);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
