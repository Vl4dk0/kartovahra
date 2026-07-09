(function () {
  "use strict";
  const SUITS = ["♠", "♥", "♦", "♣"];
  const KEY = "chuj.v1";
  const MUTE = "chuj.muted";
  // Súčet bodov v jednom kole je vždy jedna z týchto hodnôt:
  // 20 (základ), 24 (dolník žaluďový dupľovaný), 28 (dolník listový dupľovaný),
  // 40 (oba dupľované → všetky srdcové dupľované).
  const CLEAN_TOTALS = new Set([20, 24, 28, 40]);
  const $ = (s) => document.querySelector(s);

  let state = { players: [], history: [], started: false, over: false };

  /* ---------- helpers ---------- */
  const suitOf = (i) => SUITS[i % SUITS.length];
  const isRed = (i) => suitOf(i) === "♥" || suitOf(i) === "♦";
  const initial = (name) => (name.trim()[0] || "?").toUpperCase();

  // Replay all rounds applying the rules → totals
  function computeTotals(history, n) {
    const t = new Array(n).fill(0);
    for (const round of history) {
      for (let i = 0; i < n; i++) {
        t[i] += round[i] || 0;
        if (t[i] === 100) t[i] = 90; // presne 100 → späť na 90
      }
    }
    return t;
  }
  const totals = () => computeTotals(state.history, state.players.length);

  // Ktorí hráči už niekedy (v doterajšej histórii) prekročili 90 bodov (t.j. 91–99).
  function everOver90(history, n) {
    const ever = new Array(n).fill(false);
    const t = new Array(n).fill(0);
    for (const round of history) {
      for (let i = 0; i < n; i++) {
        t[i] += round[i] || 0;
        if (t[i] === 100) t[i] = 90;
        if (t[i] > 90) ever[i] = true;
      }
    }
    return ever;
  }
  const dealerIndex = () =>
    state.history.length % Math.max(state.players.length, 1);

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {}
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.players)) state = Object.assign(state, s);
    } catch (e) {}
  }

  /* ---------- voice (Web Speech API) ---------- */
  // Ohlasuje zmenu miešajúceho a koniec hry. Hlas: preferuj "sk", fallback "cs",
  // inak default. getVoices() sa môže naplniť až po evente "voiceschanged".
  const Voice = (function () {
    const supported =
      typeof window !== "undefined" && "speechSynthesis" in window;
    let voice = null;
    function pickVoice() {
      const vs = window.speechSynthesis.getVoices();
      voice =
        vs.find((v) => /^sk/i.test(v.lang)) ||
        vs.find((v) => /^cs/i.test(v.lang)) ||
        null;
    }
    if (supported) {
      pickVoice(); // zoznam môže byť ešte prázdny…
      window.speechSynthesis.addEventListener("voiceschanged", pickVoice); // …doplní sa sem
    }
    let muted = false;
    // queue=false → pred rečou zrušíme frontu; queue=true → táto hláška ide za predošlú
    function speak(text, queue) {
      if (!supported || muted || !text) return;
      if (!voice) pickVoice(); // skús znova, ak sa hlasy medzitým načítali
      if (!queue) window.speechSynthesis.cancel(); // nech sa hlášky neradia do fronty
      const u = new SpeechSynthesisUtterance(text);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = "sk-SK"; // fallback: nech engine aspoň skúsi slovenčinu
      }
      window.speechSynthesis.speak(u);
    }
    function setMuted(m) {
      muted = m;
      if (supported && m) window.speechSynthesis.cancel(); // stíš aj to, čo práve hovorí
    }
    return { speak, setMuted, isMuted: () => muted };
  })();

  let lastDealer = -1; // index naposledy ohláseného miešajúceho (-1 = žiadny)
  let booted = false; // hlásenia zapneme až po prvom rendere (nie pri obnove stránky)

  /* ---------- toast ---------- */
  function toast(html) {
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = html;
    $("#toasts").appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .3s, transform .3s";
      el.style.opacity = "0";
      el.style.transform = "translateY(10px)";
      setTimeout(() => el.remove(), 300);
    }, 2600);
  }

  /* ---------- views ---------- */
  function showView(name) {
    document
      .querySelectorAll(".view")
      .forEach((v) => v.classList.remove("is-active"));
    $("#view-" + name).classList.add("is-active");
  }

  // Po zápise kola posuň tabuľku na najnovší riadok.
  function scrollBoardToBottom() {
    const el = $(".board__scroll");
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }

  // Zosúlaď ikonku a stav tlačidla hlasu.
  function updateSoundBtn() {
    const btn = $("#soundBtn");
    if (!btn) return;
    const muted = Voice.isMuted();
    btn.classList.toggle("is-muted", muted);
    btn.setAttribute("aria-pressed", String(!muted));
  }

  function render() {
    if (state.over) {
      renderGame();
      showView("game");
      openOverlay();
    } else if (state.started) {
      closeOverlay();
      renderGame();
      showView("game");
    } else {
      closeOverlay();
      renderSetup();
      showView("setup");
    }
  }

  /* ---------- setup ---------- */
  function renderSetup() {
    lastDealer = -1; // späť v setupe → nová hra nech znova ohlási miešajúceho
    $("#roundBadge").hidden = true;
    const list = $("#playerList");
    list.innerHTML = state.players
      .map(
        (p, i) => `
      <li class="pcard">
        <button class="pcard__x" data-action="remove-player" data-i="${i}" aria-label="Odobrať ${escapeHtml(p.name)}">×</button>
        <span class="pcard__suit ${isRed(i) ? "s-red" : "s-ink"}">${suitOf(i)}</span>
        <span class="pcard__name">${escapeHtml(p.name)}</span>
      </li>`,
      )
      .join("");
    const ok = state.players.length >= 2;
    $("#startBtn").disabled = !ok;
    $("#startHint").style.display = ok ? "none" : "block";
  }

  /* ---------- game ---------- */
  function renderGame() {
    const n = state.players.length;
    const t = totals();
    const di = dealerIndex();

    $("#roundBadge").hidden = false;
    $("#roundBadge").textContent = "Kolo " + (state.history.length + 1);

    // dealer card
    const d = state.players[di];
    $("#dealerName").textContent = d.name;
    const dsuit = suitOf(di),
      dred = isRed(di);
    const dcolor = dred ? "var(--red)" : "var(--ink)";
    const idx = initial(d.name) + dsuit;
    $("#dcIdxTL").textContent = idx;
    $("#dcIdxBR").textContent = idx;
    $("#dcPip").textContent = dsuit;
    $("#dcIdxTL").style.color =
      $("#dcIdxBR").style.color =
      $("#dcPip").style.color =
        dcolor;

    // voice: ohlás zmenu miešajúceho (len počas hry, nie pri obnove stránky)
    if (!state.over) {
      if (booted && di !== lastDealer) {
        const next = state.players[(di + 1) % n];
        Voice.speak(`Teraz mieša ${d.name}. Začína ${next.name}.`);
      }
      lastDealer = di;
    }

    // header
    const heat = (v) => (v >= 90 ? "hot" : v >= 70 ? "warm" : "");
    let head = "<tr><th class='th-corner'></th>";
    state.players.forEach((p, i) => {
      head += `<th class="th-name ${i === di ? "is-dealer" : ""}">
        <span class="th-name__deal">${i === di ? "mieša" : ""}</span>
        <span class="th-name__suit ${isRed(i) ? "s-red" : "s-ink"}" style="color:${isRed(i) ? "var(--red)" : "var(--ink)"}">${suitOf(i)}</span>
        <span class="th-name__label">${escapeHtml(p.name)}</span>
      </th>`;
    });
    head += "</tr><tr><th class='th-corner tot'></th>";
    state.players.forEach((p, i) => {
      head += `<td class="tot"><span class="tot__n ${heat(t[i])}">${t[i]}</span></td>`;
    });
    head += "</tr>";
    $("#scoreHead").innerHTML = head;

    // body (rounds) — recompute running totals to classify deltas
    const body = $("#scoreBody");
    if (state.history.length === 0) {
      body.innerHTML = `<tr><td class="board__empty" colspan="${n + 1}"><span>♠ ♥ ♦ ♣</span>Zatiaľ žiadne kolá.<br>Stlač „Nové kolo" a rozdaj.</td></tr>`;
    } else {
      const run = new Array(n).fill(0);
      let rows = "";
      state.history.forEach((round, r) => {
        rows += `<tr><td class="rnd-no">K${r + 1}</td>`;
        for (let i = 0; i < n; i++) {
          const before = run[i];
          let after = before + (round[i] || 0);
          let cls = "delta",
            txt;
          const raw = round[i] || 0;
          if (after === 100) {
            after = 90;
            cls += " drop";
          } else if (after > 100) {
            cls += " bust";
          } else if (raw === 0) {
            cls += " zero";
          }
          run[i] = after;
          txt =
            (raw > 0 ? "+" : "") +
            raw +
            (after === 90 && before + raw === 100 ? " ↓" : "");
          if (before + raw > 100) txt = "+" + raw + " 💀";
          rows += `<td><span class="${cls}">${txt}</span></td>`;
        }
        rows += "</tr>";
      });
      body.innerHTML = rows;
    }

    $("#undoBtn").disabled = state.history.length === 0;
  }

  /* ---------- round sheet ---------- */
  function openRound() {
    if (state.over) return;
    const di = dealerIndex();
    $("#sheetTitle").textContent =
      "Kolo " + (state.history.length + 1) + " — body";
    $("#sheetDeal").innerHTML =
      `Mieša <b>${escapeHtml(state.players[di].name)}</b>. Zapíš, koľko kto nazbieral.`;
    const t = totals();
    $("#sheetRows").innerHTML = state.players
      .map(
        (p, i) => `
      <div class="prow">
        <div class="prow__id">
          <span class="prow__suit" style="color:${isRed(i) ? "var(--red)" : "var(--ink)"}">${suitOf(i)}</span>
          <span class="prow__name">${escapeHtml(p.name)} <span class="prow__now">· ${t[i]} b</span></span>
        </div>
        <div class="stepper">
          <button class="step" data-action="step" data-i="${i}" data-d="-1" aria-label="menej">−</button>
          <input class="pts" id="pts-${i}" type="number" inputmode="numeric" pattern="[0-9]*" value="0" aria-label="Body pre ${escapeHtml(p.name)}" />
          <button class="step" data-action="step" data-i="${i}" data-d="1" aria-label="viac">+</button>
        </div>
      </div>`,
      )
      .join("");
    $("#sheetBack").classList.add("is-open");
    // select-all on focus for fast typing
    $("#sheetRows")
      .querySelectorAll(".pts")
      .forEach((inp) => {
        inp.addEventListener("focus", () => inp.select());
        inp.addEventListener("input", updateRoundSum);
      });
    updateRoundSum();
  }
  function closeRound() {
    $("#sheetBack").classList.remove("is-open");
  }

  // Read the points currently typed into the round sheet, one entry per player.
  function readPts() {
    const n = state.players.length;
    const pts = [];
    for (let i = 0; i < n; i++) {
      let v = parseInt($("#pts-" + i).value, 10);
      if (isNaN(v)) v = 0;
      pts.push(v);
    }
    return pts;
  }

  // Keep the live round total in sync; highlight it when it's a valid sum.
  function updateRoundSum() {
    const sum = readPts().reduce((a, b) => a + b, 0);
    const val = $("#sheetSumVal");
    if (val) val.textContent = sum;
    const box = $("#sheetSum");
    if (box) box.classList.toggle("is-clean", CLEAN_TOTALS.has(sum));
  }

  function saveRound() {
    const pts = readPts();
    const sum = pts.reduce((a, b) => a + b, 0);
    if (!CLEAN_TOTALS.has(sum)) {
      if (!confirm("Súčet bodov je: " + sum + ".\n\nZapísať kolo aj tak?")) return;
    }
    const before = totals();
    const wasOver90 = everOver90(state.history, state.players.length); // pred týmto kolom
    state.history.push(pts);

    // messaging + bust detection + prvé prekročenie 90
    const busted = [];
    const newlyOver90 = [];
    state.players.forEach((p, i) => {
      const reached = before[i] + pts[i];
      if (reached === 100) {
        toast(`<b>${escapeHtml(p.name)}</b> má presne 100 → späť na 90!`);
      } else if (reached > 100) {
        busted.push(i);
      }
      // prvýkrát nad 90 (91–99) → nižníky sa mu odteraz nepočítajú
      if (!wasOver90[i] && reached > 90 && reached < 100) newlyOver90.push(i);
    });

    closeRound();

    if (busted.length) {
      state.over = true;
      save();
      render();
    } else {
      save();
      renderGame(); // ohlási zmenu miešajúceho
      // re-trigger dealer card deal animation
      const c = $("#dealerCard");
      c.classList.remove("card--deal");
      void c.offsetWidth;
      c.classList.add("card--deal");
      // hlas: prvé prekročenie 90 → nižníky sa nepočítajú (zaradí sa za miešajúceho)
      if (newlyOver90.length) {
        const mena = newlyOver90.map((i) => state.players[i].name).join(" a ");
        Voice.speak(`Pre ${mena} sa odteraz nižníky nepočítajú.`, true);
      }
      scrollBoardToBottom();
    }
  }

  /* ---------- overlay ---------- */
  function bustedIndices() {
    const t = totals();
    return state.players.map((p, i) => i).filter((i) => t[i] > 100);
  }
  function openOverlay() {
    const t = totals();
    const losers = bustedIndices();
    const names = losers.map((i) => state.players[i].name.toUpperCase());
    let verdict;
    if (names.length === 0) verdict = "Koniec hry";
    else if (names.length === 1) verdict = `${names[0]}<em>je chuj!</em>`;
    else verdict = `${names.join(" A ")}<em>sú chuji!</em>`;
    $("#verdict").innerHTML = verdict;

    // voice: na konci hry ohlás porazeného ("<meno> je chuj!")
    let spoken;
    if (names.length === 1)
      spoken = `${state.players[losers[0]].name} je chuj!`;
    else if (names.length >= 2)
      spoken = `${losers.map((i) => state.players[i].name).join(" a ")} sú chuji!`;
    if (booted && spoken) Voice.speak(spoken);
    lastDealer = -1; // ďalšia hra/odveta nech znova ohlási miešajúceho

    // standings sorted by points asc (least = winner)
    const order = state.players
      .map((p, i) => ({ i, t: t[i] }))
      .sort((a, b) => a.t - b.t);
    const minT = order[0].t;
    $("#standings").innerHTML = order
      .map((o, rank) => {
        const lose = losers.includes(o.i);
        const win = o.t === minT && !lose;
        return `<li class="${win ? "win" : ""} ${lose ? "lose" : ""}">
        <span class="stand__rank">${rank + 1}</span>
        <span class="stand__suit" style="color:${isRed(o.i) ? "var(--red)" : "#e7dcf0"}">${suitOf(o.i)}</span>
        <span class="stand__name">${escapeHtml(state.players[o.i].name)}</span>
        <span class="stand__pts">${o.t}</span>
      </li>`;
      })
      .join("");

    const ov = $("#overlay");
    ov.classList.add("is-open");
    requestAnimationFrame(() => {
      ov.classList.add("shake");
      setTimeout(() => ov.classList.remove("shake"), 600);
    });
  }
  function closeOverlay() {
    $("#overlay").classList.remove("is-open");
  }

  /* ---------- actions ---------- */
  function addPlayer() {
    const inp = $("#nameInput");
    let name = inp.value.trim();
    if (!name) return;
    // avoid dup exact names by appending number
    const base = name;
    let k = 2;
    while (state.players.some((p) => p.name === name)) {
      name = base + " " + k++;
    }
    state.players.push({ name });
    inp.value = "";
    inp.focus();
    save();
    renderSetup();
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    switch (a) {
      case "toggle-sound": {
        const m = !Voice.isMuted();
        Voice.setMuted(m);
        try {
          localStorage.setItem(MUTE, m ? "1" : "0");
        } catch (e) {}
        updateSoundBtn();
        break;
      }
      case "add-player":
        addPlayer();
        break;
      case "remove-player":
        state.players.splice(+el.dataset.i, 1);
        save();
        renderSetup();
        break;
      case "start":
        if (state.players.length >= 2) {
          state.started = true;
          state.history = [];
          state.over = false;
          save();
          render();
          const c = $("#dealerCard");
          c.classList.remove("card--deal");
          void c.offsetWidth;
          c.classList.add("card--deal");
        }
        break;
      case "open-round":
        openRound();
        break;
      case "cancel-round":
        closeRound();
        break;
      case "save-round":
        saveRound();
        break;
      case "step": {
        const inp = $("#pts-" + el.dataset.i);
        let v = parseInt(inp.value, 10);
        if (isNaN(v)) v = 0;
        v += +el.dataset.d;
        inp.value = v;
        updateRoundSum();
        break;
      }
      case "undo":
        if (state.history.length) {
          state.history.pop();
          state.over = false;
          save();
          render();
        }
        break;
      case "undo-from-over":
        if (state.history.length) {
          state.history.pop();
          state.over = false;
          save();
          render();
        }
        break;
      case "end-game":
        if (confirm("Ukončiť hru a vrátiť sa k hráčom? Skóre sa zmaže.")) {
          state.started = false;
          state.over = false;
          state.history = [];
          save();
          render();
        }
        break;
      case "rematch":
        state.history = [];
        state.over = false;
        state.started = true;
        save();
        render();
        {
          const c = $("#dealerCard");
          c.classList.remove("card--deal");
          void c.offsetWidth;
          c.classList.add("card--deal");
        }
        break;
      case "new-players":
        state.history = [];
        state.over = false;
        state.started = false;
        save();
        render();
        break;
    }
  });

  // Enter to add player / close sheet on backdrop
  $("#nameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addPlayer();
    }
  });
  $("#sheetBack").addEventListener("click", (e) => {
    if (e.target === $("#sheetBack")) closeRound();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeRound();
  });

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  /* ---------- init ---------- */
  load();
  try {
    Voice.setMuted(localStorage.getItem(MUTE) === "1"); // obnov uložený stav hlasu
  } catch (e) {}
  updateSoundBtn();
  render();
  scrollBoardToBottom(); // po obnove rozohranej hry ukáž najnovšie kolo
  booted = true; // od tejto chvíle už hlásenia hovoríme nahlas
})();
