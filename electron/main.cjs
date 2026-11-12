if (!process.versions.electron) {
    console.error(
        "O Onda Desktop precisa ser iniciado pelo Electron.\n" +
        "Use `npm start` ou o arquivo `iniciar-onda.cmd`.\n" +
        "Se `ELECTRON_RUN_AS_NODE=1` estiver definido no ambiente, remova essa variável."
    );
    process.exit(1);
}

const {
    app,
    BrowserWindow,
    Menu,
    desktopCapturer,
    dialog,
    ipcMain,
    screen,
    session,
    shell
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Em alguns Windows o sandbox do Chromium não consegue criar o processo de GPU
// (SBOX_ERROR_CREATE_PROCESS, código 18). O launcher inicia o Electron com
// --no-sandbox; veja desktop/README.md. O site carregado é apenas o domínio
// confiável do Onda.

function resolveUserDataPath() {
    if (process.env.ONDA_USER_DATA) {
        return path.resolve(process.env.ONDA_USER_DATA);
    }

    if (!app.isPackaged) {
        return path.join(__dirname, "..", ".userdata");
    }

    const base = process.env.LOCALAPPDATA || app.getPath("appData");
    return path.join(base, "OndaDesktop");
}

const userDataPath = resolveUserDataPath();
try {
    fs.mkdirSync(userDataPath, { recursive: true });
    app.setPath("userData", userDataPath);
    console.log("Dados locais em:", userDataPath);
} catch (error) {
    console.error("Não foi possível preparar a pasta de dados local:", error);
}

process.on("uncaughtException", (error) => {
    console.error("Erro não tratado no processo principal:", error);
    try {
        dialog.showErrorBox("Onda Desktop", String(error?.stack || error));
    } catch {
        // The dialog module may not be ready during early startup.
    }
});

process.on("unhandledRejection", (reason) => {
    console.error("Promise rejeitada no processo principal:", reason);
});

const DEFAULT_URL = "https://onda.dpbr.net";
const PROTOCOL = "onda";
const APP_URL = (process.env.ONDA_URL || DEFAULT_URL).replace(/\/+$/, "");
const SIDECAR_EXE = process.platform === "win32" ? "OndaCapture.exe" : "OndaCapture";

let mainWindow = null;
let pickerWindow = null;
let autoUpdaterInstance = null;
let pickerData = null;
let pendingSelection = null;
let pendingDeepLink = process.argv.find((argument) => argument.startsWith(`${PROTOCOL}://`)) || null;
let lastCaptureSelection = null;
const captureSourceObjects = new Map();
const audioCaptures = new Map();
const thumbnailCaptures = new Map();
const videoCaptures = new Map();
const windowProcessCache = new Map();

function isSameSite(url) {
    try {
        return new URL(url).origin === new URL(APP_URL).origin;
    } catch {
        return false;
    }
}

function deepLinkToRoomUrl(rawLink) {
    try {
        const url = new URL(rawLink);
        if (url.protocol !== `${PROTOCOL}:`) {
            return null;
        }

        const segments = [url.hostname, ...url.pathname.split("/")].filter(Boolean);
        const roomIndex = segments.indexOf("sala");
        if (roomIndex < 0 || !segments[roomIndex + 1]) {
            return null;
        }

        const handoff = url.searchParams.get("handoff");
        const roomUrl = `${APP_URL}/sala/${encodeURIComponent(segments[roomIndex + 1])}`;
        return handoff
            ? `${roomUrl}?handoff=${encodeURIComponent(handoff)}`
            : roomUrl;
    } catch {
        return null;
    }
}

function listSidecarCandidates() {
    const candidates = [
        process.env.ONDA_CAPTURE_EXE,
        path.join(process.resourcesPath, "native", SIDECAR_EXE),
        path.join(__dirname, "..", "dist", "native", SIDECAR_EXE),
        path.join(__dirname, "..", "native", "OndaCapture", "bin", "Release", "net10.0", "win-x64", SIDECAR_EXE),
        path.join(__dirname, "..", "native", "OndaCapture", "bin", "Release", "net10.0", SIDECAR_EXE)
    ].filter(Boolean);

    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function runSidecarList() {
    const executable = listSidecarCandidates();
    if (!executable) {
        return Promise.resolve({
            processes: [],
            windows: [],
            error: "OndaCapture não encontrado. Execute npm run native:build."
        });
    }

    return new Promise((resolve) => {
        const child = spawn(executable, ["--list"], {
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";
        const timeout = setTimeout(() => {
            child.kill();
            resolve({ processes: [], windows: [], error: "Tempo esgotado ao listar os processos." });
        }, 8000);

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });
        child.on("error", (error) => {
            clearTimeout(timeout);
            resolve({ processes: [], windows: [], error: error.message });
        });
        child.on("close", (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                resolve({ processes: [], windows: [], error: stderr.trim() || `OndaCapture saiu com código ${code}.` });
                return;
            }

            try {
                const start = stdout.indexOf("{");
                const end = stdout.lastIndexOf("}");
                const json = start >= 0 && end > start ? stdout.slice(start, end + 1) : stdout;
                const data = JSON.parse(json);
                const processes = Array.isArray(data.processes) ? data.processes : [];
                const windows = Array.isArray(data.windows) ? data.windows : [];
                const audioSessions = Array.isArray(data.audioSessions) ? data.audioSessions : [];
                const foregroundPid = Number(data.foregroundPid) || 0;
                const byPid = new Map(processes.map((process) => [Number(process.pid), process]));

                for (const session of audioSessions) {
                    const pid = Number(session.pid);
                    if (!Number.isFinite(pid) || pid <= 0) {
                        continue;
                    }

                    const existing = byPid.get(pid);
                    if (existing) {
                        existing.audioState = session.state || "AudioSessionStateActive";
                    } else {
                        const added = {
                            pid,
                            name: session.name || `Processo ${pid}`,
                            title: "",
                            audioState: session.state || "AudioSessionStateActive"
                        };
                        processes.push(added);
                        byPid.set(pid, added);
                    }
                }

                processes.sort((left, right) => {
                    const leftAudio = left.audioState ? 1 : 0;
                    const rightAudio = right.audioState ? 1 : 0;
                    return rightAudio - leftAudio ||
                        String(left.name).localeCompare(String(right.name), "pt-BR");
                });

                resolve({ processes, windows, error: null, foregroundPid });
            } catch (error) {
                console.error("Resposta inválida do OndaCapture.", {
                    stdout: stdout.slice(0, 1000),
                    stderr: stderr.slice(-1000),
                    error: error.message
                });
                resolve({ processes: [], windows: [], error: "Resposta inválida do OndaCapture." });
            }
        });
    });
}

async function buildPickerData() {
    const [sources, processResult] = await Promise.all([
        desktopCapturer.getSources({
            types: ["screen", "window"],
            thumbnailSize: { width: 320, height: 180 },
            fetchWindowIcons: true
        }),
        runSidecarList()
    ]);

    const ownSourceIds = new Set();
    const ownTitles = new Set();
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window || window.isDestroyed()) {
            continue;
        }

        try {
            const sourceId = window.webContents.getMediaSourceId();
            if (sourceId) {
                ownSourceIds.add(sourceId);
            }
        } catch {
            // The window may disappear while the picker is loading.
        }

        const title = window.getTitle();
        if (title) {
            ownTitles.add(title);
        }
    }

    const taskbarWindows = new Set(
        (Array.isArray(processResult.windows) ? processResult.windows : [])
            .filter((window) => window?.taskbar)
            .map((window) => Number(window.hwnd))
            .filter((hwnd) => Number.isFinite(hwnd) && hwnd > 0)
    );
    const filterWindowSources = Array.isArray(processResult.windows) && !processResult.error;
    const visibleSources = sources.filter((source) => {
        if (source.id.startsWith("screen:")) {
            return true;
        }

        if (!filterWindowSources) {
            return true;
        }

        const match = /^window:(\d+)/.exec(source.id);
        return !match || taskbarWindows.has(Number(match[1]));
    });

    captureSourceObjects.clear();
    for (const source of visibleSources) {
        captureSourceObjects.set(source.id, source);
    }

    return {
        sources: visibleSources.map((source) => ({
            id: source.id,
            name: source.name,
            kind: source.id.startsWith("screen:") ? "screen" : "window",
            isOwnApp: ownSourceIds.has(source.id) || ownTitles.has(source.name),
            thumbnail: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
            appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null
        })),
        processes: processResult.processes,
        foregroundPid: processResult.foregroundPid || 0,
        processError: processResult.error
    };
}

