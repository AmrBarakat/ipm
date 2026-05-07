import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import PanelWrapper from '@/components/ui/PanelWrapper';
import { formatCurrency, formatDate, INVOICE_STATUS_LABELS, EXPENSE_CATEGORY_LABELS, EXPENSE_STATUS_LABELS } from '@/lib/constants';
import { Plus, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';

const INV_STATUS_COLORS = {
  planned: 'bg-slate-100 text-slate-600',
  invoiced: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-800',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-200 text-slate-500',
};

export default function TabFinancials({ projectId, project }) {
  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingInv, setAddingInv] = useState(false);
  const [addingExp, setAddingExp] = useState(false);
  const [invForm, setInvForm] = useState({ description: '', planned_amount: '', planned_date: '' });
  const [expForm, setExpForm] = useState({ description: '', category: 'material', planned_amount: '', planned_date: '', vendor: '' });

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const [inv, exp] = await Promise.all([
      base44.entities.Invoice.filter({ project_id: projectId }, 'planned_date', 100),
      base44.entities.Expense.filter({ project_id: projectId }, 'planned_date', 100),
    ]);
    setInvoices(inv);
    setExpenses(exp);
    setLoading(false);
  }

  async function createInvoice(e) {
    e.preventDefault();
    await base44.entities.Invoice.create({ ...invForm, project_id: projectId, planned_amount: Number(invForm.planned_amount) || 0 });
    setInvForm({ description: '', planned_amount: '', planned_date: '' });
    setAddingInv(false);
    load();
  }

  async function createExpense(e) {
    e.preventDefault();
    await base44.entities.Expense.create({ ...expForm, project_id: projectId, planned_amount: Number(expForm.planned_amount) || 0 });
    setExpForm({ description: '', category: 'material', planned_amount: '', planned_date: '', vendor: '' });
    setAddingExp(false);
    load();
  }

  const totalInvoiced = invoices.reduce((s, i) => s + (i.planned_amount || 0), 0);
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.paid_amount || i.actual_amount || i.planned_amount || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.actual_amount || e.planned_amount || 0), 0);

  const budget = project?.contract_value || 0;
  const exceedsInvoiced = totalExpenses > totalInvoiced && totalInvoiced > 0;
  const exceedsBudget = budget > 0 && totalExpenses > budget;
  const hasWarning = exceedsInvoiced || exceedsBudget;

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      {/* Warning banner */}
      {hasWarning && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-300 rounded-lg text-red-800">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            {exceedsBudget && (
              <p><strong>Budget overrun:</strong> Total expenses ({formatCurrency(totalExpenses, 'SAR')}) exceed the project budget ({formatCurrency(budget, 'SAR')}) by {formatCurrency(totalExpenses - budget, 'SAR')}.</p>
            )}
            {exceedsInvoiced && !exceedsBudget && (
              <p><strong>Expenses exceed invoiced amount:</strong> Total expenses ({formatCurrency(totalExpenses, 'SAR')}) exceed total invoiced ({formatCurrency(totalInvoiced, 'SAR')}) by {formatCurrency(totalExpenses - totalInvoiced, 'SAR')}.</p>
            )}
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 text-center">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Invoiced</div>
          <div className="text-lg font-bold text-slate-800">{formatCurrency(totalInvoiced, 'SAR')}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 text-center">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Paid</div>
          <div className="text-lg font-bold text-emerald-700">{formatCurrency(totalPaid, 'SAR')}</div>
        </div>
        <div className={`rounded-lg shadow-sm p-4 text-center ${hasWarning ? 'bg-red-50 border-2 border-red-400' : 'bg-white'}`}>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1 flex items-center justify-center gap-1">
            {hasWarning && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
            Total Expenses
          </div>
          <div className={`text-lg font-bold ${hasWarning ? 'text-red-600' : 'text-red-700'}`}>{formatCurrency(totalExpenses, 'SAR')}</div>
        </div>
      </div>

      {/* Invoices */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-slate-700 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-500" /> Invoices</h3>
          <button onClick={() => setAddingInv(v => !v)}
            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-sm rounded">
            <Plus className="w-4 h-4" /> Add Invoice
          </button>
        </div>

        {addingInv && (
          <form onSubmit={createInvoice} className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <input value={invForm.description} onChange={e => setInvForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description *" className={inp} required />
            <input type="number" value={invForm.planned_amount} onChange={e => setInvForm(f => ({ ...f, planned_amount: e.target.value }))}
              placeholder="Planned Amount" className={inp} min="0" />
            <input type="date" value={invForm.planned_date} onChange={e => setInvForm(f => ({ ...f, planned_date: e.target.value }))} className={inp} />
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-emerald-500 text-white font-semibold text-sm rounded hover:bg-emerald-400">Save</button>
              <button type="button" onClick={() => setAddingInv(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
            </div>
          </form>
        )}

        {invoices.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm py-8 text-center text-slate-400 text-sm">No invoices yet.</div>
        ) : (
          <PanelWrapper
            title="Invoices"
            exportData={invoices}
            exportCols={[
              { key: 'description', label: 'Description' },
              { key: 'planned_amount', label: 'Planned Amount' },
              { key: 'actual_amount', label: 'Actual Amount' },
              { key: 'planned_date', label: 'Planned Date' },
              { key: 'actual_invoice_date', label: 'Invoice Date' },
              { key: 'status', label: 'Status' },
              { key: 'invoice_number', label: 'Invoice No.' },
            ]}
          >
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b">
                <tr>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-right">Planned</th>
                  <th className="px-4 py-3 text-left">Planned Date</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{inv.description}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(inv.planned_amount, 'SAR')}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(inv.planned_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-semibold ${INV_STATUS_COLORS[inv.status] || 'bg-slate-100 text-slate-600'}`}>
                        {INVOICE_STATUS_LABELS[inv.status] || inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
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
          <button onClick={() => setAddingExp(v => !v)}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-500 hover:bg-red-400 text-white font-semibold text-sm rounded">
            <Plus className="w-4 h-4" /> Add Expense
          </button>
        </div>

        {addingExp && (
          <form onSubmit={createExpense} className="bg-red-50 border border-red-200 rounded-lg p-4 mb-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <input value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description *" className={inp} required />
            <select value={expForm.category} onChange={e => setExpForm(f => ({ ...f, category: e.target.value }))} className={inp}>
              {Object.entries(EXPENSE_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input value={expForm.vendor} onChange={e => setExpForm(f => ({ ...f, vendor: e.target.value }))} placeholder="Vendor" className={inp} />
            <input type="number" value={expForm.planned_amount} onChange={e => setExpForm(f => ({ ...f, planned_amount: e.target.value }))}
              placeholder="Planned Amount" className={inp} min="0" />
            <input type="date" value={expForm.planned_date} onChange={e => setExpForm(f => ({ ...f, planned_date: e.target.value }))} className={inp} />
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-red-500 text-white font-semibold text-sm rounded hover:bg-red-400">Save</button>
              <button type="button" onClick={() => setAddingExp(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
            </div>
          </form>
        )}

        {expenses.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm py-8 text-center text-slate-400 text-sm">No expenses yet.</div>
        ) : (
          <PanelWrapper
            title="Expenses"
            exportData={expenses}
            exportCols={[
              { key: 'description', label: 'Description' },
              { key: 'category', label: 'Category' },
              { key: 'vendor', label: 'Vendor' },
              { key: 'planned_amount', label: 'Planned Amount' },
              { key: 'actual_amount', label: 'Actual Amount' },
              { key: 'planned_date', label: 'Date' },
              { key: 'status', label: 'Status' },
              { key: 'reference_number', label: 'Ref No.' },
            ]}
          >
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b">
                <tr>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-left">Category</th>
                  <th className="px-4 py-3 text-left">Vendor</th>
                  <th className="px-4 py-3 text-right">Planned</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(exp => (
                  <tr key={exp.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{exp.description}</td>
                    <td className="px-4 py-3 text-slate-600">{EXPENSE_CATEGORY_LABELS[exp.category] || exp.category}</td>
                    <td className="px-4 py-3 text-slate-600">{exp.vendor || '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(exp.planned_amount, 'SAR')}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(exp.planned_date)}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded font-semibold bg-slate-100 text-slate-600">
                        {EXPENSE_STATUS_LABELS[exp.status] || exp.status}
                      </span>
                    </td>
                  </tr>
                ))}
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
function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}