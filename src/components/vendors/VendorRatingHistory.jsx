import { useState } from 'react';
import { Plus } from 'lucide-react';
import { formatDate } from '@/lib/constants';
import { RATINGS, RATING_STYLES, RATING_DOT, ratingLabel } from './vendorConstants';

/**
 * VendorRatingHistory — timeline of a vendor's performance ratings over time,
 * with a compact form to record a new rating entry. Adding an entry also
 * promotes its rating to the vendor's current rating (handled by parent).
 */
export default function VendorRatingHistory({ history = [], currentRating, onAdd }) {
  const [rating, setRating] = useState(currentRating || 'approved');
  const [note, setNote] = useState('');

  function add() {
    onAdd({ date: new Date().toISOString().slice(0, 10), rating, note: note.trim() });
    setNote('');
  }

  const sorted = [...(history || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return (
    <div className="space-y-3">
      <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
        <div className="flex items-center gap-2">
          <select value={rating} onChange={e => setRating(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400">
            {RATINGS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason / note (optional)"
            className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
          <button onClick={add}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-semibold rounded shrink-0">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs text-slate-400 italic">No rating history recorded yet.</p>
      ) : (
        <ol className="relative border-l-2 border-slate-100 ml-2 space-y-3">
          {sorted.map((h, i) => (
            <li key={i} className="ml-4">
              <span className={`absolute -left-[7px] mt-1 w-3 h-3 rounded-full ${RATING_DOT[h.rating] || 'bg-slate-300'}`} />
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${RATING_STYLES[h.rating] || 'bg-slate-100 text-slate-600'}`}>
                  {ratingLabel(h.rating)}
                </span>
                <span className="text-xs text-slate-400">{formatDate(h.date)}</span>
              </div>
              {h.note && <p className="text-xs text-slate-600 mt-0.5">{h.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}