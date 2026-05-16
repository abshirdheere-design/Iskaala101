let socket;
let myName = '';
let myHand = [];
let isMyTurn = false;
let hasDrawn = false;
let pickedFromDiscard = false;
let isOpened = false;
let iHaveOpened = false;
let myOpenedSets = [];
let temporaryScore = 0;
let currentMinToOpen = 101;
let discardTop = null;
let stockCount = 0;
let players = [];
let currentTurnId = null;
let opponents = { left: null, top: null, right: null };
let tablePlayers = [];
let myScore = 0;
let turnTimeLeft = 30;
let turnTimerInterval = null;
let dragStartIndex = null;
const POINT_VALUES = { '6':6,'7':7,'8':8,'9':9,'10':10,'j':10,'q':10,'k':10,'a':11 };
function $(id) { return document.getElementById(id); }
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = $(`${name}-screen`);
  if (el) el.classList.add('active');
}
let notifTimer = null;
function showNotification(msg, duration = 3000) {
  const el = $('notification');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => el.classList.add('hidden'), duration);
}

function distributeCardsAnimated(handCards) {

    const container = $('game-table');
    const handContainer = $('hand-cards');

    if (!container || !handContainer) return;

    handContainer.innerHTML = '';

    handCards.forEach((card, index) => {

        setTimeout(() => {

            // Kaarka duulaya
            const flying = document.createElement('div');
            flying.className = 'card-deal';

            // Meesha uu ku dambaynayo
            const targetX = -350 + (index * 45);

            flying.style.setProperty('--targetX', `${targetX}px`);
            flying.style.setProperty('--targetY', `260px`);

            container.appendChild(flying);

            // Marka animation dhammaado
            setTimeout(() => {

                flying.remove();

                const realCard = createCardUI(card);
                handContainer.appendChild(realCard);

            }, 700);

        }, index * 120);

    });

}

