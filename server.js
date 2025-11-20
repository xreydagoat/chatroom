// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// serve static client files from 'public' directory
app.use(express.static('public'));

/*
Room schema:
rooms = {
  roomId: {
    id: roomId,
    name: "My Room",
    isPrivate: false,
    password: null, // if private
    clients: Set of ws,
    createdAt: Date
  }
}
*/
const rooms = new Map();
const MAX_USERS_PER_ROOM = 4;

/* Utility to broadcast list of public rooms to all clients */
function broadcastPublicRooms() {
  const publicRooms = Array.from(rooms.values())
    .filter(r => !r.isPrivate)
    .map(r => ({ id: r.id, name: r.name, count: r.clients.size }));
  const payload = JSON.stringify({ type: 'room_list', rooms: publicRooms });
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  });
}

/* Validate payload helper */
function safeParse(data) {
  try { return JSON.parse(data); } catch (e) { return null; }
}

wss.on('connection', (ws) => {
  ws._id = uuidv4(); // small id for server-side logs
  ws._roomId = null;

  // send initial public rooms list
  broadcastPublicRooms();

  ws.on('message', (msg) => {
    const data = safeParse(msg);
    if (!data || !data.type) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      return;
    }

    switch (data.type) {
      case 'create_room': {
        // { type: 'create_room', name: 'room name', isPrivate: bool, password: 'opt' }
        const name = String(data.name || 'Unnamed Room').slice(0, 100);
        const isPrivate = Boolean(data.isPrivate);
        const password = isPrivate ? String(data.password || '') : null;
        const id = uuidv4();

        rooms.set(id, {
          id,
          name,
          isPrivate,
          password,
          clients: new Set(),
          createdAt: Date.now()
        });

        // respond with room info
        ws.send(JSON.stringify({ type: 'create_room_success', room: { id, name, isPrivate } }));
        broadcastPublicRooms();
        break;
      }

      case 'list_rooms': {
        // ask server for public room list
        const publicRooms = Array.from(rooms.values())
          .filter(r => !r.isPrivate)
          .map(r => ({ id: r.id, name: r.name, count: r.clients.size }));
        ws.send(JSON.stringify({ type: 'room_list', rooms: publicRooms }));
        break;
      }

      case 'join_room': {
        // { type: 'join_room', id: ROOMID, password: 'opt', displayName: 'Name' }
        const roomId = data.id;
        const room = rooms.get(roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: 'join_error', message: 'Room not found' }));
          break;
        }
        if (room.isPrivate && room.password !== String(data.password || '')) {
          ws.send(JSON.stringify({ type: 'join_error', message: 'Incorrect password' }));
          break;
        }
        if (room.clients.size >= MAX_USERS_PER_ROOM) {
          ws.send(JSON.stringify({ type: 'join_error', message: 'Room is full (max 4)' }));
          break;
        }

        // join
        room.clients.add(ws);
        ws._roomId = roomId;
        ws._displayName = String(data.displayName || 'Anonymous').slice(0, 30);

        // notify this client success + room info + current occupants
        const occupants = Array.from(room.clients).map(c => ({
          id: c._id,
          displayName: c._displayName || 'Anonymous'
        }));
        ws.send(JSON.stringify({ type: 'join_success', room: { id: room.id, name: room.name }, occupants }));

        // notify other clients in room about join
        const joinMsg = JSON.stringify({
          type: 'user_joined',
          user: { id: ws._id, displayName: ws._displayName },
          count: room.clients.size
        });
        room.clients.forEach(c => {
          if (c !== ws && c.readyState === WebSocket.OPEN) c.send(joinMsg);
        });

        broadcastPublicRooms();
        break;
      }

      case 'leave_room': {
        const roomId = ws._roomId;
        if (!roomId) {
          ws.send(JSON.stringify({ type: 'leave_error', message: 'Not in a room' }));
          break;
        }
        const room = rooms.get(roomId);
        if (room) {
          room.clients.delete(ws);
          const leftMsg = JSON.stringify({
            type: 'user_left',
            user: { id: ws._id, displayName: ws._displayName },
            count: room.clients.size
          });
          room.clients.forEach(c => {
            if (c.readyState === WebSocket.OPEN) c.send(leftMsg);
          });
          // remove room if empty (optional)
          if (room.clients.size === 0 && Date.now() - room.createdAt > 1000) {
            rooms.delete(roomId);
          }
          ws._roomId = null;
        }
        ws.send(JSON.stringify({ type: 'left_room' }));
        broadcastPublicRooms();
        break;
      }

      case 'message': {
        // { type: 'message', text: '...' }
        const text = String(data.text || '').slice(0, 2000);
        const roomId = ws._roomId;
        if (!roomId) {
          ws.send(JSON.stringify({ type: 'error', message: 'You are not in a room' }));
          break;
        }
        const room = rooms.get(roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          break;
        }
        const chatMsg = JSON.stringify({
          type: 'message',
          from: { id: ws._id, displayName: ws._displayName },
          text,
          ts: Date.now()
        });
        room.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) c.send(chatMsg);
        });
        break;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  });

  ws.on('close', () => {
    // remove from any room
    const roomId = ws._roomId;
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.clients.delete(ws);
        const leftMsg = JSON.stringify({
          type: 'user_left',
          user: { id: ws._id, displayName: ws._displayName },
          count: room.clients.size
        });
        room.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) c.send(leftMsg);
        });
        if (room.clients.size === 0) {
          rooms.delete(roomId);
        }
      }
    }
    broadcastPublicRooms();
  });

  ws.on('error', (err) => {
    console.error('WS error', err);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
