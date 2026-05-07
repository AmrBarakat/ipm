import { Outlet } from 'react-router-dom';
import AppHeader from './AppHeader';

export default function AppLayout() {
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