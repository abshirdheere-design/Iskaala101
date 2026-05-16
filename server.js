'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = {};
let onlineUsers = 0;
const TURN_TIME_LIMIT = 30000;

function getCardPoints(value) {
  if (['J','Q','K'].includes(value)) return 10;
  if (value === 'A') return 11;
  const p = parseInt(value);
  return isNaN(p) ? 0 : p;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createDeck() {
  const suits = ['♦','♥','♠','♣'];
  const values = ['6','7','8','9','10','J','Q','K','A'];
  const deck = [];
  for (let i = 0; i < 4; i++) {
    for (const s of suits) {
      for (const v of values) {
        deck.push({
          suit: s, value: v,
          id: `${s}-${v}-${i}-${Math.random().toString(36).substr(2,5)}`,
          points: getCardPoints(v)
        });
      }
    }
  }
  return shuffle(deck);
}

function prepareGame(playerCount) {
  const deck = createDeck(); // 104 kaar
  const hands = [];
  for (let i = 0; i < playerCount; i++) {
    // Qofka koowaad (i=0) sii 15, kuwa kale 14
    const count = (i === 0) ? 15 : 14; 
    hands.push(deck.splice(0, count));
  }
  return { allHands: hands, remainingDeck: deck };
}

function refillStockIfEmpty(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.stockPile.length === 0 && room.discardPile.length > 1) {
    const top = room.discardPile.pop();
    room.stockPile = shuffle([...room.discardPile]);
    room.discardPile = [top];
    io.to(roomId).emit('updateStockCount', room.stockPile.length);
    io.to(roomId).emit('discardPileUpdate', { topCard: room.discardPile[room.discardPile.length - 1] });
  }
}

function updateRoomPlayers(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const active = room.players[room.activePlayerIndex];
  io.to(roomId).emit('playersUpdate', {
    players: room.players.map(p => ({
      id: p.id, name: p.name, cardCount: p.hand.length,
      isOpened: p.isOpened || false, online: p.online, points: p.points || 0
    })),
    stockCount: room.stockPile ? room.stockPile.length : 0,
    currentTurnId: active ? active.id : null,
    turnStartTime: room.turnStartTime
  });
  room.players.forEach((player, index) => {
    const pLen = room.players.length;
    const left  = room.players[(index + 1) % pLen];
    const top   = room.players[(index + 2) % pLen];
    const right = room.players[(index + 3) % pLen];
    io.to(player.id).emit('updateOpponents', {
      left:  left  && left.id  !== player.id ? { name: left.name  } : null,
      top:   top   && top.id   !== player.id ? { name: top.name   } : null,
      right: right && right.id !== player.id ? { name: right.name } : null,
    });
  });
}

function broadcastTableUI(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit('updateTableUI', {
    players: room.players.map(p => ({
      id: p.id, name: p.name, isOpened: p.isOpened, openedSets: p.openedSets || []
    })),
    nextRequiredPoints: room.lastOpenPoints || 101
  });
}

function startTurnTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.turnTimeout) clearTimeout(room.turnTimeout);
  room.turnStartTime = Date.now();
  updateRoomPlayers(roomId);
  const player = room.players[room.activePlayerIndex];
  if (!player) return;
  player.hasActioned = player.hand.length >= 15;
  room.turnTimeout = setTimeout(() => {
    if (!room.gameStarted) return;
    const cur = room.players[room.activePlayerIndex];
    if (!cur) return;
    if (!cur.hasActioned && room.stockPile.length > 0) {
      const card = room.stockPile.pop();
      cur.hand.push(card); cur.hasActioned = true;
      io.to(cur.id).emit('receiveCard', card);
    }
    if (cur.hand.length > 14) {
      const discarded = cur.hand.pop();
      room.discardPile.push(discarded);
      io.to(roomId).emit('updateDiscardPile', discarded);
      io.to(cur.id).emit('autoDiscarded', discarded);
      io.to(cur.id).emit('updateHand', { hand: cur.hand });
    }
    moveToNextPlayer(roomId);
  }, TURN_TIME_LIMIT);
}

function moveToNextPlayer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  // ✅ SAXID: nadiifi pause-ka si turn cusub uu si caadi ah u bilaabanaa
  room.isPaused = false;
  room.pauseTimeLeft = undefined;
  if (room.turnTimeout) {
    clearTimeout(room.turnTimeout);
    room.turnTimeout = null;
  }
  room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
  let safety = 0;
  while (safety < room.players.length) {
    const cur = room.players[room.activePlayerIndex];
    if (cur && cur.online && !cur.hoosgale) break;
    room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
    safety++;
  }
  const next = room.players[room.activePlayerIndex];
  room.players.forEach(p => { p.hasActioned = false; p.pickedFromDiscard = false; });
  startTurnTimer(roomId);
  io.to(roomId).emit('playersUpdate', {
    players: room.players.map(p => ({
      id: p.id, name: p.name, cardCount: p.hand.length,
      isOpened: p.isOpened || false, online: p.online,
      points: p.points || 0, hoosgale: p.hoosgale || false
    })),
    stockCount: room.stockPile.length,
    currentTurnId: next ? next.id : null,
    turnStartTime: room.turnStartTime
  });
  if (next) io.to(next.id).emit('yourTurn');
}

