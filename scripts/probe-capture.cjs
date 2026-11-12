const { app, desktopCapturer } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

app.commandLine.appendSwitch("no-sandbox");

app.whenReady().then(async () => {
    try {
        const sources = await desktopCapturer.getSources({
            types: ["screen", "window"],
            thumbnailSize: { width: 1280, height: 720 },
            fetchWindowIcons: false
        });
        const directory = path.join(__dirname, "..", ".scratch", "capture-probe");
        fs.mkdirSync(directory, { recursive: true });

        const results = [];
        for (const source of sources) {
            const thumbnail = source.thumbnail;
            const size = thumbnail.getSize();
            const empty = thumbnail.isEmpty();
            let file = null;
            if (!empty) {
                file = path.join(directory, `${source.id.replace(/[^a-z0-9_-]/gi, "_")}.png`);
                fs.writeFileSync(file, thumbnail.toPNG());
            }
            results.push({ id: source.id, name: source.name, size, empty, file });
        }

        console.log(JSON.stringify(results, null, 2));
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    } finally {
        app.exit();
    }
});
