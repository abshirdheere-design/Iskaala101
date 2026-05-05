const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
});

app.use(express.static(path.join(__dirname, "public")));

// GLOBAL STATE
let rooms = {}; 
let onlineUsers = 0;
const TURN_TIME_LIMIT = 30000; 
const POSITIONS = ['bottom', 'left', 'top', 'right'];

/* 1. DECK LOGIC */
function createDeck() {
    const suits = ['♦', '♥', '♠', '♣'];
    const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let newDeck = [];
    for (let i = 0; i < 4; i++) {
        for (let s of suits) {
            for (let v of values) {
                newDeck.push({ 
                    suit: s, 
                    value: v, 
                    id: `${s}-${v}-${i}-${Math.random().toString(36).substr(2, 5)}`,
                    points: getCardPoints(v)
                });
            }
        }
    }
    return shuffle(newDeck);
}

function getCardPoints(value) {
    if (['J', 'Q', 'K'].includes(value)) return 10;
    if (value === 'A') return 11;
    const points = parseInt(value);
    return (!isNaN(points)) ? points : 0;
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function prepareGame(playerCount) {
    let deck = createDeck(); 
    let hands = [];
    for (let i = 0; i < playerCount; i++) {
        hands.push(deck.splice(0, 14));
    }
    return { allHands: hands, remainingDeck: deck };
}


function nextTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    // Jooji saacaddii hore
    if (room.turnTimeout) clearTimeout(room.turnTimeout);

    // Wareeji doorka
    room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
    room.turnStartTime = Date.now(); 

    const currentPlayer = room.players[room.activePlayerIndex];
    
    // Dib u deji xaaladda qofka cusub
    currentPlayer.hasActioned = false;
    currentPlayer.pickedFromDiscard = false;

    // U sheeg qof kasta in turn-ka la beddelay
    updateRoomPlayers(roomId);

    // ROBOT: Haddii qofku seexdo (35 ilbiriqsi)
    room.turnTimeout = setTimeout(() => {
        if (!room.gameStarted) return;
        
        console.log(`ROBOT: ${currentPlayer.name} waa laga daahay.`);

        // Auto-Draw haddii uusan waxba qaadan
        if (!currentPlayer.hasActioned && room.stockPile.length > 0) {
            const card = room.stockPile.pop();
            currentPlayer.hand.push(card);
            currentPlayer.hasActioned = true;
            io.to(currentPlayer.id).emit("receiveCard", card);
        }

        // Auto-Discard (Mid tuur si ciyaartu u socoto)
        if (currentPlayer.hand.length > 0) {
            const cardToDiscard = currentPlayer.hand.pop();
            room.discardPile.push(cardToDiscard);
            io.to(roomId).emit("updateDiscardPile", cardToDiscard);
            io.to(currentPlayer.id).emit("startHand", currentPlayer.hand);
        }

        nextTurn(roomId); // U gudbi qofka xiga
    }, 35000);
}

