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

const ADD_WAIT = 'sticky-add-3'
const DELETE_WAIT = 'sticky-del-3'
const COOLDOWN = 3000
const WORLD = 100000

const noteNodes = new Map()
const peers = new Map()
const remoteDrags = new Map()
const keys = new Set()
const camera = { x: 0, y: 0, zoom: 1 }
const MIN_ZOOM = 0.2
const MAX_ZOOM = 6
const coordsEl = document.getElementById('coords')
const nameInput = document.getElementById('name-input')
const tip = document.getElementById('tip')
const paintbar = document.getElementById('paintbar')
const paintCoords = document.getElementById('paint-coords')
const KINDS = {
  draw: {
    label: 'Drawing',
    hint: 'Click the wall to place a 256\u00d7256 drawing. It zooms in so you can paint.',
  },
  game: {
    label: 'Tic-tac-toe',
    hint: 'Click the wall to place tic-tac-toe. Press I on it to take the next move.',
  },
  mine: {
    label: 'Mines',
    hint: 'Click the wall to place mines. Press I, open a square, or right-click to flag.',
  },
  lights: {
    label: 'Lights',
    hint: 'Click the wall to place lights. Press I and turn every light off.',
  },
  memo: {
    label: 'Memory',
    hint: 'Click the wall to place memory. Press I and match the pairs.',
  },
  table: {
    label: 'Table',
    hint: 'Click the wall to place the element table. Press I, then click an element to light it up.',
  },
}
const COMMANDS = [
  { cmd: '/draw', kind: 'draw' },
  { cmd: '/tictactoe', kind: 'game' },
  { cmd: '/mines', kind: 'mine' },
  { cmd: '/lights', kind: 'lights' },
  { cmd: '/memory', kind: 'memo' },
  { cmd: '/table', kind: 'table' },
]
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
let savingPlay = null
let flagMode = false
let savedView = null
let hovered = null
let ink = '#1C1917'
let brush = 4
let eraserOn = false
let drawingStroke = null
const strokes = new Map()
const seenStrokes = new Set()
let strokeCursor = '1970-01-01T00:00:00+00:00'

function isBoardNote(note) {
  return Boolean(note && KINDS[note.kind])
}

function shownName(value) {
  const raw = String(value || '').trim().slice(0, 20)
  if (!raw || raw.toLowerCase() === 'guest' || hasBlockedWord(raw)) return 'Guest'
  return raw
}

function myName() {
  return shownName(localStorage.getItem('sticky-name') || '')
}

function nameTakenLocally(raw) {
  const key = String(raw || '').trim().toLowerCase()
  if (!key || key === 'guest') return false
  for (const peer of peers.values()) {
    if (String(peer.name || '').toLowerCase() === key) return true
  }
  return false
}

let nameTimer = 0
let nameTicket = 0

function queueNameClaim(raw) {
  clearTimeout(nameTimer)
  nameTimer = setTimeout(() => claimName(raw), 350)
}

async function claimName(raw, quiet) {
  const wanted = String(raw || '').trim().slice(0, 20)
  const ticket = quiet ? nameTicket : ++nameTicket
  try {
    const accepted = await api('', {
      method: 'POST',
      table: 'rpc/claim_name',
      body: { cid: clientId(), wanted },
    })
    if (!quiet && ticket !== nameTicket) return
    const next = shownName(accepted)
    if (next === 'Guest') {
      if (!wanted || wanted.toLowerCase() === 'guest') localStorage.setItem('sticky-name', '')
    } else {
      localStorage.setItem('sticky-name', next)
    }
    if (!quiet) {
      showError('')
      publishSoon()
    }
  } catch (err) {
    if (!quiet && ticket !== nameTicket) return
    const message = serverMessage(err.message, '')
    if (/taken/i.test(message)) {
      if (quiet) localStorage.setItem('sticky-name', '')
      if (!quiet || !nameInput.matches(':focus')) nameInput.value = localStorage.getItem('sticky-name') || ''
      showError('That name is taken.')
      publishSoon()
      return
    }
    if (/cannot be used/i.test(message)) {
      showError('That name cannot be used.')
      nameInput.value = localStorage.getItem('sticky-name') || ''
      return
    }
    if (!quiet) showError('That name did not save.')
  }
}

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
  for (const name of Object.keys(KINDS)) el.classList.toggle(name, note.kind === name)
  el.setAttribute('aria-label', note.body)
  el.style.background = note.color
  el.style.color = textOn(note.color)
  el.style.zIndex = editing === note.id ? '1000000' : String(note.z)
  el.style.setProperty('--tilt', (isBoardNote(note) ? 0 : note.tilt || 0) + 'deg')
  el.classList.toggle('dragging', Boolean(drag && drag.id === note.id))
  el.classList.toggle('writing', note.kind === 'text' && editing === note.id)
  const label = el.querySelector('.note-text')
  if (note.kind === 'draw') {
    label.hidden = true
    ensureCanvas(el)
    ensureWhere(el)
    redrawNote(note.id)
  } else if (note.kind === 'game') {
    label.hidden = true
    ensureGame(el, note)
  } else if (note.kind === 'mine' || note.kind === 'lights' || note.kind === 'memo') {
    label.hidden = true
    ensurePlay(el, note)
  } else if (note.kind === 'table') {
    label.hidden = true
    ensureTable(el, note)
  } else if (label) {
    const editingThis = editing === note.id
    label.hidden = editingThis
    if (label.textContent !== note.body) label.textContent = note.body
    if (editingThis) openTextEdit(el, note)
    else {
      const box = el.querySelector('.editbox')
      if (box) box.hidden = true
    }
  }
}

