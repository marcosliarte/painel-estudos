const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  subjects: {
    list: () => ipcRenderer.invoke("subjects:list"),
    add: (name) => ipcRenderer.invoke("subjects:add", name),
    remove: (name) => ipcRenderer.invoke("subjects:remove", name),
    rename: (oldName, newName) => ipcRenderer.invoke("subjects:rename", { oldName, newName }),
  },
  studyLog: {
    getAll: () => ipcRenderer.invoke("studyLog:getAll"),
    adjustMinutes: (date, subject, delta) =>
      ipcRenderer.invoke("studyLog:adjustMinutes", { date, subject, delta }),
    adjustQuestions: (date, subject, delta) =>
      ipcRenderer.invoke("studyLog:adjustQuestions", { date, subject, delta }),
    setQuestions: (date, subject, value) =>
      ipcRenderer.invoke("studyLog:setQuestions", { date, subject, value }),
    setMinutes: (date, subject, value) =>
      ipcRenderer.invoke("studyLog:setMinutes", { date, subject, value }),
    clearDay: (date) => ipcRenderer.invoke("studyLog:clearDay", date),
  },
  mistakes: {
    list: () => ipcRenderer.invoke("mistakes:list"),
    add: (entry) => ipcRenderer.invoke("mistakes:add", entry),
    toggleRevised: (id) => ipcRenderer.invoke("mistakes:toggleRevised", id),
    remove: (id) => ipcRenderer.invoke("mistakes:remove", id),
  },
  backup: {
    export: () => ipcRenderer.invoke("backup:export"),
    import: () => ipcRenderer.invoke("backup:import"),
  },
});
