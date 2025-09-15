// utils/loader.js  (ESM)

// Registro global para deduplicar entre módulos
const GLB = (typeof window !== 'undefined' ? window : globalThis);
GLB.__assetLoader ??= {
    js: new Map(),
    css: new Map()
};

function onceExisting(el) {
    return new Promise((resolve, reject) => {
        // Si ya cargó
        if (el.dataset.loaded === 'true' || el.readyState === 'complete')
            return resolve();
        el.addEventListener('load', () => resolve(), {
            once: true
        });
        el.addEventListener('error', () => reject(new Error('Resource failed: ' + (el.src || el.href))), {
            once: true
        });
    });
}

export function loadCSSOnce(href, {
    attrs = {},
    matchPrefix = true
} = {}) {
    const key = href;
    if (GLB.__assetLoader.css.has(key))
        return GLB.__assetLoader.css.get(key);

    const sel = matchPrefix ? `link[rel="stylesheet"][href^="${href}"]`
         : `link[rel="stylesheet"][href="${href}"]`;
    const existing = document.querySelector(sel);
    if (existing) {
        const p = onceExisting(existing);
        GLB.__assetLoader.css.set(key, p);
        return p.finally(() => GLB.__assetLoader.css.delete(key));
    }

    const p = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        for (const [k, v] of Object.entries(attrs))
            link.setAttribute(k, v);
        link.onload = () => {
            link.dataset.loaded = 'true';
            resolve();
        };
        link.onerror = () => reject(new Error('CSS not loaded: ' + href));
        document.head.appendChild(link);
    });

    GLB.__assetLoader.css.set(key, p);
    return p.finally(() => GLB.__assetLoader.css.delete(key));
}

export function loadScriptOnce(src, {
    attrs = {},
    matchPrefix = true,
    test = null
} = {}) {
    // Si el test ya pasa, no cargamos nada
    try {
        if (typeof test === 'function' && test())
            return Promise.resolve();
    } catch {}

    const key = src;
    if (GLB.__assetLoader.js.has(key))
        return GLB.__assetLoader.js.get(key);

    const sel = matchPrefix ? `script[src^="${src}"]`
         : `script[src="${src}"]`;
    const existing = document.querySelector(sel);
    if (existing) {
        // Si ya cargó, ok; si no, espera a su load/error
        const p = onceExisting(existing).then(() => {
            if (typeof test === 'function' && !test()) {
                throw new Error('Script present but test() failed: ' + src);
            }
        });
        GLB.__assetLoader.js.set(key, p);
        return p.finally(() => GLB.__assetLoader.js.delete(key));
    }

    const p = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        for (const [k, v] of Object.entries(attrs))
            s.setAttribute(k, v);
        s.onload = () => {
            s.dataset.loaded = 'true';
            try {
                if (typeof test === 'function' && !test()) {
                    reject(new Error('Script loaded but test() failed: ' + src));
                } else {
                    resolve();
                }
            } catch (e) {
                reject(e);
            }
        };
        s.onerror = () => reject(new Error('Script not loaded: ' + src));
        document.head.appendChild(s);
    });

    GLB.__assetLoader.js.set(key, p);
    return p.finally(() => GLB.__assetLoader.js.delete(key));
}

/** Carga en orden un array de recursos {type:'css'|'js', url, opts} */
export async function loadResources(resources = []) {
    for (const r of resources) {
        if (r.type === 'css')
            await loadCSSOnce(r.url, r.opts);
        else if (r.type === 'js')
            await loadScriptOnce(r.url, r.opts);
    }
}