function closePicker(selection) {
    pendingSelection = selection || null;
    if (pickerWindow && !pickerWindow.isDestroyed()) {
        pickerWindow.close();
    }
    pickerWindow = null;
}

async function openCapturePicker() {
    if (pickerWindow && !pickerWindow.isDestroyed()) {
        pickerWindow.focus();
        return null;
    }

    pickerData = null;
    pendingSelection = null;

    return new Promise((resolve) => {
        const picker = new BrowserWindow({
            width: 1080,
            height: 760,
            minWidth: 820,
            minHeight: 620,
            parent: mainWindow || undefined,
            modal: Boolean(mainWindow),
            show: false,
            title: "Compartilhar no Onda",
            backgroundColor: "#0c1916",
            webPreferences: {
                preload: path.join(__dirname, "picker-preload.cjs"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false
            }
        });

        pickerWindow = picker;
        let resolved = false;
        const finish = (selection) => {
            if (resolved) {
                return;
            }
            resolved = true;
            const result = selection || pendingSelection;
            pendingSelection = null;
            resolve(result || null);
        };

        picker.on("closed", () => {
            pickerWindow = null;
            finish(pendingSelection);
        });

        picker.once("ready-to-show", () => picker.show());
        picker.loadFile(path.join(__dirname, "..", "picker", "index.html"));

        void buildPickerData()
            .then((data) => {
                pickerData = data;
                if (pickerWindow && !pickerWindow.isDestroyed()) {
                    pickerWindow.webContents.send("onda:picker:data", data);
                }
            })
            .catch((error) => {
                const data = {
                    sources: [],
                    processes: [],
                    processError: error.message || "Não foi possível carregar as fontes de captura."
                };
                pickerData = data;
                if (pickerWindow && !pickerWindow.isDestroyed()) {
                    pickerWindow.webContents.send("onda:picker:data", data);
                }
            });
    });
}

function stopVideoCapture(captureId) {
    const capture = videoCaptures.get(captureId);
    if (!capture) {
        return false;
    }

    videoCaptures.delete(captureId);
    try {
        capture.child.kill();
    } catch {
        // The process may already have exited.
    }
    return true;
}

function stopAllVideoCaptures() {
    for (const captureId of Array.from(videoCaptures.keys())) {
        stopVideoCapture(captureId);
    }
}

function startVideoCapture(sender, request) {
    const captureId = String(request?.captureId || "").trim();
    const sourceId = String(request?.sourceId || "").trim();
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(captureId) || !sourceId) {
        return Promise.reject(new Error("Captura de vídeo inválida."));
    }

    const source = captureSourceObjects.get(sourceId);
    if (!source) {
        return Promise.reject(new Error("Fonte de vídeo não encontrada."));
    }

    const executable = listSidecarCandidates();
    if (!executable) {
        return Promise.reject(new Error("OndaCapture não encontrado. Execute npm run native:build."));
    }

    const fps = Math.max(2, Math.min(30, Number(request?.fps) || 15));
    const width = Math.max(320, Math.min(1920, Number(request?.width) || 1280));
    const height = Math.max(180, Math.min(1080, Number(request?.height) || 720));
    const args = [
        "--video",
        "--out-width", String(width),
        "--out-height", String(height),
        "--fps", String(fps)
    ];

    if (sourceId.startsWith("screen:")) {
        const displayId = String(source.display_id || "");
        const displays = screen.getAllDisplays();
        const display = displays.find((item) => String(item.id) === displayId) || screen.getPrimaryDisplay();
        const scale = Number(display.scaleFactor) || 1;
        const bounds = display.bounds;
        args.push(
            "--kind", "screen",
            "--x", String(Math.round(bounds.x * scale)),
            "--y", String(Math.round(bounds.y * scale)),
            "--width", String(Math.round(bounds.width * scale)),
            "--height", String(Math.round(bounds.height * scale)));
    } else {
        const match = /^window:(\d+)/.exec(sourceId);
        const hwnd = match ? Number(match[1]) : 0;
        if (!Number.isInteger(hwnd) || hwnd <= 0) {
            return Promise.reject(new Error("Janela de captura inválida."));
        }
        args.push("--kind", "window", "--hwnd", String(hwnd));
    }

    stopVideoCapture(captureId);

    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, {
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });

        videoCaptures.set(captureId, { child, sender });
        let headerBuffer = Buffer.alloc(0);
        let frameBuffer = Buffer.alloc(0);
        let started = false;
        let settled = false;
        let stderr = "";
        let timeout = null;

        const cleanup = () => {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            if (videoCaptures.get(captureId)?.child === child) {
                videoCaptures.delete(captureId);
            }
        };

        const fail = (error) => {
            cleanup();
            try {
                child.kill();
            } catch {
                // Ignore.
            }
            if (!settled) {
                settled = true;
                reject(error);
            }
        };

        timeout = setTimeout(() => {
            fail(new Error("O OndaCapture não iniciou o vídeo a tempo."));
        }, 8000);

        child.stderr.on("data", (chunk) => {
            stderr = (stderr + chunk.toString("utf8")).slice(-8000);
        });

        child.stdout.on("data", (chunk) => {
            if (!started) {
                headerBuffer = Buffer.concat([headerBuffer, chunk]);
                const newline = headerBuffer.indexOf(0x0a);
                if (newline < 0) {
                    return;
                }

                const line = headerBuffer.subarray(0, newline).toString("utf8").trim();
                frameBuffer = headerBuffer.subarray(newline + 1);
                headerBuffer = Buffer.alloc(0);

                let header;
                try {
                    header = JSON.parse(line);
                } catch {
                    fail(new Error("Resposta inválida do vídeo do OndaCapture."));
                    return;
                }

                if (header?.type !== "video-started") {
                    fail(new Error(header?.error || "O OndaCapture não iniciou o vídeo."));
                    return;
                }

                started = true;
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                if (!settled) {
                    settled = true;
                    resolve({
                        captureId,
                        mode: "native",
                        width: Number(header.width) || width,
                        height: Number(header.height) || height,
                        fps: Number(header.fps) || fps
                    });
                }
            } else {
                frameBuffer = Buffer.concat([frameBuffer, chunk]);
            }

            if (!started) {
                return;
            }

            while (frameBuffer.length >= 4) {
                const frameLength = frameBuffer.readInt32LE(0);
                if (frameLength <= 0 || frameLength > 8 * 1024 * 1024) {
                    fail(new Error("Quadro de vídeo inválido."));
                    return;
                }
                if (frameBuffer.length < 4 + frameLength) {
                    break;
                }

                const frame = frameBuffer.subarray(4, 4 + frameLength);
                frameBuffer = frameBuffer.subarray(4 + frameLength);
                if (!sender.isDestroyed()) {
                    sender.send("onda:video:frame", {
                        captureId,
                        data: new Uint8Array(frame)
                    });
                }
            }
        });

        child.on("error", (error) => {
            fail(new Error(`Falha ao iniciar o vídeo do OndaCapture: ${error.message}`));
        });

        child.on("exit", (code) => {
            cleanup();
            if (sender && !sender.isDestroyed()) {
                sender.send("onda:video:stopped", { captureId, code });
            }
            if (!started) {
                fail(new Error(stderr.trim() || `O OndaCapture de vídeo saiu com código ${code}.`));
            }
        });
    });
}