io.on("connection", (socket) => {
    onlineUsers++;
    io.emit("updateOnlineCount", onlineUsers);

    /* ----------------------------------
       1. JOIN / RECONNECT LOGIC
    ---------------------------------- */
    socket.on("joinRandom", (name) => {
        // 1. --- RECONNECT LOGIC ---
        for (let id in rooms) {
            let room = rooms[id];
            let existingPlayer = room.players.find(p => p.name === name && p.online === false);
            
            if (existingPlayer) {
                console.log(`RECONNECT: ${name} dib u soo laabasho.`);
                existingPlayer.id = socket.id; 
                existingPlayer.online = true;  
                socket.roomId = id;
                socket.join(id);
                
                socket.emit("startHand", existingPlayer.hand); 

                if (room.discardPile.length > 0) {
                    socket.emit("updateDiscardPile", room.discardPile.at(-1));
                }

                broadcastTableUI(id);

                const currentPlayer = room.players[room.activePlayerIndex];
                socket.emit("matchFound", { 
                    roomId: id, 
                    topDiscard: room.discardPile.at(-1), 
                    currentTurn: currentPlayer.id 
                });

                updateRoomPlayers(id);
                socket.emit("notification", "Waad ku soo laabtay!");
                return; 
            }
        }

        // 2. --- NEW PLAYER JOINING ---
        let roomId = Object.keys(rooms).find(id => 
            rooms[id].players.length < 4 && !rooms[id].gameStarted
        );

        if (!roomId) {
            roomId = "Room_" + Math.random().toString(36).slice(2, 11);
            rooms[roomId] = {
                id: roomId, players: [], gameStarted: false,
                stockPile: [], discardPile: [], activePlayerIndex: 0,
                lastOpenPoints: 101, turnTimeout: null, turnStartTime: null
            };
        }

        const newPlayer = { 
            id: socket.id, 
            name: name || `User_${socket.id.slice(0, 4)}`,
            hand: [], isOpened: false, hasActioned: false,
            pickedFromDiscard: false, openedSets: [], online: true 
        };

        rooms[roomId].players.push(newPlayer);
        socket.join(roomId);
        socket.roomId = roomId;

        const room = rooms[roomId];
        io.to(roomId).emit("waitingRoomUpdate", { players: room.players.map(p => ({ name: p.name })) });

        if (room.players.length === 4) {
            room.gameStarted = true;
            room.turnStartTime = Date.now(); 
            const gameData = prepareGame(4);
            room.stockPile = gameData.remainingDeck;

            room.players.forEach((player, index) => {
                player.hand = gameData.allHands[index];
                if (index === 0) player.hand.push(room.stockPile.pop());
                io.to(player.id).emit("startHand", player.hand);
            });

            room.discardPile = [room.stockPile.pop()];
            io.to(roomId).emit("matchFound", { 
                roomId, 
                topDiscard: room.discardPile.at(-1), 
                currentTurn: room.players[0].id 
            });
            
            startTurnTimer(roomId);
            updateRoomPlayers(roomId);
        }
    }); // ✅ JOINRANDOM HALKAN AYUU KU XIDHMAY (BANAANKA AYAY KA NOQONAYAAN KUWA KALE)

    /* ----------------------------------
       2. ACTIONS (DRAW / PICK / PLAY)
    ---------------------------------- */
    socket.on("drawCard", () => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameStarted) return;
        
        const p = room.players[room.activePlayerIndex];
        if (p.id !== socket.id) return;
        if (p.hand.length >= 15 || p.hasActioned) {
            socket.emit("message", "Horey ayaad u qaadatay kaar.");
            return;
        }

        refillStockIfEmpty(socket.roomId); 

        if (room.stockPile.length > 0) {
            const card = room.stockPile.pop();
            p.hand.push(card);
            p.hasActioned = true;
            
            socket.emit("receiveCard", card);
            updateRoomPlayers(socket.roomId);
        } else {
            socket.emit("message", "Ma jiro turub dambe ee la qaato!");
        }
    });

    socket.on("pickDiscard", () => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameStarted) return;
        const p = room.players[room.activePlayerIndex];
        if (p.id !== socket.id || p.hasActioned) return;
        if (room.discardPile.length === 0) return;
        
        const card = room.discardPile.pop();
        p.hand.push(card);
        p.hasActioned = true;
        p.pickedFromDiscard = true;
        
        socket.emit("discardPickedSuccess", card);
        io.to(socket.roomId).emit("updateDiscardPile", room.discardPile.at(-1) || null);
        updateRoomPlayers(socket.roomId);
    });

    socket.on("playCard", (card) => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameStarted) return;
        
        const p = room.players[room.activePlayerIndex];
        if (p.id !== socket.id) return;

        const cardIndex = p.hand.findIndex(c => c.id === card.id);
        if (cardIndex === -1) return;

        p.hand.splice(cardIndex, 1);
        room.discardPile.push(card);
        io.to(socket.roomId).emit("updateDiscardPile", card);
        
        p.hasActioned = false;
        p.pickedFromDiscard = false;

        if (p.hand.length === 0) {
            const results = room.players.map(pl => ({ name: pl.name, points: calculateHandPoints(pl.hand) }));
            io.to(socket.roomId).emit("gameOver", { winnerName: p.name, allResults: results });
            room.gameStarted = false;
            if(room.turnTimeout) clearTimeout(room.turnTimeout);
        } else {
            socket.emit("startHand", p.hand); 
            if (typeof nextTurn === "function") nextTurn(socket.roomId);
            else moveToNextPlayer(socket.roomId);
        }
    });

    /* ----------------------------------
       3. MELDING & SYNC
    ---------------------------------- */
    socket.on("meldSets", (sets) => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameStarted) return;
        const p = room.players.find(player => player.id === socket.id);
        if (!p) return;

        let cardsToRemoveIds = [];
        sets.forEach(set => {
            set.forEach(card => cardsToRemoveIds.push(card.id));
        });

        p.hand = p.hand.filter(card => !cardsToRemoveIds.includes(card.id));
        p.isOpened = true;
        p.openedSets.push(...sets);

        socket.emit("startHand", p.hand); 
        broadcastTableUI(socket.roomId);
        updateRoomPlayers(socket.roomId);
    });

    socket.on("resetMyOpenedCards", () => {
        const room = rooms[socket.roomId]; 
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.isOpened) return; 

        player.openedSets = []; 
        player.tempScore = 0;   
        socket.emit("startHand", player.hand); 
        broadcastTableUI(socket.roomId);
    });

    socket.on("syncHandAfterMeld", (updatedHand) => {
        const room = rooms[socket.roomId];
        if (!room) return;
        const p = room.players.find(player => player.id === socket.id);
        if (p) p.hand = updatedHand;
    });

    /* ----------------------------------
       4. SYNC & HEARTBEAT
    ---------------------------------- */
    socket.on("request_sync", () => {
        if (socket.roomId && rooms[socket.roomId]) {
            updateRoomPlayers(socket.roomId);
            const room = rooms[socket.roomId];
            if (room.discardPile.length > 0) {
                socket.emit("updateDiscardPile", room.discardPile.at(-1));
            }
        }
    });
    
    socket.on("pauseTimerRequest", () => {
        const room = rooms[socket.roomId];
        if (room && room.turnTimeout) {
            clearTimeout(room.turnTimeout);
            room.turnTimeout = null;
            io.to(socket.roomId).emit("timerPaused", { message: "Saacadda waa la hakiyay..." });
        }
    });

    socket.on("ping_keep_alive", () => {
        socket.emit("pong_alive");
    });

    socket.on("forceEndTurn", () => {
        const room = rooms[socket.roomId];
        if (!room) return;
        const p = room.players[room.activePlayerIndex];
        if (p.id !== socket.id) return;
        
        if (typeof nextTurn === "function") nextTurn(socket.roomId);
        else moveToNextPlayer(socket.roomId);
    });

    /* ----------------------------------
       5. DISCONNECT
    ---------------------------------- */
    socket.on("disconnect", () => {
        onlineUsers--;
        io.emit("updateOnlineCount", onlineUsers);

        const room = rooms[socket.roomId];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        if (!room.gameStarted) {
            room.players = room.players.filter(p => p.id !== socket.id);
        } else {
            player.online = false;
            const currentPlayer = room.players[room.activePlayerIndex];
            if (currentPlayer && currentPlayer.id === socket.id) {
                if (room.turnTimeout) clearTimeout(room.turnTimeout);
                moveToNextPlayer(socket.roomId);
            }
        }

        const onlineCount = room.players.filter(p => p.online).length;
        if (onlineCount === 0) {
            if (room.turnTimeout) clearTimeout(room.turnTimeout);
            delete rooms[socket.roomId];
        } else {
            updateRoomPlayers(socket.roomId);
        }
    });
});

