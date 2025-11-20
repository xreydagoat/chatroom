const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const rooms = {}; // Stores rooms and users

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('joinRoom', ({ roomCode, password }) => {
    if (!roomCode) return socket.emit('errorMsg', 'Room code required.');

    let room = rooms[roomCode];

    if (room) {
      if (room.isPrivate && room.password !== password) {
        return socket.emit('errorMsg', 'Incorrect password.');
      }
      if (room.users.size >= 4) {
        return socket.emit('errorMsg', 'Room is full.');
      }
      room.users.add(socket.id);
    } else {
      rooms[roomCode] = {
        users: new Set([socket.id]),
        isPrivate: !!password,
        password: password || ''
      };
    }

    socket.join(roomCode);
    socket.emit('joinedRoom', { roomCode, isPrivate: rooms[roomCode].isPrivate });
    io.to(roomCode).emit('userCount', rooms[roomCode].users.size);
  });

  socket.on('chatMessage', ({ roomCode, message }) => {
    if (rooms[roomCode]?.users.has(socket.id)) {
      io.to(roomCode).emit('chatMessage', { sender: socket.id, message });
    }
  });

  socket.on('disconnecting', () => {
    for (const roomCode of socket.rooms) {
      if (rooms[roomCode]) {
        rooms[roomCode].users.delete(socket.id);
        io.to(roomCode).emit('userCount', rooms[roomCode].users.size);
        if (rooms[roomCode].users.size === 0) delete rooms[roomCode];
      }
    }
  });

  socket.on('disconnect', () => console.log(`User disconnected: ${socket.id}`));
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
