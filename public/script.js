/* SOCKET SETUP */
const socket = io();

/* STATE & GLOBAL VARIABLES */
let myHand = [];
let isMyTurn = false;
let hasDrawn = false;
let pickedFromDiscard = false;   // Inuu tuurista ka soo qaatay (Xeerka 101)
let isOpened = false;            // Inuu hore u degay (Opened 101)
let iHaveOpened = false; 
let myOpenedSets = []; // Meesha lagu kaydiyo kaararka aad degtay
let temporaryScore = 0; // Dhibcaha urursanaya ka hor 101
let setsOfTopPlayer = [];
let setsOfLeftPlayer = [];
let setsOfRightPlayer = [];
let dragStartIndex = null;
let currentMinToOpen = 101;

const pointValues = { 
    '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 
    'j': 10, 'q': 10, 'k': 10, 'a': 11 
};

async function bilowQaybintaIskala() {
    const players = ['bottom', 'left', 'top', 'right']; // Boosaska ciyaartoyda ee tusaale_7.jpg
    const totalCards = 14;
    const batchSize = 2; // Waxaad ka dhigi kartaa 2 ama 3 markiiba
    const dealingZone = document.getElementById('dealing-zone');

    for (let i = 0; i < totalCards; i += batchSize) {
        for (let player of players) {
            // 1. Samee kaararka oo dhig Booska Dhigista (Center)
            let tempCards = [];
            for (let b = 0; b < batchSize; b++) {
                let card = document.createElement('div');
                card.className = 'card-back';
                dealingZone.appendChild(card);
                tempCards.push(card);
            }

            // 2. Sug ilbiriqsi si loo arko in kaarku bartamaha yaallo
            await new Promise(r => setTimeout(r, 400));

            // 3. Kaararka u rar dhanka ciyaaryahanka
            tempCards.forEach((card, index) => {
                const playerPos = document.querySelector(`.player-${player}`).getBoundingClientRect();
                const centerPos = dealingZone.getBoundingClientRect();
                
                let moveX = playerPos.left - centerPos.left;
                let moveY = playerPos.top - centerPos.top;

                card.style.transform = `translate(${moveX}px, ${moveY}px) scale(0.5)`;
                card.style.opacity = "0"; // Kaarku wuxuu ku milmayaa gacanta ciyaaryahanka
            });

            // 4. Nadiifi booska dhigista ka hor intaan qofka xiga la siin
            await new Promise(r => setTimeout(r, 500));
            tempCards.forEach(c => c.remove());
            
            // Cusboonaysii tirada kaarka u muuqata qofka (Counter)
            updatePlayerCardCount(player, batchSize);
        }
    }
    
    // Markay dhamaato, banay booska dhigista si loogu ciyaaro
    dealingZone.style.display = 'none';
    console.log("Qaybintii 14-ka xabo waa dhamaatay.");
}

socket.on("gameStarted", async (data) => {
    // 1. Marka hore muuji animation-ka qaybinta
    await bilowQaybintaIskala();

    // 2. Markuu dhameeyo ka dib, markaas muuji kaararkaaga dhabta ah
    myHand = data.yourHand;
    renderMyHand();
    
    // Muuji UI-ga kale
    document.getElementById("setup-screen").style.display = "none";
    document.getElementById("game-table").style.display = "block";
});

/* --- XEERKA FOORADA (DYNAMIC VERSION) --- */
function applyFooroLogic(winnerId, providerId, allPlayers) {
    // 1. Hubi in allPlayers ay tahay Array sax ah
    if (!allPlayers || !Array.isArray(allPlayers) || allPlayers.length === 0) {
        console.error("Khalad: allPlayers waa madhan yahay ama ma jiro!", allPlayers);
        return null;
    }

    let totalPlayers = allPlayers.length;
    
    // Hel booska qofka kaarka bixiyay (provider)
    let providerIndex = allPlayers.findIndex(p => p.id === providerId);

    // Hubi haddii qofka kaarka bixiyay laga waayo liiska
    if (providerIndex === -1) {
        console.error("Khalad: Provider-ka lama helin!", providerId);
        // Waxaad dooran kartaa inaad 0 ka dhigto ama aad return null dhahdo
        providerIndex = 0; 
    }

    // 1. XEERKA GAMBASHADA: 
    for (let i = 0; i < totalPlayers; i++) {
        let currentIndex = (providerIndex + i) % totalPlayers;
        let currentPlayer = allPlayers[currentIndex];

        if (currentPlayer.id === winnerId) continue;

        // Hubi in currentPlayer uu jiro (Badbaado dheeraad ah)
        if (!currentPlayer) continue;

        if (!currentPlayer.isOpened && !currentPlayer.iHaveOpened) {
            console.log(`DHAGAX: ${currentPlayer.name} ma degganayn, fooradii baa ku dhacday!`);
            return currentPlayer;
        }
        console.log(`GAMBASHO: ${currentPlayer.name} wuu degay, fooradii wuu wuu ka gambaday...`);
    }

    // 2. XEERKA DHIBCAHA UGU BADAN:
    let maxPoints = -1;
    let targetPlayer = null;

    allPlayers.forEach(player => {
        if (player.id === winnerId) return;

        let handPoints = typeof calculateHandPoints === "function" 
            ? calculateHandPoints(player.hand || []) 
            : 0; // Haddii calculateHandPoints la waayo

        if (handPoints > maxPoints) {
            maxPoints = handPoints;
            targetPlayer = player;
        }
    });

    return targetPlayer;
}

function calculateHandPoints(hand) {
    if (!hand || hand.length === 0) return 0;
    
    return hand.reduce((total, card) => {
        const val = String(card.value).toLowerCase();
        if (val === 'a') return total + 11;
        if (['k', 'q', 'j', '10'].includes(val)) return total + 10;
        return total + (parseInt(val) || 0);
    }, 0);
}

