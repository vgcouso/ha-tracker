// ha-tracker.js — vanilla Web Component (producción)

// Lee la versión que pusiste en module_url: "...ha-tracker.js?v=0.0.30"
const PANEL_VERSION = (() => {
    try {
        return new URL(import.meta.url).searchParams.get("v") || "";
    } catch {
        return "";
    }
})();

class HATrackerPanel extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({
            mode: "open"
        });
        this.shadowRoot.innerHTML = `
      <style>
        :host{
          display:block; height:100%;
          background:var(--primary-background-color);
          color:var(--primary-text-color);
          font-family:var(--mdc-typography-font-family,
            system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",
            "Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji");
          -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
          position:relative;
        }
        .wrap {display:flex; flex-direction:column; min-height:0; height:100vh;}
        @supports (height: 100dvh) {.wrap{ height:100dvh; }}
        .toolbar{
          height:calc(56px + env(safe-area-inset-top));
          padding-top:env(safe-area-inset-top);
          display:flex; align-items:center; gap:12px; padding:0 12px;
          background:var(--app-header-background-color, var(--primary-color));
          color:var(--app-header-text-color, #fff);
          font:inherit;
        }
        .menu-btn{
          background:transparent; border:0; color:inherit;
          width:40px; height:40px; border-radius:8px; cursor:pointer;
          display:grid; place-items:center;
        }
        .menu-btn svg{ width:24px; height:24px; display:block; }
        @media (min-width:872px){ .menu-btn{ display:none; } }
        .title{
          font:inherit; font-size:20px;
          font-weight: var(--ha-toolbar-title-weight, 400);
          flex-grow:1; text-align:left; padding-left:16px; color:inherit;
        }
        .content{ flex:1 1 auto; min-height:0; display:flex; overscroll-behavior:contain; }
        iframe{ flex:1 1 auto; min-height:0; width:100%; border:none; display:block; }

        /* opcional: estilos si deseas reaccionar al modo estrecho */
        :host(.is-narrow) .title { font-size:18px; padding-left:8px; }
      </style>

      <div class="wrap">
        <header class="toolbar" role="toolbar">
          <button type="button" class="menu-btn" aria-label="Abrir menú">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16"/>
            </svg>
          </button>
          <div class="title">HA Tracker</div>
        </header>

        <main class="content">
          <iframe id="ha-tracker-iframe" title="HA Tracker"></iframe>
        </main>
      </div>
    `;
    }

    static get observedAttributes() {
        return ["narrow"];
    }

    // Home Assistant te inyecta .hass y .narrow como props del custom element
    set hass(val) {
        this._hass = val;
        // Si cambia el contexto (p. ej. app móvil/proxy), reconstituye la URL
        if (this.isConnected)
            this._setIframeSrc();
    }
    get hass() {
        return this._hass;
    }

    // Refleja la prop .narrow en una clase/atributo para estilos opcionales
    set narrow(v) {
        const on = !!v;
        this.classList.toggle("is-narrow", on);
        this.toggleAttribute("narrow", on);
    }

    attributeChangedCallback(name, _oldV, newV) {
        if (name === "narrow") {
            const on = newV !== null && newV !== "false";
            this.classList.toggle("is-narrow", on);
        }
    }

    connectedCallback() {
        // Guarda y fuerza margen 0 del <body>, luego lo restauraremos en disconnected
        this._prevBodyMargin = document.body.style.margin;
        document.body.style.margin = "0";

        const iframe = this.shadowRoot.getElementById("ha-tracker-iframe");
        if (iframe) {
            // Endurece el iframe (seguridad)
            iframe.setAttribute(
                "sandbox",
                [
                    "allow-scripts",
                    "allow-same-origin",
                    "allow-forms",
                    "allow-modals",
                    "allow-popups",
                    "allow-popups-to-escape-sandbox",
                    "allow-top-navigation-by-user-activation",
                    "allow-downloads"
                ].join(" "));
            iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
            // Si necesitas APIs extra, descomenta: iframe.setAttribute("allow", "fullscreen; clipboard-write");

            // Señales de carga/fallo (detección de problemas de red/CORS)
            iframe.addEventListener("error", () => {
                console.error("iframe load error");
            }, {
                once: true
            });
        }

        this.shadowRoot.querySelector(".menu-btn")?.addEventListener("click", () => this._toggleMenu());

        // Handlers
        this._visHandler = () => {
            if (!document.hidden)
                this._syncThemeFromParent();
        };
        this._pageShow = (e) => {
            if (e.persisted)
                this._syncThemeFromParent();
        };
        this._msgHandler = this._handleTokenRequest.bind(this);
        this._themeHandler = () => this._syncThemeFromParent();

        // Observa cambios de tema del padre (evento y mutaciones en <html>)
        try {
            window.addEventListener("ha-theme-changed", this._themeHandler);
            const P = window.parent;
            const root = P?.document?.documentElement;
            if (root && "MutationObserver" in window) {
                this._themeMO = new MutationObserver(this._themeHandler);
                this._themeMO.observe(root, {
                    attributes: true,
                    attributeFilter: ["style", "class"]
                });
            }
        } catch (err) {
            console.log("Theme observers not attached:", err?.message || err);
        }

        document.addEventListener("visibilitychange", this._visHandler);
        window.addEventListener("message", this._msgHandler);
        window.addEventListener("pageshow", this._pageShow);

        // Inicialización
        this._syncThemeFromParent();
        this._setIframeSrc();
    }

    disconnectedCallback() {
        // Limpieza de listeners
        document.removeEventListener("visibilitychange", this._visHandler);
        window.removeEventListener("pageshow", this._pageShow);
        window.removeEventListener("message", this._msgHandler);
        window.removeEventListener("ha-theme-changed", this._themeHandler);
        try {
            this._themeMO?.disconnect();
        } catch {}

        // Restaura margen original del <body>
        if (this._prevBodyMargin !== undefined) {
            document.body.style.margin = this._prevBodyMargin;
        }
    }

    _setIframeSrc() {
        const iframe = this.shadowRoot?.getElementById("ha-tracker-iframe");
        if (!iframe)
            return;

        const base =
            this._hass?.hassUrl?.("/local/ha-tracker/index.html") ||
            new URL("local/ha-tracker/index.html", location.href).toString();

        let url = base;
        try {
            const u = new URL(base, location.href);
            if (PANEL_VERSION && !u.searchParams.has("v")) {
                u.searchParams.set("v", PANEL_VERSION);
            }
            url = u.toString();
            // guarda el origin esperado del iframe
            this._iframeOrigin = u.origin;
        } catch (err) {
            console.error("URL error:", err?.message || err);
            this._iframeOrigin = ""; // no disponible
        }

        if (iframe.src !== url)
            iframe.src = url;
    }

    _toggleMenu() {
        const P = window.parent || window.top;
        try {
            // evento oficial
            P.dispatchEvent(new P.CustomEvent("hass-toggle-menu", {
                    bubbles: true,
                    composed: true
                }));
            P.document.querySelector("home-assistant")
            ?.dispatchEvent(new P.CustomEvent("hass-toggle-menu", {
                    bubbles: true,
                    composed: true
                }));
        } catch {}
        try {
            // fallback DOM interno
            const ha = P.document.querySelector("home-assistant");
            const main = ha?.shadowRoot?.querySelector("home-assistant-main");
            const sr = main?.shadowRoot;
            const drawer = sr?.querySelector("ha-drawer, app-drawer, app-drawer-layout app-drawer");
            if (drawer) {
                if (typeof drawer.toggle === "function")
                    drawer.toggle();
                else {
                    drawer.open = !drawer.open;
                    drawer.dispatchEvent(new P.CustomEvent("opened-changed", {
                            bubbles: true,
                            composed: true,
                            detail: {
                                value: drawer.open
                            }
                        }));
                }
                return;
            }
            if (typeof main?.toggleMenu === "function")
                main.toggleMenu();
        } catch (e) {
            console.error("toggleMenu error:", e?.message || e);
        }
    }

    _syncThemeFromParent() {
        try {
            const P = window.parent;
            const root = P?.document?.documentElement;
            if (!root)
                return;
            const csRoot = P.getComputedStyle(root);
            const csBody = P.getComputedStyle(P.document.body);

            ["--app-header-background-color", "--app-header-text-color",
                "--primary-color", "--primary-text-color", "--primary-background-color",
                "--secondary-background-color", "--divider-color"].forEach(v => {
                const val = csRoot.getPropertyValue(v);
                if (val)
                    this.style.setProperty(v, val.trim());
            });

            const famVar = (csRoot.getPropertyValue("--mdc-typography-font-family") || "").trim();
            const famBody = (csBody.fontFamily || "").trim();
            const fam = famVar || famBody ||
                'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji"';

            document.documentElement.style.setProperty("--mdc-typography-font-family", fam);
            this.style.setProperty("--mdc-typography-font-family", fam);
            this.style.fontFamily = `var(--mdc-typography-font-family, ${fam})`;

            const weightBody = (csBody.fontWeight || "400").toString().trim();
            this.style.setProperty("--ha-toolbar-title-weight", weightBody);
        } catch (err) {
            console.error("syncTheme error:", err?.message || err);
        }
    }

    async _handleTokenRequest(ev) {
        if (ev?.data?.type !== "request-token")
            return;

        const iframe = this.shadowRoot?.getElementById("ha-tracker-iframe");
        if (!iframe || iframe.contentWindow !== ev.source)
            return;

        // Seguridad: valida origin si lo conoces
        if (this._iframeOrigin && ev.origin && ev.origin !== this._iframeOrigin) {
            console.log("Message ignored due to unexpected origin:", ev.origin, "≠", this._iframeOrigin);
            return;
        }

        const SKEW_MS = 60_000; // refrescar si queda <60s de vida
        const FALLBACK_TTL_MS = 8 * 60 * 1000; // por si el token no trae 'exp'
        this._lastToken ??= "";
        this._lastExpMs ??= 0;
        this._lastGotAt ??= 0;

        // Funciones locales (todo en la misma función)
        const getCurrentToken = () =>
        this.hass?.auth?.data?.access_token || // preferido
        this.hass?.connection?.options?.auth?.accessToken || ""; // respaldo

        const tokenExpMs = (tok) => {
            try {
                const part = tok?.split(".")?.[1];
                if (!part)
                    return 0;
                // Base64URL -> Base64 + padding
                const base64 = part.replace(/-/g, "+").replace(/_/g, "/")
                    .padEnd(Math.ceil(part.length / 4) * 4, "=");
                const payload = JSON.parse(atob(base64));
                return payload?.exp ? payload.exp * 1000 : 0; // a ms
            } catch {
                return 0;
            }
        };

        const needRefresh = () => {
            if (!this._lastToken)
                return true;
            if (this._lastExpMs)
                return (Date.now() + SKEW_MS) >= this._lastExpMs;
            // si no hay exp, TTL de respaldo
            return (Date.now() - this._lastGotAt) > FALLBACK_TTL_MS;
        };

        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        // 1) Actualiza caché desde el runtime si ha cambiado
        const runtime = getCurrentToken();
        if (runtime && runtime !== this._lastToken) {
            this._lastToken = runtime;
            this._lastGotAt = Date.now();
            this._lastExpMs = tokenExpMs(runtime) || 0;
        }

        // 2) Refresca si está cerca de expirar (con throttle)
        if (needRefresh()) {
            this._refreshing ??= (async() => {
                for (let i = 0; i < 50 && !this.hass; i++)
                    await sleep(100); // espera a hass
                try {
                    await this.hass?.auth?.refreshAccessToken?.();
                } catch (e) {
                    console.warn("refreshAccessToken failed:", e);
                }
                const t = getCurrentToken();
                if (t) {
                    this._lastToken = t;
                    this._lastGotAt = Date.now();
                    this._lastExpMs = tokenExpMs(t) || 0;
                }
            })();
            try {
                await this._refreshing;
            } finally {
                this._refreshing = null;
            }
        }

        const token = this._lastToken;
        if (!token) {
            console.log("No token available to send");
            return;
        }

        // 3) Responder (incluye exp para que el iframe sepa cuándo volver a pedir)
        const targetOrigin = ev.origin || this._iframeOrigin || location.origin;
        try {
            ev.source.postMessage({
                type: "auth-token",
                token,
                exp: this._lastExpMs || undefined,
                reqId: ev.data?.reqId,
            }, targetOrigin);
        } catch (e) {
            console.error("postMessage failed:", e);
        }
    }

}

if (!customElements.get("ha-tracker-panel"))
    customElements.define("ha-tracker-panel", HATrackerPanel);
