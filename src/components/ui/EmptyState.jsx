export default function EmptyState({ icon, title, message, actions = [] }) {
  return (
    <div className="text-center py-16 bg-white rounded-lg shadow-sm border border-slate-100">
      {icon && <div className="flex justify-center mb-3 text-slate-300">{icon}</div>}
      <h3 className="text-base font-semibold text-slate-600 mb-1">{title}</h3>
      {message && <p className="text-sm text-slate-400 max-w-md mx-auto mb-5">{message}</p>}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {actions.map((a, i) => (
            <button
              key={i}
              onClick={a.onClick}
              className={`flex items-center gap-1.5 px-4 py-2 rounded font-semibold text-sm transition ${
                a.primary
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-900'
                  : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}