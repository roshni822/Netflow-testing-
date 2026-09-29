// Shared - EmptyState.jsx
// Minimal, on-brand empty state: a warm heading, optional subtext, an optional
// icon and an optional call-to-action. Callers pass their own `action` element
// (a Link or button) so routing/permissions stay in the page.


export default function EmptyState({ title, description, action, icon, className = '' }) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}
    >
      {icon && (
        <div className="mb-3 w-11 h-11 rounded-full bg-surface-3 text-fg-subtle flex items-center justify-center">
          {icon}
        </div>
      )}
      <h2 className="text-sm font-medium text-fg">{title}</h2>
      {description && <p className="mt-1 text-xs text-fg-muted max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
