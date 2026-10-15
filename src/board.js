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
const MIN_ZOOM = 0.2
const MAX_ZOOM = 6
const coordsEl = document.getElementById('coords')
const tip = document.getElementById('tip')
const paintbar = document.getElementById('paintbar')
const paintCoords = document.getElementById('paint-coords')
const drawBtn = document.getElementById('add-draw')
const gameBtn = document.getElementById('add-game')
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
let placeKind = 'text'
let editing = null
let savedView = null
let hovered = null
let ink = '#1C1917'
let brush = 4
let eraserOn = false
let drawingStroke = null
const strokes = new Map()
const seenStrokes = new Set()
let strokeCursor = '1970-01-01T00:00:00+00:00'

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
  const table = (options && options.table) || 'notes'
  const response = await fetch(API.replace('/notes', '/' + table) + path, {
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
  el.classList.toggle('draw', note.kind === 'draw')
  el.classList.toggle('game', note.kind === 'game')
  el.setAttribute('aria-label', note.body)
  el.style.background = note.color
  el.style.color = textOn(note.color)
  el.style.zIndex = String(note.z)
  el.style.setProperty('--tilt', (note.kind === 'draw' || note.kind === 'game' ? 0 : note.tilt || 0) + 'deg')
  el.classList.toggle('dragging', Boolean(drag && drag.id === note.id))
  const label = el.querySelector('.note-text')
  if (note.kind === 'draw') {
    label.hidden = true
    ensureCanvas(el)
    ensureWhere(el)
    redrawNote(note.id)
  } else if (note.kind === 'game') {
    label.hidden = true
    ensureGame(el, note)
  } else if (label.textContent !== note.body) {
    label.hidden = false
    label.textContent = note.body
  }
}

function noteSignature(list) {
  return list
    .map((note) => [note.id, note.body, note.color, note.x, note.y, note.z, note.tilt, note.kind, note.marks].join(':'))
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
    const data = await api('?select=id,body,color,x,y,z,tilt,kind,marks,created_at&order=z.asc&limit=800', {
      method: 'GET',
    })
    const held = drag && notes.find((note) => note.id === drag.id)
    const open = editing && notes.find((note) => note.id === editing)
    const next = data || []
    if (held) {
      const index = next.findIndex((note) => note.id === held.id)
      if (index >= 0) next[index] = held
    }
    if (open && open.kind === 'game') {
      const index = next.findIndex((note) => note.id === open.id)
      if (index >= 0) {
        const localCount = [...(open.marks || '')].filter((mark) => mark !== ' ').length
        const remoteCount = [...(next[index].marks || '')].filter((mark) => mark !== ' ').length
        if (localCount > remoteCount) next[index].marks = open.marks
      }
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
  loadNewStrokes()
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

function wrapTilt(value) {
  let angle = Math.round(value) % 360
  if (angle > 180) angle -= 360
  if (angle < -180) angle += 360
  return angle
}

function shownTilt(note) {
  if (drag && drag.id === note.id) return drag.tilt
  const remote = remoteDrags.get(note.id)
  if (remote && remote.tilt != null && Date.now() - remote.at < 1500) return remote.tilt
  return Number(note.tilt) || 0
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
    el.style.setProperty('--tilt', shownTilt(note) + 'deg')
    const where = el.querySelector('.where')
    if (where) where.textContent = Math.round(spot.x) + ', ' + Math.round(spot.y)
  }
  const here = pointer || { x: camera.x + board.clientWidth / 2 / camera.zoom, y: camera.y + board.clientHeight / 2 / camera.zoom }
  const coordText = 'x ' + Math.round(here.x) + ' · y ' + Math.round(here.y)
  if (coordsEl.textContent !== coordText) coordsEl.textContent = coordText
  if (pointer && (input.value.trim() || placeKind !== 'text')) positionElement(ghost, pointer.x, pointer.y)
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
  drawBtn.classList.toggle('on', placeKind === 'draw')
  gameBtn.classList.toggle('on', placeKind === 'game')
  board.classList.toggle('armed', Boolean(draft) || placeKind !== 'text')
  const waiting = cooldownText()
  const ghostLabel = placeKind === 'draw' ? 'Drawing' : placeKind === 'game' ? 'Tic-tac-toe' : draft
  const nextHint = waiting
    ? waiting
    : placeKind === 'draw'
      ? 'Click the wall to place a 256×256 drawing. It zooms in so you can paint.'
      : placeKind === 'game'
        ? 'Click the wall to place tic-tac-toe. Press I on it to take the next move.'
        : draft
          ? 'Click the wall to stick it. WASD or drag empty space to move. Scroll to zoom.'
          : 'Scroll to zoom. Coordinates follow your cursor. Press I on a drawing or game.'
  if (hintText.textContent !== nextHint) hintText.textContent = nextHint
  const showGhost = Boolean(ghostLabel)
  ghost.classList.toggle('special', placeKind !== 'text')
  if (ghost.hidden === showGhost) ghost.hidden = !showGhost
  if (showGhost && ghost.textContent !== ghostLabel) ghost.textContent = ghostLabel
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
  if (drag || pan || editing) return
  if (event.target.closest('article.note') || event.target.closest('.paintbar')) return
  if (placeKind === 'draw' || placeKind === 'game') {
    placeSpecial(event)
    return
  }
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

function armRotate() {
  if (!drag || drag.rotating) return
  drag.rotating = true
  drag.lastAngle = null
  document.body.classList.add('rotating-note')
}

function disarmRotate() {
  if (!drag || !drag.rotating) return
  drag.rotating = false
  drag.lastAngle = null
  drag.originX = drag.lastClientX
  drag.originY = drag.lastClientY
  drag.startX = drag.x
  drag.startY = drag.y
  document.body.classList.remove('rotating-note')
}

function moveDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const note = notes.find((item) => item.id === drag.id)
  if (!note) return
  drag.lastClientX = event.clientX
  drag.lastClientY = event.clientY
  if (keys.has('r')) armRotate()
  if (drag.rotating) {
    drag.tilt = note.tilt
  } else {
    note.x = clamp(drag.startX + (event.clientX - drag.originX) / camera.zoom, -WORLD, WORLD)
    note.y = clamp(drag.startY + (event.clientY - drag.originY) / camera.zoom, -WORLD, WORLD)
    drag.x = note.x
    drag.y = note.y
    drag.lastAngle = null
  }
  pointer = worldFromEvent(event)
  layout()
  publishSoon()
}

async function finishDrag(event) {
  if (!drag || (event && event.pointerId !== drag.pointerId)) return
  const saved = drag
  drag = null
  document.body.classList.remove('dragging-note')
  document.body.classList.remove('rotating-note')
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
      body: { x: saved.x, y: saved.y, z: saved.z, tilt: saved.tilt },
    })
    showError('')
  } catch (err) {
    showError('The move did not save. Drag the note again.')
  }
}