function startTurnTimer() {
  clearInterval(turnTimerInterval);
  turnTimeLeft = 30;
  renderHeader();
  turnTimerInterval = setInterval(() => {
    turnTimeLeft = Math.max(0, turnTimeLeft - 1);
    renderHeader();
    if (turnTimeLeft === 0) clearInterval(turnTimerInterval);
  }, 1000);
}
function getCardValue(card) {
  const map = { a:14, k:13, q:12, j:11 };
  const v = String(card.value).toLowerCase();
  return map[v] || parseInt(v);
}
function cardPoints(card) {
  return POINT_VALUES[String(card.value).toLowerCase()] || 0;
}
function autoSplitIntoGroups(cards) {
  const groups = [];
  const usedIdx = new Set();
  const temp = cards.map((c, i) => ({ ...c, _i: i }));
  ['♠','♥','♣','♦'].forEach(suit => {
    let sc = temp.filter(c => c.suit === suit && !usedIdx.has(c._i));
    sc.sort((a, b) => getCardValue(a) - getCardValue(b));
    let run = [];
    for (let i = 0; i < sc.length; i++) {
      if (!run.length || getCardValue(sc[i]) === getCardValue(run[run.length-1]) + 1) {
        run.push(sc[i]);
      } else {
        if (run.length >= 3) { groups.push(run.map(({_i,...r})=>r)); run.forEach(c=>usedIdx.add(c._i)); }
        run = [sc[i]];
      }
    }
    if (run.length >= 3) { groups.push(run.map(({_i,...r})=>r)); run.forEach(c=>usedIdx.add(c._i)); }
  });
  const remaining = temp.filter(c => !usedIdx.has(c._i));
  const vals = [...new Set(remaining.map(c => c.value))];
  vals.forEach(val => {
    const vc = remaining.filter(c => c.value === val && !usedIdx.has(c._i));
    if (vc.length >= 3) { groups.push(vc.map(({_i,...r})=>r)); vc.forEach(c=>usedIdx.add(c._i)); }
  });
  return groups;
}
function findValidGroups(cards) {
  const groups = autoSplitIntoGroups(cards);
  const usedIds = new Set(groups.flat().map(c => c.id));
  const remaining = cards.filter(c => !usedIds.has(c.id));
  return { validGroups: groups, remaining };
}
function applyFooroLogic(winnerId, providerId, allPlayers) {
  if (!allPlayers || !allPlayers.length) return null;
  const provIdx = allPlayers.findIndex(p => p.id === providerId);
  const startIdx = provIdx === -1 ? 0 : provIdx;
  for (let i = 0; i < allPlayers.length; i++) {
    const cur = allPlayers[(startIdx + i) % allPlayers.length];
    if (cur.id === winnerId) continue;
    if (!cur.isOpened) return cur;
  }
  let maxPts = -1, target = null;
  allPlayers.forEach(p => {
    if (p.id === winnerId) return;
    const pts = (p.hand || []).reduce((s, c) => s + (c.points || 0), 0);
    if (pts > maxPts) { maxPts = pts; target = p; }
  });
  return target;
}
function makeCard(card, size, opts = {}) {
  const el = document.createElement('div');
  const isRed = card.suit === '♥' || card.suit === '♦';
  el.className = `card ${size} ${isRed ? 'red-suit' : 'black-suit'}${opts.selected ? ' selected' : ''}${opts.overlap ? ' overlap' : ''}`;
  el.innerHTML = `<span class="cv">${card.value}</span><span class="cs">${card.suit}</span><span class="cv-bot">${card.value}</span>`;
  return el;
}
function makeCardBack(size) {
  const el = document.createElement('div');
  el.className = `card-back-${size}`;
  return el;
}
function renderHeader() {
  $('hdr-name').textContent = myName;
  $('hdr-score').textContent = `Dhibco: ${myScore}`;
  const turnEl = $('hdr-turn');
  if (isMyTurn) {
    turnEl.textContent = `DOORKAAGA (${turnTimeLeft}s)`;
    turnEl.className = 'hdr-turn-active';
  } else {
    turnEl.textContent = 'Sugaya...';
    turnEl.className = 'hdr-turn-idle';
  }
  if (isOpened) $('hdr-opened-badge').classList.remove('hidden');
  else $('hdr-opened-badge').classList.add('hidden');
}
function renderHand() {
  const container = $('hand-cards');
  container.innerHTML = '';
  myHand.forEach((card, idx) => {
    const el = makeCard(card, 'md', { selected: card.selected });
    el.addEventListener('click', () => toggleCard(idx));
    el.draggable = true;
    el.addEventListener('dragstart', () => { dragStartIndex = idx; });
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', () => handleDrop(idx));
    container.appendChild(el);
  });
  const selScore = myHand.filter(c => c.selected).reduce((s, c) => s + cardPoints(c), 0);
  $('sel-score').textContent = selScore;
  $('min-open-label').textContent = `U baahan: ${currentMinToOpen}`;
  $('btn-dhigo').disabled = !isMyTurn;
  $('btn-tuur').disabled = !isMyTurn;
}
function renderDiscardPile() {
  const el = $('discard-display');
  el.innerHTML = '';
  if (discardTop) {
    const card = makeCard(discardTop, 'lg');
    el.className = '';
    el.appendChild(card);
  } else {
    el.className = 'discard-empty';
    el.textContent = 'Madhan';
  }
}
function renderStockPile() {
  $('stock-count-label').textContent = stockCount;
}
function renderOpponentSlot(position, opponentName, count, active, opened, sets) {
  const badge = $(`badge-${position}`);
  const cardsEl = $(`cards-${position}`);
  if (!opponentName) {
    badge.textContent = 'Sugaya...';
    badge.className = 'player-badge';
    cardsEl.innerHTML = '';
    return;
  }
  badge.textContent = opponentName + (opened ? ' ✓' : '');
  badge.className = active ? 'player-badge active' : 'player-badge';
  cardsEl.innerHTML = '';
  if (sets && sets.length > 0) {
    sets.forEach(set => {
      const setDiv = document.createElement('div');
      setDiv.className = 'opened-set';
      set.forEach((card, ci) => setDiv.appendChild(makeCard(card, 'sm', { overlap: ci > 0 })));
      cardsEl.appendChild(setDiv);
    });
  } else {
    const show = Math.min(count, 7);
    for (let i = 0; i < show; i++) cardsEl.appendChild(makeCardBack('sm'));
    if (count > 7) {
      const more = document.createElement('span');
      more.style.cssText = 'color:rgba(255,255,255,.4);font-size:.75rem;align-self:center;margin-left:4px;';
      more.textContent = `+${count - 7}`;
      cardsEl.appendChild(more);
    }
  }
}
function getPlayerAtOffset(offset) {
  const myIdx = players.findIndex(p => p.id === socket.id);
  if (myIdx === -1) return null;
  return players[(myIdx + offset) % players.length] || null;
}
function getTableSetsAtOffset(offset) {
  const myIdx = tablePlayers.findIndex(p => p.id === socket.id);
  if (myIdx === -1) return [];
  return tablePlayers[(myIdx + offset) % tablePlayers.length]?.openedSets || [];
}
function renderOpponents() {
  const offsets = { left: 3, top: 2, right: 1 };
  ['left', 'top', 'right'].forEach(pos => {
    const p = getPlayerAtOffset(offsets[pos]);
    const sets = getTableSetsAtOffset(offsets[pos]);
    renderOpponentSlot(
      pos,
      p ? p.name : (opponents[pos] ? opponents[pos].name : null),
      p ? p.cardCount : 0,
      p ? p.id === currentTurnId : false,
      p ? p.isOpened : false,
      sets
    );
  });
}
function renderMyBadge() {
  const badge = $('my-name-badge');
  badge.textContent = myName + (isOpened ? ' ✓' : '') + ' (Adiga)';
  const amActive = currentTurnId === socket.id;
  badge.className = `my-name-badge bold ${amActive ? 'active' : 'gold'}`;
}
function renderMyTableSets() {
  const container = $('my-table-sets');
  container.innerHTML = '';
  myOpenedSets.forEach(set => {
    const setDiv = document.createElement('div');
    setDiv.className = 'opened-set';
    set.forEach((card, ci) => setDiv.appendChild(makeCard(card, 'sm', { overlap: ci > 0 })));
    container.appendChild(setDiv);
  });
}
function renderAll() {
  renderHeader();
  renderHand();
  renderDiscardPile();
  renderStockPile();
  renderOpponents();
  renderMyBadge();
  renderMyTableSets();
}
function toggleCard(idx) {
  myHand[idx] = { ...myHand[idx], selected: !myHand[idx].selected };
  renderHand();
}
function handleDrop(targetIdx) {
  if (dragStartIndex === null || dragStartIndex === targetIdx) return;
  const moved = myHand.splice(dragStartIndex, 1)[0];
  myHand.splice(targetIdx, 0, moved);
  dragStartIndex = null;
  renderHand();
}
function handleSort() {
  const vOrder = { '6':6,'7':7,'8':8,'9':9,'10':10,'j':11,'q':12,'k':13,'a':14 };
  const sOrder = { '♠':4,'♥':3,'♦':2,'♣':1 };
  myHand.sort((a, b) => {
    const sA = sOrder[a.suit]||0, sB = sOrder[b.suit]||0;
    if (a.suit !== b.suit) return sB - sA;
    return (vOrder[a.value.toLowerCase()]||0) - (vOrder[b.value.toLowerCase()]||0);
  });
  myHand = myHand.map(c => ({ ...c, selected: false }));
  renderHand();
}
function handleDraw() {
  if (!isMyTurn) { showNotification('Sug doorkaaga!'); return; }
  if (hasDrawn) { showNotification('Horey ayaad u qaadatay kaar.'); return; }
  socket.emit('drawCard');
}
function handlePickDiscard() {
  if (!isMyTurn) { showNotification('Sug doorkaaga!'); return; }
  if (hasDrawn) { showNotification('Horey ayaad u qaadatay kaar.'); return; }
  if (!discardTop) { showNotification('Tuurista kuma jiraan kaar.'); return; }
  socket.emit('pickDiscard');
}
function handleDhigo() {
  if (!isMyTurn) { showNotification('Sug doorkaaga!'); return; }
  const selected = myHand.filter(c => c.selected);
  if (selected.length < 3) { showNotification('Dooro ugu yaraan 3 kaar!'); return; }
  const { validGroups, remaining } = findValidGroups(selected);
  if (remaining.length > 0) { showNotification(`Kaarka ${remaining[0].value} ma geli karo koox!`); return; }
  const moveScore = selected.reduce((s, c) => s + cardPoints(c), 0);
  if (!isOpened) {
    const currentTotal = temporaryScore + moveScore;
    const allSetsSoFar = [...myOpenedSets, ...validGroups];
    const hasFourPlus = allSetsSoFar.some(g => g.length >= 4);
    if (currentTotal >= currentMinToOpen && hasFourPlus) {
      isOpened = true; iHaveOpened = true;
      myOpenedSets = allSetsSoFar;
      const selectedIds = new Set(selected.map(c => c.id));
      myHand = myHand.filter(c => !selectedIds.has(c.id)).map(c => ({ ...c, selected: false }));
      socket.emit('meldSets', { sets: allSetsSoFar, totalScore: currentTotal });
      socket.emit('syncHandAfterMeld', myHand);
      temporaryScore = 0;
      showNotification(`Waad degtay! ${currentTotal} dhibco. Qofka xiga: ${currentTotal + 1}`);
    } else {
      if (currentTotal < currentMinToOpen && hasFourPlus) {
        showNotification(`Ma degi kartid! U baahan: ${currentMinToOpen} dhibco.`); return;
      }
      temporaryScore += moveScore;
      myOpenedSets = [...myOpenedSets, ...validGroups];
      const selectedIds = new Set(selected.map(c => c.id));
      myHand = myHand.filter(c => !selectedIds.has(c.id)).map(c => ({ ...c, selected: false }));
      socket.emit('syncHandAfterMeld', myHand);
      showNotification(`Wadarta: ${temporaryScore}. U baahan: ${currentMinToOpen}`);
    }
  } else {
    const selectedIds = new Set(selected.map(c => c.id));
    myHand = myHand.filter(c => !selectedIds.has(c.id)).map(c => ({ ...c, selected: false }));
    socket.emit('meldSets', { sets: validGroups, isAdditional: true });
    socket.emit('syncHandAfterMeld', myHand);
    myOpenedSets = [...myOpenedSets, ...validGroups];
  }
  renderAll();
}
function handleReset() {
  if (iHaveOpened || isOpened) { showNotification('Hore ayaad u degtay, kama noqon kartid!'); return; }
  if (!myOpenedSets.length) { showNotification('Ma jiraan kaarar aad dhigtay.'); return; }
  const back = myOpenedSets.flat().map(c => ({ ...c, selected: false }));
  myHand = [...myHand, ...back];
  myOpenedSets = []; temporaryScore = 0;
  socket.emit('resetMyOpenedCards');
  showNotification('Kaararkii waa lagu soo celiyay gacantaada.');
  renderAll();
}
function handleTuur() {
  if (!isMyTurn) { showNotification('Sug doorkaaga!'); return; }
  if (myHand.length === 14 && !hasDrawn) { showNotification('Fadlan marka hore kaar qaado!'); return; }
  if (pickedFromDiscard && !isOpened) {
    const score = myHand.filter(c => c.selected).reduce((s, c) => s + cardPoints(c), 0);
    if (score < 101) { showNotification('Maadaama aad tuurista qaadatay, waa inaad degtaa (101)!'); return; }
    else { showNotification("Fadlan marka hore riix 'Dhigo' si aad u degto!"); return; }
  }
  const selIdx = myHand.findIndex(c => c.selected);
  if (selIdx === -1) { showNotification('Dooro kaarka aad tuurayso!'); return; }
  const remaining = myHand.length - 1;
  if (remaining === 1 || remaining === 2) { showNotification('Xeerka Batuutada: Ma kuu hari karaan 1 ama 2 xabo!'); return; }
  const cardToPlay = myHand[selIdx];
  socket.emit('playCard', cardToPlay);
  myHand.splice(selIdx, 1);
  isMyTurn = false; hasDrawn = false; pickedFromDiscard = false;
  clearInterval(turnTimerInterval);
  renderAll();
}
function renderWaitingRoom(plist) {
  $('waiting-count').textContent = `Raadinaya... (${plist.length}/4)`;
  const list = $('waiting-list');
  list.innerHTML = '';
  plist.forEach(p => {
    const row = document.createElement('div');
    row.className = 'waiting-player';
    row.innerHTML = `<span class="dot">●</span><span class="pname">${p.name}</span><span class="ready">Diyaar</span>`;
    list.appendChild(row);
  });
  for (let i = plist.length; i < 4; i++) {
    const row = document.createElement('div');
    row.className = 'waiting-empty';
    row.innerHTML = `<span style="animation:pulse 1s infinite;color:#555">●</span><span>Sugaya...</span>`;
    list.appendChild(row);
  }
}
function initSocket() {
  socket = io({ path: '/socket.io' });
  socket.on('waitingRoomUpdate', data => renderWaitingRoom(data.players));
  socket.on('startHand', hand => {
    myHand = hand.map(c => ({ ...c, selected: false }));
    showScreen('game'); renderAll();
  });
  socket.on('matchFound', data => {
    discardTop = data.topDiscard; currentTurnId = data.currentTurn;
    showScreen('game'); renderAll();
  });
  socket.on('playersUpdate', data => {
    // --- KHADKA CUSUB EE LOG-GA ---
    console.log("--- Xog Cusub oo timid ---");
    console.log("Turubka (Stock):", data.stockCount);
    console.log("Ma Doorkayga baa?:", data.currentTurnId === socket.id);
    // ------------------------------

    players = data.players; 
    stockCount = data.stockCount; 
    currentTurnId = data.currentTurnId;
    
    const wasMyTurn = isMyTurn;
    isMyTurn = data.currentTurnId === socket.id;
    
    if (isMyTurn && !wasMyTurn) {
      startTurnTimer();
      showNotification('DOORKAAGA! Kaar qaado ama tuurista ka qaado.', 2500);
    }
    
    const me = players.find(p => p.id === socket.id);
    if (me) myScore = me.points || 0;
    
    renderAll();
});
  socket.on('yourTurn', () => {
    isMyTurn = true; startTurnTimer();
    showNotification('DOORKAAGA!', 2000); renderAll();
  });
  socket.on('updateDiscardPile', card => { discardTop = card; renderDiscardPile(); });
  socket.on('updateStockCount', count => { stockCount = count; renderStockPile(); });
  socket.on('receiveCard', card => {
    myHand.push({ ...card, selected: false }); hasDrawn = true; renderHand();
  });
  socket.on('updateHand', data => {
    myHand = data.hand.map(c => ({ ...c, selected: false })); renderHand();
  });
  socket.on('discardPickedSuccess', data => {
    pickedFromDiscard = true; hasDrawn = true;
    showNotification(`${data.card.value}${data.card.suit} tuuristii ayaad ka qaadatay`, 2000);
  });
  socket.on('autoDiscarded', card => {
    showNotification(`Waqtigii dhamaday — ${card.value}${card.suit} ayaa si toos ah loo tuuray`, 3000);
  });
  socket.on('updateTableUI', data => {
    tablePlayers = data.players; currentMinToOpen = data.nextRequiredPoints;
    renderOpponents(); renderMyTableSets(); renderHand();
  });
  socket.on('updateOpponents', data => { opponents = data; renderOpponents(); });
  socket.on('scoreUpdated', data => {
    if (data.playerId === socket.id) { myScore = data.newTotal; renderHeader(); }
  });
  socket.on('gameOver', data => {
    clearInterval(turnTimerInterval);
    if (data.winnerId === socket.id) {
      const fooroTarget = applyFooroLogic(data.winnerId, data.providerId, data.allPlayers);
      if (fooroTarget) {
        socket.emit('updatePenaltyScore', { playerId: fooroTarget.id, points: 101 });
        showNotification(`FOORO! ${fooroTarget.name} ayaa 101 dhibco helay!`, 6000);
      }
    }
    $('gameover-modal').classList.remove('hidden');
    if (data.winnerId === socket.id) {
      $('modal-icon').textContent = '🏆';
      $('modal-title').textContent = 'WAAD GUULEYSATAY!';
      $('modal-body').textContent = `Hambalyo, ${myName}!`;
    } else {
      $('modal-icon').textContent = '🃏';
      $('modal-title').textContent = 'CIYAARTU WAA DHAMMAATAY';
      $('modal-body').innerHTML = `<span style="color:#2ecc71;font-weight:700">${data.winnerName}</span> ayaa guuleystay!`;
    }
  });
  socket.on('notification', msg => showNotification(msg));
  socket.on('timerPaused', data => { showNotification(data.message, 2000); clearInterval(turnTimerInterval); });
  setInterval(() => socket.emit('ping_keep_alive'), 25000);
}
document.addEventListener('DOMContentLoaded', () => {
  initSocket();
  $('join-btn').addEventListener('click', joinGame);
  $('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(); });
  $('btn-draw').addEventListener('click', handleDraw);
  $('btn-pick-discard').addEventListener('click', handlePickDiscard);
  $('btn-dhigo').addEventListener('click', handleDhigo);
  $('btn-reset').addEventListener('click', handleReset);
  $('btn-sort').addEventListener('click', handleSort);
  $('btn-tuur').addEventListener('click', handleTuur);
});
function joinGame() {
  const nameInput = $('name-input');
  const name = nameInput.value.trim();
  
  if (!name) {
    alert("Fadlan geli magacaaga!");
    return;
  }

  myName = name;
  
  // MUHIIM: HTML-kaagu wuxuu leeyahay id="waiting-screen" 
  // Markaa waa inaad u qortaa 'waiting' sababtoo ah showScreen() ayaa ku daraysa '-screen'
  showScreen('waiting'); 
  
  renderWaitingRoom([]);
  socket.emit('joinRandom', name);

  // Typewriter logic
  setTimeout(() => {
    const typewriterEl = $('waiting-typewriter');
    if (typewriterEl) {
      typeWriter('waiting-typewriter', `${name}, soo dhowoow! Dulqaado fadlan inta ay ciyaartooyda kale ku soo biirayaan...`, 48);
    }
  }, 300);
}
function typeWriter(elementId, text, speed = 45) {
  const el = $(elementId);
  if (!el) return;
  
  el.textContent = ""; // Marka hore faaruqi meesha
  let i = 0;
  
  function type() {
    if (i < text.length) {
      el.textContent += text.charAt(i);
      i++;
      setTimeout(type, speed);
    }
  }
  type();
}
