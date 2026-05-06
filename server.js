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


function nextTurn(roomId, forceNext = false) {
    const room = rooms[roomId];
    if (!room || !room.gameStarted) return;

    // 1. JOOJI TIMER-KASTA OO HORE U JIRAY (Muhiim)
    if (room.turnTimeout) {
        clearTimeout(room.turnTimeout);
        room.turnTimeout = null; // Nadiifi variable-ka
    }

    if (forceNext) {
        room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
    }

    // ... (logic-ga boodista dadka offline-ka ah) ...

    const currentPlayer = room.players[room.activePlayerIndex];

    // 2. BILAABO TIMER CUSUB
    room.turnTimeout = setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].gameStarted) {
            console.log(`[AUTO-SKIP] Waqtigu waa ka dhamaaday: ${currentPlayer.name}`);
            nextTurn(roomId, true);
        }
    }, 30000);

    // 3. Emit xogta
    io.to(roomId).emit("turnUpdate", { currentPlayerId: currentPlayer.id });
    io.to(currentPlayer.id).emit("yourTurn");
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

socket.on("updatePenaltyScore", (data) => {
    const { playerId, points } = data;

    // 1. Hel qolka uu hadda ciyaaryahanku ku jiro
    const room = rooms[socket.roomId];

    // 2. Hubi in qolku jiro, ka dibna raadi ciyaaryahanka (Safe Navigation ?. ayaa loo baahan yahay)
    let player = room?.players.find(p => p.id === playerId);
    
    if (player) {
        // 3. Ku dar 101 dhibcood (Penalty)
        player.points = (player.points || 0) + points;
        
        console.log(`[FOORO] ${player.name} dhibcihiisa waxaa lagu daray ${points}.`);

        // 4. U sheeg dhammaan dadka qolkaas ku jira in dhibcihii isbeddeleen
        io.to(socket.roomId).emit("scoreUpdated", { 
            playerId: player.id, 
            newTotal: player.points 
        });
    } else {
        console.log("Error: Ciyaaryahan lama helin markii foorada la xisaabinayay.");
    }
});