// 1. Shaqada maamulaysa cidda foorada dusha loo saarayo
function calculateFooroTarget(winnerId, providerId, allPlayers) {
    // allPlayers waa liiska ciyaartoyda miiska fadhida (Array)
    let totalPlayers = allPlayers.length;
    let providerIndex = allPlayers.findIndex(p => p.id === providerId);

    // --- XEERKA GAMBASHADA ---
    // Waxaan ka bilaabaynaa qofka kaarka bixiyay, waxaan u wareegaynaa midka xiga
    for (let i = 0; i < totalPlayers; i++) {
        let currentIndex = (providerIndex + i) % totalPlayers;
        let currentPlayer = allPlayers[currentIndex];

        // Haddii uu qofkani weli degganayn (Not Opened)
        if (currentPlayer.points < 101 && !currentPlayer.hasOpened) {
            console.log(`${currentPlayer.name} ma degganayn, dhagaxii baa ku dhacay!`);
            return currentPlayer.id; // Qofkan ayaa foorada qaadaya
        }
        
        console.log(`${currentPlayer.name} wuu degganaa, wuu ka gambaday dhagaxa...`);
    }

    // --- XEERKA DHIBCAHA UGU BADAN ---
    // Haddii la wada deggan yahay, qofka dhibcaha ugu badan gacanta ku haysta ayaa qaadaya
    let maxPoints = -1;
    let fooroTargetId = null;

    allPlayers.forEach(player => {
        let handValue = calculateHandValue(player.hand);
        if (handValue > maxPoints) {
            maxPoints = handValue;
            fooroTargetId = player.id;
        }
    });

    return fooroTargetId;
}

// 2. Shaqada xisaabinaysa qiimaha kaararka (A=11, K/Q/J=10, 6=6)
function calculateHandValue(hand) {
    let total = 0;
    hand.forEach(card => {
        // card.value waa nambarka ama xarafka kaarka
        if (card.value === 'A') {
            total += 11;
        } else if (['K', 'Q', 'J', '10'].includes(card.value)) {
            total += 10;
        } else {
            // Kaararka kale (9, 8, 7, 6) waxay leeyihiin qiimahooda nambar
            total += parseInt(card.value) || 0;
        }
    });
    return total;
}
// 1. Shaqada raadinaysa qofka foorada qaadaya (The Target)
function findFooroTarget(cardProviderName, playersList) {
    let order = ["John", "Antonio", "Antonella", "Bruno"]; // Wareegga miiska
    let startIndex = order.indexOf(cardProviderName);
    
    // Silsiladda gambashada: ka bilow qofka kaarka bixiyay
    for (let i = 0; i < order.length; i++) {
        let currentIndex = (startIndex + i) % order.length;
        let currentPlayer = playersList[order[currentIndex]];

        // Haddii la helo qof aan weli degin (Not Opened), dhagaxu isaguu ku dhacayaa
        if (!currentPlayer.hasOpened) {
            return order[currentIndex]; 
        }
    }

    // 2. Haddii qof kasta uu wada deggan yahay (All Opened)
    // Waxaan raadinaynaa qofka dhibcaha ugu badan gacanta ku haysta
    let highestScore = -1;
    let targetPlayer = null;

    for (let name in playersList) {
        let currentPoints = calculateHandPoints(playersList[name].hand);
        if (currentPoints > highestScore) {
            highestScore = currentPoints;
            targetPlayer = name;
        }
    }
    return targetPlayer;
}

// 3. Shaqada xisaabinaysa dhibcaha gacanta (A=11, K/Q/J=10, 6=6)
function calculateHandPoints(hand) {
    let total = 0;
    hand.forEach(card => {
        if (card.value === 'A') total += 11;
        else if (['K', 'Q', 'J'].includes(card.value)) total += 10;
        else total += parseInt(card.value) || 0;
    });
    return total;
}

function executeFooroVisuals(targetName) {
    // Muuji fariin digniin ah
    alert(`FOORO! Dhagaxii wuxuu ku dhacay: ${targetName}`);

    // Cusboonaysii dhibcaha shaashadda (UI)
    let scoreElement = document.querySelector(`#score-${targetName}`);
    let currentScore = parseInt(scoreElement.innerText);
    scoreElement.innerText = currentScore + 101;

    // Animation: ka dhig magaca qofka mid casaan bilig-biligleynaya
    document.querySelector(`#name-${targetName}`).classList.add('flash-red');
}

// Hubinta xeerka 101 iyo in ugu yaraan hal koox ay tahay 4+ kaar
function karaaInuuDego(sets) {
    const hasFourOrMore = sets.some(set => set.length >= 4);
    return hasFourOrMore;
}

/* RENDER HAND (Cusboonaysiin) */
function renderMyHand() {
    const area = document.getElementById("my-hand");
    if (!area) return;
    area.innerHTML = ""; 

    myHand.forEach((card, index) => {
        // 1. Khariidadda calaamadaha (Suit Map)
        const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
        const suitLetter = suitMap[card.suit];

        // 2. 🔥 SAXITAANKA: Hubi haddii xogta kaarku ay dhiman tahay
        // Tani waxay joojinaysaa ciladda cards/undefineds.svg (404)
        if (!suitLetter || !card.value) {
            console.error("Card khaldan (Undefined data):", card);
            return; // Ha render-in kaarkan si uusan 404 u dhicin
        }

        // 3. SameyntafileName-ka saxda ah
        const val = String(card.value).toLowerCase();
        const fileName = `${val}${suitLetter}.svg`;

        const cardDiv = document.createElement("div");
        cardDiv.className = `card ${card.selected ? 'selected' : ''}`;
        cardDiv.dataset.index = index;
        cardDiv.draggable = true;

        cardDiv.innerHTML = `
            <img src="/cards/${fileName}" 
                 style="width: 100%; height: 100%; pointer-events: none; border-radius: 5px;">
        `;

        // 4. Dhacdooyinka (Events)
        cardDiv.onclick = () => {
            card.selected = !card.selected;
            renderMyHand();
            if (typeof calculateTemporaryScore === "function") calculateTemporaryScore();
        };

        cardDiv.addEventListener("dragstart", (e) => { 
            dragStartIndex = index; 
            e.target.style.opacity = "0.5"; 
        });
        cardDiv.addEventListener("dragover", (e) => e.preventDefault());
        cardDiv.addEventListener("drop", handleDrop);

        area.appendChild(cardDiv);
    });
}