function stopAudioCapture(captureId) {
    const capture = audioCaptures.get(captureId);
    if (!capture) {
        return false;
    }

    audioCaptures.delete(captureId);
    try {
        capture.child.kill();
    } catch {
        // The process may already have exited.
    }
    return true;
}

function stopAllAudioCaptures() {
    for (const captureId of Array.from(audioCaptures.keys())) {
        stopAudioCapture(captureId);
    }
}

function stopThumbnailCapture(captureId) {
    const capture = thumbnailCaptures.get(captureId);
    if (!capture) {
        return false;
    }

    capture.stopped = true;
    thumbnailCaptures.delete(captureId);
    if (capture.timer) {
        clearTimeout(capture.timer);
    }
    return true;
}

function stopAllThumbnailCaptures() {
    for (const captureId of Array.from(thumbnailCaptures.keys())) {
        stopThumbnailCapture(captureId);
    }
}

function startThumbnailCapture(sender, request) {
    const captureId = String(request?.captureId || "").trim();
    const sourceId = String(request?.sourceId || "").trim();
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(captureId) || !sourceId) {
        return Promise.reject(new Error("Captura por quadros inválida."));
    }

    const fps = Math.max(2, Math.min(30, Number(request?.fps) || 15));
    const width = Math.max(320, Math.min(1920, Number(request?.width) || 1280));
    const height = Math.max(180, Math.min(1080, Number(request?.height) || 720));
    const sourceKind = sourceId.startsWith("screen:") ? "screen" : "window";

    stopThumbnailCapture(captureId);

    const capture = {
        stopped: false,
        timer: null,
        sender,
        captureId,
        sourceId,
        sourceKind,
        fps,
        width,
        height
    };
    thumbnailCaptures.set(captureId, capture);

    const tick = async () => {
        if (capture.stopped) {
            return;
        }

        const startedAt = Date.now();
        try {
            const sources = await desktopCapturer.getSources({
                types: [sourceKind],
                thumbnailSize: { width, height },
                fetchWindowIcons: false
            });
            const source = sources.find((item) => item.id === sourceId);

            if (source && !source.thumbnail.isEmpty() && !sender.isDestroyed()) {
                const jpeg = source.thumbnail.toJPEG(82);
                sender.send("onda:thumbnail:frame", {
                    captureId,
                    dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
                    width,
                    height
                });
            }
        } catch (error) {
            console.warn("Falha ao capturar quadro de compatibilidade:", error.message);
        }

        if (capture.stopped) {
            return;
        }

        const elapsed = Date.now() - startedAt;
        const delay = Math.max(0, Math.floor(1000 / fps) - elapsed);
        capture.timer = setTimeout(tick, delay);
    };

    void tick();
    return Promise.resolve({ captureId, fps, width, height, mode: "thumbnail" });
}