// 3. JIDKA GUUD EE START TURN TIMER (SERVER-SIDE)
function startTurnTimer(room) {
  if (room.turnTimeout) clearTimeout(room.turnTimeout);
  
  room.turnStartTime = Date.now();
  room.isPaused = false; // Saacadda cusub mar walba si caadi ah ayay u furmeysaa

  room.turnTimeout = setTimeout(() => {
    // BUG 2 FIX: Haddii qolku pause galay intay 30-ka ilbiriqsi socdeen, ha wareejin turn-ka!
    if (room.isPaused) return; 

    if (room.gameStarted && room.activePlayerIndex !== null) {
      moveToNextPlayer(room);
    }
  }, TURN_TIME_LIMIT);
}

io.on('connection', socket => {
  onlineUsers++;
  io.emit('updateOnlineCount', onlineUsers);
  socket.on('animation_finished', () => {
    const room = rooms[socket.roomId];
    if (room && !room.timerStarted) {
        startTurnTimer(socket.roomId); // Halkan ka billow saacadda rasmiga ah
        room.timerStarted = true;
    }
});

  socket.on('joinRandom', name => {
    // 1. Hubi haddii ciyaaryahanku hore u jiray (Reconnection)
    for (const id in rooms) {
      const room = rooms[id];
      const existing = room.players.find(p => p.name === name && p.online === false);
      if (existing) {
        existing.id = socket.id; 
        existing.online = true;
        socket.roomId = id; 
        socket.join(id);
        socket.emit('startHand', existing.hand);
        
        if (room.discardPile.length > 0)
          socket.emit('updateDiscardPile', room.discardPile[room.discardPile.length - 1]);
        
        broadcastTableUI(id);
        const cur = room.players[room.activePlayerIndex];
        socket.emit('matchFound', {
          roomId: id,
          topDiscard: room.discardPile[room.discardPile.length - 1],
          currentTurn: cur ? cur.id : null
        });
        updateRoomPlayers(id);
        socket.emit('notification', 'Waad ku soo laabtay!');
        return;
      }
    }

    // 2. Raadi qol banaan ama samee mid cusub
    let roomId = Object.keys(rooms).find(id => rooms[id].players.length < 4 && !rooms[id].gameStarted);
    if (!roomId) {
      roomId = 'Room_' + Math.random().toString(36).slice(2, 11);
      rooms[roomId] = {
        id: roomId, players: [], gameStarted: false,
        stockPile: [], discardPile: [], activePlayerIndex: 0,
        lastOpenPoints: 101, turnTimeout: null, turnStartTime: null,
        lastProviderId: null, turnInProgress: false
      };
    }

    // 3. Abuur ciyaaryahanka cusub
    const player = {
      id: socket.id, name: name || `User_${socket.id.slice(0,4)}`,
      hand: [], isOpened: false, hasActioned: false, pickedFromDiscard: false,
      openedSets: [], online: true, points: 0, tempScore: 0
    };

    rooms[roomId].players.push(player);
    socket.join(roomId); 
    socket.roomId = roomId;

    const room = rooms[roomId];
    io.to(roomId).emit('waitingRoomUpdate', { players: room.players.map(p => ({ name: p.name })) });

    // 4. Haddii ay 4 ciyaartoy buuxsamaan, billow ciyaarta
    if (room.players.length === 4) {
      room.gameStarted = true; 
      room.turnStartTime = Date.now();
      
      const gd = prepareGame(4); 
      room.stockPile = gd.remainingDeck; // Halkan turubka wuxuu ku bilaabanayaa 88 ama 87

      room.players.forEach((p, i) => {
        p.hand = gd.allHands[i];
        
        // --- SAXID: Waxaan ka saarnay p.hand.push-kii John siinayay 16-ka ---
        if (i === 0) { 
            // John horey ayuu 15 u haystaa, marka kaliya hasActioned u deji true
            p.hasActioned = true; 
        }
        
        io.to(p.id).emit('startHand', p.hand);
      });

      // Dhig kaarka u horeeya ee tuurista (Discard Pile)
      if (room.stockPile.length > 0) {
          room.discardPile = [room.stockPile.pop()];
      }

      // U sheeg qof kasta xogta ciyaarta
      io.to(roomId).emit('matchFound', {
        roomId, 
        topDiscard: room.discardPile[room.discardPile.length - 1],
        currentTurn: room.players[0].id
      });

      // --- CUSBOONAYSIIN: U sheeg qof kasta in turubku hadda yahay 87 ---
      io.to(roomId).emit('updateStockCount', room.stockPile.length);

      startTurnTimer(roomId);
      updateRoomPlayers(roomId);
    }
});

  socket.on('updatePenaltyScore', data => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const p = room.players.find(p => p.id === data.playerId);
    if (p) {
      p.points = (p.points || 0) + data.points;
      io.to(socket.roomId).emit('scoreUpdated', { playerId: p.id, newTotal: p.points });
    }
  });

  socket.on('drawCard', () => {
  const room = rooms[socket.roomId];
  if (!room || !room.gameStarted) return;

  const p = room.players[room.activePlayerIndex];
  if (p.id !== socket.id) return;

  // Haddii uu haysto 15 kaar, waa inuu mid tuuraa marka hore
  if (p.hand.length >= 15) {
    socket.emit('notification', 'Ma qaadan kartid kaar kale. Mid tuur marka hore!');
    return;
  }

  if (p.hasActioned) {
    socket.emit('notification', 'Horey ayaad u qaadatay kaar.');
    return;
  }

  refillStockIfEmpty(socket.roomId);
  if (room.stockPile && room.stockPile.length > 0) {
    const card = room.stockPile.pop();
    p.hand.push(card);
    p.hasActioned = true;
    socket.emit('receiveCard', card);
    
    // MUHIIM: U sheeg qof kasta in turubku yaraaday
    io.to(socket.roomId).emit('updateStockCount', room.stockPile.length);
    updateRoomPlayers(socket.roomId);
  }
});

  socket.on('pickDiscard', () => {
    const room = rooms[socket.roomId];
    if (!room || !room.gameStarted) return;
    if (room.players[room.activePlayerIndex].id !== socket.id) return;
    const p = room.players[room.activePlayerIndex];
    if (p.hasActioned) return;
    if (room.discardPile && room.discardPile.length > 0) {
      const card = room.discardPile.pop();
      p.hand.push(card); p.hasActioned = true; p.pickedFromDiscard = true;
      socket.emit('discardPickedSuccess', { card });
      socket.emit('updateHand', { hand: p.hand });
      broadcastTableUI(socket.roomId);
      io.to(socket.roomId).emit('updateDiscardPile', room.discardPile[room.discardPile.length - 1] || null);
    }
  });

  socket.on('playCard', card => {
  const room = rooms[socket.roomId];
  if (!room || !room.gameStarted) return;
  const p = room.players[room.activePlayerIndex];
  if (p.id !== socket.id) return;
  const idx = p.hand.findIndex(c => c.id === card.id);
  if (idx === -1) return;
  room.lastProviderId = p.id;
  p.hand.splice(idx, 1);
  room.discardPile.push(card);
  io.to(socket.roomId).emit('updateDiscardPile', card);
  socket.emit('updateHand', { hand: p.hand });
  if (p.hand.length === 0) {
    // ✅ Guul — ciyaartu waa dhammaatay
    room.gameStarted = false;
    if (room.turnTimeout) clearTimeout(room.turnTimeout);
    // Hoosgale players: 1 fooro
    room.players.forEach(pl => {
      if (pl.hoosgale) pl.points = (pl.points || 0) + 1;
    });
    io.to(socket.roomId).emit('gameOver', {
      winnerId: p.id, winnerName: p.name, providerId: room.lastProviderId,
      allPlayers: room.players.map(pl => ({
        id: pl.id, name: pl.name, isOpened: pl.isOpened,
        hand: pl.hand, points: pl.points || 0
      }))
    });
  } else {
    // ✅ Hoosgale check — tuurista qaatay oo aan degi karin
    if (p.pickedFromDiscard && !p.hoosgale) {
      p.hoosgale = true;
      room.stockPile = shuffle([...room.stockPile, ...p.hand]);
      p.hand = [];
      io.to(p.id).emit('hoosgaleTriggered');
      io.to(socket.roomId).emit('notification', `⚠️ ${p.name} HOOSGALE! hoos ayuu galay turubiina waa laga qaaday oo hoos ayaa la galiyay.`);
      updateRoomPlayers(socket.roomId);
    }
    moveToNextPlayer(socket.roomId);
  }
});

  socket.on('meldSets', data => {
    const room = rooms[socket.roomId];
    if (!room || !room.gameStarted) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (!p) return;
    const sets = Array.isArray(data) ? data : data.sets;
    const totalScore = typeof data === 'object' && !Array.isArray(data) ? data.totalScore : undefined;
    const removeIds = new Set(sets.flat().map(c => c.id));
    p.hand = p.hand.filter(c => !removeIds.has(c.id));
    p.isOpened = true; p.openedSets.push(...sets);
    if (totalScore !== undefined) room.lastOpenPoints = totalScore + 1;
    socket.emit('updateHand', { hand: p.hand });
    broadcastTableUI(socket.roomId);
    updateRoomPlayers(socket.roomId);
  });

  socket.on('resetMyOpenedCards', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (!p || p.isOpened) return;
    p.openedSets = []; p.tempScore = 0;
    socket.emit('startHand', p.hand);
    broadcastTableUI(socket.roomId);
  });

  socket.on('syncHandAfterMeld', hand => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (p) p.hand = hand;
  });

  socket.on('request_sync', () => {
    if (socket.roomId && rooms[socket.roomId]) {
      updateRoomPlayers(socket.roomId);
      const room = rooms[socket.roomId];
      if (room.discardPile.length > 0)
        socket.emit('updateDiscardPile', room.discardPile[room.discardPile.length - 1]);
    }
  });

 // 1. HAKINTA SAACADDA (SERVER-SIDE)
