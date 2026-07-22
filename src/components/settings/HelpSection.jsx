import { useState } from 'react';
import {
  HelpCircle, ChevronDown, ChevronRight, LayoutDashboard, ListTree,
  Boxes, Wallet, ShieldCheck, BarChart3, Users, FileSearch, Zap,
} from 'lucide-react';

const TOPICS = [
  {
    icon: LayoutDashboard,
    title: 'Portfolio & Projects',
    body: (
      <div className="space-y-1.5">
        <p>The <strong>Portfolio</strong> page is your starting point — every project with health, margin, and progress at a glance, plus a financial dashboard for cash flow and bookings.</p>
        <p><strong>Typical flow:</strong> create a project from <strong>Projects → New Project</strong> (code, name, client, contract value, dates) → open it to plan the schedule, build the BOM, and track delivery.</p>
        <p>Each project detail view has three tab groups: <strong>Plan</strong>, <strong>Commercial</strong>, and <strong>Governance</strong>.</p>
      </div>
    ),
  },
  {
    icon: ListTree,
    title: 'Planning (Plan group)',
    body: (
      <div className="space-y-1.5">
        <p><strong>Overview</strong> — project dashboard with KPIs, BOM procurement status, and financials.</p>
        <p><strong>Gantt</strong> — schedule timeline with dependencies. Drag bars to reschedule (cascades to successors), use the editor for details, toggle <em>Critical</em> &amp; <em>Deps</em>, and run <em>Smart Analysis</em> for delay fixes.</p>
        <p><strong>WBS</strong> — work breakdown structure. Progress rolls up to milestones automatically; use <em>Templates</em> to seed a standard plan and <em>Schedule Assistant</em> for AI-driven adjustments.</p>
        <p><strong>Tasks</strong> — Kanban board; <em>Sync from WBS</em> generates tasks from WBS items and keeps statuses aligned.</p>
        <p><strong>Milestones</strong> — key checkpoints with weights; <em>Auto-link WBS</em> connects them to WBS items so progress is derived.</p>
        <p><strong>Deliverables</strong> — track hand-offs; <em>Auto-Generate from BOM</em> creates deliverables from the BOM, and accepting a deliverable auto-completes its linked milestone.</p>
      </div>
    ),
  },
  {
    icon: Boxes,
    title: 'Commercial (BOM, Financials, Vendors & POs)',
    body: (
      <div className="space-y-1.5">
        <p><strong>BOM</strong> — bill of materials. Import or extract from documents in the Documents tab; panels are managed as single units (their internal components stay hidden everywhere outside the BOM tab). Edit cost/price inline; margin and totals recalculate live.</p>
        <p><strong>Financials</strong> — invoices, collections, expenses, and change orders with margin tracking. Approved change orders flow into the revised contract value and margin automatically.</p>
        <p><strong>Vendors &amp; POs</strong> — purchase orders, delivery notes, and procurement of BOM items grouped by supplier. Use <em>Sync with BOM</em> to refresh the procurement list; record delivery notes to update BOM received quantities.</p>
      </div>
    ),
  },
  {
    icon: FileSearch,
    title: 'Documents & Extraction workflow',
    body: (
      <div className="space-y-1.5">
        <p><strong>Documents</strong> (Governance group) — upload contracts, offers, POs, delivery notes, and engineering files.</p>
        <p><strong>BOM extraction:</strong> open a document → <em>Extract BOM</em> previews recognized items → review &amp; map columns → <em>Save</em> creates BOMItem records. Use the import skill for recurring vendor formats.</p>
        <p><strong>PO / Delivery-note extraction:</strong> extracts line items and posts quantities back to the matching BOM items (ordered → received), with a structured summary note added to Notes.</p>
        <p><strong>Project plan extraction:</strong> pulls milestones and WBS items from a plan document into the project.</p>
      </div>
    ),
  },
  {
    icon: ShieldCheck,
    title: 'Governance (Documents, Notes, Risks, Assistant)',
    body: (
      <div className="space-y-1.5">
        <p><strong>Notes</strong> — free-text and structured summary notes (PO / delivery-note summaries) generated during extraction.</p>
        <p><strong>Risks</strong> — register risks with probability × impact scoring; <em>Suggest Mitigation</em> generates AI mitigation tasks you can create with one click.</p>
        <p><strong>Assistant</strong> — chat with an AI agent about your project schedule and risks; proposed changes can be applied as an atomic batch.</p>
      </div>
    ),
  },
  {
    icon: Users,
    title: 'Roles & Access (view / modify / create)',
    body: (
      <div className="space-y-1.5">
        <p>New sign-ups start as <strong>pending</strong> and are blocked until an admin approves them (Settings → Users, admin-only).</p>
        <p>Approved users get a privilege that controls what they can do:</p>
        <p>• <strong>View</strong> — read-only: see projects, BOM, schedule, financials, and reports. No Add / Edit / Delete.</p>
        <p>• <strong>Modify</strong> — edit existing records, inline edits, drag-to-reschedule, bulk edits.</p>
        <p>• <strong>Create</strong> — everything Modify can do, plus add and delete records and projects.</p>
        <p>Admins bypass all restrictions. Enforcement is both in the UI (controls hidden) and server-side (row-level security), so changes are rejected even if the UI is bypassed.</p>
      </div>
    ),
  },
  {
    icon: Zap,
    title: 'Automations & Notifications',
    body: (
      <div className="space-y-1.5">
        <p>Background automations run on their own and write to the Event Log:</p>
        <p>• <strong>Milestone completion</strong> — auto-completes a milestone when its linked WBS items finish.</p>
        <p>• <strong>WBS progress sync</strong> — rolls WBS progress up to milestones and the project.</p>
        <p>• <strong>Shipment delays</strong> — alerts when a PO passes its expected delivery date.</p>
        <p>• <strong>Invoice due</strong> — alerts ahead of a planned invoice due date.</p>
        <p>Toggle which automations create notifications for you under <strong>Notification Preferences</strong> above.</p>
      </div>
    ),
  },
  {
    icon: BarChart3,
    title: 'Reports & Calendar',
    body: (
      <div className="space-y-1.5">
        <p><strong>Reports</strong> — generate audience-specific PDF/Excel bundles (PM, Finance, Supply Chain, Client, Top Management). Preview before downloading.</p>
        <p><strong>Calendar</strong> — milestones, PO deliveries, and invoice due dates across all projects; click a day to jump to the related task.</p>
      </div>
    ),
  },
  {
    icon: Wallet,
    title: 'Settings',
    body: (
      <div className="space-y-1.5">
        <p>Set default currency, earned-value method, and fiscal calendar for new projects.</p>
        <p>Switch language and light/dark theme. <strong>Remember to Save Changes</strong> — preferences persist to your profile.</p>
        <p>The <strong>Event Log</strong> below (collapsed by default) shows recent automated and user actions across your projects.</p>
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
          <p className="text-xs text-slate-500">A guide to the main areas and the workflows between them. Tap a topic to expand.</p>
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