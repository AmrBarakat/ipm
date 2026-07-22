import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTranslation } from '@/hooks/useTranslation';
import { applyTheme } from '@/lib/theme';
import { Settings as SettingsIcon, Globe, Bell, Palette, Save, Check, Loader2, Sun, Moon, Monitor, Sliders } from 'lucide-react';
import HelpSection from '@/components/settings/HelpSection';
import UsersSection from '@/components/settings/UsersSection';
import { useAuth } from '@/lib/AuthContext';
import EventLogSection from '@/components/settings/EventLogSection';

const DEFAULTS = {
  default_currency: 'SAR',
  default_ev_method: 'weighted_milestones',
  default_fiscal_calendar: 'calendar',
  notifications: { milestone_completion: true, shipment_delays: true, invoice_due: true, risk_mitigation: false },
  language: 'en',
  theme: 'light',
};

const EV_METHODS = [
  { value: 'weighted_milestones', label: 'Weighted Milestones' },
  { value: '0-100', label: '0/100 Rule' },
  { value: 'earned_value', label: 'Earned Value (EVM)' },
];
const FISCAL = [
  { value: 'calendar', label: 'Calendar Year (Jan–Dec)' },
  { value: 'fiscal_apr', label: 'Fiscal Year (Apr–Mar)' },
  { value: 'fiscal_jul', label: 'Fiscal Year (Jul–Jun)' },
];
const CURRENCIES = ['SAR', 'USD', 'EUR', 'AED', 'GBP', 'KWD', 'QAR'];

const NOTIF_AUTOMATIONS = [
  { key: 'milestone_completion', label: 'Milestone completion', desc: 'When a milestone auto-completes from WBS progress.' },
  { key: 'shipment_delays', label: 'Shipment delays', desc: 'When a purchase order passes its delivery date.' },
  { key: 'invoice_due', label: 'Upcoming invoice due', desc: 'Ahead of a planned invoice due date.' },
  { key: 'risk_mitigation', label: 'Risk mitigation suggestions', desc: 'When AI mitigation suggestions are generated.' },
];

const THEME_OPTS = [
  { value: 'light', label: 'Light', icon: <Sun className="w-4 h-4" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" /> },
  { value: 'system', label: 'System', icon: <Monitor className="w-4 h-4" /> },
];

const inp = 'border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

export default function SettingsPage() {
  const { setLocale } = useTranslation();
  const { user } = useAuth();
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    base44.auth.me()
      .then(user => {
        const s = user.settings || {};
        const merged = {
          ...DEFAULTS,
          ...s,
          notifications: { ...DEFAULTS.notifications, ...(s.notifications || {}) },
        };
        setSettings(merged);
        if (merged.language) setLocale(merged.language);
        applyTheme(merged.theme || 'light');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function update(partial) {
    setSettings(prev => ({ ...prev, ...partial }));
    setSaved(false);
  }
  function updateNotif(key, val) {
    setSettings(prev => ({ ...prev, notifications: { ...prev.notifications, [key]: val } }));
    setSaved(false);
  }
  function changeLanguage(lang) {
    update({ language: lang });
    setLocale(lang);
  }
  function changeTheme(theme) {
    update({ theme });
    applyTheme(theme);
  }

  async function save() {
    setSaving(true);
    try {
      await base44.auth.updateMe({ settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
            <SettingsIcon className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Settings</h1>
            <p className="text-sm text-slate-500">Manage your project defaults, notifications, language, and appearance.</p>
          </div>
        </div>
        <button onClick={save} disabled={saving || saved}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition ${
            saved ? 'bg-emerald-500 text-white' : 'bg-amber-500 hover:bg-amber-400 text-slate-900 disabled:opacity-60'
          }`}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save Changes'}
        </button>
      </div>

      {user?.role === 'admin' && <UsersSection currentUser={user} />}

      {/* Project defaults */}
      <Section icon={<Sliders className="w-4 h-4" />} title="Project Defaults" desc="Applied to new projects you create.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Default Currency">
            <select value={settings.default_currency} onChange={e => update({ default_currency: e.target.value })} className={inp}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Default EV Method">
            <select value={settings.default_ev_method} onChange={e => update({ default_ev_method: e.target.value })} className={inp}>
              {EV_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Default Fiscal Calendar">
            <select value={settings.default_fiscal_calendar} onChange={e => update({ default_fiscal_calendar: e.target.value })} className={inp}>
              {FISCAL.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </Field>
        </div>
      </Section>

      {/* Notification preferences */}
      <Section icon={<Bell className="w-4 h-4" />} title="Notification Preferences" desc="Choose which automations create notifications for you.">
        <div className="divide-y divide-slate-100">
          {NOTIF_AUTOMATIONS.map(a => (
            <label key={a.key} className="flex items-start justify-between gap-4 py-3 cursor-pointer">
              <div>
                <div className="text-sm font-medium text-slate-800">{a.label}</div>
                <div className="text-xs text-slate-500">{a.desc}</div>
              </div>
              <Toggle checked={!!settings.notifications[a.key]} onChange={v => updateNotif(a.key, v)} />
            </label>
          ))}
        </div>
      </Section>

      {/* Language */}
      <Section icon={<Globe className="w-4 h-4" />} title="Language" desc="Interface language. Arabic support is ready for when the locale is added.">
        <div className="flex gap-2">
          <button onClick={() => changeLanguage('en')}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${settings.language === 'en' ? 'bg-amber-500 border-amber-500 text-slate-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            English
          </button>
          <button onClick={() => changeLanguage('ar')} disabled
            className="px-4 py-2 rounded-lg text-sm font-medium border bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed">
            العربية (soon)
          </button>
        </div>
      </Section>

      {/* Appearance */}
      <Section icon={<Palette className="w-4 h-4" />} title="Appearance" desc="Choose how the app looks. System follows your OS preference.">
        <div className="flex gap-2">
          {THEME_OPTS.map(opt => (
            <button key={opt.value} onClick={() => changeTheme(opt.value)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition ${settings.theme === opt.value ? 'bg-amber-500 border-amber-500 text-slate-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      </Section>

      <HelpSection />
      <EventLogSection />
    </div>
  );
}

function Section({ icon, title, desc, children }) {
  return (
    <section className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 mb-4">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">{icon}</div>
        <div>
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <p className="text-xs text-slate-500">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-11 h-6 rounded-full transition ${checked ? 'bg-amber-500' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}