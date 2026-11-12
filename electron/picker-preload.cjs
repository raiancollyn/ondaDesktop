const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ondaPicker", Object.freeze({
    getData: () => ipcRenderer.invoke("onda:picker:data"),
    onData: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on("onda:picker:data", listener);
        return () => ipcRenderer.removeListener("onda:picker:data", listener);
    },
    confirm: (selection) => ipcRenderer.invoke("onda:picker:confirm", selection),
    cancel: () => ipcRenderer.invoke("onda:picker:cancel")
}));