/* ----------------------------------
   GLOBAL HELPERS
---------------------------------- */
function calculateHandPoints(hand) {
    return hand.reduce((sum, c) => sum + (c.points || 0), 0);
}
function moveToNextPlayer(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
    const nextP = room.players[room.activePlayerIndex];
    
    nextP.hasActioned = false;
    nextP.pickedFromDiscard = false;

    // Dib u bilaw saacadda haddii function-kaas uu kuu jiro
    if (typeof startTurnTimer === "function") {
        startTurnTimer(roomId);
    }

    io.to(roomId).emit("matchFound", {
        roomId: roomId,
        topDiscard: room.discardPile.at(-1),
        currentTurn: nextP.id
    });

    updateRoomPlayers(roomId);
}

function updateRoomPlayers(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const activePlayer = room.players[room.activePlayerIndex];
    
    // 1. U dir xogta guud (Turn-ka, Tirada kaararka, iwm)
    io.to(roomId).emit("playersUpdate", {
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            cardCount: p.hand.length,
            isOpened: p.isOpened || false,
            online: p.online
        })),
        stockCount: room.stockPile.length,
        currentTurnId: activePlayer ? activePlayer.id : null,
        turnStartTime: room.turnStartTime 
    });

    // 2. U kala saar boosaska qof kasta si uu u arko dadka ka soo horjeeda
    room.players.forEach((player, index) => {
        const pLen = room.players.length;
        
        const leftIdx  = (index + 1) % pLen;
        const topIdx   = (index + 2) % pLen;
        const rightIdx = (index + 3) % pLen;

        const leftPlayer  = room.players[leftIdx];
        const topPlayer   = room.players[topIdx];
        const rightPlayer = room.players[rightIdx];

        // U dir xogtan qofka hadda la marayo oo keliya (Private event)
        io.to(player.id).emit("updateOpponents", {
            left:  leftPlayer  && leftPlayer.id !== player.id  ? { name: leftPlayer.name }  : null,
            top:   topPlayer   && topPlayer.id !== player.id   ? { name: topPlayer.name }   : null,
            right: rightPlayer && rightPlayer.id !== player.id ? { name: rightPlayer.name } : null
        });
    });
}