function noteSignature(list) {
  return list
    .map((note) => [note.id, note.body, note.color, note.x, note.y, note.z, note.tilt, note.kind, note.marks, note.state].join(':'))
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
    const data = await api('?select=id,body,color,x,y,z,tilt,kind,marks,state,created_at&order=z.asc&limit=800', {
      method: 'GET',
    })
    const held = drag && notes.find((note) => note.id === drag.id)
    const open = editing && notes.find((note) => note.id === editing)
    const next = data || []
    if (held) {
      const index = next.findIndex((note) => note.id === held.id)
      if (index >= 0) next[index] = held
    }
    if (open && savingPlay === open.id) {
      const index = next.findIndex((note) => note.id === open.id)
      if (index >= 0) {
        next[index].state = open.state
        next[index].marks = open.marks
      }
    } else if (open && open.kind === 'game') {
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
    el.style.setProperty('--tilt', (isBoardNote(note) ? 0 : shownTilt(note)) + 'deg')
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
  const slash = draft.startsWith('/')
  board.classList.toggle('armed', !slash && (Boolean(draft) || placeKind !== 'text'))
  const waiting = cooldownText()
  const spec = KINDS[placeKind]
  const ghostLabel = slash ? '' : spec ? spec.label : draft
  const nextHint = waiting
    ? waiting
    : slash
      ? 'Press Tab to pick the top command.'
      : spec
        ? spec.hint
        : draft
          ? 'Click the wall to stick it. WASD or drag empty space to move. Scroll to zoom.'
          : 'Type / for a drawing, a game, or the table.'
  if (hintText.textContent !== nextHint) hintText.textContent = nextHint
  const showGhost = Boolean(ghostLabel)
  ghost.classList.toggle('special', placeKind !== 'text')
  ghost.classList.toggle('table', placeKind === 'table')
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

function commandMatches() {
  const raw = input.value.trim().toLowerCase()
  if (!raw.startsWith('/')) return []
  return COMMANDS.filter((item) => item.cmd.startsWith(raw))
}

function chooseCommand(item) {
  placeKind = item.kind
  input.value = ''
  renderSuggest([])
  updateComposer()
}

function renderSuggest(matches) {
  const suggest = document.getElementById('suggest')
  suggest.replaceChildren()
  if (!matches.length) {
    suggest.hidden = true
    return
  }
  suggest.hidden = false
  matches.forEach((item, index) => {
    const row = document.createElement('li')
    if (index === 0) row.className = 'top'
    row.textContent = item.cmd + '  ' + KINDS[item.kind].label
    row.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      chooseCommand(item)
    })
    suggest.appendChild(row)
  })
}

async function place(event) {
  if (input.value.trim().startsWith('/')) return
  if (blockPlace) {
    blockPlace = false
    return
  }
  if (drag || pan || editing) return
  if (event.target.closest('article.note') || event.target.closest('.paintbar') || event.target.closest('.dock')) return
  if (KINDS[placeKind]) {
    placeSpecial(event)
    return
  }
  const body = input.value.trim().slice(0, MAX_LENGTH)
  if (!body) return
  if (waitLeft(ADD_WAIT) > 0) {
    showError('Wait 3 seconds before another note.')
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
    const message = serverMessage(err.message, 'That note did not stick. Wait 3 seconds and try again.')
    if (/wait|second|minute/i.test(message)) markWait(ADD_WAIT)
    showError(message)
    updateComposer()
  }
}

