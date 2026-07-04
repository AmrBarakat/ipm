import { useState } from 'react';
import {
  HelpCircle, ChevronDown, ChevronRight, LayoutDashboard, ListTree,
  Boxes, Wallet, ShieldCheck, BarChart3,
} from 'lucide-react';

const TOPICS = [
  {
    icon: LayoutDashboard,
    title: 'Portfolio & Projects',
    body: (
      <div className="space-y-1.5">
        <p>The <strong>Portfolio</strong> page is your starting point — every project with health, margin, and progress at a glance, plus a financial dashboard for cash flow and bookings.</p>
        <p>Create a project from <strong>Projects → New Project</strong>. Each project opens a detail view with three tab groups: <strong>Plan</strong>, <strong>Commercial</strong>, and <strong>Governance</strong>.</p>
      </div>
    ),
  },
  {
    icon: ListTree,
    title: 'Planning (Plan group)',
    body: (
      <div className="space-y-1.5">
        <p><strong>Overview</strong> — project dashboard with KPIs, BOM procurement status, and financials.</p>
        <p><strong>Gantt</strong> — schedule timeline with dependencies between tasks and WBS items.</p>
        <p><strong>WBS</strong> — work breakdown structure; progress rolls up to milestones automatically.</p>
        <p><strong>Tasks, Milestones, Deliverables</strong> — track work, key dates, and project hand-offs.</p>
      </div>
    ),
  },
  {
    icon: Boxes,
    title: 'Commercial (BOM, Financials, Vendors & POs)',
    body: (
      <div className="space-y-1.5">
        <p><strong>BOM</strong> — bill of materials. Import or extract from documents in the Documents tab; panels are managed as single units (their internal components stay hidden everywhere outside the BOM tab).</p>
        <p><strong>Financials</strong> — invoices, collections, expenses, and change orders with margin tracking.</p>
        <p><strong>Vendors &amp; POs</strong> — purchase orders, delivery notes, and procurement of BOM items grouped by supplier. Use <em>Sync with BOM</em> to refresh the procurement list.</p>
      </div>
    ),
  },
  {
    icon: ShieldCheck,
    title: 'Governance (Documents, Notes, Risks, Assistant)',
    body: (
      <div className="space-y-1.5">
        <p><strong>Documents</strong> — upload contracts, POs, delivery notes; AI extracts BOMs and project plans.</p>
        <p><strong>Notes</strong> — free-text and structured summary notes (PO / delivery-note summaries).</p>
        <p><strong>Risks</strong> — register risks; AI suggests mitigation tasks.</p>
        <p><strong>Assistant</strong> — chat with an AI agent about your project.</p>
      </div>
    ),
  },
  {
    icon: BarChart3,
    title: 'Reports & Calendar',
    body: (
      <div className="space-y-1.5">
        <p><strong>Reports</strong> — generate audience-specific PDF/Excel reports (PM, Finance, Supply Chain, Client, Top Management).</p>
        <p><strong>Calendar</strong> — milestones, PO deliveries, and invoice due dates across all projects.</p>
      </div>
    ),
  },
  {
    icon: Wallet,
    title: 'Settings & Event Log',
    body: (
      <div className="space-y-1.5">
        <p>Set default currency, earned-value method, and fiscal calendar for new projects.</p>
        <p>Toggle notification automations (milestone completion, shipment delays, invoice due, risk mitigation).</p>
        <p>Switch language and light/dark theme. The <strong>Event Log</strong> below shows recent automated and user actions across your projects.</p>
      </div>
    ),
  },
];

export default function HelpSection() {
  const [open, setOpen] = useState(0);
  return (
    <section className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 mb-4">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-md bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
          <HelpCircle className="w-4 h-4" />
        </div>
        <div>
          <h2 className="font-semibold text-slate-800">Help — How to use the app</h2>
          <p className="text-xs text-slate-500">A quick guide to the main areas. Tap a topic to expand.</p>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {TOPICS.map((t, i) => {
          const Icon = t.icon;
          const isOpen = open === i;
          return (
            <div key={i}>
              <button onClick={() => setOpen(isOpen ? -1 : i)} className="flex items-center gap-3 w-full py-3 text-left">
                {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                <Icon className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="text-sm font-medium text-slate-800">{t.title}</span>
              </button>
              {isOpen && <div className="pb-3 pl-8 text-sm text-slate-600 leading-relaxed">{t.body}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}