function updatePlayerTurnUI(allPlayers, myId, activePlayerId) {
    if (!allPlayers || !myId) return;

    // 1. Hel index-kaaga si loo wareejiyo miiska
    const myIndex = allPlayers.findIndex(p => p.id === myId);
    if (myIndex === -1) return;

    // 2. Diyaari boosaska miiska (waafaqsan ID-yada HTML-kaaga)
    const posIds = ["player-bottom", "player-left", "player-top", "player-right"];
    
    // 3. Marka hore ka saar 'active-turn' dhamaan si loo cusubaysiiyo
    document.querySelectorAll('.player-slot').forEach(slot => {
        slot.classList.remove('active-turn');
    });

    // 4. Wareeji liiska oo ku dar class-ka qofka doorka leh
    for (let i = 0; i < 4; i++) {
        const player = allPlayers[(myIndex + i) % 4];
        const slotId = posIds[i];
        const slotElement = document.getElementById(slotId);

        if (player && slotElement) {
            // Haddii qofkani uu yahay kan doorku u joogo (Active Player)
            if (player.id === activePlayerId) {
                slotElement.classList.add('active-turn');
            }
            
            // Sidoo kale halkan waxaad ku cusubaysiin kartaa magaca haddii loo baahdo
            const nameTag = slotElement.querySelector('.player-name-tag');
            if (nameTag) {
                nameTag.innerText = (i === 0) ? `Adiga (${player.name})` : player.name;
            }
        }
    }
}

let allPlayers = [];
let currentTurnId = null;
socket.on("playersUpdate", (data) => {
    const { players, currentTurnId: turnId } = data;

    allPlayers = players;
    currentTurnId = turnId;

    updatePlayerNames(players, socket.id);

    isMyTurn = (turnId === socket.id);

    updateTurnBlink(turnId);

    const statusEl = document.getElementById("turnText");

    if (isMyTurn) {
        statusEl.innerHTML = `<b style="color:#2ecc71">DOORKAAGA!</b>`;
    } else {
        statusEl.textContent = "Sugaya...";
    }
});

// 1. Qeex function-ka hal mar (meel sare oo global ah)
function updateTurnBlink(currentTurnId) {
  document.querySelectorAll(".player-slot").forEach(el => {
    el.classList.remove("active-turn-blink", "active-turn");
  });

  if (typeof allPlayers !== "undefined" && allPlayers.length > 0) {
    const myIndex = allPlayers.findIndex(p => p.id === socket.id);
    const posIds = ["player-bottom", "player-left", "player-top", "player-right"];

    if (myIndex !== -1) {
      for (let i = 0; i < allPlayers.length; i++) {
        const playerAtPos = allPlayers[(myIndex + i) % allPlayers.length];
        if (playerAtPos && playerAtPos.id === currentTurnId) {
          const slot = document.getElementById(posIds[i]);
          if (slot) slot.classList.add("active-turn-blink");
          break;
        }
      }
    }
  }
}


socket.on("turnUpdate", ({ currentPlayerId }) => {
  currentTurnId = currentPlayerId; // kaydi si playersUpdate u isticmaalo
  updateTurnBlink(currentPlayerId);
});


function renderMeltedGroups(groups) {
    const tableArea = document.getElementById('table-area');
    if (!tableArea) return;
    tableArea.innerHTML = ''; 

    groups.forEach(group => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'melted-group';
        
        group.forEach((card, index) => {
            const img = document.createElement('img');
            const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
            const val = String(card.value).toLowerCase();
            const fileName = `${val}${suitMap[card.suit] || 's'}.svg`; // .svg halkii ay ka ahayd .png

            img.src = `/cards/${fileName}`;
            img.className = 'melted-card';
            if (index > 0) img.style.marginLeft = "-25px"; 
            
            groupDiv.appendChild(img);
        });
        tableArea.appendChild(groupDiv);
    });
}

function toggleCardSelection(cardElement) {
    // Koodhkii hore ee calaamadaynta...
    
    const selectedCards = document.querySelectorAll('.card.selected');
    
    if (selectedCards.length >= 3) {
        // Haddii 3 kaar la calaamadeeyo, u sheeg server-ka inuu saacadda joojiyo
        socket.emit("pauseTimerRequest");
    }
}

function renderMyTableSets() {
    const tableArea = document.getElementById("my-table-sets");
    if (!tableArea) return;

    tableArea.innerHTML = "";

    myOpenedSets.forEach(set => {
        const setDiv = document.createElement("div");
        setDiv.className = "card-set";

        set.forEach(card => {
            const cDiv = document.createElement("div");
            cDiv.className = `card small ${card.suit === '♦' || card.suit === '♥' ? 'red' : ''}`;

            cDiv.innerHTML = `
                <span class="v">${card.value}</span>
                <span class="s">${card.suit}</span>
            `;

            setDiv.appendChild(cDiv);
        });

        tableArea.appendChild(setDiv);
    });
}

function handleResetDhigista() {
    if (iHaveOpened || isOpened) {
        alert("Hore ayaad u degtay, kama noqon kartid kaararka miiska!");
        return;
    }
    
    if (myOpenedSets.length === 0) {
        alert("Ma jiraan kaarar aad miiska dhigtay.");
        return;
    }
    
    // Soo celi kaararka gacanta
    for (const set of myOpenedSets) {
        for (const card of set) {
            myHand.push({
                value: card.value,
                suit: card.suit,
                selected: false
            });
        }
    }
    
    myOpenedSets = [];
    temporaryScore = 0;
    
    // Ogaysii server-ka
    socket.emit("resetMyOpenedCards");
    
    renderMyHand();
    renderMyTableSets();
    
    const scoreDisplay = document.getElementById("temp-score-display");
    if (scoreDisplay) scoreDisplay.textContent = "0";
    
    alert("Kaararkii waa lagu soo celiyay gacantaada.");
}


