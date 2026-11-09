'use strict';
require('dotenv').config({ quiet: true });
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const game = require('./game');
const createAdminRouter = require('./routes/admin');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const server = http.createServer(app);

const io = new Server(server, {
  perMessageDeflate: false,     // 작은 메시지를 자주 보내므로 압축 끄기 = CPU·지연 감소
  httpCompression: false,
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5,
});

app.use(express.json({ limit: '3mb' }));
app.get('/vendor/phaser.min.js', (req, res) => {
  res.set('Cache-Control', 'public, max-age=604800');
  res.sendFile(require.resolve('phaser/dist/phaser.min.js'));
});
app.use(express.static(PUBLIC, { maxAge: '10m' }));
app.get('/teacher', (req, res) => res.sendFile(path.join(PUBLIC, 'teacher.html')));
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use('/api/admin', createAdminRouter({ game }));

game.attach(io);

server.listen(PORT, () => {
  console.log(`🎄 Jump Tower 서버 실행 중: http://localhost:${PORT}  (교사 화면: /teacher)`);
});
