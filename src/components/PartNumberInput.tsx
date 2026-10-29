import { useEffect, useRef, useState } from 'react'
import { searchProducts } from '../data/productLookup'
import type { Product } from '../data/products'
import { partNumberKey } from '../../shared/partNumber'

interface Props {
  value: string
  invalid: boolean
  onChange: (value: string) => void
  onSelect: (part: string) => void
}

export function PartNumberInput({ value, invalid, onChange, onSelect }: Props) {
  const [results, setResults] = useState<Product[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState<string | null>(null)
  const generation = useRef(0)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (query === null || !query.trim()) return
    const id = ++generation.current
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const matches = await searchProducts(query, controller.signal)
        if (id !== generation.current) return
        setResults(matches)
        setMessage(matches.length ? `${matches.length} suggestions available.` : 'No matching products.')
      } catch {
        if (id === generation.current && !controller.signal.aborted) setMessage('Product search is unavailable. Please try again.')
      }
    }, 100)
    return () => { clearTimeout(timer); controller.abort(); generation.current++ }
  }, [query])

  useEffect(() => {
    if (highlight >= 0) list.current?.children[highlight]?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  // Clear, successful lookup, and external changes invalidate pending suggestions.
  useEffect(() => {
    if (value !== query) { generation.current++; setOpen(false); setResults([]); setQuery(null) }
  }, [value, query])

  function close() { generation.current++; setOpen(false); setQuery(null); setResults([]); setHighlight(-1) }
  function select(part: string) { close(); onSelect(part) }

  return <div className="part-autocomplete" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) close()
  }}>
    <input id="part-number" value={value} required autoComplete="off"
      placeholder="Enter a part number or description" aria-describedby="product-search-help product-search-status"
      aria-invalid={invalid} aria-autocomplete="list" aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? 'part-suggestions' : undefined}
      aria-activedescendant={open && highlight >= 0 ? `part-suggestion-${highlight}` : undefined}
      onChange={(event) => {
        generation.current++; setResults([]); setHighlight(-1); setMessage('Searching products…')
        setOpen(Boolean(event.target.value.trim())); setQuery(event.target.value); onChange(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') { event.preventDefault(); close() }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length) {
          event.preventDefault(); setOpen(true)
          setHighlight((current) => event.key === 'ArrowDown'
            ? (current + 1) % results.length : (current <= 0 ? results.length - 1 : current - 1))
        }
        if (event.key === 'Enter') {
          const exact = results.filter((result) => partNumberKey(result.partNumber) === partNumberKey(value))
          const selected = open && highlight >= 0 ? results[highlight] : exact.length === 1 ? exact[0] : undefined
          if (selected) { event.preventDefault(); select(selected.partNumber) }
          else close() // Form submit performs immediate exact lookup, even before suggestions arrive.
        }
      }} />
    {open && <div className="suggestions-panel">
      <ul id="part-suggestions" role="listbox" aria-label="Matching products" ref={list}>
        {results.map((product, index) => <li key={product.partNumber} id={`part-suggestion-${index}`}
          role="option" aria-selected={highlight === index} onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setHighlight(index)} onClick={() => select(product.partNumber)}>
          <strong>{product.partNumber}</strong><span>{product.description}</span>
        </li>)}
      </ul>
      <p role="status" className={results.length ? 'sr-only' : 'suggestions-message'}>{message}</p>
    </div>}
  </div>
}