function processGroups(selectedCards) {
    // 1. Kala saar kaararka (Sort)
    // 2. Isku day inaad ka dhex dhaliso kooxaha (Groups)
    let groups = [];
    let currentGroup = [selectedCards[0]];

    for (let i = 1; i < selectedCards.length; i++) {
        // Haddii kaarka hadda iyo kii ka horreeyay ay isku xigaan (Serial)
        // ama ay isku nambar yihiin (Set), isku dhex hay.
        if (isCompatible(selectedCards[i], selectedCards[i-1])) {
            currentGroup.push(selectedCards[i]);
        } else {
            groups.push(currentGroup);
            currentGroup = [selectedCards[i]];
        }
    }
    groups.push(currentGroup);
    return groups;
}

/* XISAABINTA DHIBCAHA (MELDS) */
function calculateTemporaryScore() {
    const selectedCards = myHand.filter(c => c.selected);
    const scoreDisplay = document.getElementById("temp-score-display");

    if (selectedCards.length === 0) {
        if (scoreDisplay) scoreDisplay.textContent = "0";
        return 0;
    }

    let score = 0;
    for (const c of selectedCards) {
        // 🔥 Waa muhiim si loo garto 'j', 'q', 'k', 'a'
        const val = String(c.value).toLowerCase();
        score += pointValues[val] || 0;
    }

    if (scoreDisplay) scoreDisplay.textContent = score;
    return score;
}

document.addEventListener("DOMContentLoaded", () => {
    // 1. Badhanka Dhigo
    const dhigoBtn = document.getElementById("dhigoBtn");
    if (dhigoBtn) dhigoBtn.onclick = handleDhigista;

    // 2. Badhanka Ka noqo (Reset)
    const resetBtn = document.getElementById("resetBtn");
    if (resetBtn) resetBtn.onclick = handleResetDhigista;

    // 3. Badhanka Sort
    const sortBtn = document.getElementById("sortBtn");
    if (sortBtn) sortBtn.onclick = handleSort;

    // 4. Badhanka Tuur
    const tuurBtn = document.getElementById("tuurBtn");
    if (tuurBtn) tuurBtn.onclick = handleTuurista;
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'visible') {
        console.log("Sync cusub ayaa la codsaday...");
        socket.emit("request_sync"); // Server-ka ha u soo diro xogta cusub
    }
});

/* ACTIONS */
/* --- DHIGISTA 101 LOGIC --- */

// 2. Marka labaad: Function-ka xaqiijinta (Validation)
function findValidGroups(cards) {
    let tempCards = [...cards];
    let groups = autoSplitIntoGroups(tempCards);
    let usedCards = [];
    groups.forEach(g => usedCards.push(...g));
    let remaining = tempCards.filter(c => !usedCards.some(u => u.value === c.value && u.suit === c.suit));
    return { validGroups: groups, remaining: remaining };
}

// 3. Marka saddexaad: Function-ka Badhanka (The Main Action)
function handleDhigista() {
    if (!isMyTurn) return alert("Sug doorkaaga!");

    let selectedCards = myHand.filter(c => c.selected);
    if (selectedCards.length < 3) return alert("Dooro ugu yaraan 3 kaar!");

    const { validGroups, remaining } = findValidGroups(selectedCards);
    if (remaining.length > 0) return alert("Kaarka " + remaining[0].value + " ma geli karo koox!");

    let totalScoreOfMove = selectedCards.reduce((sum, c) => sum + (pointValues[String(c.value).toLowerCase()] || 0), 0);

    if (!isOpened) {
        let currentTotal = temporaryScore + totalScoreOfMove;
        let allSetsSoFar = [...myOpenedSets, ...validGroups];
        const hasFourPlus = allSetsSoFar.some(g => g.length >= 4);

        // --- XEERKA CUSUB: Halkan ayaan ku dareynaa currentMinToOpen ---
        if (currentTotal >= currentMinToOpen && hasFourPlus) {
            
            isOpened = true;
            iHaveOpened = true;
            myOpenedSets = allSetsSoFar;

            const selectedIds = selectedCards.map(c => c.id);
            myHand = myHand.filter(c => !selectedIds.includes(c.id));

            // MUHIIM: U dir server-ka wadarta aad ku degtay si uu kuwa kale ugu xannibo
            socket.emit("meldSets", { sets: allSetsSoFar, totalScore: currentTotal }); 
            socket.emit("syncHandAfterMeld", myHand);

            temporaryScore = 0;
            renderMyHand();
            renderMyTableSets();
            alert(`Waad degtay! Waxaad ku degtay ${currentTotal}. Qofka xiga waa inuu keenaa ${currentTotal + 1}`);
        } else {
            // Haddii uu dhibco haysto laakiin uusan gaarin tartanka (Overtaking)
            if (currentTotal < currentMinToOpen && hasFourPlus) {
                 return alert(`Ma degi kartid! Qof ayaa ka horreeyay oo degay ${currentMinToOpen - 1}. Waxaad u baahan tahay ugu yaraan ${currentMinToOpen}`);
            }

            // --- URURIN CAADI AH ---
            temporaryScore += totalScoreOfMove;
            myOpenedSets.push(...validGroups);
            const selectedIds = selectedCards.map(c => c.id);
            myHand = myHand.filter(c => !selectedIds.includes(c.id));
            socket.emit("syncHandAfterMeld", myHand);

            renderMyHand();
            renderMyTableSets();
            alert(`Wadarta: ${temporaryScore}. U baahan: ${currentMinToOpen}`);
        }
    } else {
        // HADDII AAD HORE U FURNAYD (Sidii hore)
        const selectedIds = selectedCards.map(c => c.id);
        myHand = myHand.filter(c => !selectedIds.includes(c.id));
        socket.emit("meldSets", { sets: validGroups, isAdditional: true }); 
        socket.emit("syncHandAfterMeld", myHand); 
        myOpenedSets.push(...validGroups);
        renderMyHand();
        renderMyTableSets();
    }
}

