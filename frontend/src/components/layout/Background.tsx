/** Quiet backdrop: flat system background with a soft glow at the top of the page. */
export function Background() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      <div className="absolute -top-[40vh] left-1/2 h-[80vh] w-[120vw] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(closest-side,rgb(0_113_227/0.07),transparent)] dark:bg-[radial-gradient(closest-side,rgb(10_132_255/0.12),transparent)]" />
      <div className="absolute -top-[30vh] left-[60%] h-[60vh] w-[60vw] rounded-full bg-[radial-gradient(closest-side,rgb(201_89_221/0.05),transparent)] dark:bg-[radial-gradient(closest-side,rgb(201_89_221/0.08),transparent)]" />
    </div>
  )
}
