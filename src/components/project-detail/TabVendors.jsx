import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate, BOM_CATEGORY_LABELS } from '@/lib/constants';
import {
  Plus, Truck, Package, AlertTriangle, CheckCircle2,
  Pencil, Trash2, Save, X, ChevronDown, ChevronRight,
  FileText, RefreshCw, ShoppingCart, Check, Loader2, AlertCircle
} from 'lucide-react';
import { jsPDF } from 'jspdf';

// ── Constants ────────────────────────────────────────────────────────────────

const PO_STATUS_STYLES = {
  draft:               'bg-slate-100 text-slate-600',
  issued:              'bg-blue-100 text-blue-700',
  acknowledged:        'bg-purple-100 text-purple-700',
  in_transit:          'bg-amber-100 text-amber-800',
  partially_delivered: 'bg-orange-100 text-orange-700',
  delivered:           'bg-emerald-100 text-emerald-700',
  cancelled:           'bg-slate-200 text-slate-500',
};

const PO_STATUS_LABELS = {
  draft: 'Draft', issued: 'Issued', acknowledged: 'Acknowledged',
  in_transit: 'In Transit', partially_delivered: 'Partially Delivered',
  delivered: 'Delivered', cancelled: 'Cancelled',
};

const PRIORITY_STYLES = {
  low: 'bg-slate-100 text-slate-500', medium: 'bg-blue-100 text-blue-600',
  high: 'bg-amber-100 text-amber-700', critical: 'bg-red-100 text-red-700',
};

const PO_TYPE_LABELS = {
  equipment: 'Equipment', subcontract: 'Subcontract',
  service: 'Service', material: 'Material', other: 'Other',
};

const DN_CONDITION_STYLES = {
  good: 'bg-emerald-100 text-emerald-700',
  damaged: 'bg-red-100 text-red-700',
  partial: 'bg-amber-100 text-amber-700',
};

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

const EMPTY_PO = {
  po_number: '', description: '', type: 'equipment', priority: 'medium',
  vendor_name: '', amount: '', currency: 'SAR',
  issue_date: '', expected_delivery_date: '', delivery_location: '',
  tracking_number: '', notes: '', status: 'draft',
};

const EMPTY_DN = { dn_number: '', received_date: '', received_by: '', condition: 'good', notes: '' };

// ── Main Component ───────────────────────────────────────────────────────────

export default function TabVendors({ projectId, project }) {
  const [activeSubTab, setActiveSubTab] = useState('pos');

  return (
    <div className="space-y-4">
      {/* Sub-tab switcher */}
      <div className="flex gap-1 border-b border-slate-200">
        <SubTabBtn id="pos" label="Purchase Orders" active={activeSubTab} onClick={setActiveSubTab} icon={<Truck className="w-3.5 h-3.5" />} />
        <SubTabBtn id="procurement" label="Procurement (BOM)" active={activeSubTab} onClick={setActiveSubTab} icon={<ShoppingCart className="w-3.5 h-3.5" />} />
      </div>

      {activeSubTab === 'pos'         && <POsPanel projectId={projectId} project={project} />}
      {activeSubTab === 'procurement' && <ProcurementPanel projectId={projectId} project={project} />}
    </div>
  );
}

function SubTabBtn({ id, label, active, onClick, icon }) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition -mb-px ${
        active === id ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {icon}{label}
    </button>
  );
}

// ── Purchase Orders Panel ────────────────────────────────────────────────────