/* FUNCTION-KA KALA QAYBIYA KAARARKA (ALGORITHM) */
function autoSplitIntoGroups(cards) {
    let groups = [];
    let usedIds = new Set(); // Waxaan u isticmaalaynaa ID si aanan isku dhex gelin

    // Sii kaar walba ID gaar ah haddii uusan lahayn
    let tempCards = cards.map((c, i) => ({ ...c, tempId: i }));

    // 1. Marka hore raadi RUNS (Silsilad: 6,7,8 ee hal suit ah)
    const suits = ['♠', '♥', '♣', '♦'];
    suits.forEach(suit => {
        let suitCards = tempCards.filter(c => c.suit === suit && !usedIds.has(c.tempId));
        // U kala saar lambar ahaan
        suitCards.sort((a, b) => getCardValue(a) - getCardValue(b));

        let currentRun = [];
        for (let i = 0; i < suitCards.length; i++) {
            if (currentRun.length === 0 || 
                getCardValue(suitCards[i]) === getCardValue(currentRun[currentRun.length - 1]) + 1) {
                currentRun.push(suitCards[i]);
            } else {
                if (currentRun.length >= 3) {
                    groups.push(currentRun.map(({tempId, ...rest}) => rest));
                    currentRun.forEach(c => usedIds.add(c.tempId));
                }
                currentRun = [suitCards[i]];
            }
        }
        if (currentRun.length >= 3) {
            groups.push(currentRun.map(({tempId, ...rest}) => rest));
            currentRun.forEach(c => usedIds.add(c.tempId));
        }
    });

    // 2. Ka dib raadi SETS (Isla lambarka, suits kala duwan)
    let remaining = tempCards.filter(c => !usedIds.has(c.tempId));
    let values = [...new Set(remaining.map(c => c.value))];

    values.forEach(val => {
        let valCards = remaining.filter(c => c.value === val && !usedIds.has(c.tempId));
        if (valCards.length >= 3) {
            groups.push(valCards.map(({tempId, ...rest}) => rest));
            valCards.forEach(c => usedIds.add(c.tempId));
        }
    });

    return groups;
}

// Function caawiye ah oo A, J, Q, K u beddelaya lambar
function getCardValue(card) {
    const map = { 'a': 14, 'k': 13, 'q': 12, 'j': 11 };
    let v = String(card.value).toLowerCase();
    return map[v] || parseInt(v);
}

function handleSort() {
    const sortOrder = { 
        '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 
        'j': 11, 'q': 12, 'k': 13, 'a': 14 
    };

    const suitOrder = { '♠': 4, '♥': 3, '♦': 2, '♣': 1 };

    myHand.sort((a, b) => {
        const valA = String(a.value).toLowerCase();
        const valB = String(b.value).toLowerCase();
        
        const rankA = sortOrder[valA] || 0;
        const rankB = sortOrder[valB] || 0;

        // 1. Marka hore u kala saar nooca (Suit)
        if (a.suit !== b.suit) {
            return suitOrder[b.suit] - suitOrder[a.suit];
        }
        
        // 2. Haddii ay isku suit yihiin, u kala saar lambarka (6 ilaa A)
        return rankA - rankB; // Bidix ka bilow 6, midig u soco A
    });

    // Nadiifi xulashada (Selection) ka hor intaanan dib u sawirin
    myHand.forEach(c => c.selected = false);
    renderMyHand();
}

function handleDragOver(e) {
    e.preventDefault(); // Aad bay u muhiim tahay si 'drop' u shaqeeyo!
}

function handleDragStart(e) {
    dragStartIndex = +e.target.dataset.index;
    // Wax yar madow ka dhig kaarka la jiidayo
    e.target.style.opacity = "0.5";
}

function handleDrop(e) {
    e.preventDefault(); // Jooji dhaqanka caadiga ah ee browser-ka
    
    const dropCard = e.target.closest(".card");
    if (!dropCard || dragStartIndex === null) return;

    const dragEndIndex = +dropCard.dataset.index;

    if (dragStartIndex !== dragEndIndex) {
        // Ka saar kaarkii meeshii uu joogay, ka dibna geli meesha cusub
        const [movedCard] = myHand.splice(dragStartIndex, 1);
        myHand.splice(dragEndIndex, 0, movedCard);
        
        // Halkan ayaad ku dari kartaa cod yar (sound effect) haddii aad rabto
        console.log(`Kaarka waxaa laga raray ${dragStartIndex} lana geeyay ${dragEndIndex}`);
    }

    dragStartIndex = null;
    renderMyHand(); // Dib u sawir gacantaada si index-yada ay u cusboonaadaan
}

function renderSets(elementId, sets) {
    const area = document.getElementById(elementId);
    if (!area) return;
    area.innerHTML = "";

    sets.forEach(set => {
        const setDiv = document.createElement("div");
        setDiv.className = "melted-group"; // Class-kii saxda ahaa

        set.forEach((card, index) => {
            const img = document.createElement("img");
            
            // Isticmaal isla nidaamkii sawirada (SVG)
            const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
            const val = String(card.value).toLowerCase();
            const fileName = `${val}${suitMap[card.suit] || 's'}.svg`;

            img.src = `/cards/${fileName}`;
            img.className = "melted-card";
            img.style.position = "relative";
            img.style.zIndex = index;

            // Is-dhex galka (Overlap)
            if (index > 0) {
                img.style.marginLeft = "-25px";
            }

            setDiv.appendChild(img);
        });

        area.appendChild(setDiv);
    });
}

