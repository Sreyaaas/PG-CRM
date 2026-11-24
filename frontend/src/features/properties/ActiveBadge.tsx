export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={
        active
          ? 'rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800'
          : 'rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700'
      }
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}