socket.on("forceEndTurn", () => {
    const room = rooms[socket.roomId];
    if (!room) return;

    // Hubi in qofka codsaday uu yahay qofka doorka leh
    if (room.players[room.activePlayerIndex].id !== socket.id) return;

    console.log(`[TURN] ${socket.id} ayaa doortay inuu turn-ka dhameeyo.`);
    
    // Mar haddii nextTurn la waco, timer-kii hore waa la tirtirayaa
    nextTurn(socket.roomId, true);
});
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

        if (typeof refillStockIfEmpty === "function") refillStockIfEmpty(socket.roomId); 

        if (room.stockPile && room.stockPile.length > 0) {
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

    // Hubi turn-ka
    if (room.players[room.activePlayerIndex].id !== socket.id) return;

    const player = room.players[room.activePlayerIndex];

    // Hubi haddii uu hore wax u soo qaatay
    if (player.hasActioned) return;

    if (room.discardPile && room.discardPile.length > 0) {
        const pickedCard = room.discardPile.pop();
        player.hand.push(pickedCard);

        player.hasActioned = true;
        player.pickedFromDiscard = true;

        // Farriimaha
        socket.emit("discardPickedSuccess", { card: pickedCard });
        socket.emit("updateHand", { hand: player.hand });

        // Cusboonaysii dadka kale
        if (typeof broadcastTableUI === "function") {
            broadcastTableUI(socket.roomId);
        } else {
            io.to(socket.roomId).emit("updateDiscardPile", room.discardPile.at(-1));
        }
    }
}); 

    socket.on("playCard", (card) => {
    const room = rooms[socket.roomId];
    if (!room || !room.gameStarted) return;
    
    const p = room.players[room.activePlayerIndex];
    if (p.id !== socket.id) return;

    const cardIndex = p.hand.findIndex(c => c.id === card.id);
    if (cardIndex === -1) return;

    // 1. Ka saar kaarka gacanta
    p.hand.splice(cardIndex, 1);
    room.discardPile.push(card);
    
    // 2. U sheeg qof kasta in discard pile-ku isbeddelay
    io.to(socket.roomId).emit("updateDiscardPile", card);
    
    // 3. Cusboonaysii gacanta qofka tuuray kaarka (si uu u arko inuu ka go'ay)
    socket.emit("updateHand", { hand: p.hand });

    if (p.hand.length === 0) {
        // CIYAARTU WAA DHAMMAADAY
        const results = room.players.map(pl => ({ 
            name: pl.name, 
            points: calculateHandPoints(pl.hand) 
        }));
        
        io.to(socket.roomId).emit("gameOver", { winnerName: p.name, allResults: results });
        room.gameStarted = false;
        if(room.turnTimeout) clearTimeout(room.turnTimeout);
    } else {
        // CIYAARTU WAY SOCOTAA - U GUDUB QOFKA XIGA
        // SAXITAANKA: true ayaa lagu daray halkan
        nextTurn(socket.roomId, true); 
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

    // --- ISBEDDELKA HALKAN KA BILOW ---
    
    // 1. Beddel "startHand" una beddel "updateHand"
    // 2. Kaarka u dir sidii Object: { hand: p.hand }
    socket.emit("updateHand", { hand: p.hand }); 

    // --- ISBEDDELKA HALKAN KU DHAMMAADAY ---

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

    /* ----------------------------------
       5. DISCONNECT
    ---------------------------------- */
    socket.on("disconnect", () => {
    onlineUsers--;
    io.emit("updateOnlineCount", onlineUsers);

    const room = rooms[socket.roomId];
    if (!room) return;

    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;

    const player = room.players[playerIndex];

    if (!room.gameStarted) {
        // Haddii ciyaartu aysan bilaaban, qofka gabi ahaanba ka saar qolka
        room.players = room.players.filter(p => p.id !== socket.id);
    } else {
        // Haddii ciyaartu socoto, ha saarin (si uu dhibcihiisa u garto hadduu dib u soo galo)
        player.online = false;

        // --- QAYBTA MUHIIMKA AH ---
        // Haddii qofka baxay uu ahaa qofka markuusu hadda taagnaa
        if (room.activePlayerIndex === playerIndex) {
            console.log(`[DISCONNECT] ${player.name} baa baxay isagoo markuusu lahaa.`);
            
            // 1. Jooji timer-ka hadda socda
            if (room.turnTimeout) clearTimeout(room.turnTimeout);
            
            // 2. U gudbi qofka xiga (nextTurn oo leh 'forceNext = true')
            // Xusuusnow: haddii aad haysato moveToNextPlayer, hubi inay u wacdo nextTurn si sax ah
            nextTurn(socket.roomId, true); 
        }
    }

    // Haddii qolka uu cidlo noqdo, tirtir
    const onlineCount = room.players.filter(p => p.online).length;
    if (onlineCount === 0) {
        if (room.turnTimeout) clearTimeout(room.turnTimeout);
        delete rooms[socket.roomId];
        console.log(`[ROOM] Qolka ${socket.roomId} waa la tirtiray waayo qofna kuma harin.`);
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

    // Dib u bilaw saacadda
    if (typeof startTurnTimer === "function") {
        startTurnTimer(roomId);
    }

    io.to(roomId).emit("matchFound", {
        roomId: roomId,
        topDiscard: room.discardPile.length > 0 ? room.discardPile.at(-1) : null,
        currentTurnId: nextP.id,
        players: room.players.map(p => ({ id: p.id, name: p.name, online: p.online }))
    });
} // <--- Halkan ayaa xidhaan ka dhimnaa

function updateRoomPlayers(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const activePlayer = room.players[room.activePlayerIndex];
    
    io.to(roomId).emit("playersUpdate", {
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            cardCount: p.hand.length,
            isOpened: p.isOpened || false,
            online: p.online
        })),
        stockCount: room.stockPile ? room.stockPile.length : 0,
        currentTurnId: activePlayer ? activePlayer.id : null,
        turnStartTime: room.turnStartTime 
    });

    room.players.forEach((player, index) => {
        const pLen = room.players.length;
        const leftIdx  = (index + 1) % pLen;
        const topIdx   = (index + 2) % pLen;
        const rightIdx = (index + 3) % pLen;

        const leftPlayer  = room.players[leftIdx];
        const topPlayer   = room.players[topIdx];
        const rightPlayer = room.players[rightIdx];

        io.to(player.id).emit("updateOpponents", {
            left:  leftPlayer  && leftPlayer.id !== player.id  ? { name: leftPlayer.name }  : null,
            top:   topPlayer   && topPlayer.id !== player.id   ? { name: topPlayer.name }   : null,
            right: rightPlayer && rightPlayer.id !== player.id ? { name: rightPlayer.name } : null
        });
    });
}

function isValidSet(set) {
    if (set.length < 3) return false;

    const allSameValue = set.every(c => c.value === set[0].value);
    if (allSameValue) {
        const suits = set.map(c => c.suit);
        return new Set(suits).size === suits.length;
    }

    const allSameSuit = set.every(c => c.suit === set[0].suit);
    if (allSameSuit) {
        const values = set.map(c => {
            if (c.value === 'A') return 14;
            if (c.value === 'K') return 13;
            if (c.value === 'Q') return 12;
            if (c.value === 'J') return 11;
            return parseInt(c.value);
        }).sort((a, b) => a - b);

        for (let i = 0; i < values.length - 1; i++) {
            if (values[i + 1] !== values[i] + 1) return false;
        }
        return true;
    }
    return false;
}

function startTurnTimer(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    
    if (room.turnTimeout) clearTimeout(room.turnTimeout);
    
    room.turnStartTime = Date.now();
    updateRoomPlayers(roomId);

    room.turnTimeout = setTimeout(() => {
        if (!room.gameStarted) return;

        const currentPlayer = room.players[room.activePlayerIndex];
        if (!currentPlayer) return;

        if (!currentPlayer.hasActioned) {
            if (room.stockPile && room.stockPile.length > 0) {
                const card = room.stockPile.pop();
                currentPlayer.hand.push(card);
                currentPlayer.hasActioned = true;
                io.to(currentPlayer.id).emit("receiveCard", card);
            }
        }

        if (currentPlayer.hand.length > 14) {
            const cardToDiscard = currentPlayer.hand.pop(); 
            room.discardPile.push(cardToDiscard);
            io.to(roomId).emit("updateDiscardPile", cardToDiscard);
            io.to(currentPlayer.id).emit("updateHand", { hand: currentPlayer.hand });
        }

        moveToNextPlayer(roomId); 
        
    }, 35000);
}

function refillStockIfEmpty(roomId) {
    const room = rooms[roomId];
    if (room.stockPile && room.stockPile.length === 0 && room.discardPile.length > 1) {
        const topDiscard = room.discardPile.pop();
        room.stockPile = room.discardPile;
        shuffle(room.stockPile);
        room.discardPile = [topDiscard];
        broadcastTableUI(roomId);
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
        nextRequiredPoints: room.lastOpenPoints || 101
    });
}

function dealCards(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    shuffle(room.stock); 

    room.players.forEach((player, index) => {
        player.hand = []; 
        for (let i = 0; i < 14; i++) {
            if (room.stock.length > 0) {
                player.hand.push(room.stock.pop());
            }
        }

        if (index === 0) {
            if (room.stock.length > 0) {
                player.hand.push(room.stock.pop());
            }
            player.hasActioned = true;
        } else {
            player.hasActioned = false; 
        }
    });

    room.discardPile = [room.stock.pop()];

    room.players.forEach(p => {
        io.to(p.id).emit("updateHand", { hand: p.hand });
    });

    room.gameStarted = true;
    
    // Bilaabista turn-ka koowaad si sax ah
    updateRoomPlayers(roomId);
    startTurnTimer(roomId);
}

// XIDHAANKA DHAMMAADKA EE MUHIIMKA AH (Haddii koodhkaagu uu ku dhex jiray io.on)
// }); // Ku dar kan haddii function-adani ay ku dhex jiraan io.on("connection")

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));