async function removeNote(id) {
  if (!id) return
  if (waitLeft(DELETE_WAIT) > 0) {
    showError('Wait 3 seconds before another delete.')
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
  if (kind && editing === kind.id) return
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
  const name = document.createElement('span')
  name.className = 'peer-name'
  name.textContent = 'Guest'
  const card = document.createElement('div')
  card.className = 'peer-card'
  card.hidden = true
  el.append(cursor, name, card)
  board.appendChild(el)
  const peer = { el, x: 0, y: 0, text: '', color: '#FFE566', name: 'Guest', at: 0 }
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
  peer.name = shownName(payload.name)
  peer.el.querySelector('.peer-name').textContent = peer.name
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
        name: myName(),
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
  if (event.target.closest('article.note, .paintbar, .dock')) return
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
  if (!input.value.trim().startsWith('/') && (input.value.trim() || placeKind !== 'text')) {
    ghost.hidden = false
    ghost.classList.toggle('special', placeKind !== 'text')
    ghost.classList.toggle('table', placeKind === 'table')
    ghost.textContent = KINDS[placeKind] ? KINDS[placeKind].label : input.value.trim()
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
input.addEventListener('focus', () => {
  for (const key of ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']) keys.delete(key)
})
nameInput.addEventListener('focus', () => {
  for (const key of ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']) keys.delete(key)
})
nameInput.addEventListener('keydown', (event) => event.stopPropagation())
nameInput.addEventListener('input', () => {
  if (nameInput.value.length > 20) nameInput.value = nameInput.value.slice(0, 20)
  const raw = nameInput.value.trim().slice(0, 20)
  if (raw && hasBlockedWord(raw)) {
    showError('That name cannot be used.')
    nameInput.value = localStorage.getItem('sticky-name') || ''
    return
  }
  if (raw && nameTakenLocally(raw)) {
    showError('That name is taken.')
    nameInput.value = localStorage.getItem('sticky-name') || ''
    return
  }
  queueNameClaim(raw)
})
nameInput.value = (localStorage.getItem('sticky-name') || '').slice(0, 20)
claimName(nameInput.value)
window.setInterval(() => claimName(localStorage.getItem('sticky-name') || '', true), 4000)
window.addEventListener('pagehide', () => {
  fetch(API.replace('/notes', '/rpc/claim_name'), {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: 'Bearer ' + KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ cid: clientId(), wanted: '' }),
    keepalive: true,
  })
})
input.addEventListener('input', () => {
  if (input.value.length > MAX_LENGTH) input.value = input.value.slice(0, MAX_LENGTH)
  const raw = input.value.trim().toLowerCase()
  if (raw.startsWith('/')) {
    const matches = commandMatches()
    const exact = matches.find((item) => item.cmd === raw)
    if (exact && matches.length === 1) {
      chooseCommand(exact)
      return
    }
    renderSuggest(matches)
  } else {
    renderSuggest([])
    if (raw) placeKind = 'text'
  }
  updateComposer()
})

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase()
  if (event.key === 'Escape' && editing) {
    event.preventDefault()
    exitEdit()
    return
  }
  const typing = document.activeElement === input || document.activeElement === nameInput || (document.activeElement && document.activeElement.classList.contains('editbox'))
  if (document.activeElement === input && event.key === 'Tab') {
    const matches = commandMatches()
    if (matches.length) {
      event.preventDefault()
      chooseCommand(matches[0])
    }
    return
  }
  if (!typing && (key === 'i' || event.code === 'KeyI')) {
    if (hovered) {
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
    if (typing && !drag) return
    keys.add('r')
    if (drag) {
      event.preventDefault()
      armRotate()
    }
    if (drag || typing) return
  }
  if (typing) return
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
  if ((mx || my) && document.activeElement !== input && document.activeElement !== nameInput) {
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
    if (note && !isBoardNote(note)) {
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
  hovered = note || null
  if (!hovered || editing === hovered.id) {
    tip.hidden = true
    return
  }
  tip.hidden = false
  tip.textContent =
    hovered.kind === 'draw'
      ? 'Press I to draw'
      : hovered.kind === 'text'
        ? 'Press I to edit'
        : hovered.kind === 'table'
          ? 'Press I to open'
          : 'Press I to play'
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
  const previous = note.marks
  note.marks = next
  savingPlay = id
  const el = noteNodes.get(id)
  if (el) ensureGame(el, note)
  try {
    await api('?id=eq.' + id, { method: 'PATCH', body: { marks: next } })
    showError('')
  } catch (err) {
    note.marks = previous
    savingPlay = null
    if (el) ensureGame(el, note)
    showError(serverMessage(err.message, 'That move is not next.'))
    loadNotes()
  } finally {
    if (savingPlay === id) savingPlay = null
  }
}

const MINE_COLORS = { 1: '#2563eb', 2: '#16a34a', 3: '#e11d48', 4: '#7c3aed', 5: '#b45309', 6: '#0f766e', 7: '#1c1917', 8: '#57534e' }

const ELEMENTS = [
  ['Hydrogen', 'H', 1, 0, 1, 1], ['Helium', 'He', 2, 2, 2, 4], ['Lithium', 'Li', 3, 4, 3, 7], ['Beryllium', 'Be', 4, 5, 4, 9],
  ['Boron', 'B', 5, 6, 5, 11], ['Carbon', 'C', 6, 6, 6, 12], ['Nitrogen', 'N', 7, 7, 7, 14], ['Oxygen', 'O', 8, 8, 8, 16],
  ['Fluorine', 'F', 9, 10, 9, 19], ['Neon', 'Ne', 10, 10, 10, 20], ['Sodium', 'Na', 11, 12, 11, 23], ['Magnesium', 'Mg', 12, 12, 12, 24],
  ['Aluminum', 'Al', 13, 14, 13, 27], ['Silicon', 'Si', 14, 14, 14, 28], ['Phosphorus', 'P', 15, 16, 15, 31], ['Sulfur', 'S', 16, 16, 16, 32],
  ['Chlorine', 'Cl', 17, 18, 17, 35], ['Argon', 'Ar', 18, 22, 18, 40], ['Potassium', 'K', 19, 20, 19, 39], ['Calcium', 'Ca', 20, 20, 20, 40],
  ['Scandium', 'Sc', 21, 24, 21, 45], ['Titanium', 'Ti', 22, 26, 22, 48], ['Vanadium', 'V', 23, 28, 23, 51], ['Chromium', 'Cr', 24, 28, 24, 52],
  ['Manganese', 'Mn', 25, 30, 25, 55], ['Iron', 'Fe', 26, 30, 26, 56], ['Cobalt', 'Co', 27, 32, 27, 59], ['Nickel', 'Ni', 28, 30, 28, 58],
  ['Copper', 'Cu', 29, 34, 29, 63], ['Zinc', 'Zn', 30, 34, 30, 64], ['Gallium', 'Ga', 31, 38, 31, 69], ['Germanium', 'Ge', 32, 42, 32, 74],
  ['Arsenic', 'As', 33, 42, 33, 75], ['Selenium', 'Se', 34, 46, 34, 80], ['Bromine', 'Br', 35, 44, 35, 79], ['Krypton', 'Kr', 36, 48, 36, 84],
  ['Rubidium', 'Rb', 37, 48, 37, 85], ['Strontium', 'Sr', 38, 50, 38, 88], ['Yttrium', 'Y', 39, 50, 39, 89], ['Zirconium', 'Zr', 40, 50, 40, 90],
  ['Niobium', 'Nb', 41, 52, 41, 93], ['Molybdenum', 'Mo', 42, 56, 42, 98], ['Technetium', 'Tc', 43, 55, 43, 98], ['Ruthenium', 'Ru', 44, 58, 44, 102],
  ['Rhodium', 'Rh', 45, 58, 45, 103], ['Palladium', 'Pd', 46, 60, 46, 106], ['Silver', 'Ag', 47, 60, 47, 107], ['Cadmium', 'Cd', 48, 66, 48, 114],
  ['Indium', 'In', 49, 66, 49, 115], ['Tin', 'Sn', 50, 70, 50, 120], ['Antimony', 'Sb', 51, 70, 51, 121], ['Tellurium', 'Te', 52, 78, 52, 130],
  ['Iodine', 'I', 53, 74, 53, 127], ['Xenon', 'Xe', 54, 78, 54, 132], ['Cesium', 'Cs', 55, 78, 55, 133], ['Barium', 'Ba', 56, 82, 56, 138],
  ['Lanthanum', 'La', 57, 82, 57, 139], ['Cerium', 'Ce', 58, 82, 58, 140], ['Praseodymium', 'Pr', 59, 82, 59, 141], ['Neodymium', 'Nd', 60, 82, 60, 142],
  ['Promethium', 'Pm', 61, 84, 61, 145], ['Samarium', 'Sm', 62, 90, 62, 152], ['Europium', 'Eu', 63, 90, 63, 153], ['Gadolinium', 'Gd', 64, 94, 64, 158],
  ['Terbium', 'Tb', 65, 94, 65, 159], ['Dysprosium', 'Dy', 66, 98, 66, 164], ['Holmium', 'Ho', 67, 98, 67, 165], ['Erbium', 'Er', 68, 98, 68, 166],
  ['Thulium', 'Tm', 69, 100, 69, 169], ['Ytterbium', 'Yb', 70, 104, 70, 174], ['Lutetium', 'Lu', 71, 104, 71, 175], ['Hafnium', 'Hf', 72, 108, 72, 180],
  ['Tantalum', 'Ta', 73, 108, 73, 181], ['Tungsten', 'W', 74, 110, 74, 184], ['Rhenium', 'Re', 75, 112, 75, 187], ['Osmium', 'Os', 76, 116, 76, 192],
  ['Iridium', 'Ir', 77, 116, 77, 193], ['Platinum', 'Pt', 78, 117, 78, 195], ['Gold', 'Au', 79, 118, 79, 197], ['Mercury', 'Hg', 80, 122, 80, 202],
  ['Thallium', 'Tl', 81, 124, 81, 205], ['Lead', 'Pb', 82, 126, 82, 208], ['Bismuth', 'Bi', 83, 126, 83, 209], ['Polonium', 'Po', 84, 125, 84, 209],
  ['Astatine', 'At', 85, 125, 85, 210], ['Radon', 'Rn', 86, 136, 86, 222], ['Francium', 'Fr', 87, 136, 87, 223], ['Radium', 'Ra', 88, 138, 88, 226],
  ['Actinium', 'Ac', 89, 138, 89, 227], ['Thorium', 'Th', 90, 142, 90, 232], ['Protactinium', 'Pa', 91, 140, 91, 231], ['Uranium', 'U', 92, 146, 92, 238],
  ['Neptunium', 'Np', 93, 144, 93, 237], ['Plutonium', 'Pu', 94, 150, 94, 244], ['Americium', 'Am', 95, 148, 95, 243], ['Curium', 'Cm', 96, 151, 96, 247],
  ['Berkelium', 'Bk', 97, 150, 97, 247], ['Californium', 'Cf', 98, 153, 98, 251], ['Einsteinium', 'Es', 99, 153, 99, 252], ['Fermium', 'Fm', 100, 157, 100, 257],
  ['Mendelevium', 'Md', 101, 157, 101, 258], ['Nobelium', 'No', 102, 157, 102, 259], ['Lawrencium', 'Lr', 103, 163, 103, 266], ['Rutherfordium', 'Rf', 104, 163, 104, 267],
  ['Dubnium', 'Db', 105, 163, 105, 268], ['Seaborgium', 'Sg', 106, 163, 106, 269], ['Bohrium', 'Bh', 107, 163, 107, 270], ['Hassium', 'Hs', 108, 161, 108, 269],
  ['Meitnerium', 'Mt', 109, 169, 109, 278], ['Darmstadtium', 'Ds', 110, 171, 110, 281], ['Roentgenium', 'Rg', 111, 171, 111, 282], ['Copernicium', 'Cn', 112, 173, 112, 285],
  ['Nihonium', 'Nh', 113, 173, 113, 286], ['Flerovium', 'Fl', 114, 175, 114, 289], ['Moscovium', 'Mc', 115, 175, 115, 290], ['Livermorium', 'Lv', 116, 177, 116, 293],
  ['Tennessine', 'Ts', 117, 177, 117, 294], ['Oganesson', 'Og', 118, 176, 118, 294],
].map(([name, symbol, protons, neutrons, electrons, mass]) => ({ name, symbol, protons, neutrons, electrons, mass }))

const ELEMENT_KIND = {
  H: 'nonmetal', Li: 'alkali', Na: 'alkali', K: 'alkali', Rb: 'alkali', Cs: 'alkali', Fr: 'alkali',
  Be: 'earth', Mg: 'earth', Ca: 'earth', Sr: 'earth', Ba: 'earth', Ra: 'earth',
  B: 'metalloid', Si: 'metalloid', Ge: 'metalloid', As: 'metalloid', Sb: 'metalloid', Te: 'metalloid',
  C: 'nonmetal', N: 'nonmetal', O: 'nonmetal', P: 'nonmetal', S: 'nonmetal', Se: 'nonmetal',
  F: 'halogen', Cl: 'halogen', Br: 'halogen', I: 'halogen', At: 'halogen', Ts: 'halogen',
  He: 'noble', Ne: 'noble', Ar: 'noble', Kr: 'noble', Xe: 'noble', Rn: 'noble', Og: 'noble',
  Al: 'post', Ga: 'post', In: 'post', Sn: 'post', Tl: 'post', Pb: 'post', Bi: 'post', Po: 'post',
  Nh: 'post', Fl: 'post', Mc: 'post', Lv: 'post',
}
const ELEMENT_COLORS = {
  alkali: '#fb923c', earth: '#facc15', transition: '#38bdf8', post: '#a78bfa', metalloid: '#4ade80',
  nonmetal: '#f9a8d4', halogen: '#fb7185', noble: '#94a3b8', lanthanide: '#f472b6', actinide: '#e879f9',
}

function elementKind(item) {
  if (ELEMENT_KIND[item.symbol]) return ELEMENT_KIND[item.symbol]
  if (item.protons >= 57 && item.protons <= 71) return 'lanthanide'
  if (item.protons >= 89 && item.protons <= 103) return 'actinide'
  return 'transition'
}

function tableSpot(z) {
  if (z === 1) return [1, 1]
  if (z === 2) return [1, 18]
  if (z <= 4) return [2, z - 2]
  if (z <= 10) return [2, z + 8]
  if (z <= 12) return [3, z - 10]
  if (z <= 18) return [3, z]
  if (z <= 36) return [4, z - 18]
  if (z <= 54) return [5, z - 36]
  if (z === 55) return [6, 1]
  if (z === 56) return [6, 2]
  if (z <= 71) return [9, z - 54]
  if (z <= 86) return [6, z - 68]
  if (z === 87) return [7, 1]
  if (z === 88) return [7, 2]
  if (z <= 103) return [10, z - 86]
  return [7, z - 100]
}

function ensureTable(el, note) {
  let grid = el.querySelector('.ptable')
  if (!grid) {
    const read = document.createElement('p')
    read.className = 'tread'
    grid = document.createElement('div')
    grid.className = 'ptable'
    ELEMENTS.forEach((item, index) => {
      const cell = document.createElement('button')
      cell.type = 'button'
      const kind = elementKind(item)
      cell.className = 'pcell ' + kind
      const spot = tableSpot(item.protons)
      cell.style.gridRow = String(spot[0])
      cell.style.gridColumn = String(spot[1])
      cell.style.background = ELEMENT_COLORS[kind]
      cell.textContent = item.symbol
      cell.addEventListener('pointerdown', (event) => {
        if (editing === el.dataset.id) event.stopPropagation()
      })
      cell.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        toggleElement(el.dataset.id, index)
      })
      grid.appendChild(cell)
    })
    el.append(read, grid)
    ensureWhere(el)
  }
  const bits = (note.state || '').padEnd(118, '0').slice(0, 118)
  let lastLit = null
  ;[...grid.children].forEach((cell, index) => {
    const on = bits[index] === '1'
    cell.classList.toggle('lit', on)
    if (on) lastLit = ELEMENTS[index]
  })
  const focus = el.dataset.focus
  const info = focus !== undefined ? ELEMENTS[Number(focus)] : lastLit
  const read = el.querySelector('.tread')
  read.textContent = info
    ? info.symbol + ' ' + info.name + ' · ' + info.protons + 'p ' + info.neutrons + 'n ' + info.electrons + 'e · mass ' + info.mass
    : 'Click an element'
}

async function toggleElement(id, index) {
  if (editing !== id || savingPlay) return
  const note = notes.find((item) => item.id === id)
  if (!note || note.kind !== 'table') return
  const bits = (note.state || '0'.repeat(118)).padEnd(118, '0').slice(0, 118).split('')
  bits[index] = bits[index] === '1' ? '0' : '1'
  const el = noteNodes.get(id)
  if (el) el.dataset.focus = String(index)
  await saveState(note, bits.join(''))
}

function freshMine() {
  const mines = Array(36).fill('0')
  while (mines.filter((bit) => bit === '1').length < 6) mines[Math.floor(Math.random() * 36)] = '1'
  return mines.join('') + '.'.repeat(36)
}

function freshLights() {
  let state = '0'.repeat(25)
  for (let n = 0; n < 12; n += 1) state = lightsTap(state, Math.floor(Math.random() * 25))
  if (!state.includes('1')) state = lightsTap(state, 12)
  return state
}

function freshMemo() {
  const deck = 'aabbccddeeffgghh'.split('')
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = deck[i]
    deck[i] = deck[j]
    deck[j] = swap
  }
  return deck.join('') + '.'.repeat(16)
}

function freshState(kind) {
  if (kind === 'mine') return freshMine()
  if (kind === 'lights') return freshLights()
  if (kind === 'memo') return freshMemo()
  if (kind === 'table') return '0'.repeat(118)
  return null
}

function mineParts(state) {
  const raw = state || ''
  return { mines: raw.slice(0, 36).padEnd(36, '0'), reveal: raw.slice(36, 72).padEnd(36, '.') }
}

function mineNeighbors(mines, index) {
  const col = index % 6
  const row = Math.floor(index / 6)
  let count = 0
  for (let r = Math.max(0, row - 1); r <= Math.min(5, row + 1); r += 1) {
    for (let c = Math.max(0, col - 1); c <= Math.min(5, col + 1); c += 1) {
      if ((r !== row || c !== col) && mines[r * 6 + c] === '1') count += 1
    }
  }
  return count
}

function mineOpen(mines, reveal, index) {
  const cells = reveal.split('')
  if (cells[index] !== '.') return cells.join('')
  if (mines[index] === '1') {
    cells[index] = '*'
    return cells.join('')
  }
  const stack = [index]
  while (stack.length) {
    const pos = stack.pop()
    if (cells[pos] !== '.') continue
    const count = mineNeighbors(mines, pos)
    cells[pos] = String(count)
    if (count === 0) {
      const col = pos % 6
      const row = Math.floor(pos / 6)
      for (let r = Math.max(0, row - 1); r <= Math.min(5, row + 1); r += 1) {
        for (let c = Math.max(0, col - 1); c <= Math.min(5, col + 1); c += 1) {
          if (cells[r * 6 + c] === '.') stack.push(r * 6 + c)
        }
      }
    }
  }
  return cells.join('')
}

function mineCleared(mines, reveal) {
  for (let i = 0; i < 36; i += 1) {
    if (mines[i] === '0' && !/^[0-8]$/.test(reveal[i])) return false
  }
  return true
}

function mineFlag(state, index) {
  const parts = mineParts(state)
  if (parts.reveal.includes('*') || mineCleared(parts.mines, parts.reveal)) return state
  const cells = parts.reveal.split('')
  if (cells[index] === '.') cells[index] = 'F'
  else if (cells[index] === 'F') cells[index] = '.'
  else return state
  return parts.mines + cells.join('')
}

function mineOpenState(state, index) {
  const parts = mineParts(state)
  if (parts.reveal.includes('*') || mineCleared(parts.mines, parts.reveal) || parts.reveal[index] !== '.') return state
  return parts.mines + mineOpen(parts.mines, parts.reveal, index)
}

function mineStatus(state) {
  const parts = mineParts(state)
  if (parts.reveal.includes('*')) return 'Boom'
  if (mineCleared(parts.mines, parts.reveal)) return 'Clear'
  const flags = [...parts.reveal].filter((cell) => cell === 'F').length
  return Math.max(0, 6 - flags) + ' mines'
}

function lightsTap(state, index) {
  const cells = state.split('')
  const col = index % 5
  const row = Math.floor(index / 5)
  for (const [r, c] of [[row, col], [row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]) {
    if (r < 0 || c < 0 || r > 4 || c > 4) continue
    const spot = r * 5 + c
    cells[spot] = cells[spot] === '1' ? '0' : '1'
  }
  return cells.join('')
}

function memoClick(state, index) {
  const deck = state.slice(0, 16)
  const board = state.slice(16, 32).split('')
  const open = []
  board.forEach((cell, spot) => {
    if (/[a-h]/.test(cell)) open.push(spot)
  })
  const clickedOpen = open.includes(index)
  if (open.length >= 2) {
    const same = board[open[0]] === board[open[1]]
    board[open[0]] = same ? board[open[0]].toUpperCase() : '.'
    board[open[1]] = same ? board[open[1]].toUpperCase() : '.'
  }
  if (!clickedOpen && board[index] === '.') board[index] = deck[index]
  return deck + board.join('')
}

function playStatus(note) {
  if (note.kind === 'mine') return mineStatus(note.state)
  if (note.kind === 'lights') {
    const on = [...(note.state || '')].filter((cell) => cell === '1').length
    return on ? on + ' on' : 'Clear'
  }
  const matched = [...(note.state || '').slice(16, 32)].filter((cell) => cell >= 'A' && cell <= 'H').length / 2
  return matched === 8 ? 'Matched' : matched + '/8 pairs'
}

function ensurePlay(el, note) {
  const size = note.kind === 'mine' ? 36 : note.kind === 'lights' ? 25 : 16
  let grid = el.querySelector('.grid')
  if (!grid) {
    grid = document.createElement('div')
    grid.className = 'grid'
    for (let i = 0; i < size; i += 1) {
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'cell'
      cell.addEventListener('pointerdown', (event) => {
        if (editing === el.dataset.id) event.stopPropagation()
      })
      cell.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const current = notes.find((item) => item.id === el.dataset.id)
        if (!current || editing !== current.id) return
        if (current.kind === 'mine') playMine(current, i, flagMode ? 'flag' : 'open')
        else if (current.kind === 'lights') playLights(current, i)
        else playMemo(current, i)
      })
      cell.addEventListener('contextmenu', (event) => {
        if (editing !== el.dataset.id) return
        event.preventDefault()
        const current = notes.find((item) => item.id === el.dataset.id)
        if (current && current.kind === 'mine') playMine(current, i, 'flag')
      })
      grid.appendChild(cell)
    }
    const turn = document.createElement('span')
    turn.className = 'turn'
    const flagBtn = document.createElement('button')
    flagBtn.type = 'button'
    flagBtn.className = 'flagmode'
    flagBtn.textContent = 'Flag'
    flagBtn.addEventListener('pointerdown', (event) => event.stopPropagation())
    flagBtn.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      flagMode = !flagMode
      flagBtn.classList.toggle('on', flagMode)
    })
    el.insertBefore(grid, el.firstChild)
    el.append(turn, flagBtn)
    ensureWhere(el)
  }
  const flagBtn = el.querySelector('.flagmode')
  flagBtn.hidden = note.kind !== 'mine' || editing !== note.id
  flagBtn.classList.toggle('on', flagMode)
  if (note.kind === 'mine') {
    const parts = mineParts(note.state)
    ;[...grid.children].forEach((cell, index) => {
      const mark = parts.reveal[index]
      const open = /^[0-8]$/.test(mark)
      cell.className = 'cell' + (mark === '*' ? ' boom' : mark === 'F' ? ' flag' : open ? ' open' : ' hidden')
      cell.textContent = mark === 'F' ? '\u2691' : mark === '*' ? '\u2022' : open && mark !== '0' ? mark : ''
      cell.style.color = MINE_COLORS[mark] || ''
    })
  } else if (note.kind === 'lights') {
    const bits = (note.state || '').padEnd(25, '0')
    ;[...grid.children].forEach((cell, index) => {
      cell.className = 'cell ' + (bits[index] === '1' ? 'on' : 'off')
      cell.textContent = ''
      cell.style.color = ''
    })
  } else {
    const boardFace = (note.state || '').slice(16, 32).padEnd(16, '.')
    ;[...grid.children].forEach((cell, index) => {
      const mark = boardFace[index]
      const matched = mark >= 'A' && mark <= 'H'
      cell.className = 'cell' + (mark === '.' ? ' down' : matched ? ' matched' : ' up')
      cell.textContent = mark === '.' ? '' : mark.toUpperCase()
      cell.style.color = ''
    })
  }
  el.querySelector('.turn').textContent = playStatus(note)
}

