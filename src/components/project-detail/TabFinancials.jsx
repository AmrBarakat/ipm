import { useState } from 'react';
import { useEntityList, useEntityMutation } from '@/hooks/useEntity';
import PanelWrapper from '@/components/ui/PanelWrapper';
import { formatCurrency, formatDate, INVOICE_STATUS_LABELS, EXPENSE_CATEGORY_LABELS, EXPENSE_STATUS_LABELS } from '@/lib/constants';
import { Plus, TrendingUp, TrendingDown, AlertTriangle, Pencil, Trash2, Save, X, Banknote, AlertCircle, FileEdit } from 'lucide-react';
import ExpenseCategoryChart from '@/components/project-detail/ExpenseCategoryChart';
import BaselineManager from '@/components/project-detail/BaselineManager';
import SpendingTrendChart from '@/components/project-detail/SpendingTrendChart';
import SkeletonTable from '@/components/ui/SkeletonTable';
import EmptyState from '@/components/ui/EmptyState';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Can } from '@/lib/can';

const INV_STATUS_COLORS = {
  planned: 'bg-slate-100 text-slate-600',
  invoiced: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-800',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-200 text-slate-500',
};

const PAYMENT_METHOD_LABELS = {
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  cash: 'Cash',
  other: 'Other',
};

