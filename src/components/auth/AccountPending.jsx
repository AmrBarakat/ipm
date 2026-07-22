import { useAuth } from '@/lib/AuthContext';
import { Lock, LogOut } from 'lucide-react';

/**
 * Full-screen gate shown to authenticated-but-not-approved users (pending or
 * suspended). Renders INSTEAD of the app routes. Base44 auth already verified
 * the user's identity; this layer enforces the app approval step.
 */
export default function AccountPending() {
  const { logout, appPublicSettings } = useAuth();
  const appName =
    appPublicSettings?.public_settings?.app_name ||
    appPublicSettings?.name ||
    'IndustrialPM';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-slate-200 p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-7 h-7 text-amber-600" />
        </div>
        <h1 className="text-xl font-bold text-slate-800">{appName}</h1>
        <h2 className="text-lg font-semibold text-slate-700 mt-5">Account pending approval</h2>
        <p className="text-sm text-slate-500 mt-2">
          An administrator will approve your access shortly. Once approved, sign in again to continue.
        </p>
        <button
          onClick={() => logout(true)}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <LogOut className="w-4 h-4" /> Log out
        </button>
      </div>
    </div>
  );
}