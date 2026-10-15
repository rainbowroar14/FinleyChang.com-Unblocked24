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

const API = 'https://pntixrcmuhorvpcrhmim.supabase.co/rest/v1/notes'
const KEY = 'sb_publishable_imt_ECRX2UEGTipRK9oWow_nhaLSRv8'
const MAX_LENGTH = 100

const board = document.getElementById('board')
const hint = document.getElementById('hint')
const ghost = document.getElementById('ghost')
const input = document.getElementById('note-input')
const count = document.getElementById('count')
const hintText = document.getElementById('place-hint')
const errorEl = document.getElementById('error')
const statusEl = document.getElementById('status')
const statusText = document.getElementById('status-text')
const colorsEl = document.getElementById('colors')

const noteNodes = new Map()
let notes = []
let color = COLORS[0]
let drag = null
let lastPlace = 0

function textOn(hex) {
  const h = String(hex || '').replace('#', '')
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

function nextZ() {
  return notes.reduce((max, note) => Math.max(max, note.z || 0), 0) + 1
}

function setStatus(kind, text) {
  statusEl.className = 'status status-' + kind
  statusText.textContent = text
}

function showError(message) {
  errorEl.hidden = !message
  errorEl.textContent = message || ''
}

async function api(path, options) {
  const response = await fetch(API + path, {
    method: options.method,
    headers: {
      apikey: KEY,
      Authorization: 'Bearer ' + KEY,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Could not reach the board')
  }
  if (response.status === 204) return null
  return response.json()
}

function paint(note) {
  let el = noteNodes.get(note.id)
  if (!el) {
    el = document.createElement('article')
    el.className = 'note'
    el.addEventListener('pointerdown', onNoteDown)
    noteNodes.set(note.id, el)
    board.appendChild(el)
  }
  el.dataset.id = note.id
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', note.body)
  if (!(drag && drag.id === note.id)) {
    el.style.left = note.x + '%'
    el.style.top = note.y + '%'
  }
  el.style.background = note.color
  el.style.color = textOn(note.color)
  el.style.zIndex = String(note.z)
  el.style.setProperty('--tilt', (note.tilt || 0) + 'deg')
  el.classList.toggle('dragging', Boolean(drag && drag.id === note.id))
  if (el.textContent !== note.body) el.textContent = note.body
  board.appendChild(el)
}

function render() {
  const ids = new Set(notes.map((note) => note.id))
  for (const [id, el] of noteNodes) {
    if (!ids.has(id)) {
      el.remove()
      noteNodes.delete(id)
    }
  }
  ;[...notes]
    .sort((a, b) => a.z - b.z || new Date(a.created_at) - new Date(b.created_at))
    .forEach(paint)
  hint.hidden = notes.length > 0
  const live = statusEl.classList.contains('status-live')
  if (live) statusText.textContent = notes.length + ' on the wall'
}

async function loadNotes() {
  try {
    const data = await api('?select=id,body,color,x,y,z,tilt,created_at&order=z.asc&limit=800', {
      method: 'GET',
    })
    const held = drag && notes.find((note) => note.id === drag.id)
    notes = data || []
    if (held) {
      const index = notes.findIndex((note) => note.id === held.id)
      if (index >= 0) notes[index] = held
    }
    setStatus('live', notes.length + ' on the wall')
    showError('')
    render()
  } catch (err) {
    setStatus('error', 'Reconnecting')
    showError('The board could not load. Check your connection and refresh.')
  }
}

function pointFromEvent(event) {
  const rect = board.getBoundingClientRect()
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * 100, 6, 94),
    y: clamp(((event.clientY - rect.top) / rect.height) * 100, 8, 92),
  }
}

function updateComposer() {
  const length = input.value.length
  count.textContent = length + '/' + MAX_LENGTH
  count.classList.toggle('full', length === MAX_LENGTH)
  const draft = input.value.trim()
  board.classList.toggle('armed', Boolean(draft))
  hintText.textContent = draft
    ? 'Click the wall to stick it on top.'
    : 'Write something, then click the wall. Drag a note to cover another one.'
  ghost.hidden = !draft
  if (draft) {
    ghost.textContent = draft
    ghost.style.background = color
    ghost.style.color = textOn(color)
  }
}

function selectColor(next) {
  color = next
  for (const button of colorsEl.querySelectorAll('.swatch')) {
    button.classList.toggle('on', button.dataset.color.toLowerCase() === color.toLowerCase())
    button.setAttribute('aria-selected', button.classList.contains('on') ? 'true' : 'false')
  }
  colorsEl.querySelector('.custom').classList.toggle(
    'on',
    !COLORS.some((swatch) => swatch.toLowerCase() === color.toLowerCase()),
  )
  updateComposer()
}

function buildColors() {
  for (const swatch of COLORS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'swatch' + (swatch === color ? ' on' : '')
    button.dataset.color = swatch
    button.style.background = swatch
    button.setAttribute('role', 'option')
    button.setAttribute('aria-label', swatch)
    button.setAttribute('aria-selected', swatch === color ? 'true' : 'false')
    button.addEventListener('click', () => selectColor(swatch))
    colorsEl.appendChild(button)
  }
  const custom = document.createElement('label')
  custom.className = 'custom'
  const customInput = document.createElement('input')
  customInput.type = 'color'
  customInput.value = '#ffe566'
  customInput.setAttribute('aria-label', 'Custom color')
  customInput.addEventListener('input', () => selectColor(customInput.value.toUpperCase()))
  custom.appendChild(customInput)
  colorsEl.appendChild(custom)
}

async function place(event) {
  if (drag) return
  if (event.target.closest('.note')) return
  const body = input.value.trim().slice(0, MAX_LENGTH)
  if (!body) return
  const now = Date.now()
  if (now - lastPlace < 400) return
  lastPlace = now
  const spot = pointFromEvent(event)
  const draft = {
    body,
    color,
    x: spot.x,
    y: spot.y,
    z: nextZ(),
    tilt: Math.round(Math.random() * 8 - 4),
  }
  try {
    const created = await api('', { method: 'POST', body: draft })
    const note = Array.isArray(created) ? created[0] : created
    notes.push(note)
    input.value = ''
    updateComposer()
    showError('')
    render()
  } catch (err) {
    showError('That note did not stick. Try again.')
  }
}

function moveDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const note = notes.find((item) => item.id === drag.id)
  const el = noteNodes.get(drag.id)
  const rect = board.getBoundingClientRect()
  if (!note || !el || rect.width === 0 || rect.height === 0) return
  note.x = clamp(drag.startX + ((event.clientX - drag.originX) / rect.width) * 100, 0, 100)
  note.y = clamp(drag.startY + ((event.clientY - drag.originY) / rect.height) * 100, 0, 100)
  drag.x = note.x
  drag.y = note.y
  el.style.left = note.x + '%'
  el.style.top = note.y + '%'
  el.style.zIndex = String(note.z)
}