export default function TabFinancials({ projectId, project }) {
  const { data: invoices = [], isLoading: loadingInv } = useEntityList('Invoice', { project_id: projectId }, 'planned_date', 100);
  const { data: expenses = [], isLoading: loadingExp } = useEntityList('Expense', { project_id: projectId }, 'planned_date', 100);
  const { data: collections = [], isLoading: loadingCol } = useEntityList('Collection', { project_id: projectId }, '-received_date', 100);
  const { data: changeOrders = [] } = useEntityList('ChangeOrder', { project_id: projectId }, '-created_date', 500);
  const invoiceMutation = useEntityMutation('Invoice');
  const expenseMutation = useEntityMutation('Expense');
  const collectionMutation = useEntityMutation('Collection');
  const confirmDialog = useConfirm();
  const loading = loadingInv || loadingExp || loadingCol;

  const [addingInv, setAddingInv] = useState(false);
  const [addingExp, setAddingExp] = useState(false);
  const [addingCol, setAddingCol] = useState(false);

  const [invForm, setInvForm] = useState({ description: '', planned_amount: '', planned_date: '' });
  const [expForm, setExpForm] = useState({ description: '', category: 'material', planned_amount: '', planned_date: '', vendor: '' });
  const [colForm, setColForm] = useState({ description: '', amount: '', received_date: '', payment_method: 'bank_transfer', reference_number: '' });

  const [editingInv, setEditingInv] = useState(null);
  const [editingExp, setEditingExp] = useState(null);
  const [editingCol, setEditingCol] = useState(null);
  const [editInvForm, setEditInvForm] = useState({});
  const [editExpForm, setEditExpForm] = useState({});
  const [editColForm, setEditColForm] = useState({});

  async function createInvoice(e) {
    e.preventDefault();
    // milestone_id is unique at the entity level; manual invoices get a
    // 'manual-<uuid>' sentinel so they never collide with each other or with
    // milestone-linked invoices.
    await invoiceMutation.mutateAsync({ action: 'create', data: { ...invForm, project_id: projectId, milestone_id: `manual-${crypto.randomUUID()}`, planned_amount: Number(invForm.planned_amount) || 0 } });
    setInvForm({ description: '', planned_amount: '', planned_date: '' });
    setAddingInv(false);
  }

  async function createExpense(e) {
    e.preventDefault();
    await expenseMutation.mutateAsync({ action: 'create', data: { ...expForm, project_id: projectId, planned_amount: Number(expForm.planned_amount) || 0 } });
    setExpForm({ description: '', category: 'material', planned_amount: '', planned_date: '', vendor: '' });
    setAddingExp(false);
  }

  async function createCollection(e) {
    e.preventDefault();
    await collectionMutation.mutateAsync({ action: 'create', data: { ...colForm, project_id: projectId, amount: Number(colForm.amount) || 0 } });
    setColForm({ description: '', amount: '', received_date: '', payment_method: 'bank_transfer', reference_number: '' });
    setAddingCol(false);
  }

  function startEditInv(inv) {
    setEditingInv(inv.id);
    setEditInvForm({
      description: inv.description,
      planned_amount: inv.planned_amount,
      actual_amount: inv.actual_amount ?? '',
      planned_date: inv.planned_date || '',
      actual_invoice_date: inv.actual_invoice_date || '',
      status: inv.status,
    });
  }
  async function saveInv(id) {
    const data = {
      ...editInvForm,
      planned_amount: Number(editInvForm.planned_amount) || 0,
      actual_amount: editInvForm.actual_amount !== '' ? Number(editInvForm.actual_amount) : null,
    };
    await invoiceMutation.mutateAsync({ action: 'update', id, data });
    setEditingInv(null);
  }
  async function deleteInv(id) {
    if (!(await confirmDialog({ title: 'Delete invoice', description: 'Delete this invoice?', confirmText: 'Delete', destructive: true }))) return;
    await invoiceMutation.mutateAsync({ action: 'delete', id });
  }

  function startEditExp(exp) {
    setEditingExp(exp.id);
    setEditExpForm({
      description: exp.description,
      category: exp.category,
      vendor: exp.vendor || '',
      planned_amount: exp.planned_amount,
      actual_amount: exp.actual_amount ?? '',
      planned_date: exp.planned_date || '',
      actual_date: exp.actual_date || '',
      status: exp.status,
    });
  }
  async function saveExp(id) {
    const data = {
      ...editExpForm,
      planned_amount: Number(editExpForm.planned_amount) || 0,
      actual_amount: editExpForm.actual_amount !== '' ? Number(editExpForm.actual_amount) : null,
    };
    await expenseMutation.mutateAsync({ action: 'update', id, data });
    setEditingExp(null);
  }
  async function deleteExp(id) {
    if (!(await confirmDialog({ title: 'Delete expense', description: 'Delete this expense?', confirmText: 'Delete', destructive: true }))) return;
    await expenseMutation.mutateAsync({ action: 'delete', id });
  }

  function startEditCol(col) {
    setEditingCol(col.id);
    setEditColForm({ description: col.description, amount: col.amount, received_date: col.received_date || '', payment_method: col.payment_method || 'bank_transfer', reference_number: col.reference_number || '' });
  }
  async function saveCol(id) {
    await collectionMutation.mutateAsync({ action: 'update', id, data: { ...editColForm, amount: Number(editColForm.amount) || 0 } });
    setEditingCol(null);
  }
  async function deleteCol(id) {
    if (!(await confirmDialog({ title: 'Delete collection', description: 'Delete this collection?', confirmText: 'Delete', destructive: true }))) return;
    await collectionMutation.mutateAsync({ action: 'delete', id });
  }

  // Invoice KPIs
  // Planned: all non-cancelled invoices → planned_amount
  const plannedInvoiced = invoices.filter(i => i.status !== 'cancelled').reduce((s, i) => s + (i.planned_amount || 0), 0);
  // Actual: invoices with status invoiced/paid/partial/overdue → actual_amount fallback planned_amount
  const actualInvoiced = invoices.filter(i => ['invoiced','paid','partial','overdue'].includes(i.status)).reduce((s, i) => s + (i.actual_amount || i.planned_amount || 0), 0);

  // Expense KPIs
  // Planned: all non-cancelled expenses → planned_amount
  const plannedExpenses = expenses.filter(e => e.status !== 'cancelled').reduce((s, e) => s + (e.planned_amount || 0), 0);
  // Actual: committed/paid expenses → actual_amount fallback planned_amount
  const actualExpenses = expenses.filter(e => ['committed','paid'].includes(e.status)).reduce((s, e) => s + (e.actual_amount || e.planned_amount || 0), 0);

  const totalReceived = collections.reduce((s, c) => s + (c.amount || 0), 0);
  const remainingToCollect = actualInvoiced - totalReceived;
  const budget = project?.contract_value || 0;
  const exceedsInvoiced = actualExpenses > actualInvoiced && actualInvoiced > 0;
  const exceedsBudget = budget > 0 && plannedExpenses > budget;
  const hasWarning = exceedsInvoiced || exceedsBudget;

  // Approved / implemented change orders adjust the contract value & costs
  const approvedCOs = changeOrders.filter(co => ['approved', 'implemented'].includes(co.status));
  const coRevenue = approvedCOs.reduce((s, co) => s + (co.co_selling || 0), 0);
  const coCost = approvedCOs.reduce((s, co) => s + (co.co_cost || 0), 0);
  const revisedContractValue = budget + coRevenue;
  const revisedCosts = actualExpenses + coCost;
  const revisedMargin = revisedContractValue > 0 ? Math.round(((revisedContractValue - revisedCosts) / revisedContractValue) * 100) : 0;
  const coDelta = coRevenue;

  if (loading) return <SkeletonTable columns={5} rows={6} />;

  return (
    <div className="space-y-6">
      {hasWarning && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-300 rounded-lg text-red-800">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            {exceedsBudget && <p><strong>Budget overrun:</strong> Planned expenses ({formatCurrency(plannedExpenses, 'SAR')}) exceed the project budget ({formatCurrency(budget, 'SAR')}) by {formatCurrency(plannedExpenses - budget, 'SAR')}.</p>}
            {exceedsInvoiced && !exceedsBudget && <p><strong>Actual expenses exceed actual invoiced:</strong> Actual expenses ({formatCurrency(actualExpenses, 'SAR')}) exceed actual invoiced ({formatCurrency(actualInvoiced, 'SAR')}) by {formatCurrency(actualExpenses - actualInvoiced, 'SAR')}.</p>}
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-blue-300">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Planned Invoiced</div>
              <div className="text-xl font-semibold text-slate-800">{formatCurrency(plannedInvoiced, 'SAR')}</div>
              <div className="text-xs text-slate-400 mt-0.5">All non-cancelled</div>
            </div>
            <TrendingUp className="w-5 h-5 text-slate-300" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-blue-500">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Actual Invoiced</div>
              <div className="text-xl font-semibold text-slate-800">{formatCurrency(actualInvoiced, 'SAR')}</div>
              <div className="text-xs text-slate-400 mt-0.5">Invoiced / paid / partial</div>
            </div>
            <TrendingUp className="w-5 h-5 text-blue-300" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-emerald-400">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Total Received</div>
              <div className="text-xl font-semibold text-slate-800">{formatCurrency(totalReceived, 'SAR')}</div>
              <div className="text-xs text-slate-400 mt-0.5">{remainingToCollect > 0 ? `${formatCurrency(remainingToCollect, 'SAR')} outstanding` : actualInvoiced > 0 ? 'Fully collected' : 'No invoices yet'}</div>
            </div>
            <Banknote className="w-5 h-5 text-slate-300" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-red-300">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                {exceedsBudget && <AlertTriangle className="w-3 h-3 text-red-400" />} Planned Expenses
              </div>
              <div className={`text-xl font-semibold ${exceedsBudget ? 'text-red-600' : 'text-slate-800'}`}>{formatCurrency(plannedExpenses, 'SAR')}</div>
              <div className="text-xs text-slate-400 mt-0.5">All non-cancelled</div>
            </div>
            <TrendingDown className="w-5 h-5 text-slate-300" />
          </div>
        </div>
        <div className={`rounded-lg shadow-sm p-4 border-l-4 ${exceedsInvoiced ? 'bg-red-50 border-red-500' : 'bg-white border-red-500'}`}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                {exceedsInvoiced && <AlertTriangle className="w-3 h-3 text-red-400" />} Actual Expenses
              </div>
              <div className={`text-xl font-semibold ${exceedsInvoiced ? 'text-red-600' : 'text-slate-800'}`}>{formatCurrency(actualExpenses, 'SAR')}</div>
              <div className="text-xs text-slate-400 mt-0.5">Committed / paid</div>
            </div>
            <TrendingDown className="w-5 h-5 text-red-300" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-amber-400">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Remaining to Collect</div>
              <div className={`text-xl font-semibold ${remainingToCollect > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{formatCurrency(remainingToCollect, 'SAR')}</div>
              <div className="text-xs text-slate-400 mt-0.5">{remainingToCollect > 0 ? 'Still outstanding' : 'Fully collected'}</div>
            </div>
            <AlertCircle className="w-5 h-5 text-slate-300" />
          </div>
        </div>
      </div>

      {/* Change Orders impact on contract value & margin */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-slate-300">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Original Contract</div>
              <div className="text-xl font-semibold text-slate-800">{formatCurrency(budget, 'SAR')}</div>
              <div className="text-xs text-slate-400 mt-0.5">Per contract</div>
            </div>
            <FileEdit className="w-5 h-5 text-slate-300" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-indigo-400">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Approved CO (Revenue)</div>
              <div className="text-xl font-semibold text-indigo-700">{formatCurrency(coRevenue, 'SAR')}</div>
              <div className="text-xs text-slate-400 mt-0.5">{approvedCOs.length} approved / implemented</div>
            </div>
            <TrendingUp className="w-5 h-5 text-indigo-300" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-purple-400">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Change Order Costs</div>
              <div className="text-xl font-semibold text-purple-700">{formatCurrency(coCost, 'SAR')}</div>
              <div className="text-xs text-slate-400 mt-0.5">Approved / implemented</div>
            </div>
            <TrendingDown className="w-5 h-5 text-purple-300" />
          </div>
        </div>
        <div className="bg-emerald-50 rounded-lg shadow-sm p-4 border-l-4 border-emerald-500">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Revised Contract</div>
              <div className="text-xl font-semibold text-emerald-700">{formatCurrency(revisedContractValue, 'SAR')}</div>
              <div className="text-xs text-emerald-600 mt-0.5">
                {coDelta >= 0 ? `+${formatCurrency(coDelta, 'SAR')}` : `-${formatCurrency(Math.abs(coDelta), 'SAR')}`} from COs · Margin {revisedMargin}%
              </div>
            </div>
            <TrendingUp className="w-5 h-5 text-emerald-500" />
          </div>
        </div>
      </div>

      {/* Expenses by Category — Planned vs Actual chart */}
      {!loading && <ExpenseCategoryChart expenses={expenses} currency={project?.currency} />}

      {/* Baseline capture + Cost Variance vs earliest baseline */}
      {!loading && <BaselineManager projectId={projectId} project={project} />}

      {/* Spending trend — actual vs baseline plan over project timeline */}
      {!loading && <SpendingTrendChart expenses={expenses} project={project} />}

      {/* Invoices */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-slate-700 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-500" /> Invoices</h3>
          <Can create>
          <button onClick={() => setAddingInv(v => !v)} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-sm rounded">
            <Plus className="w-4 h-4" /> Add Invoice
          </button>
          </Can>
        </div>
        {addingInv && (
          <form onSubmit={createInvoice} className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <input value={invForm.description} onChange={e => setInvForm(f => ({ ...f, description: e.target.value }))} placeholder="Description *" className={inp} required />
            <input type="number" value={invForm.planned_amount} onChange={e => setInvForm(f => ({ ...f, planned_amount: e.target.value }))} placeholder="Planned Amount" className={inp} min="0" />
            <input type="number" value={invForm.actual_amount || ''} onChange={e => setInvForm(f => ({ ...f, actual_amount: e.target.value }))} placeholder="Actual Amount" className={inp} min="0" />
            <input type="date" value={invForm.planned_date} onChange={e => setInvForm(f => ({ ...f, planned_date: e.target.value }))} placeholder="Planned Date" className={inp} />
            <input type="date" value={invForm.actual_invoice_date || ''} onChange={e => setInvForm(f => ({ ...f, actual_invoice_date: e.target.value }))} placeholder="Actual Date" className={inp} />
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-emerald-500 text-white font-semibold text-sm rounded hover:bg-emerald-400">Save</button>
              <button type="button" onClick={() => setAddingInv(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
            </div>
          </form>
        )}
        {invoices.length === 0 ? (
          <EmptyState
            icon={<TrendingUp className="w-12 h-12 opacity-40" />}
            title="No invoices yet"
            message="Add an invoice to start billing this project against its contract value."
            actions={[
              { label: 'Add Invoice', primary: true, icon: <Plus className="w-4 h-4" />, onClick: () => setAddingInv(true) },
            ]}
          />
        ) : (
          <PanelWrapper title="Invoices" exportData={invoices} exportCols={[
            { key: 'description', label: 'Description' },
            { key: 'planned_amount', label: 'Planned Amount' }, { key: 'actual_amount', label: 'Actual Amount' },
            { key: 'planned_date', label: 'Planned Date' }, { key: 'actual_invoice_date', label: 'Actual Date' },
            { key: 'status', label: 'Status' },
          ]}>
            <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b">
                  <tr>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-right">Planned Amount</th>
                    <th className="px-4 py-3 text-right">Actual Amount</th>
                    <th className="px-4 py-3 text-left">Planned Date</th>
                    <th className="px-4 py-3 text-left">Actual Date</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => {
                    const isEditing = editingInv === inv.id;
                    return (
                      <tr key={inv.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3">{isEditing ? <input value={editInvForm.description} onChange={e => setEditInvForm(f => ({ ...f, description: e.target.value }))} className={inp} /> : <span className="font-medium text-slate-800">{inv.description}</span>}</td>
                        <td className="px-4 py-3 text-right">{isEditing ? <input type="number" value={editInvForm.planned_amount} onChange={e => setEditInvForm(f => ({ ...f, planned_amount: e.target.value }))} className={inp} min="0" /> : <span className="text-slate-600">{formatCurrency(inv.planned_amount, 'SAR')}</span>}</td>
                        <td className="px-4 py-3 text-right">{isEditing ? <input type="number" value={editInvForm.actual_amount ?? ''} onChange={e => setEditInvForm(f => ({ ...f, actual_amount: e.target.value }))} placeholder="Actual" className={inp} min="0" /> : <span className="font-semibold text-slate-800">{inv.actual_amount != null ? formatCurrency(inv.actual_amount, 'SAR') : '—'}</span>}</td>
                        <td className="px-4 py-3">{isEditing ? <input type="date" value={editInvForm.planned_date} onChange={e => setEditInvForm(f => ({ ...f, planned_date: e.target.value }))} className={inp} /> : <span className="text-slate-500">{formatDate(inv.planned_date)}</span>}</td>
                        <td className="px-4 py-3">{isEditing ? <input type="date" value={editInvForm.actual_invoice_date ?? ''} onChange={e => setEditInvForm(f => ({ ...f, actual_invoice_date: e.target.value }))} className={inp} /> : <span className="text-slate-700">{inv.actual_invoice_date ? formatDate(inv.actual_invoice_date) : '—'}</span>}</td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <select value={editInvForm.status} onChange={e => setEditInvForm(f => ({ ...f, status: e.target.value }))} className={inp}>
                              {Object.keys(INV_STATUS_COLORS).map(s => <option key={s} value={s}>{INVOICE_STATUS_LABELS[s] || s}</option>)}
                            </select>
                          ) : <span className={`text-xs px-2 py-0.5 rounded font-semibold ${INV_STATUS_COLORS[inv.status] || 'bg-slate-100 text-slate-600'}`}>{INVOICE_STATUS_LABELS[inv.status] || inv.status}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {isEditing ? (<><button onClick={() => saveInv(inv.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save className="w-4 h-4" /></button><button onClick={() => setEditingInv(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button></>) : (<><Can modify><button onClick={() => startEditInv(inv)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"><Pencil className="w-4 h-4" /></button></Can><Can create><button onClick={() => deleteInv(inv.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button></Can></>)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </PanelWrapper>
        )}
      </div>

      {/* Collections */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-slate-700 flex items-center gap-2"><Banknote className="w-4 h-4 text-blue-500" /> Collections (Received)</h3>
          <Can create>
          <button onClick={() => setAddingCol(v => !v)} className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-white font-semibold text-sm rounded">
            <Plus className="w-4 h-4" /> Add Collection
          </button>
          </Can>
        </div>
        {addingCol && (
          <form onSubmit={createCollection} className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <input value={colForm.description} onChange={e => setColForm(f => ({ ...f, description: e.target.value }))} placeholder="Description *" className={inp} required />
            <input type="number" value={colForm.amount} onChange={e => setColForm(f => ({ ...f, amount: e.target.value }))} placeholder="Amount *" className={inp} min="0" required />
            <input type="date" value={colForm.received_date} onChange={e => setColForm(f => ({ ...f, received_date: e.target.value }))} className={inp} />
            <select value={colForm.payment_method} onChange={e => setColForm(f => ({ ...f, payment_method: e.target.value }))} className={inp}>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input value={colForm.reference_number} onChange={e => setColForm(f => ({ ...f, reference_number: e.target.value }))} placeholder="Reference No." className={inp} />
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-blue-500 text-white font-semibold text-sm rounded hover:bg-blue-400">Save</button>
              <button type="button" onClick={() => setAddingCol(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
            </div>
          </form>
        )}
        {collections.length === 0 ? (
          <EmptyState
            icon={<Banknote className="w-12 h-12 opacity-40" />}
            title="No collections yet"
            message="Record a received payment to track collections against invoiced amounts."
            actions={[
              { label: 'Add Collection', primary: true, icon: <Plus className="w-4 h-4" />, onClick: () => setAddingCol(true) },
            ]}
          />
        ) : (
          <PanelWrapper title="Collections" exportData={collections} exportCols={[
            { key: 'description', label: 'Description' }, { key: 'amount', label: 'Amount' },
            { key: 'received_date', label: 'Received Date' }, { key: 'payment_method', label: 'Method' },
            { key: 'reference_number', label: 'Reference' },
          ]}>
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b">
                  <tr>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-left">Received Date</th>
                    <th className="px-4 py-3 text-left">Method</th>
                    <th className="px-4 py-3 text-left">Reference</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {collections.map(col => {
                    const isEditing = editingCol === col.id;
                    return (
                      <tr key={col.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3">{isEditing ? <input value={editColForm.description} onChange={e => setEditColForm(f => ({ ...f, description: e.target.value }))} className={inp} /> : <span className="font-medium text-slate-800">{col.description}</span>}</td>
                        <td className="px-4 py-3 text-right">{isEditing ? <input type="number" value={editColForm.amount} onChange={e => setEditColForm(f => ({ ...f, amount: e.target.value }))} className={inp} min="0" /> : <span className="font-semibold text-emerald-700">{formatCurrency(col.amount, 'SAR')}</span>}</td>
                        <td className="px-4 py-3">{isEditing ? <input type="date" value={editColForm.received_date} onChange={e => setEditColForm(f => ({ ...f, received_date: e.target.value }))} className={inp} /> : formatDate(col.received_date)}</td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <select value={editColForm.payment_method} onChange={e => setEditColForm(f => ({ ...f, payment_method: e.target.value }))} className={inp}>
                              {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          ) : <span className="text-slate-600">{PAYMENT_METHOD_LABELS[col.payment_method] || col.payment_method}</span>}
                        </td>
                        <td className="px-4 py-3">{isEditing ? <input value={editColForm.reference_number} onChange={e => setEditColForm(f => ({ ...f, reference_number: e.target.value }))} placeholder="Reference" className={inp} /> : <span className="text-slate-600">{col.reference_number || '—'}</span>}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {isEditing ? (<><button onClick={() => saveCol(col.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save className="w-4 h-4" /></button><button onClick={() => setEditingCol(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button></>) : (<><Can modify><button onClick={() => startEditCol(col)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"><Pencil className="w-4 h-4" /></button></Can><Can create><button onClick={() => deleteCol(col.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button></Can></>)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </PanelWrapper>
        )}
      </div>

      {/* Expenses */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-slate-700 flex items-center gap-2"><TrendingDown className="w-4 h-4 text-red-500" /> Expenses</h3>
          <Can create>
          <button onClick={() => setAddingExp(v => !v)} className="flex items-center gap-1 px-3 py-1.5 bg-red-500 hover:bg-red-400 text-white font-semibold text-sm rounded">
            <Plus className="w-4 h-4" /> Add Expense
          </button>
          </Can>
        </div>
        {addingExp && (
          <form onSubmit={createExpense} className="bg-red-50 border border-red-200 rounded-lg p-4 mb-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <input value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))} placeholder="Description *" className={inp} required />
            <select value={expForm.category} onChange={e => setExpForm(f => ({ ...f, category: e.target.value }))} className={inp}>
              {Object.entries(EXPENSE_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input value={expForm.vendor} onChange={e => setExpForm(f => ({ ...f, vendor: e.target.value }))} placeholder="Vendor" className={inp} />
            <input type="number" value={expForm.planned_amount} onChange={e => setExpForm(f => ({ ...f, planned_amount: e.target.value }))} placeholder="Planned Amount" className={inp} min="0" />
            <input type="number" value={expForm.actual_amount || ''} onChange={e => setExpForm(f => ({ ...f, actual_amount: e.target.value }))} placeholder="Actual Amount" className={inp} min="0" />
            <input type="date" value={expForm.planned_date} onChange={e => setExpForm(f => ({ ...f, planned_date: e.target.value }))} placeholder="Planned Date" className={inp} />
            <input type="date" value={expForm.actual_date || ''} onChange={e => setExpForm(f => ({ ...f, actual_date: e.target.value }))} placeholder="Actual Date" className={inp} />
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-red-500 text-white font-semibold text-sm rounded hover:bg-red-400">Save</button>
              <button type="button" onClick={() => setAddingExp(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
            </div>
          </form>
        )}
        {expenses.length === 0 ? (
          <EmptyState
            icon={<TrendingDown className="w-12 h-12 opacity-40" />}
            title="No expenses yet"
            message="Add an expense to track planned and actual project costs."
            actions={[
              { label: 'Add Expense', primary: true, icon: <Plus className="w-4 h-4" />, onClick: () => setAddingExp(true) },
            ]}
          />
        ) : (
          <PanelWrapper title="Expenses" exportData={expenses} exportCols={[
            { key: 'description', label: 'Description' }, { key: 'category', label: 'Category' },
            { key: 'vendor', label: 'Vendor' },
            { key: 'planned_amount', label: 'Planned Amount' }, { key: 'actual_amount', label: 'Actual Amount' },
            { key: 'planned_date', label: 'Planned Date' }, { key: 'actual_date', label: 'Actual Date' },
            { key: 'status', label: 'Status' },
          ]}>
            <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b">
                  <tr>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-left">Category</th>
                    <th className="px-4 py-3 text-left">Vendor</th>
                    <th className="px-4 py-3 text-right">Planned Amount</th>
                    <th className="px-4 py-3 text-right">Actual Amount</th>
                    <th className="px-4 py-3 text-left">Planned Date</th>
                    <th className="px-4 py-3 text-left">Actual Date</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map(exp => {
                    const isEditing = editingExp === exp.id;
                    return (
                      <tr key={exp.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3">{isEditing ? <input value={editExpForm.description} onChange={e => setEditExpForm(f => ({ ...f, description: e.target.value }))} className={inp} /> : <span className="font-medium text-slate-800">{exp.description}</span>}</td>
                        <td className="px-4 py-3">
                          {isEditing ? (<select value={editExpForm.category} onChange={e => setEditExpForm(f => ({ ...f, category: e.target.value }))} className={inp}>{Object.entries(EXPENSE_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>) : <span className="text-slate-600">{EXPENSE_CATEGORY_LABELS[exp.category] || exp.category}</span>}
                        </td>
                        <td className="px-4 py-3">{isEditing ? <input value={editExpForm.vendor} onChange={e => setEditExpForm(f => ({ ...f, vendor: e.target.value }))} placeholder="Vendor" className={inp} /> : <span className="text-slate-600">{exp.vendor || '—'}</span>}</td>
                        <td className="px-4 py-3 text-right">{isEditing ? <input type="number" value={editExpForm.planned_amount} onChange={e => setEditExpForm(f => ({ ...f, planned_amount: e.target.value }))} className={inp} min="0" /> : <span className="text-slate-600">{formatCurrency(exp.planned_amount, 'SAR')}</span>}</td>
                        <td className="px-4 py-3 text-right">{isEditing ? <input type="number" value={editExpForm.actual_amount ?? ''} onChange={e => setEditExpForm(f => ({ ...f, actual_amount: e.target.value }))} placeholder="Actual" className={inp} min="0" /> : <span className="font-semibold text-slate-800">{exp.actual_amount != null ? formatCurrency(exp.actual_amount, 'SAR') : '—'}</span>}</td>
                        <td className="px-4 py-3">{isEditing ? <input type="date" value={editExpForm.planned_date} onChange={e => setEditExpForm(f => ({ ...f, planned_date: e.target.value }))} className={inp} /> : <span className="text-slate-500">{formatDate(exp.planned_date)}</span>}</td>
                        <td className="px-4 py-3">{isEditing ? <input type="date" value={editExpForm.actual_date ?? ''} onChange={e => setEditExpForm(f => ({ ...f, actual_date: e.target.value }))} className={inp} /> : <span className="text-slate-700">{exp.actual_date ? formatDate(exp.actual_date) : '—'}</span>}</td>
                        <td className="px-4 py-3">
                          {isEditing ? (<select value={editExpForm.status} onChange={e => setEditExpForm(f => ({ ...f, status: e.target.value }))} className={inp}>{Object.entries(EXPENSE_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>) : <span className="text-xs px-2 py-0.5 rounded font-semibold bg-slate-100 text-slate-600">{EXPENSE_STATUS_LABELS[exp.status] || exp.status}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {isEditing ? (<><button onClick={() => saveExp(exp.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save className="w-4 h-4" /></button><button onClick={() => setEditingExp(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button></>) : (<><Can modify><button onClick={() => startEditExp(exp)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"><Pencil className="w-4 h-4" /></button></Can><Can create><button onClick={() => deleteExp(exp.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button></Can></>)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </PanelWrapper>
        )}
      </div>
    </div>
  );
}

const inp = 'border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';