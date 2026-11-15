const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ondaPip", Object.freeze({
    onFrame: (callback) => {
        const listener = (_event, dataUrl) => callback(dataUrl);
        ipcRenderer.on("onda:pip:frame", listener);
        return () => ipcRenderer.removeListener("onda:pip:frame", listener);
    },
    close: () => ipcRenderer.send("onda:pip:close")
}));
