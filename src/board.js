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

const ADD_WAIT = 'sticky-add-10'
const DELETE_WAIT = 'sticky-del-10'
const COOLDOWN = 10000
const WORLD = 100000

const noteNodes = new Map()
const peers = new Map()
const remoteDrags = new Map()
const keys = new Set()
const camera = { x: 0, y: 0, zoom: 1 }
const MIN_ZOOM = 0.35
const MAX_ZOOM = 3
let notes = []
let color = COLORS[0]
let drag = null
let lastPlace = 0
let lastSignature = ''
let framed = false
let pointer = null
let pan = null
let blockPlace = false
let room = null
let publishTimer = 0

function clientId() {
  let id = localStorage.getItem('sticky-client')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('sticky-client', id)
  }
  return id
}

function waitLeft(key) {
  return Math.max(0, Number(localStorage.getItem(key) || 0) - Date.now())
}

function markWait(key) {
  localStorage.setItem(key, String(Date.now() + COOLDOWN))
}

function normalizeWord(value) {
  return value
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/(.)\1+/g, '$1')
}

function hasBlockedWord(raw) {
  const cleaned = raw
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/[^a-z]+/g, ' ')
    .trim()
  if (!cleaned) return false
  const tokens = cleaned.split(/\s+/).map(normalizeWord)
  const whole = /^(fuck|fuk|fck|shit|sht|bitch|btch|asshole|cunt|nigger|nigga|niga|faggot|fagot|pussy|whore|slut|retard|dick|cock|kys)$/
  const inside = /fuck|shit|bitch|nigger|nigga|faggot|pussy|whore|asshole|retard/
  if (tokens.some((token) => whole.test(token) || inside.test(token))) return true
  if (tokens.every((token) => token.length <= 2)) {
    const joined = normalizeWord(tokens.join(''))
    return /fuck|fuk|fck|shit|sht|bitch|btch|cunt|nigger|nigga|faggot|pussy|whore|slut|retard|dick|cock/.test(joined)
  }
  return false
}

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
    const label = document.createElement('span')
    label.className = 'note-text'
    const trash = document.createElement('button')
    trash.type = 'button'
    trash.className = 'trash'
    trash.textContent = '×'
    trash.setAttribute('aria-label', 'Delete note')
    trash.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    trash.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      removeNote(el.dataset.id)
    })
    el.append(label, trash)
    noteNodes.set(note.id, el)
    board.appendChild(el)
  }
  el.dataset.id = note.id
  el.setAttribute('aria-label', note.body)
  el.style.background = note.color
  el.style.color = textOn(note.color)
  el.style.zIndex = String(note.z)
  el.style.setProperty('--tilt', (note.tilt || 0) + 'deg')
  el.classList.toggle('dragging', Boolean(drag && drag.id === note.id))
  const label = el.querySelector('.note-text')
  if (label.textContent !== note.body) label.textContent = note.body
}

function noteSignature(list) {
  return list
    .map((note) => [note.id, note.body, note.color, note.x, note.y, note.z, note.tilt].join(':'))
    .join('|')
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
  layout()
  hint.hidden = notes.length > 0
  if (statusEl.classList.contains('status-live')) {
    const label = notes.length + ' on the wall'
    if (statusText.textContent !== label) statusText.textContent = label
  }
}

async function loadNotes() {
  try {
    const data = await api('?select=id,body,color,x,y,z,tilt,created_at&order=z.asc&limit=800', {
      method: 'GET',
    })
    const held = drag && notes.find((note) => note.id === drag.id)
    const next = data || []
    if (held) {
      const index = next.findIndex((note) => note.id === held.id)
      if (index >= 0) next[index] = held
    }
    const signature = noteSignature(next)
    notes = next
    if (!framed && notes.length) {
      framed = true
      const xs = notes.map((note) => Number(note.x))
      const ys = notes.map((note) => Number(note.y))
      const rect = board.getBoundingClientRect()
      camera.x = (Math.min(...xs) + Math.max(...xs)) / 2 - rect.width / 2
      camera.y = (Math.min(...ys) + Math.max(...ys)) / 2 - rect.height / 2
    }
    if (!statusEl.classList.contains('status-live')) setStatus('live', notes.length + ' on the wall')
    if (signature !== lastSignature) {
      lastSignature = signature
      render()
    } else if (statusEl.classList.contains('status-live')) {
      const label = notes.length + ' on the wall'
      if (statusText.textContent !== label) statusText.textContent = label
    }
  } catch (err) {
    setStatus('error', 'Reconnecting')
    showError('The board could not load. Check your connection and refresh.')
  }
}