async function finishDrag(event) {
  if (!drag || (event && event.pointerId !== drag.pointerId)) return
  const saved = drag
  drag = null
  document.body.classList.remove('dragging-note')
  window.removeEventListener('pointermove', moveDrag)
  window.removeEventListener('pointerup', finishDrag)
  window.removeEventListener('pointercancel', finishDrag)
  const el = noteNodes.get(saved.id)
  if (el) el.classList.remove('dragging')
  try {
    await api('?id=eq.' + saved.id, {
      method: 'PATCH',
      body: { x: saved.x, y: saved.y, z: saved.z },
    })
    showError('')
  } catch (err) {
    showError('The move did not save. Drag the note again.')
  }
}

function onNoteDown(event) {
  if (input.value.trim()) return
  if (event.button != null && event.button !== 0) return
  const note = notes.find((item) => item.id === event.currentTarget.dataset.id)
  if (!note) return
  event.preventDefault()
  event.stopPropagation()
  try {
    event.currentTarget.setPointerCapture(event.pointerId)
  } catch (err) {
    /* Window listeners still follow the pointer if capture is unavailable. */
  }
  note.z = nextZ()
  drag = {
    id: note.id,
    pointerId: event.pointerId,
    originX: event.clientX,
    originY: event.clientY,
    startX: note.x,
    startY: note.y,
    x: note.x,
    y: note.y,
    z: note.z,
  }
  document.body.classList.add('dragging-note')
  window.addEventListener('pointermove', moveDrag)
  window.addEventListener('pointerup', finishDrag)
  window.addEventListener('pointercancel', finishDrag)
  const el = noteNodes.get(note.id)
  if (el) {
    el.classList.add('dragging')
    el.style.zIndex = String(note.z)
  }
}

board.addEventListener('pointermove', (event) => {
  if (!input.value.trim() || event.pointerType !== 'mouse') return
  const spot = pointFromEvent(event)
  ghost.style.left = spot.x + '%'
  ghost.style.top = spot.y + '%'
  ghost.hidden = false
})
board.addEventListener('pointerleave', () => {
  if (!drag) ghost.hidden = true
})
board.addEventListener('click', place)
document.getElementById('composer').addEventListener('submit', (event) => event.preventDefault())
input.addEventListener('input', () => {
  if (input.value.length > MAX_LENGTH) input.value = input.value.slice(0, MAX_LENGTH)
  updateComposer()
})

buildColors()
updateComposer()
loadNotes()
window.setInterval(loadNotes, 4000)