function onNoteDown(event) {
  if (input.value.trim() || placeKind !== 'text') return
  const kind = notes.find((item) => item.id === event.currentTarget.dataset.id)
  if (kind && editing === kind.id && (kind.kind === 'draw' || kind.kind === 'game')) return
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
    tilt: Number(note.tilt) || 0,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    spinX: event.clientX,
    rotating: false,
    lastAngle: null,
  }
  if (keys.has('r')) armRotate()
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
      tilt: payload.dragTilt == null ? null : Number(payload.dragTilt),
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
        dragTilt: drag ? drag.tilt : null,
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
  room.on('broadcast', { event: 'stroke' }, (message) => {
    const payload = message && message.payload && message.payload.id ? message.payload : message
    addStroke(payload)
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
  try {
    syncTip(event)
  } catch (err) {
    /* A tooltip problem should not stop the wall from moving. */
  }
  if (input.value.trim() || placeKind !== 'text') {
    ghost.hidden = false
    ghost.textContent = placeKind === 'draw' ? 'Drawing' : placeKind === 'game' ? 'Tic-tac-toe' : input.value.trim()
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
      stopFollowing()
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
  hovered = null
  tip.hidden = true
  if (!drag && !input.value.trim() && placeKind === 'text') ghost.hidden = true
})
board.addEventListener('click', place)
window.addEventListener(
  'wheel',
  (event) => {
    if (event.target.closest && event.target.closest('input, label.custom')) return
    event.preventDefault()
    const rect = board.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    let delta = event.deltaY
    if (event.deltaMode === 1) delta *= 40
    else if (event.deltaMode === 2) delta *= 800
    const oldZoom = camera.zoom
    const next = clamp(oldZoom * Math.exp(-delta * 0.0035), MIN_ZOOM, MAX_ZOOM)
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
  if (input.value.trim()) placeKind = 'text'
  updateComposer()
})

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase()
  if (event.key === 'Escape' && editing) {
    event.preventDefault()
    exitEdit()
    return
  }
  if (key === 'i' || event.code === 'KeyI') {
    if (hovered && (hovered.kind === 'draw' || hovered.kind === 'game')) {
      event.preventDefault()
      if (editing === hovered.id) exitEdit()
      else enterEdit(hovered)
      return
    }
    if (editing) {
      event.preventDefault()
      exitEdit()
      return
    }
  }
  if (key === 'r' || event.code === 'KeyR') {
    keys.add('r')
    if (drag) {
      event.preventDefault()
      armRotate()
    }
    if (drag || (document.activeElement === input && input.value.trim())) return
  }
  if (document.activeElement === input && input.value.trim()) return
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
    keys.add(key)
    event.preventDefault()
  }
})
window.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase()
  keys.delete(key)
  if (key === 'r' || event.code === 'KeyR') {
    keys.delete('r')
    disarmRotate()
  }
})
window.addEventListener('blur', () => {
  keys.clear()
  disarmRotate()
})

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
    stopFollowing()
    camera.x += (mx * 760 * dt) / camera.zoom
    camera.y += (my * 760 * dt) / camera.zoom
    layout()
    publishSoon()
  }
  try {
    glideCamera(dt)
  } catch (err) {
    /* Zooming back out should not stop WASD. */
  }
  if (drag && keys.has('r')) {
    const note = notes.find((item) => item.id === drag.id)
    if (note && note.kind !== 'draw' && note.kind !== 'game') {
      armRotate()
      note.tilt = wrapTilt((Number(note.tilt) || 0) + 140 * dt)
      drag.tilt = note.tilt
      layout()
      publishSoon()
    }
  }
  requestAnimationFrame(tick)
}

