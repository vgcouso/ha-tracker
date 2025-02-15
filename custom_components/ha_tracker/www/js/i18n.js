//	
// i18n
//


export let currentLang = 'en'; // Idioma predeterminado

let translations = {};

export async function loadTranslations(lang) {
    try {
        const response = await fetch(`locales/${lang}.json`);
        if (!response.ok)
            throw new Error(`Translation not found for ${lang}`);
        translations = await response.json();
        currentLang = lang;
        updateTexts(); // Actualizar textos en la página solo si se cargan traducciones
    } catch (error) {
        console.error(`Error loading translations for ${lang}.`, error);

        if (lang === 'en') {
            console.error("The English translation file could not be loaded. No changes will be made to the texts.");
            return; // No hacer nada si no se encuentra inglés
        } else {
            console.error("Trying to load english as fallback.");
            await loadTranslations('en'); // Intentar cargar inglés como fallback
        }
    }
}

export function t(key) {
    return translations[key] || key; // Devuelve la traducción o la clave original si no existe
}

export function tWithVars(key, vars = {}) {
    let text = t(key);
    for (const [varName, value] of Object.entries(vars)) {
        text = text.replace(`{${varName}}`, value);
    }
    return text;
}

function updateTexts() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        element.textContent = t(key);
    });
}

export async function initializeI18n() {
    const userLang = navigator.language.slice(0, 2); // Idioma del navegador

    // Cambiar el atributo `lang` en el documento HTML
    document.documentElement.setAttribute('lang', userLang);

    // Intentar cargar el idioma del navegador
    await loadTranslations(userLang);
}