socket.on('pauseTimer', () => {
  const room = rooms[socket.roomId];
  if (!room || !room.gameStarted) return; // Lagama rabo 'room.isPaused' halkan si uusan u xannibmin

  const cur = room.players[room.activePlayerIndex];
  if (!cur || cur.id !== socket.id) return;

  // Xisaabi waqtiga rasmiga ah ee u haray intaan timeout-ka la tirin
  if (!room.isPaused) {
    const timeElapsed = Date.now() - room.turnStartTime;
    room.pauseTimeLeft = Math.max(5000, TURN_TIME_LIMIT - timeElapsed);
  }

  // BUG 1 FIX: Calanka 'isPaused' hadda si JOOGTO ah ayaa loo dejiyaa, ha jiro timeout ama yuusan jirin!
  room.isPaused = true; 

  if (room.turnTimeout) {
    clearTimeout(room.turnTimeout);
    room.turnTimeout = null;
  }

  io.to(socket.roomId).emit('timerPaused', {
    activePlayerId: socket.id,
    message: `⏸️ ${cur.name} baa dalbaday in la sugo — Waqtiga waa la hakiyay!`
  });
});

// 2. DIB U BILAABISTA SAACADDA (SERVER-SIDE)
socket.on('resumeTimer', () => {
  const room = rooms[socket.roomId];
  if (!room || !room.gameStarted || !room.isPaused) return;

  const cur = room.players[room.activePlayerIndex];
  if (!cur || cur.id !== socket.id) return;

  room.isPaused = false;
  // Dib u xisaabi waqtigii bilowga si uusan ilbiriqsigu u dhiman
  room.turnStartTime = Date.now() - (TURN_TIME_LIMIT - room.pauseTimeLeft);

  if (room.turnTimeout) clearTimeout(room.turnTimeout);

  // Dib u rur saacadda haraaga ah
  room.turnTimeout = setTimeout(() => {
    // BUG 3 FIX: Haddii qofku dib u hakiyay intuu callback-gan dhexda ku jiray, HALKAN KU ISTAAG!
    if (room.isPaused) return; 

    if (room.gameStarted && room.activePlayerIndex !== null) {
      moveToNextPlayer(room); // Ama function-kaaga caadiga ah ee wareejinta
    }
  }, room.pauseTimeLeft);

  io.to(socket.roomId).emit('timerResumed');
});

  socket.on('ping_keep_alive', () => socket.emit('pong_alive'));

  socket.on('disconnect', () => {
    onlineUsers--;
    io.emit('updateOnlineCount', onlineUsers);
    const room = rooms[socket.roomId];
    if (!room) return;
    const pidx = room.players.findIndex(p => p.id === socket.id);
    if (pidx === -1) return;
    const player = room.players[pidx];
    if (!room.gameStarted) {
      room.players = room.players.filter(p => p.id !== socket.id);
    } else {
      player.online = false;
      if (room.activePlayerIndex === pidx) {
        if (room.turnTimeout) clearTimeout(room.turnTimeout);
        moveToNextPlayer(socket.roomId);
      }
    }
    const online = room.players.filter(p => p.online).length;
    if (online === 0) { if (room.turnTimeout) clearTimeout(room.turnTimeout); delete rooms[socket.roomId]; }
    else updateRoomPlayers(socket.roomId);
  });
});

httpServer.listen(PORT, () => console.log(`Turubka 101 server running on port ${PORT}`));