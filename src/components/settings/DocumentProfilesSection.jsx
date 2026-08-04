import { useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { BookText, Trash2, Loader2, RefreshCw } from 'lucide-react';

const KIND_LABEL = { po: 'Purchase Order', delivery_note: 'Delivery Note', other: 'Other' };

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Read-only list of learned DocumentProfiles with a per-row Clear (delete) action. */
export default function DocumentProfilesSection() {
  const confirm = useConfirm();
  const [profiles, setProfiles] = useState(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    base44.entities.DocumentProfile.list('-last_seen', 200)
      .then((data) => setProfiles(data || []))
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
  }, []);

  // Load once on mount via a click-equivalent: render triggers on first open.
  if (profiles === null && !loading) load();

  async function clearProfile(p) {
    const ok = await confirm({
      title: `Clear profile for ${p.issuer_display_name || p.issuer_key}?`,
      description: `This returns ${KIND_LABEL[p.document_kind] || p.document_kind} extraction from this issuer to unassisted behaviour. Sample count was ${p.sample_count}.`,
      confirmText: 'Clear',
      destructive: true,
    });
    if (!ok) return;
    setClearing(p.id);
    try {
      await base44.entities.DocumentProfile.delete(p.id);
      setProfiles((prev) => (prev || []).filter((x) => x.id !== p.id));
    } finally {
      setClearing(null);
    }
  }

  async function clearAll() {
    const list = profiles || [];
    if (!list.length) return;
    const ok = await confirm({
      title: `Clear all ${list.length} learned profiles?`,
      description: 'All issuer conventions will be forgotten. Extraction returns to unassisted behaviour for every vendor.',
      confirmText: 'Clear all',
      destructive: true,
    });
    if (!ok) return;
    setClearing('all');
    try {
      await Promise.allSettled(list.map((p) => base44.entities.DocumentProfile.delete(p.id)));
      setProfiles([]);
    } finally {
      setClearing(null);
    }
  }

  return (
    <section className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 mb-4">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
          <BookText className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-slate-800">Learned Document Profiles</h2>
          <p className="text-xs text-slate-500">
            Conventions the extractor remembers per vendor (date format, price basis, column labels) so repeat POs
            extract with fewer corrections. Read-only — use Clear to forget a profile.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-200 rounded-md text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
          </button>
          {profiles && profiles.length > 0 && (
            <button onClick={clearAll} disabled={clearing === 'all'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-red-200 text-red-600 rounded-md text-xs hover:bg-red-50 disabled:opacity-50">
              {clearing === 'all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Clear all
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8 text-slate-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading profiles…
        </div>
      )}

      {!loading && profiles && profiles.length === 0 && (
        <div className="text-center py-8 text-sm text-slate-400">
          No learned profiles yet. Profiles appear here after you apply extracted POs or delivery notes.
        </div>
      )}

      {!loading && profiles && profiles.length > 0 && (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left font-medium px-2 py-2">Issuer</th>
                <th className="text-left font-medium px-2 py-2">Kind</th>
                <th className="text-left font-medium px-2 py-2">Date format</th>
                <th className="text-left font-medium px-2 py-2">Prices</th>
                <th className="text-left font-medium px-2 py-2">Part code</th>
                <th className="text-right font-medium px-2 py-2">Samples</th>
                <th className="text-left font-medium px-2 py-2">Last seen</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {profiles.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-2 py-2.5">
                    <div className="font-medium text-slate-800">{p.issuer_display_name || p.issuer_key}</div>
                    <div className="text-xs text-slate-400 font-mono">{p.issuer_key}</div>
                  </td>
                  <td className="px-2 py-2.5 text-slate-600">{KIND_LABEL[p.document_kind] || p.document_kind}</td>
                  <td className="px-2 py-2.5 text-slate-600 font-mono text-xs">{p.date_format || '—'}</td>
                  <td className="px-2 py-2.5">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${p.prices_are_net ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {p.prices_are_net ? 'net' : 'gross'}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-slate-600 text-xs">{p.part_code_pattern ? p.part_code_pattern.replace(/_/g, ' ') : '—'}</td>
                  <td className="px-2 py-2.5 text-right font-semibold text-slate-700">{p.sample_count}</td>
                  <td className="px-2 py-2.5 text-slate-500 text-xs">{fmtDate(p.last_seen)}</td>
                  <td className="px-2 py-2.5">
                    <button onClick={() => clearProfile(p)} disabled={clearing === p.id}
                      className="inline-flex items-center justify-center w-7 h-7 text-red-500 hover:bg-red-50 rounded disabled:opacity-50" title="Clear this profile">
                      {clearing === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}