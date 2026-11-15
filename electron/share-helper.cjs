const path = require("node:path");

function loadNativeShare() {
    try {
        return require("electron-native-share");
    } catch {
        // No app empacotado o helper fica fora do app.asar; o módulo nativo
        // permanece em app.asar.unpacked.
    }

    try {
        return require(path.join(
            process.resourcesPath,
            "app.asar.unpacked",
            "node_modules",
            "electron-native-share"
        ));
    } catch {
        return null;
    }
}

const nativeShare = loadNativeShare();

function loadNativeAddon() {
    const base = path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        "electron-native-share"
    );
    const candidates = [
        path.join(base, "prebuilds", "win32-x64", "electron-native-share.node"),
        path.join(base, "build", "Release", "native_share.node")
    ];

    for (const candidate of candidates) {
        try {
            return require(candidate);
        } catch {
            // Tenta o próximo formato de build.
        }
    }

    return null;
}

const nativeAddon = nativeShare ? null : loadNativeAddon();

const isUtilityProcess = Boolean(process.parentPort);
const reply = (message) => {
    if (isUtilityProcess) {
        process.parentPort.postMessage(message);
    } else if (typeof process.send === "function") {
        process.send(message);
    }
};

const onMessage = (callback) => {
    if (isUtilityProcess) {
        process.parentPort.on("message", (event) => callback(event?.data ?? event));
    } else {
        process.on("message", callback);
    }
};

onMessage(async (message) => {
    if (!message || typeof message !== "object") {
        return;
    }

    if (message.probe) {
        reply({
            id: message.id,
            ok: Boolean(nativeShare?.canShare?.() || nativeAddon?.canShare?.()),
            probe: true
        });
        return;
    }

    if (!nativeShare?.canShare?.() && !nativeAddon?.canShare?.()) {
        reply({
            id: message.id,
            ok: false,
            reason: "unsupported"
        });
        return;
    }

    try {
        const handle = Buffer.from(String(message.windowHandle || ""), "base64");
        let result;
        if (nativeShare) {
            result = await nativeShare.share({
                title: String(message.title || "Onda"),
                text: String(message.text || ""),
                url: String(message.url || "")
            }, {
                getNativeWindowHandle: () => handle
            });
        } else {
            await nativeAddon.share({
                title: String(message.title || "Onda"),
                text: String(message.text || ""),
                url: String(message.url || ""),
                windowHandle: handle
            });
            result = { method: "native" };
        }

        reply({
            id: message.id,
            ok: result?.method === "native",
            cancelled: result?.method === "cancelled"
        });
    } catch (error) {
        const messageText = String(error?.message || error);
        reply({
            id: message.id,
            ok: false,
            cancelled: /cancelled/i.test(messageText),
            reason: "failed",
            error: messageText
        });
    }
});
