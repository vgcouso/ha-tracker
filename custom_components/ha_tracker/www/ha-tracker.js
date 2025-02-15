import { html, css, LitElement } from "https://cdn.jsdelivr.net/npm/lit@3.1.2/+esm";

class HATrackerPanel extends LitElement {
    static originalConsole = {
        log: console.log,
        debug: console.debug,
        info: console.info,
        warn: console.warn,
        error: console.error
    };
    
	static get properties() {
        return {
            hass: { type: Object },
            panel: { type: Object },
			tokenExpiration: { type: Number },
            token: { type: String },
			enableDebug: { type: Boolean },
        };
    }

	constructor() {
		super();
		this.token = null;
		this.tokenExpiration = null;
		this.enableDebug  = false; 
		this.tokenRefreshInterval = null;
	}

	async connectedCallback() {
		super.connectedCallback();
		await this.checkHassConnection();
		this.configureConsole();
		await this.startTokenRefreshInterval();		
		this.setupVisibilityCheck();
	}

    render() {
        return html`
            <ha-app-layout>
                <app-header slot="header" fixed>
                    <app-toolbar>
                        <ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button> 
                        <div class="title">HA Tracker</div>
                    </app-toolbar>
                </app-header>

                <div class="iframe-container">
                    <iframe id="myIframe" src="/local/ha-tracker/index.html"></iframe>
                </div>
            </ha-app-layout>
        `;
    }

    static styles = css`
        :host {
            display: block;
            height: 100%;
            background: var(--primary-background-color);
            color: var(--primary-text-color);
        }
        ha-app-layout {
            display: flex;
            flex-direction: column;
            height: 100%;
        }
        app-header {
            background-color: var(--primary-color);
            color: white;
            --mdc-theme-primary: var(--primary-color);
            height: 56px;
            display: flex;
            align-items: center;
        }
        app-toolbar {
            display: flex;
            align-items: center;
            width: 100%;
            padding: 0 16px;
        }
        ha-menu-button {
            display: block;
        }
        .title {
            font-size: 20px;
            flex-grow: 1;
            text-align: left;
            padding-left: 16px;
        }
        .iframe-container {
            flex-grow: 1;
            display: flex;
            height: calc(100vh - 56px);
        }
        iframe {
            width: 100%;
            height: 100%;
            border: none;
        }
    `;
	
	/** Obtiene la configuración */
	async fetchConfig() {
		// Comprobar si 'this.hass' y 'this.hass.auth' están definidos
		if (!this.hass || !this.hass.auth || !this.hass.auth.data) {
			console.error('Home Assistant context, authentication or token data is missing.');
			return;
		}

		// Comprobar si 'access_token' existe y es una cadena no vacía
		const accessToken = this.hass.auth.data.access_token;
		if (!accessToken || typeof accessToken !== 'string') {
			console.error('Invalid or missing access token.');
			return;
		}

		// Ahora proceder con la solicitud fetch usando el 'access_token' válido
		try {
			const response = await fetch('/api/ha_tracker/config', {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${accessToken}`
				}
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
					
			const config = await response.json();
			
			this.enableDebug = config.enable_debug;
			
		} catch (error) {
			console.error('Failed to fetch config:', error);
		}
	}


    /** Configura la detección de visibilidad de la pestaña */
    setupVisibilityCheck() {
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                console.log("Back to the tab. Checking iframe...");
                this.checkIframeAndReloadPage();
            }
        });
    }

    /** Espera 1 segundo antes de verificar si el `iframe` está cargado */
    checkIframeAndReloadPage() {
        setTimeout(() => {
            const iframe = this.shadowRoot.querySelector("#myIframe");

			// **Condiciones para determinar si el iframe no es válido o visible**
			if (
				!iframe || 
				!iframe.contentWindow || 
				!iframe.contentWindow.document || 
				iframe.contentWindow.location.href === "about:blank" || 
				iframe.getBoundingClientRect().width === 0 ||  // No tiene ancho visible
				iframe.getBoundingClientRect().height === 0    // No tiene alto visible
			) {
                console.warn("The iframe is not loading correctly. Reloading page...");
                window.location.reload(); // Recargar toda la página
            } else {
                console.log("The iframe is loaded correctly.");
            }
        }, 1000); // Espera 1 segundo antes de decidir recargar la página
    }

    /** Verifica si Home Assistant ha cargado y obtiene el token */
	async checkHassConnection() {
		while (!this.hass?.auth?.data?.access_token) {
			await new Promise(resolve => setTimeout(resolve, 500)); // Esperar 500ms antes de reintentar
		}
		
		await this.fetchConfig();
	}

    /** Llama a `refreshToken()` periódicamente */
	async startTokenRefreshInterval() {
		if (this.tokenRefreshInterval) {
			clearInterval(this.tokenRefreshInterval); // Asegura que solo haya un temporizador activo
		}

		// Renovar el token inmediatamente al iniciar
		await this.refreshToken();

		// Luego, renovar cada 10 minutos con una función anónima async
		this.tokenRefreshInterval = setInterval(() => {
			(async () => {
				console.log("Automatic token renewal...");
				await this.refreshToken();
			})();
		}, 10 * 60 * 1000); // Cada 10 minutos
	}

    /** Renueva el token */
    async refreshToken() {
        try {
            console.log("Trying to renew token...");

            if (!this.hass || !this.hass.auth) {
                throw new Error("`this.hass.auth` not available.");
            }

            // Usar el método oficial de Home Assistant para renovar el token
            await this.hass.auth.refreshAccessToken();

            // Obtener el nuevo token
            await this.fetchToken();

        } catch (error) {
            console.error("Error renewing token:", error);
        }
    }
	
    /** Obtiene el token desde `hass.auth.data.access_token` */
    async fetchToken() {
        try {
            const accessToken = this.hass.auth.data.access_token;
			const expiresIn = this.hass.auth.data.expires_in || (10 * 60); 
			
            if (!accessToken) {
                throw new Error("No valid token was found in`hass.auth.data.access_token`.");
            }

            this.token = accessToken;
			this.tokenExpiration = Date.now() + (expiresIn * 1000);
			
			console.log(`Token obtained: ${this.token}\nExpires at: ${new Date(this.tokenExpiration).toLocaleString()}`);
        } catch (error) {
            console.error("Failed to get token:", error);
        }
    }	
	
    configureConsole() {
        if (!this.enableDebug) {
            // Modo producción: deshabilitar mensajes de consola excepto advertencias y errores
            console.log = () => {};
            console.debug = () => {};
            console.info = () => {};
            console.warn = (...args) => HATrackerPanel.originalConsole.warn("[WARNING]:", ...args);
            console.error = (...args) => HATrackerPanel.originalConsole.error("[ERROR]:", ...args);
        } else {
            // Modo desarrollo: habilitar mensajes con marcas de tiempo
            const getTimeStamp = () => {
                const now = new Date();
                return `[${now.toLocaleTimeString()}:${now.getMilliseconds()}]`;
            };

            console.log = (...args) => HATrackerPanel.originalConsole.log(getTimeStamp(), ...args);
            console.debug = (...args) => HATrackerPanel.originalConsole.debug(getTimeStamp(), ...args);
            console.info = (...args) => HATrackerPanel.originalConsole.info(getTimeStamp(), ...args);
            console.warn = (...args) => HATrackerPanel.originalConsole.warn(getTimeStamp(), "[WARNING]:", ...args);
            console.error = (...args) => HATrackerPanel.originalConsole.error(getTimeStamp(), "[ERROR]:", ...args);
        }
    }
}

customElements.define("ha-tracker", HATrackerPanel);