function worldFromEvent(event) {
  const rect = board.getBoundingClientRect()
  return {
    x: clamp((event.clientX - rect.left) / camera.zoom + camera.x, -WORLD, WORLD),
    y: clamp((event.clientY - rect.top) / camera.zoom + camera.y, -WORLD, WORLD),
  }
}

function positionElement(el, worldX, worldY) {
  el.style.left = (worldX - camera.x) * camera.zoom + 'px'
  el.style.top = (worldY - camera.y) * camera.zoom + 'px'
}

function noteWorld(note) {
  if (drag && drag.id === note.id) return { x: drag.x, y: drag.y }
  const remote = remoteDrags.get(note.id)
  if (remote && Date.now() - remote.at < 1500) return { x: remote.x, y: remote.y }
  return { x: Number(note.x), y: Number(note.y) }
}

function layout() {
  const zoom = camera.zoom
  board.style.setProperty('--zoom', String(zoom))
  board.style.backgroundSize = 28 * zoom + 'px ' + 28 * zoom + 'px'
  board.style.backgroundPosition = -camera.x * zoom + 'px ' + -camera.y * zoom + 'px'
  for (const note of notes) {
    const el = noteNodes.get(note.id)
    if (!el) continue
    const spot = noteWorld(note)
    positionElement(el, spot.x, spot.y)
  }
  if (pointer && input.value.trim()) positionElement(ghost, pointer.x, pointer.y)
  const now = Date.now()
  for (const [id, peer] of peers) {
    if (now - peer.at > 2500) {
      peer.el.remove()
      peers.delete(id)
      continue
    }
    positionElement(peer.el, peer.x, peer.y)
  }
}

function cooldownText() {
  const add = Math.ceil(waitLeft(ADD_WAIT) / 1000)
  const del = Math.ceil(waitLeft(DELETE_WAIT) / 1000)
  const parts = []
  if (add > 0) parts.push('Next note in ' + add + 's')
  if (del > 0) parts.push('Next delete in ' + del + 's')
  return parts.join(' · ')
}

