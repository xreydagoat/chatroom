const socket = io();

const roomCodeInput = document.getElementById('roomCode');
const roomPasswordInput = document.getElementById('roomPassword');
const joinBtn = document.getElementById('joinBtn');
const roomDiv = document.getElementById('room');
const roomNameSpan = document.getElementById('roomName');
const roomTypeSpan = document.getElementById('roomType');
const userCountSpan = document.getElementById('userCount');
const chatDiv = document.getElementById('chat');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const errorDiv = document.getElementById('error');

let currentRoom = null;

joinBtn.onclick = () => {
  const roomCode = roomCodeInput.value.trim();
  const password = roomPasswordInput.value;
  if (!roomCode) return alert('Room code is required.');
  socket.emit('joinRoom', { roomCode, password });
};

sendBtn.onclick = () => {
  const message = messageInput.value.trim();
  if (message && currentRoom) {
    socket.emit('chatMessage', { roomCode: currentRoom, message });
    messageInput.value = '';
  }
};

socket.on('joinedRoom', ({ roomCode, isPrivate }) => {
  currentRoom = roomCode;
  roomDiv.style.display = 'block';
  roomNameSpan.textContent = roomCode;
  roomTypeSpan.textContent = isPrivate ? 'Private' : 'Public';
  errorDiv.textContent = '';
  chatDiv.innerHTML = '';
});

socket.on('chatMessage', ({ sender, message }) => {
  const div = document.createElement('div');
  div.textContent = `${sender.substring(0,5)}: ${message}`;
  chatDiv.appendChild(div);
  chatDiv.scrollTop = chatDiv.scrollHeight;
});

socket.on('userCount', (count) => userCountSpan.textContent = count);
socket.on('errorMsg', (msg) => errorDiv.textContent = msg);