function syncTip(event) {
  const el = event.target.closest && event.target.closest('article.note')
  const note = el && notes.find((item) => item.id === el.dataset.id)
  hovered = note && (note.kind === 'draw' || note.kind === 'game') ? note : null
  if (!hovered || editing === hovered.id) {
    tip.hidden = true
    return
  }
  tip.hidden = false
  tip.textContent = hovered.kind === 'draw' ? 'Press I to draw' : 'Press I to play'
  tip.style.left = event.clientX + 14 + 'px'
  tip.style.top = event.clientY + 18 + 'px'
}

function ensureWhere(el) {
  if (el.querySelector('.where')) return
  const where = document.createElement('span')
  where.className = 'where'
  el.appendChild(where)
}

function gameStatus(marks) {
  const cells = (marks || '         ').padEnd(9, ' ').slice(0, 9)
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ]
  for (const [a, b, c] of lines) {
    if (cells[a] !== ' ' && cells[a] === cells[b] && cells[a] === cells[c]) return { over: cells[a] }
  }
  if (![...cells].includes(' ')) return { over: 'draw' }
  const xs = [...cells].filter((cell) => cell === 'X').length
  const os = [...cells].filter((cell) => cell === 'O').length
  return { next: xs <= os ? 'X' : 'O' }
}