function sendAudioChunk(sender, captureId, chunk) {
    if (!chunk || chunk.length === 0 || sender.isDestroyed()) {
        return;
    }

    sender.send("onda:audio:data", {
        captureId,
        data: new Uint8Array(chunk)
    });
}

function startAudioCapture(sender, request) {
    const captureId = String(request?.captureId || "").trim();
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(captureId)) {
        return Promise.reject(new Error("Identificador de captura inválido."));
    }

    const requestedMode = String(request?.mode || "include").toLowerCase();
    const mode = requestedMode === "system"
        ? "system"
        : requestedMode === "exclude" ? "exclude" : "include";
    const pid = Number(request?.pid);
    if (mode !== "system" && (!Number.isInteger(pid) || pid <= 0)) {
        return Promise.reject(new Error("Processo de áudio inválido."));
    }

    const executable = listSidecarCandidates();
    if (!executable) {
        return Promise.reject(new Error("OndaCapture não encontrado. Execute npm run native:build."));
    }

    stopAudioCapture(captureId);
    const captureArgs = ["--capture"];
    if (mode === "system") {
        // Exclude the whole Onda Desktop process tree so remote voices played
        // by the app are never captured and sent back to the room.
        captureArgs.push("--system", "--exclude-pid", String(process.pid));
    } else {
        captureArgs.push("--pid", String(pid), "--mode", mode);
    }

    return new Promise((resolve, reject) => {
        const child = spawn(executable, captureArgs, {
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });

        audioCaptures.set(captureId, { child, sender });

        let buffered = Buffer.alloc(0);
        let started = false;
        let settled = false;
        let stderr = "";
        let timeout = null;

        const cleanup = () => {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            if (audioCaptures.get(captureId)?.child === child) {
                audioCaptures.delete(captureId);
            }
        };

        const fail = (error) => {
            cleanup();
            try {
                child.kill();
            } catch {
                // Ignore.
            }
            if (!settled) {
                settled = true;
                reject(error);
            }
        };

        timeout = setTimeout(() => {
            fail(new Error("O OndaCapture não iniciou a captura a tempo."));
        }, 8000);

        child.stderr.on("data", (chunk) => {
            stderr = (stderr + chunk.toString("utf8")).slice(-8000);
        });

        child.stdout.on("data", (chunk) => {
            if (!started) {
                buffered = Buffer.concat([buffered, chunk]);
                const newline = buffered.indexOf(0x0a);
                if (newline < 0) {
                    return;
                }

                const line = buffered.subarray(0, newline).toString("utf8").trim();
                buffered = buffered.subarray(newline + 1);

                let header;
                try {
                    header = JSON.parse(line);
                } catch {
                    fail(new Error("Resposta inválida do OndaCapture."));
                    return;
                }

                if (header?.type !== "started") {
                    fail(new Error(header?.error || "O OndaCapture não iniciou a captura."));
                    return;
                }

                started = true;
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }

                if (!settled) {
                    settled = true;
                    resolve({
                        captureId,
                        pid: mode === "system" ? process.pid : pid,
                        mode,
                        sampleRate: Number(header.sampleRate) || 48000,
                        channels: Number(header.channels) || 2
                    });
                }

                if (buffered.length > 0) {
                    sendAudioChunk(sender, captureId, buffered);
                    buffered = Buffer.alloc(0);
                }
            } else {
                sendAudioChunk(sender, captureId, chunk);
            }
        });

        child.on("error", (error) => {
            fail(new Error(`Falha ao iniciar o OndaCapture: ${error.message}`));
        });

        child.on("exit", (code) => {
            cleanup();
            if (sender && !sender.isDestroyed()) {
                sender.send("onda:audio:stopped", { captureId, code });
            }
            if (!started) {
                fail(new Error(stderr.trim() || `O OndaCapture saiu com código ${code}.`));
            }
        });
    });
}

