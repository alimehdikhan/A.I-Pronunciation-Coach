import { WarningIcon } from '@phosphor-icons/react'
import { useHealth } from '@/lib/queries'

/**
 * Shown when the server keeps accounts only in a temporary file. Without it the
 * app would quietly lose every account on each restart, which looks to a user
 * like "the login keeps forgetting me".
 */
export function StorageNotice({ className }: { className?: string }) {
  const { data } = useHealth()
  if (!data?.database || data.database.persistent) return null
  return (
    <div role="status" className={`flex gap-3 rounded-2xl bg-warn-soft p-4 text-[14px] leading-relaxed ${className ?? ''}`}>
      <WarningIcon size={20} weight="fill" className="mt-0.5 shrink-0 text-warn" />
      <p>
        <b>Accounts here are temporary.</b> This server has no permanent database yet, so accounts and history are erased
        whenever it restarts or updates. Please do not rely on them until that is fixed.
      </p>
    </div>
  )
}