socket.on("updateTableUI", (data) => {
    const { players, nextRequiredPoints } = data;
    if (!players) return;

    const myId = socket.id;

    // 1. Nadiifi miiska
    const slots = ["pos-top", "pos-left", "pos-bottom", "pos-right"];
    slots.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = "";
    });

    const myIndex = players.findIndex(p => p.id === myId);
    if (myIndex === -1) return;

    // 2. Sawir kaararka ciyaartoyda
    players.forEach((p, index) => {
        if (!p.isOpened || !p.openedSets) return;

        const diff = (index - myIndex + 4) % 4;
        let slotId = "";
        if (diff === 0) slotId = "pos-bottom";
        else if (diff === 1) slotId = "pos-right";
        else if (diff === 2) slotId = "pos-top";
        else if (diff === 3) slotId = "pos-left";

        const slotArea = document.getElementById(slotId);
        if (!slotArea) return;

        p.openedSets.forEach(set => {
            const setDiv = document.createElement("div");
            setDiv.className = "melted-group"; 
            
            // --- ISBEDELKA HALKAN AA BUU KU JIRAA ---
            // Ka dhig 'row' si ay u jiifaan (dadab) dhammaan boosaska
            setDiv.style.display = "flex";
            setDiv.style.flexDirection = "row"; 
            setDiv.style.flexWrap = "nowrap";
            setDiv.style.marginBottom = "10px";

            set.forEach((card, cardIndex) => {
                const img = document.createElement("img");
                const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
                const val = String(card.value).toLowerCase();
                const fileName = `${val}${suitMap[card.suit] || 's'}.svg`;
                
                img.src = `/cards/${fileName}`;
                img.className = "melted-card";
                
                // Style-ka kaarka yar ee miiska
                img.style.width = "40px";
                img.style.height = "auto";
                img.style.position = "relative";
                img.style.zIndex = cardIndex;

                // Overlap-ka dhinac (Horizontal overlap)
                if (cardIndex > 0) {
                    img.style.marginLeft = "-25px"; // Isku riix dhinac ah
                    img.style.marginTop = "0px";    // Ha u dejin hoos
                }
                
                setDiv.appendChild(img);
            });
            slotArea.appendChild(setDiv);
        });
    });

    const req = document.getElementById("requiredPoints");
    if (req && nextRequiredPoints) req.innerText = nextRequiredPoints;
});

/* HELPER FUNCTIONS */
function isSet(cards) {
    if (cards.length < 3) return false;

    const value = cards[0].value;
    const suits = new Set();

    for (let c of cards) {
        if (c.value !== value) return false;
        if (suits.has(c.suit)) return false;
        suits.add(c.suit);
    }

    return true;
}

function isSerial(cards) {
    if (cards.length < 3) return false;

    const suit = cards[0].suit;
    if (!cards.every(c => c.suit === suit)) return false;

    const valueOrder = {
        "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
        "j": 11, "q": 12, "k": 13, "a": 14
    };

    const mapped = cards.map(c => valueOrder[c.value]);
    if (mapped.includes(undefined)) return false;

    mapped.sort((a, b) => a - b);

    for (let i = 0; i < mapped.length - 1; i++) {
        if (mapped[i + 1] !== mapped[i] + 1) return false;
    }

    return true;
}

function startTheGame() {
    const name = document.getElementById("nameInput").value;
    
    if (name) {
        document.getElementById("setup-screen").style.display = "none";
        document.getElementById("main-header").style.display = "flex";
        document.getElementById("game-table").style.display = "block";
        document.querySelector(".player-hand-section").style.display = "flex";
        socket.emit('joinRandom', name);
    }
}

function handleTuurista() {
    if (!isMyTurn) return;

    if (myHand.length === 14) {
        alert("Fadlan marka hore kaar qaado!");
        return;
    }

    if (pickedFromDiscard && !isOpened) {
        const canOpenNow = calculateTemporaryScore() >= 101;
        if (!canOpenNow) {
            alert("Maadaama aad tuurista qaadatay, waa inaad degtaa (101)! Maadaama dhibcahaagu yaryihiin, dib u soo celi kaarka.");
            return;
        } else {
            alert("Fadlan marka hore riix 'Dhigo' si aad u degto!");
            return;
        }
    }

    const selectedIndex = myHand.findIndex(c => c.selected);
    if (selectedIndex === -1) {
        alert("Dooro kaarka aad tuurayso!");
        return;
    }

    const remaining = myHand.length - 1;
    if (remaining === 1 || remaining === 2) {
        alert("Xeerka Batuutada: Ma kuu hari karaan 1 ama 2 xabo oo kaliya!");
        return;
    }

    const cardToPlay = myHand[selectedIndex];
    socket.emit("playCard", cardToPlay);

    myHand.splice(selectedIndex, 1);
    isMyTurn = false;
    hasDrawn = false;
    pickedFromDiscard = false;
    renderMyHand();
    if (timerInterval) clearInterval(timerInterval);
}

/* KEEP ALIVE (MOBILKA) */
setInterval(() => {
    if (socket && socket.connected) {
        socket.emit("ping_keep_alive"); 
    }
}, 10000); 

function switchUItoGame() {
    const setupScreen = document.getElementById("setup-screen");
    const waitingRoom = document.getElementById("waiting-room");
    const mainHeader = document.getElementById("main-header");
    const gameTable = document.getElementById("game-table");
    const myHandSection = document.getElementById("my-hand-section");

    if (setupScreen) setupScreen.style.display = "none";
    if (waitingRoom) waitingRoom.style.display = "none";
    if (mainHeader) mainHeader.style.display = "flex";
    if (gameTable) gameTable.style.display = "flex";
    if (myHandSection) myHandSection.style.display = "flex";
}

socket.on("startHand", (hand) => {
    myHand = hand.map(c => ({...c, selected:false}));
    if (document.getElementById("waiting-room").style.display !== "none") {
        switchUItoGame();
    }
    renderMyHand();
});

document.getElementById("startGameBtn").onclick = () => {
    const nameInput = document.getElementById("nameInput");
    const name = nameInput.value.trim();
    if (!name) return alert("Fadlan magacaaga qor!");

    localStorage.setItem("turub_user_name", name);
    document.getElementById("setup-screen").style.display = "none";
    document.getElementById("waiting-room").style.display = "block";
    socket.emit("joinRandom", name);
};

