import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import AppHeader from './AppHeader';
import { base44 } from '@/api/base44Client';
import { useTranslation } from '@/hooks/useTranslation';
import { applyTheme } from '@/lib/theme';

export default function AppLayout() {
  const { setLocale } = useTranslation();

  // Apply persisted per-user settings (language + theme) on app load.
  useEffect(() => {
    base44.auth.me()
      .then(user => {
        const s = user.settings || {};
        if (s.language) setLocale(s.language);
        applyTheme(s.theme || 'light');
      })
      .catch(() => {});
  }, [setLocale]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <AppHeader />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
      <footer className="text-center text-xs text-slate-400 py-6">
        IndustrialPM · Industrial Automation & Energy Project Management
      </footer>
    </div>
  );
}