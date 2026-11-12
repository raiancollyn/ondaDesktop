(() => {
    "use strict";

    const state = {
        data: null,
        selectedSourceId: null,
        activeKind: "screen",
        audioMode: "none"
    };

    const elements = {
        grid: document.getElementById("source-grid"),
        sourceHelp: document.getElementById("source-help"),
        tabs: Array.from(document.querySelectorAll("[data-kind]")),
        audioOptions: document.getElementById("audio-options"),
        audioBadge: document.getElementById("audio-badge"),
        audioNote: document.getElementById("audio-note"),
        error: document.getElementById("picker-error"),
        loading: document.getElementById("picker-loading"),
        summary: document.getElementById("selection-summary"),
        confirm: document.getElementById("confirm-button"),
        cancel: document.getElementById("cancel-button"),
        cancelTop: document.getElementById("cancel-top")
    };

    function selectedSource() {
        return state.data?.sources?.find((source) => source.id === state.selectedSourceId) || null;
    }

    function effectiveKind() {
        return selectedSource()?.kind || state.activeKind;
    }

    function isScreen() {
        return effectiveKind() === "screen";
    }

    function canConfirm() {
        if (!state.selectedSourceId) {
            return false;
        }

        return isScreen()
            ? state.audioMode !== "window"
            : state.audioMode === "none" || state.audioMode === "window";
    }

    function audioDescription() {
        if (isScreen()) {
            return state.audioMode === "system" ? "som do sistema" : "sem áudio";
        }

        return state.audioMode === "window" ? "som desta janela" : "sem áudio";
    }

    function updateSummary() {
        const source = selectedSource();
        elements.summary.textContent = source
            ? `${source.kind === "screen" ? "Tela" : "Janela"}: ${source.name} · ${audioDescription()}`
            : "Selecione uma fonte para continuar.";
        elements.confirm.disabled = !canConfirm();
        elements.audioBadge.textContent = state.audioMode === "none" ? "Opcional" : "Selecionado";
    }

    function renderSources() {
        elements.grid.replaceChildren();
        const sources = (state.data?.sources || []).filter((source) => source.kind === state.activeKind);
        elements.tabs.forEach((tab) => {
            tab.setAttribute("aria-selected", tab.dataset.kind === state.activeKind ? "true" : "false");
        });

        if (sources.length === 0) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = state.data
                ? (state.activeKind === "screen"
                    ? "Nenhuma tela disponível para captura."
                    : "Nenhuma janela disponível. Minimize ou abra a janela que deseja compartilhar.")
                : "Carregando fontes…";
            elements.grid.appendChild(empty);
            return;
        }

        for (const source of sources) {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "source-card";
            card.dataset.sourceId = source.id;
            card.setAttribute("aria-pressed", source.id === state.selectedSourceId ? "true" : "false");
            if (source.id === state.selectedSourceId) {
                card.classList.add("is-selected");
            }

            const thumb = document.createElement("span");
            thumb.className = "source-thumb";
            if (source.thumbnail) {
                const image = document.createElement("img");
                image.src = source.thumbnail;
                image.alt = "";
                thumb.appendChild(image);
            } else {
                thumb.textContent = source.kind === "screen" ? "Tela" : "Janela";
            }

            const copy = document.createElement("span");
            copy.className = "source-copy";
            if (source.appIcon) {
                const icon = document.createElement("img");
                icon.src = source.appIcon;
                icon.alt = "";
                copy.appendChild(icon);
            }
            const name = document.createElement("span");
            name.textContent = source.name;
            copy.appendChild(name);

            card.append(thumb, copy);
            card.addEventListener("click", () => selectSource(source));
            card.addEventListener("dblclick", () => {
                if (canConfirm()) {
                    confirmSelection();
                }
            });
            elements.grid.appendChild(card);
        }
    }

    function selectSource(source) {
        const previousKind = effectiveKind();
        if (source.kind !== previousKind) {
            state.audioMode = "none";
        }
        state.selectedSourceId = source.id;
        state.activeKind = source.kind;
        if (source.kind === "window" && state.audioMode === "system") {
            state.audioMode = "none";
        }
        if (source.kind === "screen" && state.audioMode === "window") {
            state.audioMode = "none";
        }
        renderSources();
        renderAudioOptions();
        updateAudioUi();
    }

    function renderAudioOptions() {
        elements.audioOptions.replaceChildren();
        const options = isScreen()
            ? [
                { value: "none", title: "Sem áudio", help: "Compartilha apenas o vídeo; o microfone continua separado." },
                { value: "system", title: "Som do sistema", help: "Captura todos os aplicativos, exceto o próprio Onda Desktop." }
            ]
            : [
                { value: "none", title: "Sem áudio", help: "Compartilha apenas a janela, sem o som dela." },
                { value: "window", title: "Som desta janela", help: "Captura o áudio do processo dono da janela escolhida." }
            ];

        for (const option of options) {
            const label = document.createElement("label");
            label.className = "audio-option";
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "audio-mode";
            input.value = option.value;
            input.checked = state.audioMode === option.value;
            input.addEventListener("change", () => {
                if (input.checked) {
                    state.audioMode = option.value;
                    clearError();
                    updateAudioUi();
                }
            });

            const copy = document.createElement("span");
            const title = document.createElement("strong");
            title.textContent = option.title;
            const help = document.createElement("small");
            help.textContent = option.help;
            copy.append(title, help);
            label.append(input, copy);
            elements.audioOptions.appendChild(label);
        }
    }

    function updateAudioUi() {
        const systemAudio = isScreen() && state.audioMode === "system";
        const windowAudio = !isScreen() && state.audioMode === "window";
        elements.audioNote.hidden = !(systemAudio || windowAudio);
        if (systemAudio) {
            elements.audioNote.textContent = "O Onda Desktop é excluído automaticamente do som do sistema para evitar que a voz dos participantes volte pelo compartilhamento.";
        } else if (windowAudio) {
            elements.audioNote.textContent = "Será capturado o áudio do processo dono da janela. Em navegadores, isso pode incluir outras janelas do mesmo processo.";
        }

        updateSummary();
    }

    function clearError() {
        elements.error.hidden = true;
        elements.error.textContent = "";
    }

    function showError(message) {
        elements.error.hidden = false;
        elements.error.textContent = message;
    }

    async function confirmSelection() {
        if (!canConfirm()) {
            return;
        }

        clearError();
        const source = selectedSource();
        let audioMode = "none";
        if (source.kind === "screen" && state.audioMode === "system") {
            audioMode = "system";
        } else if (source.kind === "window" && state.audioMode === "window") {
            audioMode = "window";
        }

        elements.confirm.disabled = true;
        elements.confirm.textContent = "Abrindo…";
        try {
            const accepted = await window.ondaPicker.confirm({
                sourceId: source.id,
                sourceName: source.name,
                sourceKind: source.kind,
                audioMode
            });
            if (!accepted) {
                showError("O Onda não aceitou a seleção. Verifique a fonte escolhida e tente novamente.");
            }
        } catch (error) {
            showError(error?.message || "Não foi possível confirmar a captura.");
        } finally {
            elements.confirm.disabled = !canConfirm();
            elements.confirm.textContent = "Compartilhar →";
        }
    }

    async function cancel() {
        try {
            await window.ondaPicker.cancel();
        } catch {
            window.close();
        }
    }

    function applyData(data) {
        state.data = data;
        elements.loading.hidden = true;
        const sources = data?.sources || [];
        const screenCount = sources.filter((source) => source.kind === "screen").length;
        const windowCount = sources.filter((source) => source.kind === "window").length;
        elements.sourceHelp.textContent = `${screenCount} tela(s) e ${windowCount} janela(s) encontradas.`;

        if (state.selectedSourceId && !sources.some((source) => source.id === state.selectedSourceId)) {
            state.selectedSourceId = null;
        }

        renderSources();
        renderAudioOptions();
        updateAudioUi();
        updateSummary();
    }

    function bind() {
        elements.tabs.forEach((tab) => {
            tab.addEventListener("click", () => {
                if (state.activeKind === tab.dataset.kind) {
                    return;
                }
                state.activeKind = tab.dataset.kind;
                state.selectedSourceId = null;
                state.audioMode = "none";
                clearError();
                renderSources();
                renderAudioOptions();
                updateAudioUi();
            });
        });

        elements.confirm.addEventListener("click", confirmSelection);
        elements.cancel.addEventListener("click", cancel);
        elements.cancelTop.addEventListener("click", cancel);
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                cancel();
            }
        });
    }

    async function init() {
        bind();
        if (!window.ondaPicker) {
            showError("A bridge do seletor não está disponível.");
            elements.sourceHelp.textContent = "Não foi possível carregar o seletor.";
            elements.loading.hidden = true;
            return;
        }

        let applied = false;
        const apply = (data) => {
            if (applied || !data) {
                return;
            }
            applied = true;
            applyData(data);
        };

        const off = window.ondaPicker.onData((data) => {
            apply(data);
            off();
        });

        try {
            const data = await window.ondaPicker.getData();
            apply(data);
        } catch (error) {
            elements.sourceHelp.textContent = "Não foi possível carregar as fontes.";
            elements.loading.hidden = true;
            showError(error?.message || "Falha ao abrir o seletor.");
        }
    }

    init();
})();
