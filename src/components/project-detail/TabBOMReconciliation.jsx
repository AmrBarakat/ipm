/**
 * BOM Reconciliation Report Tab
 * Shows reconciliation status per document, drill-down into mismatches,
 * and tools to re-run extraction or flag suspect rows.
 */
import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { isTopLevelBOM } from '@/lib/constants';
import {
  CheckCircle2, AlertTriangle, XCircle, MinusCircle,
  ChevronDown, ChevronRight, RefreshCw, Flag, Search,
  FileSearch, Info, TrendingUp, TrendingDown
} from 'lucide-react';
import BOMExtractionPreviewModal from './BOMExtractionPreviewModal';

const fmt = (val, dec = 0) => {
  const n = Number(val ?? 0);
  if (!n && n !== 0) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
};
const fmtSAR = (val) => {
  const n = Number(val ?? 0);
  if (!n) return '—';
  return `SAR ${fmt(n)}`;
};

const STATUS_CONFIG = {
  OK:                   { label: 'OK',               color: 'text-emerald-700 bg-emerald-50 border-emerald-200',  icon: CheckCircle2,  dot: 'bg-emerald-500' },
  MISSING_ROWS:         { label: 'Missing Rows',      color: 'text-amber-700 bg-amber-50 border-amber-300',        icon: TrendingDown,  dot: 'bg-amber-500'  },
  DOUBLE_COUNTED_ROWS:  { label: 'Double Counted',    color: 'text-red-700 bg-red-50 border-red-300',              icon: TrendingUp,    dot: 'bg-red-500'    },
  MISMATCH:             { label: 'Mismatch',          color: 'text-red-700 bg-red-50 border-red-300',              icon: XCircle,       dot: 'bg-red-500'    },
  UNVERIFIED:           { label: 'Unverified',        color: 'text-slate-500 bg-slate-50 border-slate-200',        icon: MinusCircle,   dot: 'bg-slate-400'  },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.UNVERIFIED;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border ${cfg.color}`}>
      <Icon className="w-3.5 h-3.5" />
      {cfg.label}
    </span>
  );
}

export default function TabBOMReconciliation({ projectId }) {
  const [documents, setDocuments] = useState([]);
  const [bomItems, setBomItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [rerunDoc, setRerunDoc] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [flaggedItems, setFlaggedItems] = useState(new Set()); // BOM item ids flagged for review

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const [docs, items] = await Promise.all([
      base44.entities.Document.filter({ project_id: projectId }, '-created_date', 200),
      base44.entities.BOMItem.filter({ project_id: projectId }, '-created_date', 500),
    ]);
    setDocuments(docs);
    // Exclude panel child rows (parent_id) — outside the BOM tab a panel is one
    // complete item, so its components are invisible to reconciliation counts.
    setBomItems(items.filter(isTopLevelBOM));
    setLoading(false);
  }

  function toggleExpand(docId) {
    setExpanded(p => ({ ...p, [docId]: !p[docId] }));
  }

  function toggleFlag(itemId) {
    setFlaggedItems(prev => {
      const n = new Set(prev);
      n.has(itemId) ? n.delete(itemId) : n.add(itemId);
      return n;
    });
  }

  // ── Compute per-document reconciliation data ────────────────────────────────
  const docReconciliations = useMemo(() => {
    // Only documents that have been through BOM extraction
    const bomDocs = documents.filter(d => d.bom_extraction_status === 'completed' || d.bom_items_created > 0);

    return bomDocs.map(doc => {
      // Items created from this document
      const docItems = bomItems.filter(i => i.source_document_id === doc.id);

      const extractedCost = docItems.reduce((s, i) => s + (Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0);
      const extractedSell = docItems.reduce((s, i) => s + (Number(i.selling_price) || 0) * (Number(i.quantity) || 1), 0);
      const itemCount     = docItems.length;

      // Items without part numbers (suspect)
      const noPartNo = docItems.filter(i => !i.item_code && !i.manufacturer_part_number);
      // Items with zero cost
      const zeroCost = docItems.filter(i => !i.cost_price || Number(i.cost_price) === 0);
      // Potential duplicates: same description
      const descCounts = {};
      docItems.forEach(i => {
        const key = i.description?.toLowerCase().trim() || '';
        if (key) descCounts[key] = (descCounts[key] || 0) + 1;
      });
      const duplicates = docItems.filter(i => descCounts[i.description?.toLowerCase().trim()] > 1);

      // Derive reconciliation status from document metadata or heuristics
      // The reconciliation_status was stored in meta during extraction (not persisted to doc entity),
      // so we derive it from item-level signals:
      let status = 'UNVERIFIED';
      const issues = [];

      if (itemCount === 0) {
        status = 'UNVERIFIED';
        issues.push('No BOM items linked to this document.');
      } else {
        if (duplicates.length > 0) {
          status = 'DOUBLE_COUNTED_ROWS';
          issues.push(`${duplicates.length} item(s) may be duplicated (same description).`);
        }
        if (noPartNo.length > docItems.length * 0.3) {
          status = status === 'UNVERIFIED' ? 'MISSING_ROWS' : status;
          issues.push(`${noPartNo.length} item(s) have no part number — may indicate missing rows.`);
        }
        if (zeroCost.length > 0) {
          issues.push(`${zeroCost.length} item(s) have zero planned cost.`);
        }
        if (issues.length === 0) status = 'OK';
      }

      // Category breakdown
      const byCategory = {};
      docItems.forEach(i => {
        const cat = i.category || 'other';
        if (!byCategory[cat]) byCategory[cat] = { count: 0, cost: 0, sell: 0 };
        byCategory[cat].count++;
        byCategory[cat].cost += (Number(i.cost_price) || 0) * (Number(i.quantity) || 1);
        byCategory[cat].sell += (Number(i.selling_price) || 0) * (Number(i.quantity) || 1);
      });

      return {
        doc,
        status,
        issues,
        itemCount,
        extractedCost,
        extractedSell,
        noPartNo,
        zeroCost,
        duplicates,
        byCategory,
        docItems,
      };
    });
  }, [documents, bomItems]);

  const filtered = useMemo(() => {
    return docReconciliations.filter(r => {
      if (filterStatus && r.status !== filterStatus) return false;
      if (searchQuery && !r.doc.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [docReconciliations, filterStatus, searchQuery]);

  // Summary KPIs
  const kpis = useMemo(() => {
    const all = docReconciliations;
    return {
      total:    all.length,
      ok:       all.filter(r => r.status === 'OK').length,
      mismatch: all.filter(r => ['MISMATCH','DOUBLE_COUNTED_ROWS','MISSING_ROWS'].includes(r.status)).length,
      unverified: all.filter(r => r.status === 'UNVERIFIED').length,
      totalItems: bomItems.filter(i => documents.some(d => d.id === i.source_document_id && (d.bom_extraction_status === 'completed' || d.bom_items_created > 0))).length,
      totalCost: docReconciliations.reduce((s, r) => s + r.extractedCost, 0),
    };
  }, [docReconciliations, bomItems, documents]);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  if (docReconciliations.length === 0) return (
    <div className="text-center py-16 text-slate-400">
      <FileSearch className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="text-sm font-medium">No extracted BOM documents found.</p>
      <p className="text-xs mt-1">Upload a document and run BOM Extraction from the Documents tab first.</p>
    </div>
  );

  return (
    <div className="space-y-5">

      {/* ── KPI bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Documents Extracted', value: kpis.total,       color: 'text-slate-800' },
          { label: 'Clean (OK)',           value: kpis.ok,          color: 'text-emerald-600' },
          { label: 'Need Review',          value: kpis.mismatch,    color: 'text-red-600' },
          { label: 'Total BOM Items',      value: kpis.totalItems,  color: 'text-slate-700' },
        ].map((k, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-lg px-4 py-3">
            <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
            <div className="text-xs text-slate-400 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search documents…"
            className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 w-52"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
        >
          <option value="">All Statuses</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
        <span className="text-xs text-slate-400 ml-auto">{filtered.length} document{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Document list ── */}
      <div className="space-y-3">
        {filtered.map(({ doc, status, issues, itemCount, extractedCost, extractedSell, noPartNo, zeroCost, duplicates, byCategory, docItems }) => {
          const isExpanded = expanded[doc.id];
          const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.UNVERIFIED;
          const Icon = cfg.icon;

          return (
            <div key={doc.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">

              {/* ── Document header row ── */}
              <button
                onClick={() => toggleExpand(doc.id)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition text-left"
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800 text-sm truncate">{doc.title}</span>
                    {doc.file_name && <span className="text-xs text-slate-400 font-mono truncate hidden sm:block">{doc.file_name}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-1">
                    <StatusBadge status={status} />
                    <span className="text-xs text-slate-500">{itemCount} items</span>
                    {extractedCost > 0 && <span className="text-xs text-slate-500">Cost: <span className="font-semibold text-slate-700">{fmtSAR(extractedCost)}</span></span>}
                    {extractedSell > 0 && <span className="text-xs text-slate-500">Sell: <span className="font-semibold text-emerald-700">{fmtSAR(extractedSell)}</span></span>}
                    {issues.length > 0 && (
                      <span className="flex items-center gap-1 text-xs text-amber-600">
                        <AlertTriangle className="w-3 h-3" /> {issues.length} issue{issues.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); setRerunDoc(doc); }}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 border border-amber-300 text-amber-700 rounded hover:bg-amber-50 font-medium"
                  >
                    <RefreshCw className="w-3 h-3" /> Re-extract
                  </button>
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                </div>
              </button>

              {/* ── Expanded drill-down ── */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-5 pb-5 pt-4 space-y-5">

                  {/* Issues list */}
                  {issues.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Detected Issues</h4>
                      <div className="space-y-1.5">
                        {issues.map((issue, i) => (
                          <div key={i} className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            {issue}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Category breakdown */}
                  {Object.keys(byCategory).length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Category Breakdown</h4>
                      <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 text-slate-500 font-semibold">
                            <tr>
                              <th className="px-3 py-2 text-left">Category</th>
                              <th className="px-3 py-2 text-right">Items</th>
                              <th className="px-3 py-2 text-right">Total Cost (SAR)</th>
                              <th className="px-3 py-2 text-right">Total Sell (SAR)</th>
                              <th className="px-3 py-2 text-right">GM%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(byCategory).sort(([,a],[,b]) => b.cost - a.cost).map(([cat, data], i) => {
                              const gp = data.sell - data.cost;
                              const gm = data.sell > 0 ? (gp / data.sell * 100).toFixed(1) : null;
                              return (
                                <tr key={cat} className={`border-t border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                  <td className="px-3 py-2 font-medium text-slate-700 capitalize">{cat.replace(/_/g, ' ')}</td>
                                  <td className="px-3 py-2 text-right text-slate-600">{data.count}</td>
                                  <td className="px-3 py-2 text-right font-semibold text-slate-800">{fmt(data.cost)}</td>
                                  <td className="px-3 py-2 text-right text-emerald-700">{fmt(data.sell)}</td>
                                  <td className="px-3 py-2 text-right">
                                    {gm != null ? (
                                      <span className={`font-semibold ${Number(gm) < 0 ? 'text-red-600' : Number(gm) < 10 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                        {gm}%
                                      </span>
                                    ) : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                            {/* Totals row */}
                            <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold">
                              <td className="px-3 py-2 text-slate-700">TOTAL</td>
                              <td className="px-3 py-2 text-right text-slate-700">{itemCount}</td>
                              <td className="px-3 py-2 text-right text-slate-800">{fmt(extractedCost)}</td>
                              <td className="px-3 py-2 text-right text-emerald-700">{fmt(extractedSell)}</td>
                              <td className="px-3 py-2 text-right">
                                {extractedSell > 0 ? (
                                  <span className="text-emerald-600">{((extractedSell - extractedCost) / extractedSell * 100).toFixed(1)}%</span>
                                ) : '—'}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Suspect items — duplicates + zero cost + no part no */}
                  {(duplicates.length > 0 || zeroCost.length > 0 || noPartNo.length > 0) && (
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <Flag className="w-3.5 h-3.5 text-red-500" /> Suspect Items
                      </h4>
                      <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-red-50 text-slate-600 font-semibold">
                            <tr>
                              <th className="px-3 py-2 text-left">Description</th>
                              <th className="px-3 py-2 text-left">Part No</th>
                              <th className="px-3 py-2 text-left">Category</th>
                              <th className="px-3 py-2 text-right">Qty</th>
                              <th className="px-3 py-2 text-right">Cost</th>
                              <th className="px-3 py-2 text-center">Issues</th>
                              <th className="px-3 py-2 text-center">Flag</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...new Map([...duplicates, ...zeroCost, ...noPartNo].map(i => [i.id, i])).values()].map((item, idx) => {
                              const issues = [];
                              if (duplicates.find(d => d.id === item.id)) issues.push('Possible duplicate');
                              if (zeroCost.find(z => z.id === item.id)) issues.push('Zero cost');
                              if (noPartNo.find(n => n.id === item.id)) issues.push('No part no.');
                              const isFlagged = flaggedItems.has(item.id);
                              return (
                                <tr key={item.id} className={`border-t border-slate-100 ${isFlagged ? 'bg-red-50' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                  <td className="px-3 py-2 font-medium text-slate-800 max-w-[180px] truncate">{item.description}</td>
                                  <td className="px-3 py-2 font-mono text-slate-500">{item.item_code || item.manufacturer_part_number || '—'}</td>
                                  <td className="px-3 py-2 capitalize text-slate-500">{(item.category || 'other').replace(/_/g, ' ')}</td>
                                  <td className="px-3 py-2 text-right">{item.quantity}</td>
                                  <td className="px-3 py-2 text-right font-semibold">{fmt(Number(item.cost_price) * Number(item.quantity))}</td>
                                  <td className="px-3 py-2 text-center">
                                    <div className="flex flex-wrap gap-1 justify-center">
                                      {issues.map(issue => (
                                        <span key={issue} className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{issue}</span>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <button
                                      onClick={() => toggleFlag(item.id)}
                                      title={isFlagged ? 'Remove flag' : 'Flag for review'}
                                      className={`p-1 rounded transition ${isFlagged ? 'text-red-600 bg-red-100 hover:bg-red-200' : 'text-slate-300 hover:text-red-500 hover:bg-red-50'}`}
                                    >
                                      <Flag className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {flaggedItems.size > 0 && (
                        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                          <Flag className="w-3 h-3 text-red-500" />
                          <span>{flaggedItems.size} item{flaggedItems.size > 1 ? 's' : ''} flagged for review.</span>
                          <button onClick={() => setFlaggedItems(new Set())} className="text-slate-400 hover:text-slate-600 underline">Clear all flags</button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* All clean */}
                  {status === 'OK' && issues.length === 0 && (
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      All {itemCount} items extracted cleanly. No issues detected.
                    </div>
                  )}

                  {/* Resolution tips */}
                  {issues.length > 0 && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 mb-2">
                        <Info className="w-3.5 h-3.5 text-blue-500" /> Resolution Options
                      </div>
                      <ul className="space-y-1.5 text-xs text-slate-600">
                        {duplicates.length > 0 && (
                          <li className="flex items-start gap-2">
                            <span className="text-amber-500 font-bold shrink-0">→</span>
                            <span><strong>Duplicate rows:</strong> Re-run extraction — the parser now uses first-occurrence dedup. Or delete the duplicate entries manually in the BOM tab.</span>
                          </li>
                        )}
                        {noPartNo.length > 0 && (
                          <li className="flex items-start gap-2">
                            <span className="text-amber-500 font-bold shrink-0">→</span>
                            <span><strong>Missing part numbers:</strong> These may be service rows or rows where the column resolver couldn't find a part number. Edit in BOM tab or re-run with a custom template mapping the correct column.</span>
                          </li>
                        )}
                        {zeroCost.length > 0 && (
                          <li className="flex items-start gap-2">
                            <span className="text-amber-500 font-bold shrink-0">→</span>
                            <span><strong>Zero-cost items:</strong> The cost column may not have been recognized. Re-run extraction with a template that specifies the exact cost column name or index.</span>
                          </li>
                        )}
                        <li className="flex items-start gap-2">
                          <span className="text-blue-500 font-bold shrink-0">→</span>
                          <span>Click <strong>Re-extract</strong> to open the BOM extraction preview and adjust template settings before re-importing.</span>
                        </li>
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Re-extract modal */}
      {rerunDoc && (
        <BOMExtractionPreviewModal
          document={rerunDoc}
          projectId={projectId}
          onClose={() => setRerunDoc(null)}
          onImported={() => { setRerunDoc(null); load(); }}
        />
      )}
    </div>
  );
}