function ensureGame(el, note) {
  let grid = el.querySelector('.grid')
  if (!grid) {
    grid = document.createElement('div')
    grid.className = 'grid'
    for (let i = 0; i < 9; i += 1) {
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'cell'
      cell.addEventListener('pointerdown', (event) => {
        if (editing === el.dataset.id) event.stopPropagation()
      })
      cell.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        playCell(el.dataset.id, i)
      })
      grid.appendChild(cell)
    }
    const turn = document.createElement('span')
    turn.className = 'turn'
    el.insertBefore(grid, el.firstChild)
    el.appendChild(turn)
    ensureWhere(el)
  }
  const marks = (note.marks || '         ').padEnd(9, ' ').slice(0, 9)
  const status = gameStatus(marks)
  ;[...grid.children].forEach((cell, index) => {
    cell.textContent = marks[index] === ' ' ? '' : marks[index]
  })
  const turn = el.querySelector('.turn')
  turn.textContent = status.over === 'draw' ? 'Draw' : status.over ? status.over + ' wins' : status.next + ' plays'
}

async function playCell(id, index) {
  const note = notes.find((item) => item.id === id)
  if (!note || editing !== id) return
  const marks = (note.marks || '         ').padEnd(9, ' ').slice(0, 9)
  if (marks[index] !== ' ') return
  const status = gameStatus(marks)
  if (status.over) return
  const next = marks.slice(0, index) + status.next + marks.slice(index + 1)
  note.marks = next
  const el = noteNodes.get(id)
  if (el) ensureGame(el, note)
  try {
    await api('?id=eq.' + id, { method: 'PATCH', body: { marks: next } })
    showError('')
  } catch (err) {
    showError(serverMessage(err.message, 'That move is not next.'))
    loadNotes()
  }
}

function ensureCanvas(el) {
  if (el.querySelector('canvas')) return
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  canvas.addEventListener('pointerdown', (event) => {
    if (editing !== el.dataset.id) return
    event.preventDefault()
    event.stopPropagation()
    const point = canvasPoint(event, canvas)
    drawingStroke = {
      id: crypto.randomUUID(),
      note_id: el.dataset.id,
      client_id: clientId(),
      color: ink,
      size: brush,
      eraser: eraserOn,
      points: [[point.x, point.y]],
    }
    paintCoords.textContent = point.x + ', ' + point.y
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch (err) {
      /* Window listeners still follow the pointer. */
    }
    redrawNote(el.dataset.id)
    window.addEventListener('pointermove', moveStroke)
    window.addEventListener('pointerup', endStroke)
    window.addEventListener('pointercancel', endStroke)
  })
  canvas.addEventListener('pointermove', (event) => {
    if (editing !== el.dataset.id) return
    const point = canvasPoint(event, canvas)
    paintCoords.textContent = point.x + ', ' + point.y
  })
  el.insertBefore(canvas, el.firstChild)
  ensureWhere(el)
}

function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect()
  const x = rect.width ? ((event.clientX - rect.left) / rect.width) * 256 : 0
  const y = rect.height ? ((event.clientY - rect.top) / rect.height) * 256 : 0
  return { x: clamp(Math.round(x), 0, 255), y: clamp(Math.round(y), 0, 255) }
}

function drawStroke(ctx, stroke) {
  const points = stroke.points || []
  if (!points.length) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Number(stroke.size) || 4
  if (stroke.eraser) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = 'rgba(0,0,0,1)'
  } else {
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = stroke.color || '#1C1917'
  }
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  if (points.length === 1) ctx.lineTo(points[0][0] + 0.01, points[0][1])
  else points.slice(1).forEach((point) => ctx.lineTo(point[0], point[1]))
  ctx.stroke()
  ctx.restore()
}

