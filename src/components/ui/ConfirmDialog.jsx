import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';

/**
 * App-wide styled confirmation dialog.
 *
 * Mounts a single Radix AlertDialog at the root and exposes a Promise-returning
 * `confirm()` via `useConfirm()`, so call sites can replace the blocking native
 * `window.confirm()` with an awaitable, styled dialog:
 *
 *   const confirmDialog = useConfirm();
 *   if (!(await confirmDialog({ title: 'Delete 3 tasks?', destructive: true, confirmText: 'Delete' }))) return;
 *
 * `destructive` styles the confirm button red; Escape / overlay click resolves false.
 */
const ConfirmContext = createContext(null);

export function ConfirmDialogProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState({
    title: '', description: '', confirmText: 'Confirm', cancelText: 'Cancel', destructive: false,
  });
  const resolverRef = useRef(null);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      // Resolve any still-pending confirm as cancelled before showing a new one.
      if (resolverRef.current) {
        const prev = resolverRef.current;
        resolverRef.current = null;
        prev(false);
      }
      resolverRef.current = resolve;
      setOpts({
        title: options.title || 'Are you sure?',
        description: options.description || '',
        confirmText: options.confirmText || 'Confirm',
        cancelText: options.cancelText || 'Cancel',
        destructive: options.destructive ?? false,
      });
      setOpen(true);
    });
  }, []);

  const settle = useCallback((result) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    if (r) r(result);
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AlertDialog open={open} onOpenChange={(o) => { if (!o) settle(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts.title}</AlertDialogTitle>
            {opts.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <button
              type="button"
              onClick={() => settle(false)}
              className="inline-flex items-center justify-center px-4 py-2 border border-slate-300 rounded-md text-slate-700 text-sm font-medium hover:bg-slate-100"
            >
              {opts.cancelText}
            </button>
            <button
              type="button"
              onClick={() => settle(true)}
              className={
                opts.destructive
                  ? 'inline-flex items-center justify-center px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-md'
                  : 'inline-flex items-center justify-center px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-semibold rounded-md'
              }
            >
              {opts.confirmText}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmDialogProvider');
  return ctx.confirm;
}