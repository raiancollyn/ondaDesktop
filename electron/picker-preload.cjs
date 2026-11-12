const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ondaPicker", Object.freeze({
    getData: () => ipcRenderer.invoke("onda:picker:data"),
    onData: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on("onda:picker:data", listener);
        return () => ipcRenderer.removeListener("onda:picker:data", listener);
    },
    confirm: (selection) => ipcRenderer.invoke("onda:picker:confirm", selection),
    cancel: () => ipcRenderer.invoke("onda:picker:cancel"),
    window: Object.freeze({
        minimize: () => ipcRenderer.send("onda:picker:window:minimize"),
        toggleMaximize: () => ipcRenderer.send("onda:picker:window:toggle-maximize"),
        close: () => ipcRenderer.send("onda:picker:window:close"),
        isMaximized: () => ipcRenderer.invoke("onda:picker:window:is-maximized"),
        onMaximized: (callback) => {
            const listener = (_event, maximized) => callback(Boolean(maximized));
            ipcRenderer.on("onda:picker:window:maximized", listener);
            return () => ipcRenderer.removeListener("onda:picker:window:maximized", listener);
        }
    })
}));
