import '@fontsource-variable/inter'
import './index.css'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { router } from './App'
import { ApiError } from './lib/api'

// After a deploy, lazily loaded chunks from the previous build no longer exist;
// reload once to pick up the new build instead of showing a broken page.
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('pc-chunk-reload')) return
  sessionStorage.setItem('pc-chunk-reload', '1')
  event.preventDefault()
  window.location.reload()
})
window.addEventListener('load', () => sessionStorage.removeItem('pc-chunk-reload'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return
      toast.error(error instanceof Error ? error.message : 'Something went wrong')
    },
  }),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
          <Toaster position="top-center" />
        </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
)
