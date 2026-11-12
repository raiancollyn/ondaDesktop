(() => {
    "use strict";

    const state = {
        data: null,
        selectedSourceId: null,
        activeKind: "screen",
        audioMode: "none",
        excludeEnabled: false,
        processId: null,
        processFilter: "",
        showAllProcesses: false
    };

    const elements = {
        grid: document.getElementById("source-grid"),
        sourceHelp: document.getElementById("source-help"),
        tabs: Array.from(document.querySelectorAll("[data-kind]")),
        audioOptions: document.getElementById("audio-options"),
        audioBadge: document.getElementById("audio-badge"),
        audioNote: document.getElementById("audio-note"),
        screenAudioExtra: document.getElementById("screen-audio-extra"),
        excludeToggle: document.getElementById("exclude-toggle"),
        processPicker: document.getElementById("process-picker"),
        processSearch: document.getElementById("process-search"),
        processSelect: document.getElementById("process-select"),
        processHelp: document.getElementById("process-help"),
        processError: document.getElementById("process-error"),
        loadMore: document.getElementById("load-more"),
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

    function selectedProcess() {
        return state.data?.processes?.find((process) => Number(process.pid) === Number(state.processId)) || null;
    }

    function canConfirm() {
        if (!state.selectedSourceId) {
            return false;
        }

        if (isScreen()) {
            if (state.audioMode !== "system") {
                return true;
            }
            return !state.excludeEnabled || Boolean(selectedProcess());
        }

        return state.audioMode === "none" || state.audioMode === "window";
    }

    function audioDescription() {
        const process = selectedProcess();
        if (isScreen()) {
            if (state.audioMode !== "system") {
                return "sem áudio";
            }
            return state.excludeEnabled
                ? `som do sistema, exceto ${process?.name || "aplicativo"}`
                : "som do sistema";
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
            state.excludeEnabled = false;
            state.processId = null;
        }
        state.selectedSourceId = source.id;
        state.activeKind = source.kind;
        if (state.audioMode !== "none" && state.audioMode !== "window" && !isScreen()) {
            state.audioMode = "none";
        }
        if (source.kind === "screen" && state.audioMode === "window") {
            state.audioMode = "none";
        }
        state.processId = source.kind === "window" ? null : state.processId;
        renderSources();
        renderAudioOptions();
        updateAudioUi();
    }

    function renderAudioOptions() {
        elements.audioOptions.replaceChildren();
        const options = isScreen()
            ? [
                { value: "none", title: "Sem áudio", help: "Compartilha apenas o vídeo; o microfone continua separado." },
                { value: "system", title: "Som do sistema", help: "Captura o áudio de todos os aplicativos." }
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

    function getBaseProcesses() {
        const processes = state.data?.processes || [];
        if (state.showAllProcesses) {
            return processes;
        }
        return processes.filter((process) => process.audioState || process.foreground || process.hasWindow);
    }

    function getFilteredProcesses() {
        const filter = state.processFilter.toLocaleLowerCase("pt-BR");
        return getBaseProcesses()
            .filter((process) => {
                if (!filter) {
                    return true;
                }
                return `${process.name} ${process.title}`.toLocaleLowerCase("pt-BR").includes(filter);
            })
            .sort((left, right) => {
                const score = (process) => (process.audioState ? 4 : 0) + (process.foreground ? 2 : 0) + (process.hasWindow ? 1 : 0);
                return score(right) - score(left) ||
                    String(left.name).localeCompare(String(right.name), "pt-BR");
            });
    }

    function renderProcesses() {
        const processes = getFilteredProcesses();
        elements.processSelect.replaceChildren();

        if (processes.length === 0) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = state.data?.processError || "Nenhum aplicativo encontrado.";
            elements.processSelect.appendChild(option);
            state.processId = null;
        } else {
            for (const process of processes) {
                const option = document.createElement("option");
                option.value = String(process.pid);
                const tags = [
                    process.audioState ? "áudio ativo" : null,
                    process.foreground ? "em primeiro plano" : null,
                    process.title || null
                ].filter(Boolean);
                option.textContent = `${process.name}${tags.length ? ` · ${tags.join(" · ")}` : ""} · PID ${process.pid}`;
                option.selected = Number(process.pid) === Number(state.processId);
                elements.processSelect.appendChild(option);
            }

            if (!processes.some((process) => Number(process.pid) === Number(state.processId))) {
                state.processId = Number(processes[0].pid);
                elements.processSelect.value = String(state.processId);
            }
        }

        const available = getBaseProcesses();
        elements.loadMore.hidden = state.showAllProcesses || available.length >= (state.data?.processes?.length || 0);
        elements.processHelp.textContent = state.showAllProcesses
            ? "Todos os processos disponíveis."
            : "Mostrando aplicativos com áudio, em primeiro plano ou com janela aberta.";
        updateSummary();
    }

    function updateAudioUi() {
        const screenSystem = isScreen() && state.audioMode === "system";
        elements.screenAudioExtra.hidden = !screenSystem;
        elements.excludeToggle.checked = state.excludeEnabled;
        elements.processPicker.hidden = !screenSystem || !state.excludeEnabled;

        const windowAudio = !isScreen() && state.audioMode === "window";
        elements.audioNote.hidden = !(screenSystem || windowAudio);
        if (screenSystem) {
            elements.audioNote.textContent = "O som do sistema inclui todos os aplicativos. Se quiser, exclua um programa que não deve ser compartilhado.";
        } else if (windowAudio) {
            elements.audioNote.textContent = "Será capturado o áudio do processo dono da janela. Em navegadores, isso pode incluir outras janelas do mesmo processo.";
        }

        elements.processError.hidden = !state.data?.processError;
        if (state.data?.processError) {
            elements.processError.textContent = `Não foi possível listar os aplicativos: ${state.data.processError}`;
        }

        if (screenSystem && state.excludeEnabled) {
            renderProcesses();
        } else {
            updateSummary();
        }
    }

    function showError(message) {
        elements.processError.hidden = false;
        elements.processError.textContent = message;
    }

    async function confirmSelection() {
        if (!canConfirm()) {
            return;
        }

        const source = selectedSource();
        const process = selectedProcess();
        let audioMode = "none";
        if (source.kind === "screen" && state.audioMode === "system") {
            audioMode = state.excludeEnabled && process ? "exclude" : "system";
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
                audioMode,
                processId: audioMode === "exclude" && process ? Number(process.pid) : null,
                processName: audioMode === "exclude" ? process?.name || null : null
            });
            if (!accepted) {
                showError("O Onda não aceitou a seleção. Verifique o aplicativo escolhido e tente novamente.");
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

        if (data?.processError) {
            showError(`Não foi possível listar os aplicativos: ${data.processError}`);
        }

        if (state.selectedSourceId && !sources.some((source) => source.id === state.selectedSourceId)) {
            state.selectedSourceId = null;
        }
        if (!state.selectedSourceId && sources.some((source) => source.kind === state.activeKind)) {
            // Keep the explicit selection: the user should choose a source.
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
                state.excludeEnabled = false;
                state.processId = null;
                state.processFilter = "";
                elements.processSearch.value = "";
                renderSources();
                renderAudioOptions();
                updateAudioUi();
            });
        });

        elements.excludeToggle.addEventListener("change", () => {
            state.excludeEnabled = elements.excludeToggle.checked;
            if (state.excludeEnabled && !state.processId) {
                state.processId = getFilteredProcesses()[0]?.pid || null;
            }
            updateAudioUi();
        });

        elements.processSelect.addEventListener("change", () => {
            state.processId = Number(elements.processSelect.value) || null;
            updateSummary();
        });
        elements.processSearch.addEventListener("input", () => {
            state.processFilter = elements.processSearch.value;
            renderProcesses();
        });
        elements.loadMore.addEventListener("click", () => {
            state.showAllProcesses = true;
            renderProcesses();
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
