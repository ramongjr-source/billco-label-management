import { ChevronDown, Menu, Settings, UserRound } from 'lucide-react'
import { BillcoLogo } from './BillcoLogo'

interface HeaderProps {
  menuOpen: boolean
  onToggleMenu: () => void
}

export function Header({ menuOpen, onToggleMenu }: HeaderProps) {
  return (
    <header className="app-header flex items-center text-white">
      <button className="mobile-menu icon-button" type="button" onClick={onToggleMenu} aria-label="Toggle navigation" aria-expanded={menuOpen} aria-controls="main-navigation">
        <Menu size={24} />
      </button>
      <div className="header-brand"><BillcoLogo /></div>
      <div className="platform-heading">
        <div className="platform-title">LABELING PLATFORM</div>
        <div className="platform-subtitle">PACKAGING <span>|</span> SHIPPING <span>|</span> WAREHOUSE <span>|</span> CUSTOMER LABELS</div>
      </div>
      <div className="header-account ml-auto flex items-center">
        <span className="flex items-center gap-2"><UserRound size={19} aria-hidden="true" /> Good Morning, Ramon</span>
        <ChevronDown size={17} aria-hidden="true" />
        <span className="header-divider" />
        <button className="settings-button flex items-center gap-3" type="button" disabled title="Settings are outside this UI prototype."><Settings size={26} /> <span>Settings</span></button>
      </div>
    </header>
  )
}