function resolveWindowProcess(sourceId) {
    const match = /^window:(\d+)/.exec(String(sourceId || ""));
    const hwnd = match ? Number(match[1]) : 0;
    if (!Number.isInteger(hwnd) || hwnd <= 0) {
        return Promise.reject(new Error("Janela inválida."));
    }

    if (windowProcessCache.has(hwnd)) {
        return Promise.resolve(windowProcessCache.get(hwnd));
    }

    const executable = listSidecarCandidates();
    if (!executable) {
        return Promise.reject(new Error("OndaCapture não encontrado."));
    }

    return new Promise((resolve, reject) => {
        const child = spawn(executable, ["--window-pid", "--hwnd", String(hwnd)], {
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error("Tempo esgotado ao identificar o processo da janela."));
        }, 5000);

        child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
        child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
        child.on("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                reject(new Error(stderr.trim() || `OndaCapture saiu com código ${code}.`));
                return;
            }
            try {
                const data = JSON.parse(stdout);
                if (!Number.isInteger(Number(data.pid)) || Number(data.pid) <= 0) {
                    reject(new Error("Processo da janela não encontrado."));
                    return;
                }
                const result = { pid: Number(data.pid), name: data.name || `Processo ${data.pid}` };
                windowProcessCache.set(hwnd, result);
                resolve(result);
            } catch {
                reject(new Error("Resposta inválida ao identificar o processo da janela."));
            }
        });
    });
}

