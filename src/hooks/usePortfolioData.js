import { useEntityList } from '@/hooks/useEntity';

// Portfolio-wide datasets used by the Portfolio Reports mode (and as the
// source for per-project filtering in Project Reports mode).
export function usePortfolioData() {
  const projects    = useEntityList('Project',     null, '-updated_date',  2000);
  const invoices    = useEntityList('Invoice',     null, '-planned_date',  2000);
  const expenses    = useEntityList('Expense',     null, '-planned_date',  2000);
  const collections = useEntityList('Collection',  null, '-received_date', 2000);
  const pos         = useEntityList('PurchaseOrder', null, '-created_date', 2000);
  const risks       = useEntityList('Risk',        null, '-risk_score',   2000);
  const changeOrders = useEntityList('ChangeOrder', null, '-created_date', 2000);

  return {
    projects:    projects.data || [],
    invoices:    invoices.data || [],
    expenses:    expenses.data || [],
    collections: collections.data || [],
    pos:         pos.data || [],
    risks:       risks.data || [],
    changeOrders: changeOrders.data || [],
    isLoading:
      projects.isLoading || invoices.isLoading || expenses.isLoading ||
      collections.isLoading || pos.isLoading || risks.isLoading || changeOrders.isLoading,
  };
}