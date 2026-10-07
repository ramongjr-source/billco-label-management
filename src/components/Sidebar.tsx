import { Boxes, ChevronDown, ChevronUp, Clock3, Database, House, Settings, Truck } from 'lucide-react'
import { labelTypes, type LabelType } from '../data/products'

interface SidebarProps {
  open: boolean
  labelType: LabelType
  onSelectLabelType: (type: LabelType) => void
  onNavigateImport: () => void
  activePage?: 'product-labels' | 'product-import'
  navigationDisabled?: boolean
}

export function Sidebar({ open, labelType, onSelectLabelType, onNavigateImport, activePage = 'product-labels', navigationDisabled = false }: SidebarProps) {
  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`} id="main-navigation">
      <nav aria-label="Main navigation">
        <button className="nav-heading" disabled type="button"><House size={27} fill="currentColor" /> <span>Dashboard</span></button>
        <div className="nav-section product-navigation">
          <div className={`nav-heading${activePage === 'product-labels' ? ' active-section' : ''}`}><Boxes size={27} /> <span>Product Labels</span><ChevronUp size={18} className="ml-auto" /></div>
          <div className="nav-children">
            {labelTypes.map((type) => (
              <button type="button" key={type.id} onClick={() => onSelectLabelType(type.id)} disabled={navigationDisabled} className={activePage === 'product-labels' && labelType === type.id ? 'nav-item nav-item-active' : 'nav-item'} aria-current={activePage === 'product-labels' && labelType === type.id ? 'page' : undefined}>{type.name}</button>
            ))}
          </div>
        </div>
        <div className="nav-section">
          <div className="nav-heading"><Truck size={29} /> <span>Shipping Labels</span><ChevronDown size={18} className="ml-auto" /></div>
          <div className="nav-children"><button className="nav-item" type="button" disabled>Will Call Labels</button><button className="nav-item" type="button" disabled>Pallet Placards</button></div>
        </div>
        <div className="nav-section">
          <div className={`nav-heading${activePage === 'product-import' ? ' active-section' : ''}`}><Database size={27} /> <span>Database</span><ChevronDown size={18} className="ml-auto" /></div>
          <div className="nav-children"><button className="nav-item" type="button" disabled>Products</button><button className="nav-item" type="button" disabled>Customers</button><button className={activePage === 'product-import' ? 'nav-item nav-item-active' : 'nav-item'} type="button" onClick={onNavigateImport} disabled={navigationDisabled} aria-current={activePage === 'product-import' ? 'page' : undefined}>Import Master List</button></div>
        </div>
        <div className="nav-section"><button className="nav-heading" type="button" disabled><Clock3 size={27} /> <span>Print History</span></button></div>
        <div className="nav-section">
          <div className="nav-heading"><Settings size={27} /> <span>Administration</span><ChevronDown size={18} className="ml-auto" /></div>
          <div className="nav-children"><button className="nav-item" type="button" disabled>Printer Setup</button><button className="nav-item" type="button" disabled>User Management</button><button className="nav-item" type="button" disabled>System Settings</button></div>
        </div>
      </nav>
      <p className="sidebar-note">Billco Labeling Platform</p>
    </aside>
  )
}
