"use strict";

// Desktop chrome injected into the main window. It uses the same theme
// variables as the Onda site and keeps all visible controls in Portuguese.
module.exports = function installDesktopUi(ipcRenderer) {
    const TITLEBAR_ID = "onda-desktop-chrome";
    let manualUpdateCheck = false;
    let activeDialog = null;

    const styles = `
        html.onda-desktop-shell {
            --onda-titlebar-height: 38px;
        }

        html.onda-desktop-shell body {
            padding-top: var(--onda-titlebar-height) !important;
            box-sizing: border-box;
        }

        html.onda-desktop-shell .room-app {
            height: calc(100vh - var(--onda-titlebar-height)) !important;
            min-height: 0 !important;
        }

        html.onda-desktop-shell .gate-page,
        html.onda-desktop-shell .room-fallback-page {
            min-height: calc(100vh - var(--onda-titlebar-height)) !important;
        }

        html.onda-desktop-shell .boot-screen {
            top: var(--onda-titlebar-height) !important;
            height: calc(100vh - var(--onda-titlebar-height)) !important;
        }

        #onda-desktop-chrome {
            position: fixed;
            inset: 0 0 auto 0;
            z-index: 2147483000;
            display: flex;
            align-items: center;
            gap: 0.55rem;
            height: var(--onda-titlebar-height);
            padding: 0 0 0 0.45rem;
            background: #f7f3eb;
            color: #14231f;
            border-bottom: 1px solid rgba(20, 35, 31, 0.12);
            box-shadow: 0 1px 0 rgba(255, 255, 255, 0.35) inset;
            font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
            -webkit-app-region: drag;
            user-select: none;
        }

        html[data-theme="dark"] #onda-desktop-chrome {
            background: #0c1916;
            color: #f7f3eb;
            border-bottom-color: rgba(247, 243, 235, 0.11);
            box-shadow: 0 1px 0 rgba(255, 255, 255, 0.025) inset;
        }

        #onda-desktop-chrome button {
            -webkit-app-region: no-drag;
            border: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            cursor: pointer;
        }

        .onda-chrome-menu-button {
            display: grid;
            place-items: center;
            width: 28px;
            height: 28px;
            border-radius: 8px;
            padding: 0 !important;
        }

        .onda-chrome-menu-button:hover {
            background: rgba(20, 35, 31, 0.08);
        }

        html[data-theme="dark"] .onda-chrome-menu-button:hover {
            background: rgba(247, 243, 235, 0.09);
        }

        .onda-chrome-menu-lines {
            display: grid;
            gap: 4px;
            width: 14px;
        }

        .onda-chrome-menu-lines i {
            display: block;
            height: 1.5px;
            border-radius: 2px;
            background: currentColor;
        }

        .onda-chrome-brand {
            display: flex;
            align-items: center;
            gap: 0.45rem;
            min-width: 0;
        }

        .onda-chrome-brand img {
            width: 20px;
            height: 20px;
            pointer-events: none;
        }

        .onda-chrome-brand strong {
            font-size: 0.72rem;
            font-weight: 720;
            letter-spacing: -0.02em;
            white-space: nowrap;
        }

        .onda-chrome-brand span {
            color: inherit;
            opacity: 0.45;
            font-size: 0.62rem;
            font-weight: 560;
            white-space: nowrap;
        }

        .onda-chrome-spacer {
            flex: 1;
            min-width: 1rem;
        }

        .onda-chrome-window-actions {
            display: flex;
            align-self: stretch;
            -webkit-app-region: no-drag;
        }

        .onda-chrome-window-actions button {
            display: grid;
            place-items: center;
            width: 44px;
            height: 100%;
            padding: 0 !important;
            border-radius: 0;
        }

        .onda-chrome-window-actions button:hover {
            background: rgba(20, 35, 31, 0.08);
        }

        html[data-theme="dark"] .onda-chrome-window-actions button:hover {
            background: rgba(247, 243, 235, 0.09);
        }

        .onda-chrome-window-actions button[data-window="close"]:hover {
            background: #c42b1c;
            color: white;
        }

        .onda-chrome-window-actions svg {
            width: 12px;
            height: 12px;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.3;
        }

        .onda-chrome-max-icon,
        .onda-chrome-restore-icon {
            display: none;
        }

        #onda-desktop-chrome[data-maximized="false"] .onda-chrome-max-icon {
            display: block;
        }

        #onda-desktop-chrome[data-maximized="true"] .onda-chrome-restore-icon {
            display: block;
        }

        .onda-chrome-menu {
            position: fixed;
            top: calc(var(--onda-titlebar-height) + 6px);
            left: 8px;
            z-index: 2147483002;
            width: 242px;
            padding: 0.35rem;
            border: 1px solid rgba(20, 35, 31, 0.13);
            border-radius: 0.9rem;
            background: #fffdf8;
            color: #14231f;
            box-shadow: 0 1rem 2.5rem rgba(20, 35, 31, 0.18);
            font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
            -webkit-app-region: no-drag;
        }

        html[data-theme="dark"] .onda-chrome-menu {
            border-color: rgba(247, 243, 235, 0.13);
            background: #10231d;
            color: #f7f3eb;
            box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.4);
        }

        .onda-chrome-menu[hidden] {
            display: none;
        }

        .onda-chrome-menu-item {
            display: flex;
            align-items: center;
            gap: 0.55rem;
            width: 100%;
            padding: 0.52rem 0.6rem !important;
            border: 0 !important;
            border-radius: 0.6rem;
            background: transparent !important;
            box-shadow: none !important;
            text-align: left;
            font-size: 0.7rem !important;
            font-weight: 560;
        }

        .onda-chrome-menu-item:hover {
            background: rgba(205, 242, 124, 0.55) !important;
            color: #14231f;
        }

        html[data-theme="dark"] .onda-chrome-menu-item:hover {
            background: rgba(205, 242, 124, 0.16) !important;
            color: #cdf27c;
        }

        .onda-chrome-menu-item svg {
            width: 15px;
            height: 15px;
            flex: 0 0 auto;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.5;
        }

        .onda-chrome-menu-separator {
            height: 1px;
            margin: 0.3rem 0.45rem;
            background: currentColor;
            opacity: 0.1;
        }

        .onda-chrome-dialog-backdrop {
            position: fixed;
            inset: 0;
            z-index: 2147483003;
            display: grid;
            place-items: center;
            padding: 1.2rem;
            background: rgba(4, 14, 10, 0.54);
            backdrop-filter: blur(7px);
            -webkit-app-region: no-drag;
            font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
        }

        .onda-chrome-dialog {
            width: min(100%, 420px);
            padding: 1.25rem;
            border: 1px solid rgba(20, 35, 31, 0.13);
            border-radius: 1.2rem;
            background: #fffdf8;
            color: #14231f;
            box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, 0.28);
        }

        html[data-theme="dark"] .onda-chrome-dialog {
            border-color: rgba(247, 243, 235, 0.14);
            background: #0d1e18;
            color: #f7f3eb;
        }

        .onda-chrome-dialog-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
        }

        .onda-chrome-dialog-icon {
            display: grid;
            place-items: center;
            width: 2.6rem;
            height: 2.6rem;
            border-radius: 0.8rem;
            background: rgba(205, 242, 124, 0.45);
            color: #14231f;
        }

        html[data-theme="dark"] .onda-chrome-dialog-icon {
            background: rgba(205, 242, 124, 0.14);
            color: #cdf27c;
        }

        .onda-chrome-dialog-icon svg {
            width: 1.25rem;
            height: 1.25rem;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.6;
        }

        .onda-chrome-dialog-close {
            display: grid;
            place-items: center;
            width: 1.9rem;
            height: 1.9rem;
            border-radius: 50%;
            color: inherit;
            opacity: 0.6;
        }

        .onda-chrome-dialog-close:hover {
            opacity: 1;
            background: rgba(20, 35, 31, 0.07);
        }

        html[data-theme="dark"] .onda-chrome-dialog-close:hover {
            background: rgba(247, 243, 235, 0.08);
        }

        .onda-chrome-dialog-eyebrow {
            margin: 1rem 0 0.25rem;
            color: #6f7b74;
            font-size: 0.58rem;
            font-weight: 800;
            letter-spacing: 0.14em;
            text-transform: uppercase;
        }

        html[data-theme="dark"] .onda-chrome-dialog-eyebrow {
            color: rgba(247, 243, 235, 0.55);
        }

        .onda-chrome-dialog h2 {
            margin: 0;
            font-size: 1.15rem;
            line-height: 1.15;
            letter-spacing: -0.03em;
        }

        .onda-chrome-dialog-message {
            margin: 0.65rem 0 0;
            font-size: 0.76rem;
            line-height: 1.55;
        }

        .onda-chrome-dialog-detail {
            margin: 0.4rem 0 0;
            color: #6f7b74;
            font-size: 0.68rem;
            line-height: 1.5;
            white-space: pre-line;
        }

        html[data-theme="dark"] .onda-chrome-dialog-detail {
            color: rgba(247, 243, 235, 0.56);
        }

        .onda-chrome-dialog-actions {
            display: flex;
            justify-content: flex-end;
            gap: 0.5rem;
            margin-top: 1.1rem;
        }

        .onda-chrome-dialog-actions button {
            min-height: 2rem;
            padding: 0.45rem 0.85rem;
            border: 1px solid rgba(20, 35, 31, 0.13);
            border-radius: 999px;
            background: transparent;
            color: inherit;
            font: inherit;
            font-size: 0.68rem;
            font-weight: 650;
            cursor: pointer;
        }

        .onda-chrome-dialog-actions button:hover {
            background: rgba(20, 35, 31, 0.06);
        }

        .onda-chrome-dialog-actions button.is-primary {
            border-color: #cdf27c;
            background: #cdf27c;
            color: #14231f;
        }

        .onda-chrome-dialog-actions button.is-primary:hover {
            background: #bde968;
        }

        .onda-chrome-spinner {
            width: 1.4rem;
            height: 1.4rem;
            margin: 0.9rem 0 0.2rem;
            border: 2px solid rgba(20, 35, 31, 0.15);
            border-top-color: #14231f;
            border-radius: 50%;
            animation: onda-chrome-spin 0.7s linear infinite;
        }

        html[data-theme="dark"] .onda-chrome-spinner {
            border-color: rgba(247, 243, 235, 0.18);
            border-top-color: #cdf27c;
        }

        @keyframes onda-chrome-spin {
            to { transform: rotate(360deg); }
        }
    `;

    function init() {
        if (document.getElementById(TITLEBAR_ID)) {
            return;
        }

        document.documentElement.classList.add("onda-desktop-shell");
        injectStyles();
        createTitlebar();
        createMenu();
        listenForUpdates();
        refreshWindowState();
    }

    function injectStyles() {
        const style = document.createElement("style");
        style.id = "onda-desktop-chrome-style";
        style.textContent = styles;
        (document.head || document.documentElement).appendChild(style);
    }

    function createTitlebar() {
        const titlebar = document.createElement("div");
        titlebar.id = TITLEBAR_ID;
        titlebar.dataset.maximized = "false";
        titlebar.innerHTML = `
            <button type="button" class="onda-chrome-menu-button" aria-label="Abrir menu" aria-expanded="false" title="Menu">
                <span class="onda-chrome-menu-lines"><i></i><i></i><i></i></span>
            </button>
            <div class="onda-chrome-brand">
                <img src="/favicon.svg" alt="" draggable="false" />
                <strong>Onda</strong>
                <span>Desktop</span>
            </div>
            <div class="onda-chrome-spacer"></div>
            <div class="onda-chrome-window-actions">
                <button type="button" data-window="minimize" aria-label="Minimizar" title="Minimizar">
                    <svg viewBox="0 0 16 16"><path d="M3 8h10"/></svg>
                </button>
                <button type="button" data-window="maximize" aria-label="Maximizar" title="Maximizar">
                    <svg class="onda-chrome-max-icon" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1"/></svg>
                    <svg class="onda-chrome-restore-icon" viewBox="0 0 16 16"><rect x="3" y="5" width="8" height="8" rx="1"/><path d="M5.5 5V3.5h7v7H11"/></svg>
                </button>
                <button type="button" data-window="close" aria-label="Fechar" title="Fechar">
                    <svg viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8"/></svg>
                </button>
            </div>
        `;
        document.body.prepend(titlebar);

        titlebar.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const windowButton = target.closest("[data-window]");
            if (windowButton) {
                const action = windowButton.getAttribute("data-window");
                if (action === "minimize") {
                    ipcRenderer.send("onda:window:minimize");
                } else if (action === "maximize") {
                    ipcRenderer.send("onda:window:toggle-maximize");
                } else if (action === "close") {
                    ipcRenderer.send("onda:window:close");
                }
                return;
            }

            const menuButton = target.closest(".onda-chrome-menu-button");
            if (menuButton) {
                toggleMenu();
            }
        });

        titlebar.addEventListener("dblclick", (event) => {
            const target = event.target;
            if (target instanceof Element &&
                !target.closest("button") &&
                !target.closest(".onda-chrome-menu")) {
                ipcRenderer.send("onda:window:toggle-maximize");
            }
        });
    }

    function createMenu() {
        const menu = document.createElement("div");
        menu.id = "onda-desktop-menu";
        menu.className = "onda-chrome-menu";
        menu.hidden = true;
        menu.innerHTML = `
            <button type="button" class="onda-chrome-menu-item" data-menu="home">
                <svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/></svg> Início
            </button>
            <button type="button" class="onda-chrome-menu-item" data-menu="reload">
                <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg> Recarregar
            </button>
            <button type="button" class="onda-chrome-menu-item" data-menu="updates">
                <svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg> Verificar atualizações
            </button>
            <button type="button" class="onda-chrome-menu-item" data-menu="about">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7h.01"/></svg> Sobre o Onda
            </button>
            <button type="button" class="onda-chrome-menu-item" data-menu="site">
                <svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg> Abrir site no navegador
            </button>
            <div class="onda-chrome-menu-separator"></div>
            <button type="button" class="onda-chrome-menu-item" data-menu="quit">
                <svg viewBox="0 0 24 24"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/></svg> Sair
            </button>
        `;
        document.body.appendChild(menu);

        menu.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const item = target.closest("[data-menu]");
            if (!item) {
                return;
            }

            const action = item.getAttribute("data-menu");
            menu.hidden = true;
            setMenuExpanded(false);

            if (action === "home") {
                ipcRenderer.send("onda:navigate-home");
            } else if (action === "reload") {
                ipcRenderer.send("onda:reload");
            } else if (action === "updates") {
                void checkForUpdatesManually();
            } else if (action === "about") {
                void showAbout();
            } else if (action === "site") {
                ipcRenderer.send("onda:open-site");
            } else if (action === "quit") {
                ipcRenderer.send("onda:quit");
            }
        });

        document.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            if (!menu.hidden &&
                !target.closest("#onda-desktop-menu") &&
                !target.closest(".onda-chrome-menu-button") &&
                !target.closest(".onda-chrome-brand")) {
                menu.hidden = true;
                setMenuExpanded(false);
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                menu.hidden = true;
                setMenuExpanded(false);
                closeDialog();
            }
        });
    }

    function toggleMenu() {
        const menu = document.getElementById("onda-desktop-menu");
        if (!menu) {
            return;
        }

        menu.hidden = !menu.hidden;
        setMenuExpanded(!menu.hidden);
    }

    function setMenuExpanded(expanded) {
        const button = document.querySelector(".onda-chrome-menu-button");
        if (button instanceof HTMLElement) {
            button.setAttribute("aria-expanded", expanded ? "true" : "false");
        }
    }

    async function checkForUpdatesManually() {
        manualUpdateCheck = true;
        openDialog({
            eyebrow: "ATUALIZAÇÕES",
            title: "Verificando atualizações",
            message: "Procurando uma nova versão do Onda Desktop...",
            spinner: true
        });

        try {
            const result = await ipcRenderer.invoke("onda:check-updates");
            if (result?.state === "not-packaged") {
                manualUpdateCheck = false;
                openInfoDialog(
                    "Atualizações",
                    "Disponível na versão instalada",
                    "Esta é uma execução de desenvolvimento. O verificador de atualizações só funciona no aplicativo instalado."
                );
            } else if (result?.state === "error") {
                manualUpdateCheck = false;
                openInfoDialog("Atualizações", "Não foi possível verificar", result.message || "Tente novamente mais tarde.");
            }
        } catch (error) {
            manualUpdateCheck = false;
            openInfoDialog("Atualizações", "Não foi possível verificar", String(error?.message || error));
        }
    }

    function listenForUpdates() {
        ipcRenderer.on("onda:update-status", (_event, payload) => {
            if (!payload || typeof payload !== "object") {
                return;
            }

            const state = payload.state;
            if (state === "downloaded") {
                manualUpdateCheck = false;
                openDialog({
                    eyebrow: "ATUALIZAÇÃO",
                    title: "Atualização pronta",
                    message: `A versão ${payload.version || ""} do Onda foi baixada.`,
                    detail: "Reinicie agora para aplicar. Se preferir, ela será aplicada ao fechar o aplicativo.",
                    icon: "download",
                    buttons: [
                        {
                            label: "Reiniciar agora",
                            primary: true,
                            action: () => ipcRenderer.invoke("onda:update:install")
                        },
                        { label: "Depois", action: closeDialog }
                    ]
                });
                return;
            }

            if (!manualUpdateCheck) {
                return;
            }

            if (state === "checking") {
                openDialog({
                    eyebrow: "ATUALIZAÇÕES",
                    title: "Verificando atualizações",
                    message: "Procurando uma nova versão do Onda Desktop...",
                    spinner: true
                });
            } else if (state === "available") {
                openDialog({
                    eyebrow: "ATUALIZAÇÃO",
                    title: "Nova versão encontrada",
                    message: `A versão ${payload.version || ""} está sendo baixada.`,
                    detail: "O download acontece em segundo plano.",
                    icon: "download",
                    spinner: true
                });
            } else if (state === "current") {
                manualUpdateCheck = false;
                openInfoDialog(
                    "ATUALIZAÇÕES",
                    "Você está atualizado",
                    `A versão ${payload.version || ""} é a mais recente disponível.`
                );
            } else if (state === "error") {
                manualUpdateCheck = false;
                openInfoDialog(
                    "ATUALIZAÇÕES",
                    "Não foi possível verificar",
                    payload.message || "Confira a conexão e tente novamente."
                );
            }
        });

        ipcRenderer.on("onda:window:maximized", (_event, maximized) => {
            const titlebar = document.getElementById(TITLEBAR_ID);
            if (titlebar) {
                titlebar.dataset.maximized = maximized ? "true" : "false";
            }
        });
    }

    async function showAbout() {
        try {
            const info = await ipcRenderer.invoke("onda:get-app-info");
            openDialog({
                eyebrow: "SOBRE",
                title: "Onda Desktop",
                message: `Versão ${info.version} · Electron ${info.electron || ""}`,
                detail: `Site: ${info.siteUrl || "https://onda.dpbr.net"}\nFeito para conversas que fluem.`,
                icon: "wave",
                buttons: [
                    {
                        label: "Abrir site",
                        action: () => ipcRenderer.send("onda:open-site")
                    },
                    { label: "Fechar", primary: true, action: closeDialog }
                ]
            });
        } catch (error) {
            openInfoDialog("Sobre", "Onda Desktop", String(error?.message || error));
        }
    }

    function openInfoDialog(eyebrow, title, message) {
        openDialog({
            eyebrow,
            title,
            message,
            buttons: [{ label: "Fechar", primary: true, action: closeDialog }]
        });
    }

    function openDialog({ eyebrow, title, message, detail = "", icon = "wave", spinner = false, buttons = [] }) {
        closeDialog();

        const backdrop = document.createElement("div");
        backdrop.className = "onda-chrome-dialog-backdrop";
        const iconMarkup = icon === "download"
            ? `<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>`
            : `<path d="M3 12h2l2-5 3.5 11 3.5-14 3 8H21"/>`;

        backdrop.innerHTML = `
            <div class="onda-chrome-dialog" role="dialog" aria-modal="true">
                <div class="onda-chrome-dialog-head">
                    <span class="onda-chrome-dialog-icon">
                        <svg viewBox="0 0 24 24">${iconMarkup}</svg>
                    </span>
                    <button type="button" class="onda-chrome-dialog-close" aria-label="Fechar" title="Fechar">
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4"><path d="m4 4 8 8M12 4l-8 8"/></svg>
                    </button>
                </div>
                <p class="onda-chrome-dialog-eyebrow"></p>
                <h2></h2>
                <p class="onda-chrome-dialog-message"></p>
                <p class="onda-chrome-dialog-detail"></p>
                <div class="onda-chrome-dialog-actions"></div>
            </div>
        `;

        backdrop.querySelector(".onda-chrome-dialog-eyebrow").textContent = eyebrow || "";
        backdrop.querySelector("h2").textContent = title || "";
        backdrop.querySelector(".onda-chrome-dialog-message").textContent = message || "";

        const detailElement = backdrop.querySelector(".onda-chrome-dialog-detail");
        if (detail) {
            detailElement.textContent = detail;
        } else {
            detailElement.remove();
        }

        if (spinner) {
            const spinnerElement = document.createElement("div");
            spinnerElement.className = "onda-chrome-spinner";
            backdrop.querySelector(".onda-chrome-dialog").appendChild(spinnerElement);
        }

        const actions = backdrop.querySelector(".onda-chrome-dialog-actions");
        for (const button of buttons) {
            const element = document.createElement("button");
            element.type = "button";
            element.textContent = button.label;
            if (button.primary) {
                element.classList.add("is-primary");
            }
            element.addEventListener("click", () => {
                if (typeof button.action === "function") {
                    button.action();
                } else {
                    closeDialog();
                }
            });
            actions.appendChild(element);
        }

        backdrop.querySelector(".onda-chrome-dialog-close").addEventListener("click", closeDialog);
        backdrop.addEventListener("click", (event) => {
            if (event.target === backdrop && !spinner) {
                closeDialog();
            }
        });

        document.body.appendChild(backdrop);
        activeDialog = backdrop;
        const focusTarget = backdrop.querySelector(".is-primary") ||
            backdrop.querySelector(".onda-chrome-dialog-close");
        if (focusTarget instanceof HTMLElement) {
            focusTarget.focus();
        }
    }

    function closeDialog() {
        if (activeDialog) {
            activeDialog.remove();
            activeDialog = null;
        }
    }

    async function refreshWindowState() {
        try {
            const maximized = await ipcRenderer.invoke("onda:window:is-maximized");
            const titlebar = document.getElementById(TITLEBAR_ID);
            if (titlebar) {
                titlebar.dataset.maximized = maximized ? "true" : "false";
            }
        } catch {
            // Keep the default state.
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
};