function POsPanel({ projectId, project }) {
  const [pos, setPOs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_PO);
  const [expanded, setExpanded] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [addingDN, setAddingDN] = useState(null);
  const [dnForm, setDNForm] = useState(EMPTY_DN);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [checkingDelays, setCheckingDelays] = useState(false);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const data = await base44.entities.PurchaseOrder.filter({ project_id: projectId }, '-created_date', 200);
    setPOs(data);
    setLoading(false);
  }

  async function createPO(e) {
    e.preventDefault();
    if (!form.description.trim()) return;
    await base44.entities.PurchaseOrder.create({
      ...form, project_id: projectId,
      amount: Number(form.amount) || 0, delivery_notes: [], delay_days: 0, delay_alerted: false,
    });
    setForm(EMPTY_PO); setAdding(false); load();
  }

  function startEdit(po) {
    setEditingId(po.id);
    setEditForm({
      po_number: po.po_number || '', description: po.description, type: po.type,
      priority: po.priority, vendor_name: po.vendor_name || '',
      amount: po.amount || '', currency: po.currency || 'SAR',
      issue_date: po.issue_date || '', expected_delivery_date: po.expected_delivery_date || '',
      actual_delivery_date: po.actual_delivery_date || '',
      delivery_location: po.delivery_location || '', tracking_number: po.tracking_number || '',
      notes: po.notes || '', status: po.status,
    });
  }

  async function saveEdit(id) {
    await base44.entities.PurchaseOrder.update(id, { ...editForm, amount: Number(editForm.amount) || 0 });
    setEditingId(null); load();
  }

  async function deletePO(id) {
    if (!confirm('Delete this PO?')) return;
    await base44.entities.PurchaseOrder.delete(id); load();
  }

  async function addDeliveryNote(po) {
    if (!dnForm.received_date) return;
    const updated = [...(po.delivery_notes || []), { ...dnForm, id: Date.now().toString() }];
    await base44.entities.PurchaseOrder.update(po.id, {
      delivery_notes: updated,
      status: po.status !== 'delivered' ? 'partially_delivered' : 'delivered',
      actual_delivery_date: po.actual_delivery_date || dnForm.received_date,
    });
    setDNForm(EMPTY_DN); setAddingDN(null); load();
  }

  async function markDelivered(po) {
    await base44.entities.PurchaseOrder.update(po.id, {
      status: 'delivered',
      actual_delivery_date: po.actual_delivery_date || new Date().toISOString().slice(0, 10),
    });
    load();
  }

  async function runDelayCheck() {
    setCheckingDelays(true);
    await base44.functions.invoke('checkShipmentDelays', {});
    setCheckingDelays(false); load();
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  function isOverdue(po) {
    if (!po.expected_delivery_date || po.status === 'delivered' || po.status === 'cancelled') return false;
    return new Date(po.expected_delivery_date) < today;
  }
  function daysOverdue(po) {
    return Math.round((today - new Date(po.expected_delivery_date)) / 86400000);
  }

  const filtered = useMemo(() =>
    pos.filter(p => (!filterStatus || p.status === filterStatus) && (!filterType || p.type === filterType)),
    [pos, filterStatus, filterType]
  );

  const totalValue     = pos.reduce((s, p) => s + (p.amount || 0), 0);
  const overdueCount   = pos.filter(isOverdue).length;
  const deliveredCount = pos.filter(p => p.status === 'delivered').length;
  const inTransitCount = pos.filter(p => p.status === 'in_transit').length;
  const currency       = project?.currency || 'SAR';

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      {overdueCount > 0 && (
        <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-300 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-800 flex-1">
            <strong>{overdueCount} shipment{overdueCount !== 1 ? 's' : ''}</strong> overdue.
          </p>
          <button onClick={runDelayCheck} disabled={checkingDelays}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-500 hover:bg-red-400 text-white rounded font-semibold disabled:opacity-50">
            <RefreshCw className={`w-3 h-3 ${checkingDelays ? 'animate-spin' : ''}`} /> Send Alerts
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Total PO Value" value={formatCurrency(totalValue, currency)} color="border-blue-400" icon={<Package className="w-5 h-5" />} />
        <Kpi label="In Transit" value={inTransitCount} color="border-amber-400" icon={<Truck className="w-5 h-5" />} />
        <Kpi label="Delivered" value={deliveredCount} color="border-emerald-400" icon={<CheckCircle2 className="w-5 h-5" />} />
        <Kpi label="Overdue" value={overdueCount} color="border-red-400" icon={<AlertTriangle className="w-5 h-5" />} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 items-center">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={inp} style={{ width: 'auto' }}>
            <option value="">All Statuses</option>
            {Object.entries(PO_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className={inp} style={{ width: 'auto' }}>
            <option value="">All Types</option>
            {Object.entries(PO_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {(filterStatus || filterType) && (
            <button onClick={() => { setFilterStatus(''); setFilterType(''); }} className="text-xs text-slate-400 hover:text-red-500 underline">Clear</button>
          )}
        </div>
        <button onClick={() => setAdding(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Plus className="w-4 h-4" /> Add PO
        </button>
      </div>

      {adding && (
        <form onSubmit={createPO} className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-500" /> New Purchase Order / Subcontract
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input value={form.po_number} onChange={e => setForm(f => ({ ...f, po_number: e.target.value }))} placeholder="PO Number" className={inp} />
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description *" className={inp} required />
            <input value={form.vendor_name} onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))} placeholder="Vendor / Subcontractor" className={inp} />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-500">Type
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inp + ' mt-0.5'}>
                  {Object.entries(PO_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-500">Priority
                <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={inp + ' mt-0.5'}>
                  <option value="low">Low</option><option value="medium">Medium</option>
                  <option value="high">High</option><option value="critical">Critical</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="Amount" className={inp} min="0" />
              <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className={inp}>
                {['SAR','AED','USD','EUR','GBP'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-500">Issue Date
                <input type="date" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} className={inp + ' mt-0.5'} />
              </label>
              <label className="text-xs text-slate-500">Expected Delivery
                <input type="date" value={form.expected_delivery_date} onChange={e => setForm(f => ({ ...f, expected_delivery_date: e.target.value }))} className={inp + ' mt-0.5'} />
              </label>
            </div>
            <input value={form.delivery_location} onChange={e => setForm(f => ({ ...f, delivery_location: e.target.value }))} placeholder="Delivery Location" className={inp} />
            <input value={form.tracking_number} onChange={e => setForm(f => ({ ...f, tracking_number: e.target.value }))} placeholder="Tracking Number" className={inp} />
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes" className={inp + ' resize-none'} rows={2} />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold text-sm rounded hover:bg-amber-400">Save PO</button>
            <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Truck className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No purchase orders yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(po => {
            const overdue = isOverdue(po);
            const overdueDays = overdue ? daysOverdue(po) : 0;
            const isExp = expanded[po.id];
            const isEdit = editingId === po.id;
            return (
              <div key={po.id} className={`bg-white rounded-lg shadow-sm border overflow-hidden ${overdue ? 'border-red-300' : 'border-slate-200'}`}>
                <div className="flex items-start gap-3 p-4">
                  <button onClick={() => setExpanded(p => ({ ...p, [po.id]: !p[po.id] }))}
                    className="text-slate-400 hover:text-slate-600 mt-0.5 shrink-0">
                    {isExp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    {isEdit ? (
                      <EditPOForm form={editForm} setForm={setEditForm} onSave={() => saveEdit(po.id)} onCancel={() => setEditingId(null)} />
                    ) : (
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          {po.po_number && <span className="font-mono text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{po.po_number}</span>}
                          <span className="font-semibold text-slate-800">{po.description}</span>
                          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${PO_STATUS_STYLES[po.status]}`}>{PO_STATUS_LABELS[po.status]}</span>
                          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${PRIORITY_STYLES[po.priority]}`}>{po.priority}</span>
                          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{PO_TYPE_LABELS[po.type]}</span>
                          {overdue && (
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> {overdueDays}d overdue
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-slate-500 mt-1">
                          {po.vendor_name && <span>Vendor: <strong className="text-slate-700">{po.vendor_name}</strong></span>}
                          {po.amount > 0 && <span>Value: <strong className="text-slate-700">{formatCurrency(po.amount, po.currency)}</strong></span>}
                          {po.issue_date && <span>Issued: <strong>{formatDate(po.issue_date)}</strong></span>}
                          {po.expected_delivery_date && (
                            <span className={overdue ? 'text-red-600 font-semibold' : ''}>Expected: <strong>{formatDate(po.expected_delivery_date)}</strong></span>
                          )}
                          {po.actual_delivery_date && <span>Delivered: <strong className="text-emerald-700">{formatDate(po.actual_delivery_date)}</strong></span>}
                          {po.tracking_number && <span>Tracking: <strong>{po.tracking_number}</strong></span>}
                          {(po.delivery_notes || []).length > 0 && (
                            <span className="text-emerald-600 font-semibold">{po.delivery_notes.length} DN{po.delivery_notes.length !== 1 ? 's' : ''}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {!isEdit && (
                    <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                      {po.status !== 'delivered' && po.status !== 'cancelled' && (
                        <>
                          <button onClick={() => { setAddingDN(po.id); setExpanded(p => ({ ...p, [po.id]: true })); setDNForm(EMPTY_DN); }}
                            className="flex items-center gap-1 px-2 py-1.5 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded font-semibold border border-emerald-200">
                            <FileText className="w-3 h-3" /> Add DN
                          </button>
                          <button onClick={() => markDelivered(po)}
                            className="flex items-center gap-1 px-2 py-1.5 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 rounded font-semibold border border-blue-200">
                            <CheckCircle2 className="w-3 h-3" /> Delivered
                          </button>
                        </>
                      )}
                      <button onClick={() => startEdit(po)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deletePO(po.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>

                {isExp && !isEdit && (
                  <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 space-y-3">
                    {po.notes && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Notes</p>
                        <p className="text-xs text-slate-700 leading-relaxed">{po.notes}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Delivery Notes</p>
                      {(po.delivery_notes || []).length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No delivery notes yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {po.delivery_notes.map((dn, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded px-3 py-2 text-xs">
                              {dn.dn_number && <span className="font-mono font-semibold text-slate-600">{dn.dn_number}</span>}
                              <span className="text-slate-600">{formatDate(dn.received_date)}</span>
                              {dn.received_by && <span className="text-slate-500">by {dn.received_by}</span>}
                              {dn.condition && <span className={`px-1.5 py-0.5 rounded font-semibold capitalize ${DN_CONDITION_STYLES[dn.condition]}`}>{dn.condition}</span>}
                              {dn.notes && <span className="text-slate-400 italic">{dn.notes}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {addingDN === po.id && (
                        <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                          <input value={dnForm.dn_number} onChange={e => setDNForm(f => ({ ...f, dn_number: e.target.value }))} placeholder="DN Number" className={inp} />
                          <input type="date" value={dnForm.received_date} onChange={e => setDNForm(f => ({ ...f, received_date: e.target.value }))} className={inp} required />
                          <input value={dnForm.received_by} onChange={e => setDNForm(f => ({ ...f, received_by: e.target.value }))} placeholder="Received By" className={inp} />
                          <select value={dnForm.condition} onChange={e => setDNForm(f => ({ ...f, condition: e.target.value }))} className={inp}>
                            <option value="good">Good</option><option value="damaged">Damaged</option><option value="partial">Partial</option>
                          </select>
                          <input value={dnForm.notes} onChange={e => setDNForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes" className={inp} />
                          <div className="flex gap-2">
                            <button onClick={() => addDeliveryNote(po)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 text-white text-xs rounded font-semibold hover:bg-emerald-400">
                              <Save className="w-3 h-3" /> Save DN
                            </button>
                            <button onClick={() => setAddingDN(null)} className="px-2 py-1.5 border border-slate-200 rounded text-xs text-slate-500 hover:bg-slate-100">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Procurement Panel ────────────────────────────────────────────────────────

function ProcurementPanel({ projectId, project }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [collapsedSuppliers, setCollapsedSuppliers] = useState(new Set());
  const [generatingPO, setGeneratingPO] = useState(null);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const all = await base44.entities.BOMItem.filter({ project_id: projectId }, 'supplier', 500);
    const unordered = all.filter(i => (i.order_status || (i.ordered ? 'ordered' : 'not_ordered')) === 'not_ordered');
    setItems(unordered);
    setSelectedIds(new Set(unordered.map(i => i.id)));
    setLoading(false);
  }

  const grouped = useMemo(() => {
    const map = {};
    items.forEach(i => {
      const sup = i.supplier || '(No Supplier)';
      if (!map[sup]) map[sup] = [];
      map[sup].push(i);
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  function toggleItem(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleSupplierAll(supplier, supplierItems) {
    const allSel = supplierItems.every(i => selectedIds.has(i.id));
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (allSel) supplierItems.forEach(i => n.delete(i.id));
      else supplierItems.forEach(i => n.add(i.id));
      return n;
    });
  }

  function toggleSupplierCollapse(supplier) {
    setCollapsedSuppliers(prev => { const n = new Set(prev); n.has(supplier) ? n.delete(supplier) : n.add(supplier); return n; });
  }

  function toggleAll() {
    setSelectedIds(selectedIds.size === items.length ? new Set() : new Set(items.map(i => i.id)));
  }

  function generatePO(supplier, supplierItems) {
    const selected = supplierItems.filter(i => selectedIds.has(i.id));
    if (!selected.length) return;
    setGeneratingPO(supplier);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210; const margin = 14; const colW = W - margin * 2;
    const cur = project?.currency || 'SAR';
    let y = 0;

    doc.setFillColor(15, 23, 42); doc.rect(0, 0, W, 32, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.setFont(undefined, 'bold');
    doc.text('PURCHASE ORDER', margin, 13);
    doc.setFontSize(9); doc.setFont(undefined, 'normal');
    doc.text(`Date: ${new Date().toLocaleDateString('en-GB')}`, margin, 20);
    doc.text(`Project: ${project?.code || ''} — ${project?.name || ''}`, margin, 26);
    doc.setTextColor(0, 0, 0); y = 40;

    doc.setFillColor(248, 250, 252); doc.roundedRect(margin, y, colW * 0.45, 28, 2, 2, 'F');
    doc.setFontSize(7); doc.setFont(undefined, 'bold'); doc.setTextColor(100, 116, 139);
    doc.text('VENDOR', margin + 3, y + 6);
    doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(15, 23, 42);
    doc.text(supplier === '(No Supplier)' ? 'TBD' : supplier, margin + 3, y + 13);
    doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(71, 85, 105);
    doc.text('Supplier / Vendor', margin + 3, y + 19);

    const px = margin + colW * 0.48;
    doc.setFillColor(248, 250, 252); doc.roundedRect(px, y, colW * 0.52, 28, 2, 2, 'F');
    doc.setFontSize(7); doc.setFont(undefined, 'bold'); doc.setTextColor(100, 116, 139);
    doc.text('SHIP TO / PROJECT', px + 3, y + 6);
    doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(15, 23, 42);
    doc.text(project?.name || '', px + 3, y + 13, { maxWidth: colW * 0.5 });
    doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(71, 85, 105);
    doc.text(project?.client || '', px + 3, y + 19);
    doc.text(project?.location || '', px + 3, y + 24);
    y += 36;

    const cols = [
      { label: '#', w: 0.04 }, { label: 'Part No.', w: 0.14 }, { label: 'Description', w: 0.35 },
      { label: 'Category', w: 0.13 }, { label: 'Qty', w: 0.06, right: true }, { label: 'Unit', w: 0.07 },
      { label: 'Unit Cost', w: 0.10, right: true }, { label: 'Total', w: 0.11, right: true },
    ];

    function drawRow(y, vals, header, alt) {
      if (header) { doc.setFillColor(15, 23, 42); doc.rect(margin, y - 5, colW, 8, 'F'); doc.setTextColor(255,255,255); doc.setFont(undefined,'bold'); }
      else { if (alt) { doc.setFillColor(248,250,252); doc.rect(margin, y-5, colW, 7, 'F'); } doc.setTextColor(30,41,59); doc.setFont(undefined,'normal'); }
      doc.setFontSize(7.5);
      let x = margin + 2;
      vals.forEach((v, i) => {
        const cw = colW * cols[i].w;
        cols[i].right ? doc.text(String(v), x + cw - 4, y, { align: 'right', maxWidth: cw - 2 }) : doc.text(String(v), x, y, { maxWidth: cw - 2 });
        x += cw;
      });
    }

    drawRow(y, cols.map(c => c.label), true); y += 8;
    let grandTotal = 0;
    selected.forEach((item, idx) => {
      if (y > 265) { doc.addPage(); y = 20; }
      const unitCost = Number(item.planned_cost_price) || Number(item.cost_price) || 0;
      const qty = Number(item.quantity) || 1;
      const total = unitCost * qty; grandTotal += total;
      drawRow(y, [
        idx + 1, item.manufacturer_part_number || '—', item.description || '—',
        BOM_CATEGORY_LABELS[item.category] || item.category || '—',
        qty, item.unit || 'pcs',
        unitCost > 0 ? formatCurrency(unitCost, cur) : '—',
        total > 0 ? formatCurrency(total, cur) : '—',
      ], false, idx % 2 === 1);
      y += 7;
    });

    y += 4;
    doc.setFillColor(245, 158, 11); doc.rect(margin + colW * 0.6, y - 4, colW * 0.4, 8, 'F');
    doc.setTextColor(15,23,42); doc.setFont(undefined,'bold'); doc.setFontSize(9);
    doc.text('TOTAL:', margin + colW * 0.62, y);
    doc.text(formatCurrency(grandTotal, cur), margin + colW - 2, y, { align: 'right' });
    y += 14;

    if (y < 240) {
      doc.setDrawColor(226,232,240); doc.setLineWidth(0.3);
      doc.line(margin, y, margin + colW * 0.45, y);
      doc.line(margin + colW * 0.55, y, margin + colW, y);
      doc.setFontSize(7); doc.setFont(undefined,'normal'); doc.setTextColor(148,163,184);
      doc.text('Prepared by', margin, y + 4);
      doc.text('Approved by', margin + colW * 0.55, y + 4);
    }

    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p); doc.setFontSize(7); doc.setTextColor(148,163,184); doc.setFont(undefined,'normal');
      doc.text(`${project?.name || ''} · PO for ${supplier} · Page ${p} of ${pageCount}`, W / 2, 290, { align: 'center' });
    }

    const safeSupplier = supplier.replace(/[^a-z0-9]/gi, '_').slice(0, 30);
    doc.save(`PO_${project?.code || 'PRJ'}_${safeSupplier}_${new Date().toISOString().slice(0, 10)}.pdf`);
    setGeneratingPO(null);
  }

  const totalValue = items.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0);
  const selectedValue = items.filter(i => selectedIds.has(i.id)).reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Items to Order" value={items.length} color="border-amber-400" icon={<ShoppingCart className="w-5 h-5" />} />
        <Kpi label="Suppliers" value={grouped.length} color="border-blue-400" icon={<Package className="w-5 h-5" />} />
        <Kpi label="Total Value" value={formatCurrency(totalValue, project?.currency || 'SAR')} color="border-slate-400" icon={<FileText className="w-5 h-5" />} />
        <Kpi label="Selected Value" value={formatCurrency(selectedValue, project?.currency || 'SAR')} color="border-emerald-400" icon={<CheckCircle2 className="w-5 h-5" />} />
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg shadow-sm border border-slate-100">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShoppingCart className="w-8 h-8 text-emerald-400" />
          </div>
          <h3 className="font-semibold text-slate-700 text-lg mb-1">All items are ordered!</h3>
          <p className="text-slate-400 text-sm">No BOM items with "Not Ordered" status found.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <button onClick={toggleAll} className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${selectedIds.size === items.length ? 'bg-amber-400 border-amber-400' : 'border-slate-300'}`}>
                {selectedIds.size === items.length && <Check className="w-2.5 h-2.5 text-slate-900" />}
              </div>
              <span>{selectedIds.size === items.length ? 'Deselect All' : 'Select All'} ({items.length} items)</span>
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <AlertCircle className="w-3.5 h-3.5" /> Select items per supplier, then generate a PO PDF
            </div>
          </div>

          <div className="space-y-4">
            {grouped.map(([supplier, supplierItems]) => {
              const isCollapsed = collapsedSuppliers.has(supplier);
              const allSel = supplierItems.every(i => selectedIds.has(i.id));
              const someSel = supplierItems.some(i => selectedIds.has(i.id));
              const selItems = supplierItems.filter(i => selectedIds.has(i.id));
              const supTotal = selItems.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0);

              return (
                <div key={supplier} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
                    <button onClick={() => toggleSupplierAll(supplier, supplierItems)} className="flex items-center justify-center shrink-0">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${allSel ? 'bg-amber-400 border-amber-400' : someSel ? 'bg-amber-200 border-amber-400' : 'border-slate-300'}`}>
                        {allSel && <Check className="w-2.5 h-2.5 text-slate-900" />}
                        {someSel && !allSel && <div className="w-1.5 h-1.5 bg-amber-500 rounded-sm" />}
                      </div>
                    </button>
                    <button onClick={() => toggleSupplierCollapse(supplier)} className="flex items-center gap-2 flex-1 text-left">
                      {isCollapsed ? <ChevronRight className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      <Package className="w-4 h-4 text-amber-500 shrink-0" />
                      <span className="font-semibold text-slate-800">{supplier}</span>
                      <span className="text-xs text-slate-400 ml-1">{supplierItems.length} item{supplierItems.length !== 1 ? 's' : ''}</span>
                    </button>
                    <div className="flex items-center gap-3 shrink-0">
                      {selItems.length > 0 && (
                        <span className="text-xs text-slate-500 hidden sm:block">
                          {selItems.length} selected · <span className="font-semibold text-slate-700">{formatCurrency(supTotal, project?.currency || 'SAR')}</span>
                        </span>
                      )}
                      <button
                        onClick={() => generatePO(supplier, supplierItems)}
                        disabled={selItems.length === 0 || generatingPO === supplier}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-xs rounded disabled:opacity-40 disabled:cursor-not-allowed transition"
                      >
                        {generatingPO === supplier ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                        Generate PO ({selItems.length})
                      </button>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[700px]">
                        <thead className="bg-slate-100 text-slate-500 uppercase">
                          <tr>
                            <th className="px-3 py-2 w-8"></th>
                            <th className="px-3 py-2 text-left">Description</th>
                            <th className="px-3 py-2 text-left">Part No.</th>
                            <th className="px-3 py-2 text-left">Category</th>
                            <th className="px-3 py-2 text-right">Qty</th>
                            <th className="px-3 py-2 text-left">Unit</th>
                            <th className="px-3 py-2 text-right">Unit Cost</th>
                            <th className="px-3 py-2 text-right">Total Cost</th>
                            <th className="px-3 py-2 text-left">Exp. Delivery</th>
                          </tr>
                        </thead>
                        <tbody>
                          {supplierItems.map((item, idx) => {
                            const isChecked = selectedIds.has(item.id);
                            const unitCost = Number(item.planned_cost_price) || Number(item.cost_price) || 0;
                            const qty = Number(item.quantity) || 1;
                            return (
                              <tr key={item.id} onClick={() => toggleItem(item.id)}
                                className={`border-t border-slate-100 cursor-pointer transition ${isChecked ? 'bg-amber-50' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} hover:bg-amber-50/70`}>
                                <td className="px-3 py-2">
                                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center mx-auto transition-colors ${isChecked ? 'bg-amber-400 border-amber-400' : 'border-slate-300'}`}>
                                    {isChecked && <Check className="w-2.5 h-2.5 text-slate-900" />}
                                  </div>
                                </td>
                                <td className="px-3 py-2 font-medium text-slate-800 max-w-[200px]"><div className="truncate">{item.description || '—'}</div></td>
                                <td className="px-3 py-2 font-mono text-slate-500">{item.manufacturer_part_number || '—'}</td>
                                <td className="px-3 py-2">
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">
                                    {BOM_CATEGORY_LABELS[item.category] || item.category || '—'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right font-semibold text-slate-700">{qty}</td>
                                <td className="px-3 py-2 text-slate-500">{item.unit || 'pcs'}</td>
                                <td className="px-3 py-2 text-right text-slate-700">{unitCost > 0 ? formatCurrency(unitCost, project?.currency || 'SAR') : '—'}</td>
                                <td className="px-3 py-2 text-right font-semibold text-slate-800">{unitCost > 0 ? formatCurrency(unitCost * qty, project?.currency || 'SAR') : '—'}</td>
                                <td className="px-3 py-2 text-slate-500">{formatDate(item.expected_delivery_date)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                          <tr>
                            <td colSpan={7} className="px-3 py-2 text-slate-500 text-xs font-semibold">Supplier Total</td>
                            <td className="px-3 py-2 text-right font-bold text-slate-800">
                              {formatCurrency(supplierItems.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0), project?.currency || 'SAR')}
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function EditPOForm({ form, setForm, onSave, onCancel }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <input value={form.po_number} onChange={e => setForm(f => ({ ...f, po_number: e.target.value }))} placeholder="PO Number" className={inp} />
        <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description *" className={inp} />
        <input value={form.vendor_name} onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))} placeholder="Vendor" className={inp} />
        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inp}>
          {Object.entries({ equipment:'Equipment', subcontract:'Subcontract', service:'Service', material:'Material', other:'Other' }).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={inp}>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
        </select>
        <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inp}>
          {Object.entries(PO_STATUS_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="Amount" className={inp} min="0" />
        <input type="date" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} className={inp} />
        <input type="date" value={form.expected_delivery_date} onChange={e => setForm(f => ({ ...f, expected_delivery_date: e.target.value }))} className={inp} />
        <input type="date" value={form.actual_delivery_date} onChange={e => setForm(f => ({ ...f, actual_delivery_date: e.target.value }))} className={inp} />
        <input value={form.tracking_number} onChange={e => setForm(f => ({ ...f, tracking_number: e.target.value }))} placeholder="Tracking Number" className={inp} />
        <input value={form.delivery_location} onChange={e => setForm(f => ({ ...f, delivery_location: e.target.value }))} placeholder="Delivery Location" className={inp} />
      </div>
      <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes" className={inp + ' resize-none'} rows={2} />
      <div className="flex gap-2">
        <button onClick={onSave} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 text-white text-xs rounded font-semibold hover:bg-emerald-400">
          <Save className="w-3 h-3" /> Save
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 border border-slate-200 rounded text-xs text-slate-500 hover:bg-slate-100">
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function Kpi({ label, value, color, icon }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${color}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
          <div className="text-xl font-semibold text-slate-800">{value}</div>
        </div>
        <div className="text-slate-300 mt-0.5">{icon}</div>
      </div>
    </div>
  );
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}