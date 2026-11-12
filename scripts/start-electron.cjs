"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

let electronPath;
try {
    electronPath = require("electron");
} catch (error) {
    console.error("Electron não encontrado. Execute `npm install` na pasta desktop.");
    console.error(error.message);
    process.exit(1);
}

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const requestedArgs = process.argv.slice(2);
const local = requestedArgs.includes("--local");
const forwardedArgs = requestedArgs.filter((argument) => argument !== "--local");
const appRoot = path.join(__dirname, "..");

if (local) {
    environment.ONDA_URL = environment.ONDA_URL || "http://127.0.0.1:5062";
}

// O Chromium precisa receber --no-sandbox antes de iniciar o processo de GPU.
// Em vários Windows o sandbox falha com SBOX_ERROR_CREATE_PROCESS (código 18)
// quando o app roda de uma pasta de usuário. Em uma instalação normal
// (LocalAppData/Programs ou Program Files), o sandbox funciona e é necessário
// para o WGC do Chromium funcionar com desempenho total.
const explicitSandbox = environment.ONDA_ALLOW_SANDBOX === "1";
const sandboxDisabled = environment.ONDA_ALLOW_SANDBOX === "0" ||
    environment.ONDA_NO_SANDBOX === "1";
const installedPath = /[\\/](?:AppData[\\/]Local[\\/]Programs|Program Files(?: \(x86\))?)[\\/]/i.test(appRoot);
const allowSandbox = explicitSandbox || (!sandboxDisabled && installedPath);
const sandboxArgs = allowSandbox ? [] : ["--no-sandbox"];
if (allowSandbox) {
    console.warn(explicitSandbox
        ? "ONDA_ALLOW_SANDBOX=1: tentando iniciar com o sandbox normal do Chromium."
        : "Modo instalado: iniciando com o sandbox normal do Chromium (WGC habilitado).");
    if (explicitSandbox) {
        console.warn("Se nada abrir, defina ONDA_ALLOW_SANDBOX=0 para usar o modo de compatibilidade.");
    }
} else {
    console.warn("Iniciando com --no-sandbox para compatibilidade com o sandbox do Windows.");
}
const args = [".", ...sandboxArgs, ...forwardedArgs];
const child = spawn(electronPath, args, {
    cwd: appRoot,
    env: environment,
    stdio: "inherit",
    windowsHide: false
});

child.on("error", (error) => {
    console.error("Não foi possível iniciar o Electron:", error.message);
    process.exit(1);
});

child.on("exit", (code, signal) => {
    if (signal) {
        console.error(`Electron encerrado pelo sinal ${signal}.`);
        process.exit(1);
    }

    if (code !== 0) {
        console.error(`Electron encerrou com código ${code}.`);
        if (allowSandbox) {
            console.error("O modo com sandbox normal falhou. Defina ONDA_ALLOW_SANDBOX=0 e abra novamente.");
        }
    }

    process.exit(code ?? 1);
});