// 2. Sax isValidSet (Inuu aqoonsado J, Q, K, A)
function isValidSet(set) {
    if (!set || set.length < 3) return false;

    const valueMap = { '6':6, '7':7, '8':8, '9':9, '10':10, 'J':11, 'Q':12, 'K':13, 'A':14 };
    // Hubi in kaararku ay leeyihiin values sax ah
    const sortedSet = [...set].sort((a, b) => valueMap[a.value] - valueMap[b.value]);
    
    const isSameSuit = sortedSet.every(c => c.suit === sortedSet[0].suit);
    const isSameValue = sortedSet.every(c => c.value === sortedSet[0].value);

    // Run Logic (e.g., 7♦, 8♦, 9♦)
    if (isSameSuit) {
        for (let i = 0; i < sortedSet.length - 1; i++) {
            if (valueMap[sortedSet[i+1].value] !== valueMap[sortedSet[i].value] + 1) return false;
        }
        return true;
    }
    // Group Logic (e.g., 7♦, 7♥, 7♠) - Suits kala duwan
    if (isSameValue) {
        const suits = sortedSet.map(c => c.suit);
        return new Set(suits).size === sortedSet.length;
    }
    return false;
}

// --- HELPER FUNCTIONS ---
function startTurnTimer(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    
    if (room.turnTimeout) clearTimeout(room.turnTimeout);
    
    room.turnStartTime = Date.now();
    updateRoomPlayers(roomId);

    room.turnTimeout = setTimeout(() => {
        if (!room.gameStarted) return;

        const currentPlayer = room.players[room.activePlayerIndex];
        if (!currentPlayer) return; // Hubinta amniga

        console.log(`ROBOT: ${currentPlayer.name} waa laga daahay.`);

        // 1. Haddii uusan waxba qaadan, u qaad kaar
        if (!currentPlayer.hasActioned) {
            if (room.stockPile.length > 0) {
                const card = room.stockPile.pop();
                currentPlayer.hand.push(card);
                currentPlayer.hasActioned = true;
                io.to(currentPlayer.id).emit("receiveCard", card);
            }
        }

        // 2. Haddii uu haysto 15, mid ka tuur (si markuunka u wareego)
        if (currentPlayer.hand.length > 14) {
            const cardToDiscard = currentPlayer.hand.pop(); 
            room.discardPile.push(cardToDiscard);
            io.to(roomId).emit("updateDiscardPile", cardToDiscard);
            
            // U sheeg ciyaaryahanka in kaar laga tuuray si gacantiisu u sync noqoto
            io.to(currentPlayer.id).emit("startHand", currentPlayer.hand);
        }

        // 3. U wareeji qofka xiga
        moveToNextPlayer(roomId); 
        
    }, 35000); // 35 ilbiriqsi
}

function isValidSet(set) {
    if (!set || set.length < 3) return false;

    // Sifee xogta: kaararka u habee sida ay u kala horreeyaan (1, 2, 3...)
    const sortedSet = [...set].sort((a, b) => a.value - b.value);
    
    const isSameColor = sortedSet.every(c => c.color === sortedSet[0].color);
    const isSameValue = sortedSet.every(c => c.value === sortedSet[0].value);

    // 1. Sharciga "Run" (Sida: 6, 7, 8 oo isku midab ah)
    if (isSameColor) {
        for (let i = 0; i < sortedSet.length - 1; i++) {
            if (sortedSet[i + 1].value !== sortedSet[i].value + 1) {
                return false; // Haddii ay kala go'an yihiin (e.g. 6, 7, 9)
            }
        }
        return true;
    }

    // 2. Sharciga "Group" (Sida: 7-Casaan, 7-Madow, 7-Buluug)
    if (isSameValue) {
        // Hubi in midabyadu ay kala duwan yihiin (uusan jirin laba madow ah)
        const colors = sortedSet.map(c => c.color);
        const uniqueColors = new Set(colors);
        return uniqueColors.size === sortedSet.length;
    }

    return false; // Haddii uusan midna ahayn
}

function refillStockIfEmpty(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    // Haddii kaararkii la dhuubanayay ay dhammaadeen (ama hal kaar u haray)
    if (room.stockPile.length <= 0) {
        console.log(`REFILL: QAADASHADII waa dhammaatay qolka ${roomId}. Dib u soo celinaya turubka badda lagu tuuray...`);

        // 1. Keydi kaarka ugu dambeeyay ee yaalla discardPile (si uusan u lumin)
        const topDiscard = room.discardPile.pop();

        // 2. Inta kale ee discardPile-ka ah u rar stockPile
        room.stockPile = shuffle([...room.discardPile]);

        // 3. Faaruqi discardPile-kii hore, kuna reeb kaliya kaarkii ugu dambeeyay
        room.discardPile = [topDiscard];

        // 4. U sheeg qof kasta tirada cusub ee kaararka
        io.to(roomId).emit("notification", "Waa la baandheeyay.");
        updateRoomPlayers(roomId);
    }
}

function broadcastTableUI(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit("updateTableUI", {
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            isOpened: p.isOpened,
            openedSets: p.openedSets || []
        })),
        nextRequiredPoints: room.lastOpenPoints // Halkan hadda waa sax (101)
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));