function registerIpc() {
    const fromMainWindow = (event) =>
        Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);

    ipcMain.handle("onda:get-app-info", () => ({
        version: app.getVersion(),
        electron: process.versions.electron,
        platform: process.platform,
        isPackaged: app.isPackaged,
        siteUrl: APP_URL
    }));

    ipcMain.on("onda:window:minimize", (event) => {
        if (fromMainWindow(event)) {
            mainWindow.minimize();
        }
    });

    ipcMain.on("onda:window:toggle-maximize", (event) => {
        if (!fromMainWindow(event)) {
            return;
        }

        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    });

    ipcMain.on("onda:window:close", (event) => {
        if (fromMainWindow(event)) {
            mainWindow.close();
        }
    });

    ipcMain.handle("onda:window:is-maximized", (event) =>
        fromMainWindow(event) && mainWindow.isMaximized());

    ipcMain.on("onda:navigate-home", (event) => {
        if (fromMainWindow(event)) {
            mainWindow.loadURL(APP_URL);
        }
    });

    ipcMain.on("onda:reload", (event) => {
        if (fromMainWindow(event)) {
            mainWindow.reload();
        }
    });

    ipcMain.on("onda:open-site", (event) => {
        if (fromMainWindow(event)) {
            shell.openExternal(APP_URL);
        }
    });

    ipcMain.on("onda:quit", (event) => {
        if (fromMainWindow(event)) {
            app.quit();
        }
    });

    ipcMain.handle("onda:check-updates", async (event) => {
        if (!fromMainWindow(event)) {
            return { state: "error", message: "Origem não autorizada." };
        }

        if (!app.isPackaged) {
            return { state: "not-packaged" };
        }

        if (!autoUpdaterInstance) {
            return { state: "error", message: "Atualizador indisponível." };
        }

        try {
            await autoUpdaterInstance.checkForUpdates();
            return { state: "started" };
        } catch (error) {
            return {
                state: "error",
                message: String(error?.message || error)
            };
        }
    });

    ipcMain.handle("onda:update:install", (event) => {
        if (!fromMainWindow(event) || !autoUpdaterInstance) {
            return false;
        }

        autoUpdaterInstance.quitAndInstall();
        return true;
    });

    ipcMain.handle("onda:list-processes", () => runSidecarList());
    ipcMain.handle("onda:open-picker", () => openCapturePicker());
    ipcMain.handle("onda:picker:data", () => pickerData);
    ipcMain.handle("onda:capture-selection", () => lastCaptureSelection);

    ipcMain.handle("onda:audio:start", (event, request) => {
        if (!mainWindow || event.sender !== mainWindow.webContents) {
            throw new Error("Origem não autorizada para captura de áudio.");
        }
        return startAudioCapture(event.sender, request);
    });

    ipcMain.handle("onda:audio:stop", (event, captureId) => {
        if (!mainWindow || event.sender !== mainWindow.webContents) {
            throw new Error("Origem não autorizada para captura de áudio.");
        }
        return stopAudioCapture(String(captureId || ""));
    });

    ipcMain.handle("onda:thumbnail:start", (event, request) => {
        if (!mainWindow || event.sender !== mainWindow.webContents) {
            throw new Error("Origem não autorizada para captura de quadros.");
        }
        return startThumbnailCapture(event.sender, request);
    });

    ipcMain.handle("onda:thumbnail:stop", (event, captureId) => {
        if (!mainWindow || event.sender !== mainWindow.webContents) {
            throw new Error("Origem não autorizada para captura de quadros.");
        }
        return stopThumbnailCapture(String(captureId || ""));
    });

    ipcMain.handle("onda:video:start", (event, request) => {
        if (!mainWindow || event.sender !== mainWindow.webContents) {
            throw new Error("Origem não autorizada para captura de vídeo.");
        }
        return startVideoCapture(event.sender, request);
    });

    ipcMain.handle("onda:video:stop", (event, captureId) => {
        if (!mainWindow || event.sender !== mainWindow.webContents) {
            throw new Error("Origem não autorizada para captura de vídeo.");
        }
        return stopVideoCapture(String(captureId || ""));
    });

    ipcMain.handle("onda:picker:confirm", async (event, selection) => {
        if (!pickerWindow || event.sender !== pickerWindow.webContents) {
            return false;
        }

        const source = pickerData?.sources?.find((item) => item.id === selection?.sourceId);
        if (!source) {
            return false;
        }

        const validAudioModes = new Set(["none", "system", "exclude", "window"]);
        const requestedMode = validAudioModes.has(selection.audioMode) ? selection.audioMode : "none";
        let audioMode = requestedMode;
        let process = null;

        if (source.kind === "window" && source.isOwnApp) {
            // Never capture the Onda Desktop's own window audio: that would
            // send the participants' voices back into the room.
            audioMode = "none";
        }

        if (source.kind === "screen") {
            if (audioMode === "window") {
                return false;
            }
            if (audioMode === "exclude") {
                process = pickerData?.processes?.find((item) => Number(item.pid) === Number(selection.processId)) || null;
                if (!process) {
                    return false;
                }
            }
        } else {
            if (audioMode === "system" || audioMode === "exclude") {
                return false;
            }
            if (audioMode === "window") {
                try {
                    const resolved = await resolveWindowProcess(source.id);
                    process = { pid: resolved.pid, name: resolved.name };
                } catch (error) {
                    console.error("Não foi possível obter o processo da janela:", error);
                    return false;
                }
            }
        }

        closePicker({
            sourceId: source.id,
            sourceName: source.name,
            sourceKind: source.kind,
            audioMode,
            processId: process ? Number(process.pid) : null,
            processName: process?.name || null
        });
        return true;
    });

    ipcMain.handle("onda:picker:cancel", (event) => {
        if (!pickerWindow || event.sender !== pickerWindow.webContents) {
            return false;
        }

        closePicker(null);
        return true;
    });
}

