import { useState, useEffect, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate } from '@/lib/constants';
import {
  Plus, Truck, Package, AlertTriangle, CheckCircle2, Clock,
  Pencil, Trash2, Save, X, ChevronDown, ChevronRight,
  FileText, RefreshCw
} from 'lucide-react';

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
  draft:               'Draft',
  issued:              'Issued',
  acknowledged:        'Acknowledged',
  in_transit:          'In Transit',
  partially_delivered: 'Partially Delivered',
  delivered:           'Delivered',
  cancelled:           'Cancelled',
};

const PRIORITY_STYLES = {
  low:      'bg-slate-100 text-slate-500',
  medium:   'bg-blue-100 text-blue-600',
  high:     'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
};

const PO_TYPE_LABELS = {
  equipment:   'Equipment',
  subcontract: 'Subcontract',
  service:     'Service',
  material:    'Material',
  other:       'Other',
};

const DN_CONDITION_STYLES = {
  good:    'bg-emerald-100 text-emerald-700',
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

export default function TabVendors({ projectId, project }) {
  const [pos, setPOs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_PO);
  const [expanded, setExpanded] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [addingDN, setAddingDN] = useState(null); // po id
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
      ...form,
      project_id: projectId,
      amount: Number(form.amount) || 0,
      delivery_notes: [],
      delay_days: 0,
      delay_alerted: false,
    });
    setForm(EMPTY_PO);
    setAdding(false);
    load();
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
    setEditingId(null);
    load();
  }

  async function deletePO(id) {
    if (!confirm('Delete this PO?')) return;
    await base44.entities.PurchaseOrder.delete(id);
    load();
  }

  async function addDeliveryNote(po) {
    if (!dnForm.received_date) return;
    const existing = po.delivery_notes || [];
    const updated = [...existing, { ...dnForm, id: Date.now().toString() }];
    // Mark as at least partially delivered
    const newStatus = po.status !== 'delivered' ? 'partially_delivered' : 'delivered';
    await base44.entities.PurchaseOrder.update(po.id, {
      delivery_notes: updated,
      status: newStatus,
      actual_delivery_date: po.actual_delivery_date || dnForm.received_date,
    });
    setDNForm(EMPTY_DN);
    setAddingDN(null);
    load();
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
    setCheckingDelays(false);
    load();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function isOverdue(po) {
    if (!po.expected_delivery_date || po.status === 'delivered' || po.status === 'cancelled') return false;
    return new Date(po.expected_delivery_date) < today;
  }

  function daysOverdue(po) {
    if (!po.expected_delivery_date) return 0;
    const exp = new Date(po.expected_delivery_date);
    return Math.round((today - exp) / 86400000);
  }

  const filtered = useMemo(() =>
    pos.filter(p =>
      (!filterStatus || p.status === filterStatus) &&
      (!filterType   || p.type   === filterType)
    ),
    [pos, filterStatus, filterType]
  );

  // KPIs
  const totalValue     = pos.reduce((s, p) => s + (p.amount || 0), 0);
  const overdueCount   = pos.filter(isOverdue).length;
  const deliveredCount = pos.filter(p => p.status === 'delivered').length;
  const inTransitCount = pos.filter(p => p.status === 'in_transit').length;
  const currency       = project?.currency || 'SAR';

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      {/* Delay Alert Banner */}
      {overdueCount > 0 && (
        <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-300 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-800 flex-1">
            <strong>{overdueCount} shipment{overdueCount !== 1 ? 's' : ''}</strong> overdue and awaiting delivery.
          </p>
          <button
            onClick={runDelayCheck}
            disabled={checkingDelays}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-500 hover:bg-red-400 text-white rounded font-semibold disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${checkingDelays ? 'animate-spin' : ''}`} />
            Send Alerts
          </button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Total PO Value" value={formatCurrency(totalValue, currency)} color="border-blue-400" icon={<Package className="w-5 h-5" />} />
        <Kpi label="In Transit" value={inTransitCount} color="border-amber-400" icon={<Truck className="w-5 h-5" />} />
        <Kpi label="Delivered" value={deliveredCount} color="border-emerald-400" icon={<CheckCircle2 className="w-5 h-5" />} />
        <Kpi label="Overdue" value={overdueCount} color="border-red-400" icon={<AlertTriangle className="w-5 h-5" />} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 items-center">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white">
            <option value="">All Statuses</option>
            {Object.entries(PO_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white">
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

      {/* Add PO Form */}
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

      {/* PO List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Truck className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No purchase orders yet. Click "Add PO" to start tracking.</p>
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
                {/* Header */}
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
                          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${PO_STATUS_STYLES[po.status]}`}>
                            {PO_STATUS_LABELS[po.status]}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${PRIORITY_STYLES[po.priority]}`}>
                            {po.priority}
                          </span>
                          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                            {PO_TYPE_LABELS[po.type]}
                          </span>
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
                            <span className={overdue ? 'text-red-600 font-semibold' : ''}>
                              Expected: <strong>{formatDate(po.expected_delivery_date)}</strong>
                            </span>
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
                      <button onClick={() => startEdit(po)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deletePO(po.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded Panel */}
                {isExp && !isEdit && (
                  <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 space-y-3">
                    {po.notes && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Notes</p>
                        <p className="text-xs text-slate-700 leading-relaxed">{po.notes}</p>
                      </div>
                    )}

                    {/* Delivery Notes */}
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
                              {dn.condition && (
                                <span className={`px-1.5 py-0.5 rounded font-semibold capitalize ${DN_CONDITION_STYLES[dn.condition]}`}>{dn.condition}</span>
                              )}
                              {dn.notes && <span className="text-slate-400 italic">{dn.notes}</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add DN Form */}
                      {addingDN === po.id && (
                        <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                          <input value={dnForm.dn_number} onChange={e => setDNForm(f => ({ ...f, dn_number: e.target.value }))} placeholder="DN Number" className={inp} />
                          <input type="date" value={dnForm.received_date} onChange={e => setDNForm(f => ({ ...f, received_date: e.target.value }))} className={inp} required />
                          <input value={dnForm.received_by} onChange={e => setDNForm(f => ({ ...f, received_by: e.target.value }))} placeholder="Received By" className={inp} />
                          <select value={dnForm.condition} onChange={e => setDNForm(f => ({ ...f, condition: e.target.value }))} className={inp}>
                            <option value="good">Good</option>
                            <option value="damaged">Damaged</option>
                            <option value="partial">Partial</option>
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
          {Object.entries({ draft:'Draft', issued:'Issued', acknowledged:'Acknowledged', in_transit:'In Transit', partially_delivered:'Partially Delivered', delivered:'Delivered', cancelled:'Cancelled' }).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
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