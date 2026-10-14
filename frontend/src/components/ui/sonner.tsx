import { CheckCircleIcon, InfoIcon, SpinnerIcon, WarningIcon, XCircleIcon } from '@phosphor-icons/react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useSettings } from '@/store/settings'

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useSettings((s) => s.theme)

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CheckCircleIcon weight="fill" className="size-[18px] text-good" />,
        info: <InfoIcon weight="fill" className="size-[18px] text-primary" />,
        warning: <WarningIcon weight="fill" className="size-[18px] text-warn" />,
        error: <XCircleIcon weight="fill" className="size-[18px] text-bad" />,
        loading: <SpinnerIcon className="size-[18px] animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': '18px',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast !shadow-pop !text-[13px] !font-medium',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
