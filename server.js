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

/* 2. GAME FUNCTIONS */
function updateRoomPlayers(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const activePlayer = room.players[room.activePlayerIndex];
    const currentTurnId = activePlayer ? activePlayer.id : null;

    const playersData = room.players.map(p => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        isOpened: p.isOpened || false
    }));

    // DIR PLAYERSUPDATE (Halkan ayaan ku daray turnStartTime)
    io.to(roomId).emit("playersUpdate", {
        players: playersData,
        stockCount: room.stockPile.length,
        currentTurnId: currentTurnId,
        turnStartTime: room.turnStartTime // 🔥 MUHIIM: Kani waa kan Timer-ka hagaajinaya
    });

    // DIR UPDATEOPPONENTS (Sidii aad u qortay waa sax)
    room.players.forEach((player, index) => {
        const left  = room.players[(index + 1) % room.players.length];
        const top   = room.players[(index + 2) % room.players.length];
        const right = room.players[(index + 3) % room.players.length];

        io.to(player.id).emit("updateOpponents", {
            left:  left  ? { name: left.name } : null,
            top:   top   ? { name: top.name } : null,
            right: right ? { name: right.name } : null
        });
    });
}





function nextTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    if (room.turnTimeout) clearTimeout(room.turnTimeout);

    room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
    room.turnStartTime = Date.now(); 

    room.players.forEach(p => {
        p.hasActioned = false;
        p.pickedFromDiscard = false;
    });

    const currentPlayer = room.players[room.activePlayerIndex];
    io.to(roomId).emit('yourTurn', currentPlayer.id);
    updateRoomPlayers(roomId);

    // ROBOT LOGIC (Haddii qofku seexdo)
    room.turnTimeout = setTimeout(() => {
        if (!room || !room.gameStarted) return;
        
        console.log(`ROBOT: Ciyaaryahan ${currentPlayer.name} waa laga daahay.`);

        // 1. AUTO-DRAW: Haddii uusan weli qaadan kaar
        if (!currentPlayer.hasActioned && room.stockPile.length > 0) {
            const card = room.stockPile.pop();
            currentPlayer.hand.push(card);
            currentPlayer.hasActioned = true;
            io.to(currentPlayer.id).emit("receiveCard", card);
        }

        // 2. AUTO-DISCARD: Ka saar hal kaar (Haddii uu 15 haysto ama 14)
        if (currentPlayer.hand.length > 0) {
            const cardToDiscard = currentPlayer.hand.pop(); // Halkan ayaan ka saarnay
            room.discardPile.push(cardToDiscard);
            
            // 🔥 MUHIIM: U sheeg qofka in gacantiisa la beddelay (si uusan nuqul ugu harin)
            io.to(currentPlayer.id).emit("startHand", currentPlayer.hand); 
            io.to(roomId).emit("updateDiscardPile", cardToDiscard);
        }

        nextTurn(roomId);
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
            
            // U dir kaararka gacanta
            socket.emit("startHand", existingPlayer.hand); 

            // Hubi haddii uu jiro discard pile
            if (room.discardPile.length > 0) {
                socket.emit("updateDiscardPile", room.discardPile.at(-1));
            }

            // ⚠️ SAXITAAN: Halkii aad forEach isticmaali lahayd, isticmaal broadcastTableUI
            // Tani waxay hubinaysaa in ciyaaryahanku hal mar helo dhammaan miiska (Consistent Data)
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
	
	// Marka qofka uu kaar dhuubto (Draw Card)
    socket.on("drawCard", () => {
        const roomId = socket.roomId;
        const room = rooms[roomId];
        
        if (!room) return;

        const p = room.players.find(player => player.id === socket.id);
        
        // Hubi inuu isagu markuunka leeyahay iyo inuu hore u dhuubtay
        if (room.players[room.activePlayerIndex].id === socket.id && !p.hasActioned) {
            
            if (room.stockPile.length > 0) {
                const card = room.stockPile.pop(); // Kaar ka qaad mishiinka
                p.hand.push(card); // U dar gacanta server-ka
                
                p.hasActioned = true; // Calaamadi inuu ficil sameeyay

                // 1. U dir kaarkaas qofka codsaday oo kaliya
                socket.emit("cardDrawn", card); 
                
                // 2. U sheeg qof kasta in tirada kaararka p ay isbeddeshay
                updateRoomPlayers(roomId);
                
                console.log(`${p.name} ayaa dhuubtay kaar.`);
            }
        }
    });

    // 2. --- NEW PLAYER JOINING ---
    let roomId = Object.keys(rooms).find(id => 
        rooms[id].players.length < 4 && !rooms[id].gameStarted
    );

    if (!roomId) {
        // ⚠️ SAXITAAN: substr() waxaa loo beddelay slice()
        roomId = "Room_" + Math.random().toString(36).slice(2, 11);
        rooms[roomId] = {
            id: roomId, players: [], gameStarted: false,
            stockPile: [], discardPile: [], activePlayerIndex: 0,
            lastOpenPoints: 101, turnTimeout: null, turnStartTime: null
        };
    }

    const newPlayer = { 
        // ⚠️ SAXITAAN: substr() waxaa loo beddelay slice()
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
});

    socket.on("resetMyOpenedCards", () => {
    const roomId = socket.roomId;
    const room = rooms[roomId]; 
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    
    // Haddii uu hore u "Xidhay" (Finalized) miiska, ma celin karo
    if (!player || player.isOpened) return; 

    // 1. Maadaama aan gacanta ka saarnay markii uu 'Meld' sameeyay,
    // waa inaan dib ugu soo celinaa gacantiisa (Haddii aad gacanta ka saartay horey)
    // Haddii gacantiisu aysan isbeddelin inta uu miiska dhigayay, talaabadan ka bood.

    player.openedSets = []; 
    player.tempScore = 0;   

    // 2. U sheeg qofka in gacantiisii dib u soo noqotay
    socket.emit("startHand", player.hand); 

    // 3. U baahi miiska in kaararkii laga saaray
    broadcastTableUI(roomId);
    
    console.log(`RESET: ${player.name} ayaa dib u soo qaatay kaararkii uu miiska dhigay.`);
    });

    /* ----------------------------------
       2. SYNC & HEARTBEAT
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
    
    // Waxaan isticmaalaynaa turnTimeout waayo waa kan saacadda haya
    if (room && room.turnTimeout) {
        clearTimeout(room.turnTimeout); // Jooji setTimeout
        room.turnTimeout = null;         // Nadiifi si uusan dib dambe u shaqayn
        
        io.to(socket.roomId).emit("timerPaused", { 
            message: "Saacadda waa la hakiyay..." 
        });
        console.log(`Room ${socket.roomId}: Saacadda waa la hakiyay.`);
        }
    });

    socket.on("ping_keep_alive", () => {
        socket.emit("pong_alive");
    });

    /* ----------------------------------
       3. ACTIONS (DRAW / PICK / PLAY)
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

        const card = room.stockPile.pop();
        p.hand.push(card);
        p.hasActioned = true; 
        
        socket.emit("receiveCard", card);
        updateRoomPlayers(socket.roomId);
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

    /* ----------------------------------
       4. MELDING & SYNC
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

    // Ka saar kaararka gacanta ciyaaryahanka
    p.hand = p.hand.filter(card => !cardsToRemoveIds.includes(card.id));
    p.isOpened = true;
    p.openedSets.push(...sets);

    // 1. U dir ciyaaryahanka gacantiisa cusub
    socket.emit("startHand", p.hand); 

    // 2. U baahi dhammaan dadka miiska xogta cusub (User-ka iyo Sets-kiisa)
    broadcastTableUI(socket.roomId);
    
    // 3. Cusboonaysii tirada kaararka ee dadka kale u muuqata
    updateRoomPlayers(socket.roomId);
    });

    socket.on("syncHandAfterMeld", (updatedHand) => {
        const room = rooms[socket.roomId];
        if (!room) return;
        
        const p = room.players.find(player => player.id === socket.id);
        if (p) {
            p.hand = updatedHand;
            console.log(`Sync: ${p.name} gacantiisa waa la cusboonaysiiyay.`);
        }
    });

    /* ----------------------------------
       5. END TURN / DISCONNECT
    ---------------------------------- */
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

    socket.on("forceEndTurn", () => {
        const room = rooms[socket.roomId];
        if (!room) return;
        const p = room.players[room.activePlayerIndex];
        if (p.id !== socket.id) return;
        
        if (typeof nextTurn === "function") nextTurn(socket.roomId);
        else moveToNextPlayer(socket.roomId);
    });

    socket.on("disconnect", () => {
    onlineUsers--;
    io.emit("updateOnlineCount", onlineUsers);

    const room = rooms[socket.roomId];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    if (!room.gameStarted) {
        // Haddii ciyaartu aysan bilaaban, ka saar liiska gebi ahaanba
        room.players = room.players.filter(p => p.id !== socket.id);
    } else {
        // Haddii ciyaartu socoto, u calaamadee inuu "Offline" yahay
        player.online = false;

        // ⚠️ HADDIU UU YAHAY ACTIVE PLAYER:
        const currentPlayer = room.players[room.activePlayerIndex];
        if (currentPlayer && currentPlayer.id === socket.id) {
            console.log(`Ciyaaryahan ${player.name} ayaa baxay isagoo leh markuunka. Wareejinaynaa...`);
            
            // Jooji saacaddii u socotay isaga
            if (room.turnTimeout) clearTimeout(room.turnTimeout);
            
            // U gudbi qofka xiga
            moveToNextPlayer(socket.roomId);
        }
    }

    // Haddii qolka uu cidlo noqdo (qofna uusan online ahayn)
    const onlineCount = room.players.filter(p => p.online).length;
       if (onlineCount === 0) {
        if (room.turnTimeout) clearTimeout(room.turnTimeout);
         delete rooms[socket.roomId];
        console.log(`Qolkii ${socket.roomId} waa la tirtiray waayo qofna kuma harin.`);
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
    
    io.to(roomId).emit("playersUpdate", {
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            cardCount: p.hand.length, // Hubi in magacu yahay cardCount ama handCount (Frontend-kaaga eeg)
            isOpened: p.isOpened || false,
            online: p.online
        })),
        stockCount: room.stockPile.length,
        currentTurnId: activePlayer ? activePlayer.id : null,
        turnStartTime: room.turnStartTime 
    });
}

// 2. Sax isValidSet (Inuu aqoonsado J, Q, K, A)
function isValidSet(set) {
    if (!set || set.length < 3) return false;

    const valueMap = { '6':6, '7':7, '8':8, '9':9, '10':10, 'J':11, 'Q':12, 'K':13, 'A':14 };
    const sortedSet = [...set].sort((a, b) => valueMap[a.value] - valueMap[b.value]);
    
    const isSameColor = sortedSet.every(c => c.suit === sortedSet[0].suit); // Isticmaal suit halkii aad color ka isticmaali lahayd
    const isSameValue = sortedSet.every(c => c.value === sortedSet[0].value);

    // Run Logic (6-7-8 isku suit ah)
    if (isSameColor) {
        for (let i = 0; i < sortedSet.length - 1; i++) {
            if (valueMap[sortedSet[i+1].value] !== valueMap[sortedSet[i].value] + 1) return false;
        }
        return true;
    }
    // Group Logic (7-7-7 suits kala duwan)
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