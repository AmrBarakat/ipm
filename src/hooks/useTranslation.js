import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { createElement } from 'react';
import en from '@/locales/en';

/**
 * Lightweight i18n. For now only 'en' exists; adding a second locale (e.g. ar)
 * is just a matter of dropping another file in src/locales and registering it
 * in the `locales` map below.
 */
const locales = { en };

const TranslationContext = createContext({
  locale: 'en',
  setLocale: () => {},
  t: (k) => k,
});

function resolve(dict, key) {
  if (!key) return key;
  const parts = key.split('.');
  let cur = dict;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

export function TranslationProvider({ children }) {
  const [locale, setLocale] = useState('en');

  const t = useCallback(
    (key, vars) => {
      const value = resolve(locales[locale], key);
      if (value === undefined) return key;
      if (typeof value !== 'string' || !vars) return value;
      return Object.entries(vars).reduce(
        (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), v),
        value
      );
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return createElement(TranslationContext.Provider, { value }, children);
}

export function useTranslation() {
  return useContext(TranslationContext);
}

export default useTranslation;