import type { SatoCommand, SatoHistoryPage, SatoRequest } from '../../shared/sato'
import { responseJson } from './printing'

export const generateSatoCommands = (request: SatoRequest) => fetch('/api/sato-commands', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
}).then(responseJson<SatoCommand>)

export const listSatoCommands = (before?: number) => fetch(`/api/sato-commands${before === undefined ? '' : `?before=${before}`}`)
  .then(responseJson<SatoHistoryPage>)