/* AUTO-LOAD NAME (RECONNECT FIX) */
window.addEventListener("load", () => {
    const savedName = localStorage.getItem("turub_user_name");
    const nameInput = document.getElementById("nameInput");
    if (savedName && nameInput) {
        nameInput.value = savedName;
    }
});

/* EVENT LISTENERS */
socket.on("waitingRoomUpdate", (data) => {
    const statusText = document.getElementById("waiting-status");
    const listArea = document.getElementById("players-list");

    if (!data || !data.players) return;

    const count = data.players.length;
    const dhiman = 4 - count;

    if (listArea) {
        listArea.innerHTML = "";
        data.players.forEach(p => {
            const pDiv = document.createElement("div");
            pDiv.style.cssText = `padding:8px; margin:5px; background:rgba(255,255,255,0.1); border-radius:5px; width:100%; text-align:center;`;
            pDiv.innerHTML = `✅ <b>${p.name}</b> waa diyaar`;
            listArea.appendChild(pDiv);
        });
    }

    if (statusText) {
        statusText.style.display = "block";
        if (dhiman > 0) {
            const magacyo = { 1: "hal ciyaartooy", 2: "laba ciyaartooy", 3: "saddex ciyaartooy" };
            const text = magacyo[dhiman] || `${dhiman} ciyaartooy`;
            statusText.innerText = `Waxaa dhiman ${text}: ${count}/4`;
        } else {
            statusText.innerText = "Dhammaan waa la helay! Ciyaartu waa bilaabanaysaa...";
        }
    }
});

function updatePlayerNames(allPlayers, myId) {
    const myIndex = allPlayers.findIndex(p => p.id === myId);
    if (myIndex === -1) return;

    const rotatedPlayers = [];
    for (let i = 0; i < 4; i++) {
        rotatedPlayers.push(allPlayers[(myIndex + i) % 4]);
    }

    const posIds = ["name-bottom", "name-left", "name-top", "name-right"];

    rotatedPlayers.forEach((player, i) => {
        const el = document.getElementById(posIds[i]);
        if (el && player) {
            // Halkan ku dar: 'Adiga' haddii uu yahay John (socket.id-gaaga)
            el.innerText = (player.id === myId) ? `Adiga (${player.name})` : player.name;
            
            // MUHIIM: Ku dheji ID-ga qofka 'Parent-ka' (Slot-ka) si animation-ku u helo
            el.parentElement.setAttribute("data-player-id", player.id);
            el.parentElement.style.display = "flex";
        }
    });
}

socket.on("playersUpdate", (data) => {
    const { players, currentTurnId } = data;

    updatePlayerNames(players, socket.id);

    isMyTurn = (currentTurnId === socket.id);

    // 🔥 HALKAN: remove blink from all players first
    document.querySelectorAll(".player").forEach(el => {
        el.classList.remove("active-turn-blink");
    });

    // 🔥 HALKAN: add blink to current player
    const currentPlayerEl = document.querySelector(`[data-id="${currentTurnId}"]`);
    if (currentPlayerEl) {
        currentPlayerEl.classList.add("active-turn-blink");
    }

    const statusEl = document.getElementById("turnText");

    if (isMyTurn) {
        statusEl.innerHTML = `<b style="color:#2ecc71">DOORKAAGA!</b>`;
    } else {
        statusEl.textContent = "Sugaya...";
    }
});

function updateTurnVisuals(currentTurnId) {
    document.querySelectorAll('.player-slot').forEach(slot => {
        slot.classList.remove('active-turn');
    });

    const activeSlot = document.querySelector(
        `.player-slot[data-player-id="${currentTurnId}"]`
    );

    if (activeSlot) {
        activeSlot.classList.add('active-turn');
    }
}

/* GAME START LISTENER */
socket.on("matchFound", (data) => {
    // data.players waxaa laga yaabaa inay ku jirto liiska magacyada
    
    setTimeout(() => {
        // 1. Beddel UI-ga (Qari Lobby, muuji Game)
        switchUItoGame();

        // 2. Muuji Header-ka haddii uu qarsoonaa
        const header = document.getElementById("main-header");
        if (header) header.style.display = "flex";

        // 3. Deji magaca (si ka ammaan badan nameInput)
        const displayName = document.getElementById("display-name");
        const nameInput = document.getElementById("nameInput");
        
        if (displayName) {
            // Haddii nameInput uu madhan yahay (Refresh ka dib), ha isticmaalin
            displayName.textContent = (nameInput && nameInput.value) ? nameInput.value : "Player";
        }

        // 4. Sawir gacantaada
        renderMyHand();
        
        console.log("Ciyaartii waa bilaabatay qolka:", data.roomId);
    }, 1500);
});

socket.on("receiveCard", (card) => {
    myHand.push({ ...card, selected: false });
    hasDrawn = true;
    renderMyHand();
});

// Kani waa qaybta maqan ee dhibka xalinaysa
socket.on("updateHand", (data) => {
    // 1. Hubi xogta soo dhacday (Data validation)
    const newHand = Array.isArray(data) ? data : data.hand;

    // 2. Dooro element-ka aad wax ku qori lahayd
    const el = document.getElementById("renderMyHand");

    // 3. Hubi in element-ka uu jiro iyo in xogtu tahay Array
    if (el && Array.isArray(newHand)) {
        const handHTML = newHand.map(card => {
            return `<div class="card">${card.value}${card.suit}</div>`;
        }).join("");
        
        el.innerHTML = handHTML;
    } else {
        console.error("Khalad: Element-ka lama helin ama xogta ayaa khaldan", { el, data });
    }
});



socket.on("discardPickedSuccess", (data) => {
    // data waa Object, ee ma ahan kaarka tooskiisa. 
    // Markaa waa inaan niraahdaa data.card
    if (data && data.card) {
        myHand.push({ ...data.card, selected: false });
        hasDrawn = true;
        pickedFromDiscard = true;
        renderMyHand();
        
        console.log("Kaarkii waa lagu daray gacantaada:", data.card);
    }
});

