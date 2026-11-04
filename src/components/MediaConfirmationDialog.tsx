import { useEffect, useRef } from 'react'
import type { MediaMismatch } from '../data/printing'

export function MediaConfirmationDialog({ mismatch, user, busy, error, onUserChange, onCancel, onConfirm }: {
  mismatch: MediaMismatch | null
  user: string
  busy: boolean
  error: string
  onUserChange: (name: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (mismatch) { if (!dialogRef.current?.open) dialogRef.current?.showModal() }
    else dialogRef.current?.close()
  }, [mismatch])

  return <dialog className="preview-dialog media-dialog" ref={dialogRef} aria-labelledby="media-mismatch-heading" aria-describedby="media-mismatch-instructions" onCancel={event => {
    if (busy) event.preventDefault()
    else onCancel()
  }} onClose={onCancel}>
    {mismatch && <>
      <h2 id="media-mismatch-heading">MEDIA MISMATCH</h2>
      <p className="media-printer-name">{mismatch.printerName}</p>
      <dl className="media-comparison">
        <div><dt>Requested Material</dt><dd>{mismatch.requestedMedia}</dd></div>
        <div><dt>Current Media</dt><dd>{mismatch.currentMedia ?? 'Unknown'}</dd></div>
      </dl>
      <p id="media-mismatch-instructions">Please load {mismatch.requestedMedia} label stock before continuing.</p>
      <div className="field-group"><label htmlFor="media-operator">Operator name</label><input id="media-operator" value={user} maxLength={80} disabled={busy} onChange={event => onUserChange(event.target.value)} autoComplete="name" aria-describedby="media-operator-help" /><p id="media-operator-help" className="field-help">Recorded in the media change history.</p></div>
      {error && <p className="media-error" role="alert">{error}</p>}
      <div className="media-dialog-actions">
        <button className="button button-secondary" type="button" disabled={busy} onClick={onCancel} autoFocus>Cancel</button>
        <button className="button button-primary" type="button" disabled={busy || !user.trim()} onClick={onConfirm}>{busy ? 'Recording…' : 'Media Changed - Continue'}</button>
      </div>
    </>}
  </dialog>
}