async function saveState(note, next) {
  if (!next || next === note.state) return
  const previous = note.state
  note.state = next
  savingPlay = note.id
  const el = noteNodes.get(note.id)
  if (el) {
    if (note.kind === 'table') ensureTable(el, note)
    else ensurePlay(el, note)
  }
  try {
    await api('?id=eq.' + note.id, { method: 'PATCH', body: { state: next } })
    showError('')
  } catch (err) {
    note.state = previous
    savingPlay = null
    if (el) {
      if (note.kind === 'table') ensureTable(el, note)
      else ensurePlay(el, note)
    }
    showError(serverMessage(err.message, 'That move is not next.'))
    loadNotes()
  } finally {
    if (savingPlay === note.id) savingPlay = null
  }
}

function playMine(note, index, mode) {
  if (editing !== note.id) return
  saveState(note, mode === 'flag' ? mineFlag(note.state, index) : mineOpenState(note.state, index))
}

function playLights(note, index) {
  if (editing !== note.id || !(note.state || '').includes('1')) return
  saveState(note, lightsTap(note.state, index))
}

function playMemo(note, index) {
  if (editing !== note.id) return
  const face = (note.state || '').slice(16, 32)
  if (/^[A-H]{16}$/.test(face)) return
  saveState(note, memoClick(note.state, index))
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
    showError('Wait 3 seconds before another note.')
    updateComposer()
    return
  }
  const now = Date.now()
  if (now - lastPlace < 400) return
  lastPlace = now
  const spot = pointer || worldFromEvent(event)
  const kind = placeKind
  const spec = KINDS[kind]
  const draft = {
    body: spec.label,
    color,
    x: spot.x,
    y: spot.y,
    z: nextZ(),
    tilt: 0,
    kind,
    marks: kind === 'game' ? '         ' : null,
    state: freshState(kind),
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
    const message = serverMessage(err.message, 'That note did not stick. Wait 3 seconds and try again.')
    if (/wait|second|minute/i.test(message)) markWait(ADD_WAIT)
    showError(message)
    updateComposer()
  }
}