socket.on("yourTurn", () => {
    isMyTurn = true; // Maaddaama farriintan adiga uun kugu soo dhacday
    hasDrawn = false;
    hasDiscarded = false; // Xaqiiji in qofku uusan weli kaar tuurin
    
    console.log("Waa markayga! Badhamada manual-ka ah soo saar.");
    
    // Muuji badhamada ficilka
    const actionButtons = document.getElementById("action-buttons");
    if (actionButtons) {
        actionButtons.style.display = "block";
    }
    
    // Cusboonaysii gacanta si aad u arki karto kaararka la dooran karo
    renderMyHand();
});

socket.on("updateDiscardPile", (card) => {
    const pile = document.getElementById("discard-pile");
    if (!pile) return;
    pile.innerHTML = "";

    if (card) {
        const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
        const val = String(card.value).toLowerCase();
        const fileName = `${val}${suitMap[card.suit] || 's'}.svg`;
        const cardDiv = document.createElement("div");
        cardDiv.className = "card";
        cardDiv.innerHTML = `<img src="/cards/${fileName}" style="width: 100%; height: 100%; border-radius: 5px;">`;
        pile.appendChild(cardDiv);
    }
});

socket.on("updateOpponents", (data) => {
    // data.allPlayers waa inuu noqdaa liis ay ku jiraan dhammaan 4-ta ciyaaryahan
    // Haddii server-kaagu soo diro data.allPlayers, isticmaal kan:
    if (data.allPlayers) {
        updatePlayerNames(data.allPlayers, socket.id);
    } else {
        // Haddii server-kaagu wali u soo diro qaabkii hore (top, left, right):
        const topEl = document.getElementById("name-top");
        const leftEl = document.getElementById("name-left");
        const rightEl = document.getElementById("name-right");
        const bottomEl = document.getElementById("name-bottom");

        if (topEl)    topEl.innerText    = data.top    ? data.top.name    : "Sugaya...";
        if (leftEl)   leftEl.innerText   = data.left   ? data.left.name   : "Sugaya...";
        if (rightEl)  rightEl.innerText  = data.right  ? data.right.name  : "Sugaya...";
        if (bottomEl) bottomEl.innerText = "Adiga"; 
    }
});

const stockPile = document.getElementById("stock-pile");
if (stockPile) {
    stockPile.onclick = () => {
        if (!isMyTurn || hasDrawn) return;
        socket.emit("drawCard");
        hasDrawn = true;
        pickedFromDiscard = false;
    };
}

const discardPile = document.getElementById("discard-pile");
if (discardPile) {
    discardPile.onclick = () => {
        if (!isMyTurn || hasDrawn) return;
        socket.emit("pickDiscard");
        hasDrawn = true;
        pickedFromDiscard = true;
    };
}

const tuurBtn = document.getElementById("tuurBtn");
if (tuurBtn) {
    tuurBtn.onclick = handleTuurista;
}

//  Marka hore hubi in dhacdadan (event) ay jirto
socket.on("scoreUpdated", (data) => {
    const { playerId, newTotal } = data;

    // 2. Xisaabi booska (sidii hore)
    const myIndex = allPlayers.findIndex(p => p.id === socket.id);
    const targetIndex = allPlayers.findIndex(p => p.id === playerId);

    if (myIndex === -1 || targetIndex === -1) return;

    const diff = (targetIndex - myIndex + 4) % 4;
    const posIds = ["player-bottom", "player-left", "player-top", "player-right"];
    const slotId = posIds[diff];

    // 3. HALKAN AYAA LA GELIYAA QAYBTA QURXINTA (Logic-ga cusub)
    const slotElement = document.getElementById(slotId);
    if (slotElement) {
        const scoreSpan = slotElement.querySelector('.player-score');
        if (scoreSpan) {
            scoreSpan.innerText = newTotal;

            // --- QURXINTA ---
            scoreSpan.style.color = "#2ecc71"; // Cagaar
            scoreSpan.style.fontWeight = "bold";
            scoreSpan.style.transition = "all 0.5s ease";
            
            setTimeout(() => {
                scoreSpan.style.color = ""; // Dib ugu soo celi midabkii hore
            }, 2000);
        }
    }
    
    // Sidoo kale haddii uu dhibcaha helay ay tahay "Adiga", cusboonaysii header-ka
    if (playerId === socket.id) {
        const myScoreHeader = document.getElementById("my-score");
        if (myScoreHeader) myScoreHeader.innerText = newTotal;
    }
});

socket.on("gameOver", (data) => {
    // Hubi in data ay jirto ka hor intaanan kala bixin (destructure)
    if (!data || !data.allPlayers) {
        console.error("GameOver error: Xog dhammaystiran kama soo bixin server-ka.");
        return;
    }

    const { winnerId, winnerName, providerId, allPlayers } = data;

    // 1. Xisaabi foorada (Dhagaxa)
    const penaltyTarget = applyFooroLogic(winnerId, providerId, allPlayers);
    
    if (penaltyTarget) {
        // Hubi haddii qofka foorada qaaday uu yahay qofkii kaarka bixiyay (Direct Fooro)
        // mise waa qof kale oo laga gambaday (Gambasho)
        if (penaltyTarget.id !== providerId) {
            const provider = allPlayers.find(p => p.id === providerId);
            const providerName = provider ? provider.name : "Qof";
            alert(`FOORO! ${providerName} wuxuu helay fooro, fooradii waxay ku dhacday: ${penaltyTarget.name}`);
        } else {
            alert(`FOORO! Fooradii waxay ku dhacday: ${penaltyTarget.name}`);
        }

        // 2. U sheeg server-ka dhibcaha rasmiga ah (101)
        socket.emit("updatePenaltyScore", { playerId: penaltyTarget.id, points: 101 });
    }

    // 3. Sug 4 ilbiriqsi si loo dareemo natiijada
    setTimeout(() => {
        alert("Ciyaarta waxaa ku guuleystay: " + winnerName);
        location.reload(); 
    }, 4000); 
});