function updateComposer() {
  const length = input.value.length
  const countText = length + '/' + MAX_LENGTH
  if (count.textContent !== countText) count.textContent = countText
  count.classList.toggle('full', length === MAX_LENGTH)
  const draft = input.value.trim()
  board.classList.toggle('armed', Boolean(draft))
  const waiting = cooldownText()
  const nextHint = waiting
    ? waiting
    : draft
      ? 'Click the wall to stick it. WASD or drag empty space to move. Scroll to zoom.'
      : '10 seconds between notes, and 10 seconds between deletes. WASD, drag, or scroll to zoom.'
  if (hintText.textContent !== nextHint) hintText.textContent = nextHint
  const showGhost = Boolean(draft)
  if (ghost.hidden === showGhost) ghost.hidden = !showGhost
  if (showGhost && ghost.textContent !== draft) ghost.textContent = draft
  if (showGhost) {
    ghost.style.background = color
    ghost.style.color = textOn(color)
    if (pointer) positionElement(ghost, pointer.x, pointer.y)
  }
  publishSoon()
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

function serverMessage(detail, fallback) {
  try {
    const parsed = JSON.parse(detail)
    if (parsed.message) return parsed.message
  } catch (err) {
    /* The board sometimes returns plain text. */
  }
  return fallback
}

async function place(event) {
  if (blockPlace) {
    blockPlace = false
    return
  }
  if (drag || pan) return
  if (event.target.closest('article.note')) return
  const body = input.value.trim().slice(0, MAX_LENGTH)
  if (!body) return
  if (waitLeft(ADD_WAIT) > 0) {
    showError('Wait 10 seconds before another note.')
    updateComposer()
    return
  }
  if (hasBlockedWord(body)) {
    showError('That word cannot go on the board.')
    return
  }
  const now = Date.now()
  if (now - lastPlace < 400) return
  lastPlace = now
  const spot = pointer || worldFromEvent(event)
  const draft = {
    body,
    color,
    x: spot.x,
    y: spot.y,
    z: nextZ(),
    tilt: Math.round(Math.random() * 8 - 4),
    client_id: clientId(),
  }
  try {
    const created = await api('', { method: 'POST', body: draft })
    const note = Array.isArray(created) ? created[0] : created
    notes.push(note)
    lastSignature = ''
    markWait(ADD_WAIT)
    input.value = ''
    updateComposer()
    showError('')
    render()
  } catch (err) {
    const message = serverMessage(err.message, 'That note did not stick. Wait 10 seconds and try again.')
    if (/wait|second|minute/i.test(message)) markWait(ADD_WAIT)
    showError(message)
    updateComposer()
  }
}

async function removeNote(id) {
  if (!id) return
  if (waitLeft(DELETE_WAIT) > 0) {
    showError('Wait 10 seconds before another delete.')
    updateComposer()
    return
  }
  try {
    const response = await fetch(API.replace('/notes', '/rpc/remove_note'), {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: 'Bearer ' + KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ note_id: id, client_id: clientId() }),
    })
    if (!response.ok) throw new Error(await response.text())
    notes = notes.filter((note) => note.id !== id)
    lastSignature = ''
    markWait(DELETE_WAIT)
    showError('')
    render()
    updateComposer()
  } catch (err) {
    const message = serverMessage(err.message, 'That note could not be deleted.')
    if (/wait|second|minute/i.test(message)) markWait(DELETE_WAIT)
    showError(message)
    updateComposer()
  }
}

function moveDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const note = notes.find((item) => item.id === drag.id)
  if (!note) return
  note.x = clamp(drag.startX + (event.clientX - drag.originX) / camera.zoom, -WORLD, WORLD)
  note.y = clamp(drag.startY + (event.clientY - drag.originY) / camera.zoom, -WORLD, WORLD)
  drag.x = note.x
  drag.y = note.y
  pointer = worldFromEvent(event)
  layout()
  publishSoon()
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
  publishSoon()
  layout()
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
  publishSoon()
}

function ensurePeer(id) {
  const existing = peers.get(id)
  if (existing) return existing
  const el = document.createElement('div')
  el.className = 'peer'
  const cursor = document.createElement('span')
  cursor.className = 'peer-cursor'
  const card = document.createElement('div')
  card.className = 'peer-card'
  card.hidden = true
  el.append(cursor, card)
  board.appendChild(el)
  const peer = { el, x: 0, y: 0, text: '', color: '#FFE566', at: 0 }
  peers.set(id, peer)
  return peer
}

function applyPeer(payload) {
  if (!payload || !payload.id || payload.id === clientId()) return
  const peer = ensurePeer(payload.id)
  peer.x = Number(payload.x) || 0
  peer.y = Number(payload.y) || 0
  peer.text = String(payload.text || '').slice(0, MAX_LENGTH)
  peer.color = payload.color || '#FFE566'
  peer.at = Date.now()
  const card = peer.el.querySelector('.peer-card')
  const showCard = Boolean(peer.text) && !payload.dragId
  card.hidden = !showCard
  if (showCard) {
    card.textContent = peer.text
    card.style.background = peer.color
    card.style.color = textOn(peer.color)
  }
  if (payload.dragId) {
    remoteDrags.set(payload.dragId, {
      x: Number(payload.dragX),
      y: Number(payload.dragY),
      at: Date.now(),
    })
  }
  layout()
}

function publishSoon() {
  if (publishTimer || !room) return
  publishTimer = window.setTimeout(() => {
    publishTimer = 0
    if (!room) return
    const spot = pointer || { x: camera.x + 80, y: camera.y + 80 }
    room.send({
      type: 'broadcast',
      event: 'here',
      payload: {
        id: clientId(),
        x: spot.x,
        y: spot.y,
        text: input.value.slice(0, MAX_LENGTH),
        color,
        dragId: drag ? drag.id : null,
        dragX: drag ? drag.x : null,
        dragY: drag ? drag.y : null,
      },
    })
  }, 70)
}

