const { contextBridge, ipcRenderer } = require("electron");
const installDesktopUi = require("./desktop-ui.cjs");

contextBridge.exposeInMainWorld("ondaDesktop", Object.freeze({
    isDesktop: true,
    platform: process.platform,
    getAppInfo: () => ipcRenderer.invoke("onda:get-app-info"),
    openCapturePicker: () => ipcRenderer.invoke("onda:open-picker"),
    listProcesses: () => ipcRenderer.invoke("onda:list-processes"),
    getCaptureSelection: () => ipcRenderer.invoke("onda:capture-selection"),
    startAudio: (request) => ipcRenderer.invoke("onda:audio:start", request),
    stopAudio: (captureId) => ipcRenderer.invoke("onda:audio:stop", captureId),
    startThumbnailCapture: (request) => ipcRenderer.invoke("onda:thumbnail:start", request),
    stopThumbnailCapture: (captureId) => ipcRenderer.invoke("onda:thumbnail:stop", captureId),
    startNativeVideo: (request) => ipcRenderer.invoke("onda:video:start", request),
    stopNativeVideo: (captureId) => ipcRenderer.invoke("onda:video:stop", captureId),
    onNativeVideoFrame: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("onda:video:frame", listener);
        return () => ipcRenderer.removeListener("onda:video:frame", listener);
    },
    onNativeVideoStopped: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("onda:video:stopped", listener);
        return () => ipcRenderer.removeListener("onda:video:stopped", listener);
    },
    onThumbnailFrame: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("onda:thumbnail:frame", listener);
        return () => ipcRenderer.removeListener("onda:thumbnail:frame", listener);
    },
    onAudioData: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("onda:audio:data", listener);
        return () => ipcRenderer.removeListener("onda:audio:data", listener);
    },
    onAudioStopped: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("onda:audio:stopped", listener);
        return () => ipcRenderer.removeListener("onda:audio:stopped", listener);
    }
}));

installDesktopUi(ipcRenderer);
