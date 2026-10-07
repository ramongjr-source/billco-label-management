export function BillcoLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`billco-logo ${className}`} role="img" aria-label="Billco Corporation">
      <span className="billco-initial" aria-hidden="true">B</span>
      <span className="billco-wordmark" aria-hidden="true">
        <span className="billco-name">ILLCO</span>
        <span className="billco-corporation">CORPORATION</span>
      </span>
    </span>
  )
}