function redrawNote(id) {
  const el = noteNodes.get(id)
  const canvas = el && el.querySelector('canvas')
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 256, 256)
  for (const stroke of strokes.get(id) || []) drawStroke(ctx, stroke)
  if (drawingStroke && drawingStroke.note_id === id) drawStroke(ctx, drawingStroke)
}

function addStroke(row) {
  if (!row || !row.id || seenStrokes.has(row.id)) return
  seenStrokes.add(row.id)
  const list = strokes.get(row.note_id) || []
  list.push(row)
  strokes.set(row.note_id, list)
  if (row.created_at && row.created_at > strokeCursor) strokeCursor = row.created_at
  redrawNote(row.note_id)
}

async function loadNewStrokes() {
  const ids = notes.filter((note) => note.kind === 'draw').map((note) => note.id)
  if (!ids.length) return
  try {
    const rows = await api(
      '?select=id,note_id,color,size,eraser,points,created_at&note_id=in.(' +
        ids.join(',') +
        ')&created_at=gt.' +
        encodeURIComponent(strokeCursor) +
        '&order=created_at.asc&limit=2000',
      { method: 'GET', table: 'strokes' },
    )
    for (const row of rows || []) addStroke(row)
  } catch (err) {
    /* The next poll tries again. */
  }
}

function moveStroke(event) {
  if (!drawingStroke) return
  const el = noteNodes.get(drawingStroke.note_id)
  const canvas = el && el.querySelector('canvas')
  if (!canvas) return
  const point = canvasPoint(event, canvas)
  paintCoords.textContent = point.x + ', ' + point.y
  const last = drawingStroke.points[drawingStroke.points.length - 1]
  if (last[0] !== point.x || last[1] !== point.y) drawingStroke.points.push([point.x, point.y])
  if (drawingStroke.points.length >= 180) {
    const keep = drawingStroke.points[drawingStroke.points.length - 1]
    const next = {
      id: crypto.randomUUID(),
      note_id: drawingStroke.note_id,
      client_id: drawingStroke.client_id,
      color: drawingStroke.color,
      size: drawingStroke.size,
      eraser: drawingStroke.eraser,
      points: [[keep[0], keep[1]]],
    }
    endStroke()
    drawingStroke = next
    window.addEventListener('pointermove', moveStroke)
    window.addEventListener('pointerup', endStroke)
    window.addEventListener('pointercancel', endStroke)
  }
  if (drawingStroke) redrawNote(drawingStroke.note_id)
}

function endStroke() {
  window.removeEventListener('pointermove', moveStroke)
  window.removeEventListener('pointerup', endStroke)
  window.removeEventListener('pointercancel', endStroke)
  finishStroke()
}

async function finishStroke() {
  if (!drawingStroke || !drawingStroke.points.length) {
    drawingStroke = null
    return
  }
  const stroke = drawingStroke
  drawingStroke = null
  addStroke(stroke)
  if (room) {
    room.send({
      type: 'broadcast',
      event: 'stroke',
      payload: {
        id: stroke.id,
        note_id: stroke.note_id,
        color: stroke.color,
        size: stroke.size,
        eraser: stroke.eraser,
        points: stroke.points,
      },
    })
  }
  try {
    await api('', { method: 'POST', table: 'strokes', body: stroke })
  } catch (err) {
    showError('That stroke did not save.')
  }
}

