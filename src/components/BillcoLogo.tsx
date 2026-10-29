// Original official artwork, served from the repository's public/assets folder.
const billcoLogoUrl = '/assets/billco-logo.png'

export function BillcoLogo({ className = '' }: { className?: string }) {
  return (
    <img
      className={`billco-logo ${className}`}
      src={billcoLogoUrl}
      alt="Billco Corporation"
      width={457}
      height={201}
    />
  )
}
