// Preserve original artwork by default; dark surfaces explicitly select the white variant.
const billcoLogoUrl = '/assets/billco-logo.png'

export function BillcoLogo({ className = '', variant = 'original' }: { className?: string; variant?: 'original' | 'dark' }) {
  return (
    <img
      className={`billco-logo ${className}`}
      src={variant === 'dark' ? '/assets/billco-logo-dark.svg' : billcoLogoUrl}
      alt="Billco Corporation"
      width={457}
      height={201}
    />
  )
}