async function placeSpecial(event) {
  if (waitLeft(ADD_WAIT) > 0) {
    showError('Wait 10 seconds before another note.')
    updateComposer()
    return
  }
  const now = Date.now()
  if (now - lastPlace < 400) return
  lastPlace = now
  const spot = pointer || worldFromEvent(event)
  const kind = placeKind
  const draft = {
    body: kind === 'draw' ? 'Drawing' : 'Tic-tac-toe',
    color,
    x: spot.x,
    y: spot.y,
    z: nextZ(),
    tilt: 0,
    kind,
    marks: kind === 'game' ? '         ' : null,
    client_id: clientId(),
  }
  try {
    const created = await api('', { method: 'POST', body: draft })
    const note = Array.isArray(created) ? created[0] : created
    notes.push(note)
    lastSignature = ''
    markWait(ADD_WAIT)
    placeKind = 'text'
    showError('')
    updateComposer()
    render()
    enterEdit(note)
  } catch (err) {
    const message = serverMessage(err.message, 'That note did not stick. Wait 10 seconds and try again.')
    if (/wait|second|minute/i.test(message)) markWait(ADD_WAIT)
    showError(message)
    updateComposer()
  }
}

function stopFollowing() {
  if (!editing && !savedView) return
  editing = null
  savedView = null
  board.classList.remove('editing')
  paintbar.hidden = true
}

function enterEdit(note) {
  if (!savedView) savedView = { x: camera.x, y: camera.y, zoom: camera.zoom }
  editing = note.id
  board.classList.add('editing')
  paintbar.hidden = note.kind !== 'draw'
  tip.hidden = true
  const el = noteNodes.get(note.id)
  if (el && note.kind === 'game') ensureGame(el, note)
}

function exitEdit() {
  editing = null
  board.classList.remove('editing')
  paintbar.hidden = true
  for (const note of notes) {
    if (note.kind !== 'game') continue
    const el = noteNodes.get(note.id)
    if (el) ensureGame(el, note)
  }
}

function glideCamera(dt) {
  let target = null
  if (editing) {
    const note = notes.find((item) => item.id === editing)
    if (!note) {
      exitEdit()
      return
    }
    const rect = board.getBoundingClientRect()
    const zoom = clamp((Math.min(rect.width, rect.height) * 0.82) / 256, 1.15, MAX_ZOOM)
    target = {
      x: note.x - rect.width / (2 * zoom),
      y: note.y - rect.height / (2 * zoom),
      zoom,
    }
  } else if (savedView) {
    target = savedView
  } else {
    return
  }
  const step = Math.min(1, dt * 7)
  camera.x += (target.x - camera.x) * step
  camera.y += (target.y - camera.y) * step
  camera.zoom += (target.zoom - camera.zoom) * step
  layout()
  if (!editing && Math.hypot(camera.x - target.x, camera.y - target.y) < 2 && Math.abs(camera.zoom - target.zoom) < 0.02) {
    camera.x = target.x
    camera.y = target.y
    camera.zoom = target.zoom
    savedView = null
    layout()
  }
}

drawBtn.addEventListener('click', () => {
  placeKind = placeKind === 'draw' ? 'text' : 'draw'
  if (placeKind !== 'text') input.value = ''
  updateComposer()
})
gameBtn.addEventListener('click', () => {
  placeKind = placeKind === 'game' ? 'text' : 'game'
  if (placeKind !== 'text') input.value = ''
  updateComposer()
})
paintbar.addEventListener('click', (event) => {
  const inkButton = event.target.closest('.ink')
  const sizeButton = event.target.closest('.size')
  if (inkButton) {
    ink = inkButton.dataset.ink
    eraserOn = false
    document.getElementById('eraser').classList.remove('on')
    for (const button of paintbar.querySelectorAll('.ink')) button.classList.toggle('on', button === inkButton)
  }
  if (sizeButton) {
    brush = Number(sizeButton.dataset.size)
    for (const button of paintbar.querySelectorAll('.size')) button.classList.toggle('on', button === sizeButton)
  }
})
document.getElementById('eraser').addEventListener('click', () => {
  eraserOn = !eraserOn
  document.getElementById('eraser').classList.toggle('on', eraserOn)
})
document.getElementById('paint-done').addEventListener('click', () => exitEdit())

buildColors()
updateComposer()
connectLive()
loadNotes()
window.setInterval(loadNotes, 4000)
window.setInterval(updateComposer, 1000)
requestAnimationFrame(tick)
