const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const VERSION_FILE = path.join(__dirname, 'version.txt');
let codeVersion = 1;
try { codeVersion = parseInt(fs.readFileSync(VERSION_FILE, 'utf8').trim()) || 1; } catch {}
fs.watch(VERSION_FILE, () => {
  try { codeVersion = parseInt(fs.readFileSync(VERSION_FILE, 'utf8').trim()) || 1; } catch {}
});

app.use(express.static('public'));
app.use('/0PLAYER.png', express.static(path.join(__dirname, '0PLAYER.png')));
app.get('/version', (req, res) => {
  const id = req.query.sid;
  if (id) { const p = players.get(id); if (p) p.lastActive = Date.now(); }
  res.json({ version: codeVersion });
});

const STATE_FILE = path.join(__dirname, 'state.json');

let state = {
  annotations: [],
  nextId: 1
};

try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  state = saved;
  for (const a of state.annotations) {
    if (a.type === 'tetramino' && a.cells.length && a.cells[0].x !== undefined) {
      const OLD = 60;
      a.x = a.cells[0].x;
      a.y = a.cells[0].y;
      a.cells = a.cells.map(c => ({ ix: Math.round((c.x - a.x) / OLD), iy: Math.round((c.y - a.y) / OLD) }));
    }
  }
} catch {}

const players = new Map();

let saveTimer = null;
function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}
function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(STATE_FILE, JSON.stringify(state), () => {});
  }, 1000);
}

const EXPIRE_MS = 15 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of players) {
    if (now - p.lastActive > EXPIRE_MS) {
      players.delete(id);
      io.emit('player:leave', id);
      const s = io.sockets.sockets.get(id);
      if (s) s.disconnect(true);
    }
  }
}, 10000);

io.on('connection', (socket) => {
  const playerId = socket.id;
  function touch() { const p = players.get(playerId); if (p) p.lastActive = Date.now(); }

  socket.emit('state:sync', {
    annotations: state.annotations,
    players: Object.fromEntries(players)
  });

  socket.on('player:join', (data) => {
    players.set(playerId, { id: playerId, name: data.name, color: data.color, viewport: null, lastActive: Date.now() });
    io.emit('player:update', { id: playerId, ...players.get(playerId) });
  });

  socket.on('player:update', (data) => {
    touch();
    const p = players.get(playerId);
    if (!p) return;
    if (data.name !== undefined) p.name = data.name;
    if (data.color !== undefined) p.color = data.color;
    io.emit('player:update', { id: playerId, ...p });
  });

  socket.on('viewport:update', (viewport) => {
    touch();
    const p = players.get(playerId);
    if (!p) return;
    p.viewport = viewport;
    socket.broadcast.emit('viewport:update', { id: playerId, viewport, name: p.name, color: p.color });
  });

  socket.on('cursor:update', (cursor) => {
    const p = players.get(playerId);
    if (!p) return;
    socket.broadcast.emit('cursor:update', { id: playerId, cursor, name: p.name, color: p.color });
  });

  const redoStack = [];

  socket.on('annotation:add', (annotation) => {
    touch();
    annotation.id = state.nextId++;
    annotation.playerId = playerId;
    annotation.timestamp = Date.now();
    state.annotations.push(annotation);
    redoStack.length = 0;
    io.emit('annotation:add', annotation);
    debouncedSave();
  });

  socket.on('annotation:dragging', (data) => {
    socket.broadcast.emit('annotation:dragging', data);
  });

  socket.on('annotation:toggle', (id) => {
    const a = state.annotations.find(a => a.id === id);
    if (!a) return;
    a.on = !a.on;
    io.emit('annotation:toggle', id);
    debouncedSave();
  });

  socket.on('annotation:move', ({ id, dx, dy }) => {
    const a = state.annotations.find(a => a.id === id);
    if (!a) return;
    if (a.type === 'text' || a.type === 'tetramino' || a.type === 'signal') { a.x += dx; a.y += dy; }
    else if (a.type === 'pen') { for (const p of a.points) { p.x += dx; p.y += dy; } }
    else { a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy; }
    io.emit('annotation:move', { id, dx, dy });
    debouncedSave();
  });

  socket.on('annotation:remove', (id) => {
    state.annotations = state.annotations.filter(a => a.id !== id);
    io.emit('annotation:remove', id);
    debouncedSave();
  });

  socket.on('annotation:undo', () => {
    const last = [...state.annotations].reverse().find(a => a.playerId === playerId);
    if (last) {
      state.annotations = state.annotations.filter(a => a.id !== last.id);
      redoStack.push(last);
      io.emit('annotation:remove', last.id);
      debouncedSave();
    }
  });

  socket.on('annotation:redo', () => {
    const item = redoStack.pop();
    if (item) {
      state.annotations.push(item);
      io.emit('annotation:add', item);
      debouncedSave();
    }
  });


  socket.on('disconnect', () => {
    players.delete(playerId);
    io.emit('player:leave', playerId);
    if (saveTimer) flushSave();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
