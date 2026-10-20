import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import type { RefObject } from 'react'

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText)
gsap.defaults({ ease: 'power3.out', duration: 0.7 })

const MOTION_OK = '(prefers-reduced-motion: no-preference)'

export { gsap, ScrollTrigger, SplitText, useGSAP }

/** Masked word-by-word rise for headlines (re-splits on resize). */
export function useHeadlineReveal(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useGSAP(
    () => {
      const el = ref.current
      if (!el?.textContent?.trim()) return
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        SplitText.create(el, {
          type: 'words',
          mask: 'words',
          autoSplit: true,
          onSplit: (self) => gsap.from(self.words, { yPercent: 110, opacity: 0, duration: 0.9, stagger: 0.06, ease: 'expo.out' }),
        })
      })
      return () => mm.revert()
    },
    { dependencies: deps, scope: ref, revertOnUpdate: true },
  )
}

/** Stagger children matching `selector` into view when `deps` change. */
export function useStaggerIn(scope: RefObject<HTMLElement | null>, selector: string, deps: unknown[] = [], vars: gsap.TweenVars = {}) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        // Nothing to animate yet (still loading): skip quietly instead of warning.
        const targets = gsap.utils.toArray<HTMLElement>(selector, scope.current)
        if (targets.length) gsap.from(targets, { y: 24, opacity: 0, scale: 0.985, duration: 0.8, stagger: 0.08, ease: 'expo.out', ...vars })
      })
      return () => mm.revert()
    },
    { dependencies: deps, scope, revertOnUpdate: true },
  )
}

/** Fade-up elements as they scroll into view (batched for grids). */
export function useScrollReveal(scope: RefObject<HTMLElement | null>, selector: string, deps: unknown[] = []) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        const targets = gsap.utils.toArray<HTMLElement>(selector, scope.current)
        if (!targets.length) return
        gsap.set(targets, { opacity: 0, y: 28 })
        ScrollTrigger.batch(targets, {
          start: 'top 92%',
          once: true,
          onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.8, stagger: 0.05, ease: 'expo.out', overwrite: true }),
        })
      })
      return () => mm.revert()
    },
    { dependencies: deps, scope, revertOnUpdate: true },
  )
}
