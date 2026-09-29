// Shared - Skeleton.jsx
// Shimmer placeholders shown during initial data load. Uses Tailwind's built-in
// animate-pulse (no custom keyframes). Variants mirror real component sizes so
// swapping to real content causes no layout shift.


export function Skeleton({ className = '' }) {
  // surface-3 rather than `line`: the border tone is too faint to read as a
  // placeholder on a white card.
  return <div aria-hidden="true" className={`animate-pulse rounded bg-surface-3 ${className}`} />
}

// Mirrors StatCard5 in Dashboard.jsx
export function StatCardSkeleton() {
  return (
    <div className="bg-surface border border-line rounded-xl p-5 flex items-start gap-4">
      <Skeleton className="w-10 h-10 rounded-lg" />
      <div className="flex-1 space-y-2 py-0.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-6 w-12" />
      </div>
    </div>
  )
}

// Mirrors the list rows in RecentRequests / MyRequestsList
export function ListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <Skeleton className="w-2 h-2 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-2.5 w-1/3" />
      </div>
      <Skeleton className="h-4 w-14 rounded" />
    </div>
  )
}

// For the Forms / Workflows tables; `cols` = number of columns
export function TableRowSkeleton({ cols = 6 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-5 py-4">
          <Skeleton className="h-4 w-full max-w-[8rem]" />
        </td>
      ))}
    </tr>
  )
}
