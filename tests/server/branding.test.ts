import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BillcoLogo } from '../../src/components/BillcoLogo.js'
import { Header } from '../../src/components/Header.js'

test('original logo stays the default; only the dark application header requests white ink', () => {
  const original = renderToStaticMarkup(createElement(BillcoLogo))
  const header = renderToStaticMarkup(createElement(Header, { menuOpen: false, onToggleMenu() {} }))
  assert.match(original, /src="\/assets\/billco-logo\.png"/)
  assert.doesNotMatch(original, /billco-logo-dark/)
  assert.match(header, /src="\/assets\/billco-logo-dark\.svg"/)
  for (const markup of [original, header]) {
    assert.match(markup, /width="457" height="201"/)
    assert.match(markup, /alt="Billco Corporation"/)
  }
})
