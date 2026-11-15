(() => {
    const frame = document.getElementById("pip-frame");
    const close = document.getElementById("pip-close");
    const api = window.ondaPip;

    if (api?.onFrame) {
        api.onFrame((dataUrl) => {
            if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
                frame.src = dataUrl;
            }
        });
    }

    close?.addEventListener("click", () => {
        api?.close?.();
    });

    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            api?.close?.();
        }
    });
})();
