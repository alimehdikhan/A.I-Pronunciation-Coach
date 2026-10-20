import { useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import { useSettings } from '@/store/settings'

/**
 * Keeps the learner profile (first language, goal, tip language) in step with the server, which
 * uses it for drill order, the starter sound and the coach. When a name is first used here, the
 * server's saved profile wins over this browser's defaults; after that, changes made here are saved.
 */
export function useProfileSync() {
  const username = useSettings((s) => s.username)
  const nativeLanguage = useSettings((s) => s.nativeLanguage)
  const goal = useSettings((s) => s.goal)
  const tipLanguage = useSettings((s) => s.tipLanguage)
  const loadedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!username || loadedFor.current === username) return
    let cancelled = false
    api
      .learnerProfile(username)
      .then((saved) => {
        if (cancelled) return
        const local = useSettings.getState()
        const serverHasProfile = saved.first_language || saved.goal !== 'understood' || saved.tip_language !== 'English'
        if (serverHasProfile) {
          local.setNativeLanguage(saved.first_language)
          local.setGoal(saved.goal)
          local.setTipLanguage(saved.tip_language)
        }
        loadedFor.current = username
      })
      .catch(() => {
        loadedFor.current = username // someone else's name or offline: keep local settings
      })
    return () => {
      cancelled = true
    }
  }, [username])

  useEffect(() => {
    if (!username || loadedFor.current !== username) return
    const timer = window.setTimeout(() => {
      void api.saveLearnerProfile(username, { first_language: nativeLanguage, goal, tip_language: tipLanguage }).catch(() => undefined)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [username, nativeLanguage, goal, tipLanguage])
}