function createMenu() {
    // The window uses the custom desktop chrome injected by the preload.
    Menu.setApplicationMenu(null);
}

function sendUpdateStatus(payload) {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send("onda:update-status", payload);
    }
}

function setupAutoUpdater() {
    if (!app.isPackaged) {
        return;
    }

    let updater;
    try {
        updater = require("electron-updater").autoUpdater;
    } catch (error) {
        console.warn("electron-updater indisponível:", error.message);
        return;
    }

    autoUpdaterInstance = updater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;

    updater.on("error", (error) => {
        console.error("Falha no auto-update:", error?.message || error);
        sendUpdateStatus({
            state: "error",
            message: String(error?.message || error)
        });
    });

    updater.on("checking-for-update", () => {
        console.log("Auto-update: verificando atualizações.");
        sendUpdateStatus({ state: "checking" });
    });

    updater.on("update-available", (info) => {
        console.log("Auto-update: versão disponível:", info.version);
        sendUpdateStatus({ state: "available", version: info.version });
    });

    updater.on("update-not-available", () => {
        console.log("Auto-update: já está na versão mais recente.");
        sendUpdateStatus({ state: "current", version: app.getVersion() });
    });

    updater.on("update-downloaded", (info) => {
        console.log("Auto-update: versão baixada:", info.version);
        sendUpdateStatus({ state: "downloaded", version: info.version });
    });

    const check = () => {
        updater.checkForUpdates().catch((error) => {
            console.warn("Auto-update: verificação falhou:", error?.message || error);
        });
    };

    setTimeout(check, 5000);
    setInterval(check, 6 * 60 * 60 * 1000);
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 960,
        minHeight: 640,
        frame: false,
        show: false,
        title: "Onda",
        backgroundColor: "#0c1916",
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    mainWindow.once("ready-to-show", () => {
        console.log("Janela principal pronta; exibindo.");
        mainWindow.show();
    });

    mainWindow.on("maximize", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("onda:window:maximized", true);
        }
    });

    mainWindow.on("unmaximize", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("onda:window:maximized", false);
        }
    });

    const showFallback = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
            console.warn("ready-to-show não disparou em 10 s; exibindo a janela mesmo assim.");
            mainWindow.show();
        }
    }, 10000);

    mainWindow.webContents.on("did-finish-load", () => {
        clearTimeout(showFallback);
        console.log("Site carregado:", APP_URL);
    });

    mainWindow.webContents.on("render-process-gone", (_event, details) => {
        console.error("O processo de renderização encerrou:", details);
        try {
            dialog.showErrorBox(
                "Onda Desktop",
                `A interface do Onda encerrou inesperadamente (${details.reason}).`);
        } catch {
            // Ignore if the dialog is unavailable.
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) {
            shell.openExternal(url);
        }
        return { action: "deny" };
    });

    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (!isSameSite(url)) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    mainWindow.webContents.on("did-fail-load", async (_event, errorCode, description, _url, isMainFrame) => {
        if (!isMainFrame || errorCode === -3 || !mainWindow || mainWindow.isDestroyed()) {
            return;
        }

        const { response } = await dialog.showMessageBox(mainWindow, {
            type: "error",
            title: "Onda",
            message: "Não foi possível abrir o site do Onda.",
            detail: description || "Confira a conexão e tente novamente.",
            buttons: ["Tentar novamente", "Sair"],
            defaultId: 0,
            cancelId: 1
        });

        if (response === 0 && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadURL(APP_URL);
        } else {
            app.quit();
        }
    });

    mainWindow.on("closed", () => {
        stopAllAudioCaptures();
        stopAllThumbnailCaptures();
        stopAllVideoCaptures();
        mainWindow = null;
    });

    const sessionRef = mainWindow.webContents.session;
    sessionRef.setPermissionRequestHandler((_webContents, permission, callback) => {
        if (permission === "media" || permission === "display-capture" || permission === "fullscreen") {
            callback(true);
            return;
        }
        callback(false);
    });

    sessionRef.setDisplayMediaRequestHandler(async (_request, callback) => {
        lastCaptureSelection = null;
        try {
            const selection = await openCapturePicker();
            if (!selection || selection.error || !selection.sourceId) {
                callback(null);
                return;
            }

            const source = captureSourceObjects.get(selection.sourceId);
            if (!source) {
                callback(null);
                return;
            }

            lastCaptureSelection = selection;
            callback({ video: source });
        } catch (error) {
            console.error("Falha ao selecionar a fonte de captura:", error);
            callback(null);
        }
    });

    mainWindow.loadURL(APP_URL);
}

function loadDeepLink(rawLink) {
    const roomUrl = deepLinkToRoomUrl(rawLink);
    if (!roomUrl) {
        return;
    }

    if (!mainWindow) {
        pendingDeepLink = roomUrl;
        return;
    }

    mainWindow.loadURL(roomUrl);
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.focus();
}

if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
    app.setAsDefaultProtocolClient(PROTOCOL);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on("second-instance", (_event, argv) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
        }

        const deepLink = argv.find((argument) => argument.startsWith(`${PROTOCOL}://`));
        if (deepLink) {
            loadDeepLink(deepLink);
        }
    });

    app.whenReady().then(() => {
        console.log(`Onda Desktop ${app.getVersion()} · Electron ${process.versions.electron}`);
        console.log("Abrindo site:", APP_URL);
        registerIpc();
        createMenu();
        createMainWindow();
        setupAutoUpdater();

        if (pendingDeepLink) {
            const target = pendingDeepLink;
            pendingDeepLink = null;
            loadDeepLink(target);
        }

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createMainWindow();
            }
        });
    });
}

app.on("before-quit", () => {
    stopAllAudioCaptures();
    stopAllThumbnailCaptures();
    stopAllVideoCaptures();
    console.log("Encerrando o Onda Desktop.");
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