function stopFollowing() {
  if (!editing && !savedView) return
  commitTextEdit()
  editing = null
  savedView = null
  board.classList.remove('editing')
  paintbar.hidden = true
  for (const note of notes) {
    const el = noteNodes.get(note.id)
    if (!el) continue
    const box = el.querySelector('.editbox')
    if (box) box.hidden = true
    const mark = el.querySelector('.editmark')
    if (mark) mark.hidden = true
    const label = el.querySelector('.note-text')
    if (label && note.kind === 'text') label.hidden = false
    if (note.kind === 'mine' || note.kind === 'lights' || note.kind === 'memo') ensurePlay(el, note)
  }
}

function enterEdit(note) {
  if (!savedView) savedView = { x: camera.x, y: camera.y, zoom: camera.zoom }
  editing = note.id
  board.classList.add('editing')
  paintbar.hidden = note.kind !== 'draw'
  tip.hidden = true
  paint(note)
}

function openTextEdit(el, note) {
  let box = el.querySelector('.editbox')
  if (!box) {
    box = document.createElement('textarea')
    box.className = 'editbox'
    box.maxLength = MAX_LENGTH
    box.rows = 4
    box.addEventListener('pointerdown', (event) => event.stopPropagation())
    box.addEventListener('input', () => queueTextSave(el.dataset.id))
    el.appendChild(box)
  }
  let mark = el.querySelector('.editmark')
  if (!mark) {
    mark = document.createElement('span')
    mark.className = 'editmark'
    mark.textContent = 'Esc'
    el.appendChild(mark)
  }
  mark.hidden = false
  box.hidden = false
  if (document.activeElement !== box) {
    box.value = note.body
    box.focus()
    const end = box.value.length
    box.setSelectionRange(end, end)
  }
}

