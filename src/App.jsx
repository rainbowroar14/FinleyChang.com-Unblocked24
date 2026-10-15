import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isConfigured, supabase } from './supabase'

const COLORS = [
  '#FFE566',
  '#FFB4A2',
  '#B8F2E6',
  '#A0C4FF',
  '#CDB4DB',
  '#FFD6A5',
  '#CAFFBF',
  '#FF8FAB',
  '#9BF6FF',
  '#F8F7F4',
]

const MAX_LENGTH = 100
const COLUMNS = 'id, body, color, x, y, z, tilt, created_at'

function textOn(hex) {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '#1c1917'
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 160 ? '#1c1917' : '#fffaf3'
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function nextZ(list) {
  return list.reduce((max, note) => Math.max(max, note.z || 0), 0) + 1
}

export default function App() {
  const boardRef = useRef(null)
  const notesRef = useRef([])
  const dragRef = useRef(null)
  const lastPlace = useRef(0)
  const [notes, setNotes] = useState([])
  const [text, setText] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [cursor, setCursor] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const [status, setStatus] = useState(isConfigured ? 'loading' : 'local')
  const [error, setError] = useState('')

  notesRef.current = notes

  const mergeNotes = useCallback((current, incoming) => {
    const held = dragRef.current?.id
    const map = new Map(current.map((note) => [note.id, note]))
    for (const note of incoming) {
      if (note.id === held) continue
      map.set(note.id, note)
    }
    return [...map.values()]
  }, [])

  const loadNotes = useCallback(async () => {
    if (!supabase) return
    const { data, error: loadError } = await supabase
      .from('notes')
      .select(COLUMNS)
      .order('z', { ascending: true })
      .limit(800)

    if (loadError) {
      setError(loadError.message)
      setStatus('error')
      return
    }

    setNotes((current) => mergeNotes(current, data ?? []))
    setStatus('live')
    setError('')
  }, [mergeNotes])

  useEffect(() => {
    if (!supabase) return undefined

    loadNotes()

    const channel = supabase
      .channel('notes-wall')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setNotes((current) => current.filter((note) => note.id !== payload.old?.id))
            return
          }
          if (payload.new) setNotes((current) => mergeNotes(current, [payload.new]))
        },
      )
      .subscribe()

    const poll = window.setInterval(loadNotes, 5000)

    return () => {
      window.clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [loadNotes, mergeNotes])

  const ordered = useMemo(
    () =>
      [...notes].sort(
        (a, b) => a.z - b.z || new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      ),
    [notes],
  )

  function pointFromEvent(event) {
    const rect = boardRef.current.getBoundingClientRect()
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 6, 94),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 8, 92),
    }
  }

  async function place(event) {
    if (dragRef.current) return
    const body = text.trim().slice(0, MAX_LENGTH)
    if (!body) return

    const now = Date.now()
    if (now - lastPlace.current < 400) return
    lastPlace.current = now

    const { x, y } = pointFromEvent(event)
    const draft = {
      body,
      color,
      x,
      y,
      z: nextZ(notesRef.current),
      tilt: Math.round(Math.random() * 8 - 4),
    }

    if (!supabase) {
      setNotes((current) => [
        ...current,
        { ...draft, id: crypto.randomUUID(), created_at: new Date().toISOString() },
      ])
      setText('')
      return
    }

    const { data, error: insertError } = await supabase
      .from('notes')
      .insert(draft)
      .select(COLUMNS)
      .single()

    if (insertError) {
      setError(insertError.message)
      return
    }

    setNotes((current) => mergeNotes(current, [data]))
    setText('')
    setError('')
  }

  function startDrag(event, note) {
    if (text.trim()) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const z = nextZ(notesRef.current)
    dragRef.current = {
      id: note.id,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startX: note.x,
      startY: note.y,
      x: note.x,
      y: note.y,
      z,
    }
    setDraggingId(note.id)
    setNotes((current) => current.map((item) => (item.id === note.id ? { ...item, z } : item)))
  }

  function moveDrag(event) {
    const drag = dragRef.current
    window.__lastMove = {
      hasDrag: Boolean(drag),
      dragPointer: drag?.pointerId,
      eventPointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
    if (!drag || drag.pointerId !== event.pointerId || !boardRef.current) return
    const rect = boardRef.current.getBoundingClientRect()
    const x = clamp(drag.startX + ((event.clientX - drag.originX) / rect.width) * 100, 6, 94)
    const y = clamp(drag.startY + ((event.clientY - drag.originY) / rect.height) * 100, 8, 92)
    drag.x = x
    drag.y = y
    setNotes((current) =>
      current.map((item) => (item.id === drag.id ? { ...item, x, y } : item)),
    )
  }

  async function endDrag(event) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const saved = { id: drag.id, x: drag.x, y: drag.y, z: drag.z }
    if (!supabase) {
      dragRef.current = null
      setDraggingId(null)
      return
    }

    const { error: updateError } = await supabase
      .from('notes')
      .update({ x: saved.x, y: saved.y, z: saved.z })
      .eq('id', saved.id)

    if (dragRef.current?.id === saved.id) {
      dragRef.current = null
      setDraggingId(null)
    }

    if (updateError) setError(updateError.message)
  }

  const draft = text.trim()
  const usingCustom = !COLORS.some((swatch) => swatch.toLowerCase() === color.toLowerCase())

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="mark">Sticky Board</p>
          <p className="tag">
            Up to 100 characters. Pick a color, click the wall, and drag any note over someone else’s.
          </p>
        </div>
        <p className={`status status-${status}`}>
          <span className="dot" />
          {status === 'live' && `${ordered.length} on the wall`}
          {status === 'loading' && 'Connecting'}
          {status === 'local' && 'Only on this screen'}
          {status === 'error' && 'Reconnecting'}
        </p>
      </header>

      <div
        ref={boardRef}
        className={`board ${draft ? 'armed' : ''}`}
        onPointerMove={(event) => {
          if (event.pointerType === 'mouse') setCursor(pointFromEvent(event))
        }}
        onPointerLeave={() => setCursor(null)}
        onClick={place}
      >
        {ordered.map((note) => (
          <article
            key={note.id}
            role="button"
            aria-label={note.body}
            className={note.id === draggingId ? 'note dragging' : 'note'}
            style={{
              left: `${note.x}%`,
              top: `${note.y}%`,
              background: note.color,
              color: textOn(note.color),
              zIndex: note.z,
              '--tilt': `${note.tilt}deg`,
            }}
            onPointerDown={(event) => startDrag(event, note)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {note.body}
          </article>
        ))}

        {cursor && draft && (
          <div
            className="note ghost"
            style={{
              left: `${cursor.x}%`,
              top: `${cursor.y}%`,
              background: color,
              color: textOn(color),
              '--tilt': '-2deg',
            }}
          >
            {draft}
          </div>
        )}

        {ordered.length === 0 && status !== 'loading' && (
          <p className="hint">The wall is empty. Stick the first note.</p>
        )}
      </div>

      <form className="composer" onSubmit={(event) => event.preventDefault()}>
        {status === 'local' && (
          <p className="banner">This wall is still private. Shared notes turn on once the board is connected.</p>
        )}
        <label className="field">
          <span className="sr">Note</span>
          <input
            maxLength={MAX_LENGTH}
            value={text}
            placeholder="Type a note"
            autoFocus
            onChange={(event) => setText(event.target.value.slice(0, MAX_LENGTH))}
          />
          <span className={text.length === MAX_LENGTH ? 'count full' : 'count'}>
            {text.length}/{MAX_LENGTH}
          </span>
        </label>

        <div className="colors" role="listbox" aria-label="Note color">
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              role="option"
              aria-selected={color.toLowerCase() === swatch.toLowerCase()}
              aria-label={swatch}
              className={color.toLowerCase() === swatch.toLowerCase() ? 'swatch on' : 'swatch'}
              style={{ background: swatch }}
              onClick={() => setColor(swatch)}
            />
          ))}
          <label className={usingCustom ? 'custom on' : 'custom'}>
            <span className="sr">Custom color</span>
            <input
              type="color"
              value={/^#[0-9A-Fa-f]{6}$/.test(color) ? color.toLowerCase() : '#ffe566'}
              onChange={(event) => setColor(event.target.value.toUpperCase())}
            />
          </label>
        </div>

        <p className="place-hint">
          {draft
            ? 'Click the wall to stick it on top.'
            : 'Write something, then click the wall. Drag a note to cover another one.'}
        </p>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  )
}