function connectLive() {
  const lib = window.supabase
  if (!lib || !lib.createClient) return
  const client = lib.createClient('https://pntixrcmuhorvpcrhmim.supabase.co', KEY)
  room = client.channel('wall-cursors', { config: { broadcast: { self: false } } })
  room.on('broadcast', { event: 'here' }, (message) => {
    const payload = message && message.payload && message.payload.id ? message.payload : message
    applyPeer(payload)
  })
  room.subscribe()
}

function onBoardPointerDown(event) {
  if (event.button != null && event.button !== 0) return
  if (event.target.closest('article.note')) return
  pan = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    moved: false,
  }
  try {
    board.setPointerCapture(event.pointerId)
  } catch (err) {
    /* Dragging still tracks while the pointer stays over the page. */
  }
}

function onBoardPointerMove(event) {
  pointer = worldFromEvent(event)
  if (input.value.trim()) {
    ghost.hidden = false
    ghost.textContent = input.value.trim()
    ghost.style.background = color
    ghost.style.color = textOn(color)
  }
  if (pan && pan.pointerId === event.pointerId) {
    const dx = event.clientX - pan.x
    const dy = event.clientY - pan.y
    pan.x = event.clientX
    pan.y = event.clientY
    pan.travel = (pan.travel || 0) + Math.hypot(dx, dy)
    if (pan.travel > 5) pan.moved = true
    if (pan.moved) {
      camera.x -= dx / camera.zoom
      camera.y -= dy / camera.zoom
      board.classList.add('panning')
    }
  }
  layout()
  publishSoon()
}

function onBoardPointerUp(event) {
  if (!pan || pan.pointerId !== event.pointerId) return
  blockPlace = pan.moved
  pan = null
  board.classList.remove('panning')
}

board.addEventListener('pointerdown', onBoardPointerDown)
board.addEventListener('pointermove', onBoardPointerMove)
board.addEventListener('pointerup', onBoardPointerUp)
board.addEventListener('pointercancel', onBoardPointerUp)
board.addEventListener('pointerleave', () => {
  if (!drag && !input.value.trim()) ghost.hidden = true
})
board.addEventListener('click', place)
board.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    const rect = board.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    const oldZoom = camera.zoom
    const next = clamp(oldZoom * Math.exp(-event.deltaY * 0.0012), MIN_ZOOM, MAX_ZOOM)
    if (next === oldZoom) return
    camera.x = sx / oldZoom + camera.x - sx / next
    camera.y = sy / oldZoom + camera.y - sy / next
    camera.zoom = next
    pointer = worldFromEvent(event)
    layout()
  },
  { passive: false },
)
document.getElementById('composer').addEventListener('submit', (event) => event.preventDefault())
input.addEventListener('input', () => {
  if (input.value.length > MAX_LENGTH) input.value = input.value.slice(0, MAX_LENGTH)
  updateComposer()
})

window.addEventListener('keydown', (event) => {
  if (document.activeElement === input) return
  const key = event.key.toLowerCase()
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
    keys.add(key)
    event.preventDefault()
  }
})
window.addEventListener('keyup', (event) => {
  keys.delete(event.key.toLowerCase())
})
window.addEventListener('blur', () => keys.clear())

let lastFrame = performance.now()
function tick(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000)
  lastFrame = now
  let mx = 0
  let my = 0
  if (keys.has('w') || keys.has('arrowup')) my -= 1
  if (keys.has('s') || keys.has('arrowdown')) my += 1
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1
  if (keys.has('d') || keys.has('arrowright')) mx += 1
  if (mx || my) {
    camera.x += (mx * 760 * dt) / camera.zoom
    camera.y += (my * 760 * dt) / camera.zoom
    layout()
    publishSoon()
  }
  requestAnimationFrame(tick)
}

buildColors()
updateComposer()
connectLive()
loadNotes()
window.setInterval(loadNotes, 4000)
window.setInterval(updateComposer, 1000)
requestAnimationFrame(tick)