let textTimer = 0
function queueTextSave(id) {
  clearTimeout(textTimer)
  textTimer = setTimeout(() => commitTextEdit(id), 280)
}

async function commitTextEdit(id) {
  const noteId = id || editing
  const note = notes.find((item) => item.id === noteId)
  if (!note || note.kind !== 'text') return
  const el = noteNodes.get(note.id)
  const box = el && el.querySelector('.editbox')
  if (!box) return
  const body = box.value.trim().slice(0, MAX_LENGTH)
  if (!body) {
    box.value = note.body
    return
  }
  if (body === note.body) return
  if (hasBlockedWord(body)) {
    showError('That word cannot go on the board.')
    box.value = note.body
    return
  }
  const previous = note.body
  note.body = body
  const label = el.querySelector('.note-text')
  if (label) label.textContent = body
  el.setAttribute('aria-label', body)
  try {
    await api('?id=eq.' + note.id, { method: 'PATCH', body: { body } })
    showError('')
  } catch (err) {
    note.body = previous
    if (label) label.textContent = previous
    el.setAttribute('aria-label', previous)
    box.value = previous
    showError(serverMessage(err.message, 'That edit did not save.'))
  }
}

function exitEdit() {
  commitTextEdit()
  const current = editing
  editing = null
  board.classList.remove('editing')
  paintbar.hidden = true
  const currentEl = current && noteNodes.get(current)
  if (currentEl) {
    const box = currentEl.querySelector('.editbox')
    if (box) box.hidden = true
    const mark = currentEl.querySelector('.editmark')
    if (mark) mark.hidden = true
    const label = currentEl.querySelector('.note-text')
    if (label && !currentEl.classList.contains('draw') && !currentEl.classList.contains('game') && !currentEl.classList.contains('mine') && !currentEl.classList.contains('lights') && !currentEl.classList.contains('memo') && !currentEl.classList.contains('table')) label.hidden = false
  }
  for (const note of notes) {
    const el = noteNodes.get(note.id)
    if (!el) continue
    if (note.kind === 'game') ensureGame(el, note)
    if (note.kind === 'mine' || note.kind === 'lights' || note.kind === 'memo') ensurePlay(el, note)
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
    const zoom = note.kind === 'table'
      ? clamp(Math.min((rect.width * 0.92) / 780, (rect.height * 0.86) / 500), 0.35, MAX_ZOOM)
      : note.kind === 'text'
        ? clamp(Math.min((rect.width * 0.42) / 230, (rect.height * 0.42) / 170), 1.4, 2.15)
        : clamp((Math.min(rect.width, rect.height) * 0.82) / 256, 1.15, MAX_ZOOM)
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

paintbar.addEventListener('pointerdown', (event) => {
  event.stopPropagation()
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
