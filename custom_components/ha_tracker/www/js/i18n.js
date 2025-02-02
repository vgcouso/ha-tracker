//	
// i18n
//


export let currentLang = 'en'; // Idioma predeterminado

let translations = {};

export async function loadTranslations(lang) {
  try {
    const response = await fetch(`locales/${lang}.json`);
    if (!response.ok) throw new Error(`Traducción no encontrada para ${lang}`);
    translations = await response.json();
    currentLang = lang;
    console.log(`Traducciones cargadas para el idioma: ${lang}`);
    updateTexts(); // Actualizar textos en la página solo si se cargan traducciones
  } catch (error) {
    console.log(`Error cargando traducciones para ${lang}.`, error);

    if (lang === 'en') {
      console.error("No se pudo cargar el archivo de traducciones en inglés. No se realizarán cambios en los textos.");
      return; // No hacer nada si no se encuentra inglés
    } else {
      console.log("Intentando cargar inglés como fallback.");
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
  console.log(`Idioma del navegador detectado: ${userLang}`);

  // Cambiar el atributo `lang` en el documento HTML
  document.documentElement.setAttribute('lang', userLang);

  // Intentar cargar el idioma del navegador
  await loadTranslations(userLang);
}
