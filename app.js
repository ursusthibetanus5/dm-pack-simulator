// ============================================================
// 開封シミュレーション本体
// ============================================================

function randInt(n) {
  return Math.floor(Math.random() * n);
}

function pickRandom(arr) {
  return arr[randInt(arr.length)];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sample(arr, n) {
  return shuffle([...arr]).slice(0, n);
}

function card(name, rarity) {
  return { name, rarity };
}

function configOf(set) {
  return { ...DEFAULT_CONFIG, ...(set.config || {}) };
}

function cartonSize(set) {
  const cfg = configOf(set);
  return cfg.boxesPerCarton * cfg.packsPerBox;
}

// パック内のスロット位置
const SLOT_R = 2;   // R枠(OR/SR/キャラプレミアム/銀/VR/シク と入れ替わる)
const SLOT_UC1 = 3; // UC枠(金トレジャーと入れ替わる)
const SLOT_UC2 = 4; // UC枠(黒トレジャーと入れ替わる)

// シク枠のカードを1枚抽選する
// レアリティを weights の重み付きで選び、そのレアリティの登録カードから1種選ぶ
function pickSecret(set) {
  const sec = set.secret;
  if (!sec) return null;
  const entries = Object.entries(sec.cards || {}).filter(
    ([rarity, list]) => list && list.length > 0 && (sec.weights[rarity] || 0) > 0
  );
  if (entries.length === 0) return null;

  const totalWeight = entries.reduce((sum, [rarity]) => sum + sec.weights[rarity], 0);
  let roll = Math.random() * totalWeight;
  for (const [rarity, list] of entries) {
    roll -= sec.weights[rarity];
    if (roll < 0) {
      return { name: pickRandom(list), rarity: "SEC", base: rarity };
    }
  }
  // 浮動小数の誤差対策(最後の候補にフォールバック)
  const [rarity, list] = entries[entries.length - 1];
  return { name: pickRandom(list), rarity: "SEC", base: rarity };
}

// 指定した弾の1箱ぶんのパックを生成する
// 仕様:
//   - 基本封入は C, C, R, UC, UC の5枚
//   - オーバーレア1枚・SR4枚(種類被りなし)・キャラプレミアムトレジャー1枚・
//     銀トレジャー1枚・VR6枚(種類被りなし)・シク枠1枚(レアリティは弾ごとの
//     重み付き抽選)は、それぞれ別のパックのR枠と入れ替わる(R枠を潰す)
//   - 残りのR枠には R が被りなく全種類入る(pool.R の種類数 = R枠数 = 16 が前提)
//   - 黒トレジャー12枚はUC1枚と入れ替わる(R以上と同じパックに共存し得る)
//   - コモンは1箱で全種が必ず2枚か3枚出る(4枚は揃わない)
//   - Cが3枚封入されるパックが箱に2つあり、そのパックはUCが1枚少ない
//   - アンコモンは1箱で全種が最低1枚・最大3枚出る
function buildBox(set, boxNo) {
  const cfg = configOf(set);
  const pool = set.pool;

  // C枠(1箱 60+3C封入パック数 = 62枚)の中身: 全種2枚ずつ+余り枠にランダムな
  // 種類の3枚目(pool.C が25種なら「12種が3枚+13種が2枚」になる)
  const cSlots = 2 * cfg.packsPerBox + cfg.tripleCPacksPerBox;
  const cList = [];
  if (2 * pool.C.length <= cSlots) {
    cList.push(...pool.C, ...pool.C);
    const extra = cSlots - cList.length;
    cList.push(...sample(pool.C, Math.min(extra, pool.C.length)));
  }
  while (cList.length < cSlots) cList.push(pickRandom(pool.C)); // 種類数が範囲外の場合の保険
  shuffle(cList);

  // UC枠(3C封入パックと黒トレジャーで潰れる分を除いた46枚)の中身: 全種1枚ずつ+
  // 残りをランダムな種類で埋める(1種あたり最大3枚)
  const ucSlots = 2 * cfg.packsPerBox - cfg.tripleCPacksPerBox - cfg.blackPerBox;
  let ucList;
  if (pool.UC.length <= ucSlots) {
    ucList = [...pool.UC];
    const ucCount = {};
    pool.UC.forEach((name) => (ucCount[name] = 1));
    while (ucList.length < ucSlots) {
      const candidates = pool.UC.filter((name) => ucCount[name] < 3);
      const name = candidates.length ? pickRandom(candidates) : pickRandom(pool.UC);
      ucCount[name]++;
      ucList.push(name);
    }
  } else {
    ucList = sample(pool.UC, ucSlots); // 種類数が枠より多い場合の保険
  }
  shuffle(ucList);

  const packs = [];
  for (let p = 0; p < cfg.packsPerBox; p++) {
    const cards = [
      card(cList[2 * p], "C"),
      card(cList[2 * p + 1], "C"),
      null, // R枠(後で割り当て)
      null, // UC枠1(後で割り当て。3C封入パックでは3枚目のC。金/ドリームと入れ替わる)
      null, // UC枠2(後で割り当て。黒トレジャーと入れ替わる)
    ];
    packs.push({ setName: set.name, boxNo, packNo: p + 1, cards });
  }

  // Cが3枚封入されるパック: UC枠1に3枚目のCが入る(UCが1枚減る)
  let cIdx = 2 * cfg.packsPerBox;
  sample(packs, Math.min(cfg.tripleCPacksPerBox, packs.length)).forEach((p) => {
    p.cards[SLOT_UC1] = card(cList[cIdx++], "C");
  });

  // R枠の上位レア(各1パックずつ別のパックに)
  const upgrades = [];
  for (let i = 0; i < cfg.orPerBox; i++) {
    upgrades.push(card(pickRandom(pool.OR), "OR"));
  }
  for (const name of sample(pool.SR, cfg.srPerBox)) {
    upgrades.push(card(name, "SR"));
  }
  for (let i = 0; i < cfg.charPremiumPerBox; i++) {
    upgrades.push(card(pickRandom(pool.CPT), "CPT"));
  }
  for (let i = 0; i < cfg.silverPerBox; i++) {
    upgrades.push(card(pickRandom(pool.SILVER), "SILVER"));
  }
  for (const name of sample(pool.VR, cfg.vrPerBox)) {
    upgrades.push(card(name, "VR"));
  }
  for (let i = 0; i < cfg.secretPerBox; i++) {
    const secret = pickSecret(set);
    if (secret) upgrades.push(secret);
  }
  const upgradePacks = sample(packs, upgrades.length);
  upgrades.forEach((c, i) => {
    upgradePacks[i].cards[SLOT_R] = c;
  });

  // 残りのR枠にRを被りなく全種類割り当てる(足りない場合は繰り返し)
  const rCards = shuffle([...pool.R]);
  packs
    .filter((p) => p.cards[SLOT_R] === null)
    .forEach((p, i) => {
      p.cards[SLOT_R] = card(rCards[i % rCards.length], "R");
    });

  // 黒トレジャーはUC1枚と入れ替え(R枠とは独立に選ぶので、SR等と共存し得る)
  // ただし「3C封入かつR枠が当たり」のパックには入れない
  // (UCが1枚もないパックはR枠が素のRのパックでしか発生させない)
  const blackCandidates = packs.filter(
    (p) => !(p.cards[SLOT_UC1] !== null && p.cards[SLOT_R].rarity !== "R")
  );
  const blackPacks = sample(blackCandidates, Math.min(cfg.blackPerBox, blackCandidates.length));
  blackPacks.forEach((p) => {
    p.cards[SLOT_UC2] = card(pickRandom(pool.BLACK), "BLACK");
  });

  // 残りのUC枠を箱単位のUCリストで埋める
  let ucIdx = 0;
  for (const p of packs) {
    if (!p.cards[SLOT_UC1]) p.cards[SLOT_UC1] = card(ucList[ucIdx++], "UC");
    if (!p.cards[SLOT_UC2]) p.cards[SLOT_UC2] = card(ucList[ucIdx++], "UC");
  }

  return packs;
}

// 1カートンを生成する(金トレジャーはカートン単位で封入)
function buildCarton(set) {
  const cfg = configOf(set);
  const pool = set.pool;

  const carton = [];
  for (let b = 1; b <= cfg.boxesPerCarton; b++) {
    carton.push(...buildBox(set, b));
  }

  // カートン単位の封入数: 整数部は確定、端数は確率で+1枚
  function perCartonCount(value) {
    let count = Math.floor(value);
    if (Math.random() < value - count) count++;
    return count;
  }

  // カートン内で種類が被らないように選ぶ(枚数が種類数を超えたら繰り返す)
  function distinctNames(list, count) {
    const names = [];
    while (names.length < count) {
      names.push(...sample(list, Math.min(count - names.length, list.length)));
    }
    return names;
  }

  // 箱ごとのUC種類カウント(金/ドリームが最後の1枚のUCを潰して
  // 「箱で0枚の種類」を作らないようにするため)
  const ucCountByBox = new Map();
  for (const p of carton) {
    if (!ucCountByBox.has(p.boxNo)) ucCountByBox.set(p.boxNo, new Map());
    const m = ucCountByBox.get(p.boxNo);
    for (const c of p.cards) {
      if (c.rarity === "UC") m.set(c.name, (m.get(c.name) || 0) + 1);
    }
  }

  // 金/ドリームを1枚ずつ封入する。条件:
  //   - UC枠1が通常のUC(3C封入パック・封入済みパックは除外)
  //   - UC枠2もUC(黒入りパックに入れるとUC0枚の当たりパックになるため除外)
  //   - そのUCの種類が箱に2枚以上残っている(潰しても箱で0枚にならない)
  function placeCartonCards(names, rarity, excludeBoxNos, trackBoxNos) {
    for (const name of names) {
      const candidates = carton.filter(
        (p) =>
          !excludeBoxNos.has(p.boxNo) &&
          p.cards[SLOT_UC1].rarity === "UC" &&
          p.cards[SLOT_UC2].rarity === "UC" &&
          ucCountByBox.get(p.boxNo).get(p.cards[SLOT_UC1].name) >= 2
      );
      if (candidates.length === 0) break;
      const p = pickRandom(candidates);
      const m = ucCountByBox.get(p.boxNo);
      m.set(p.cards[SLOT_UC1].name, m.get(p.cards[SLOT_UC1].name) - 1);
      p.cards[SLOT_UC1] = card(name, rarity);
      if (trackBoxNos) trackBoxNos.add(p.boxNo);
    }
  }

  // 金トレジャー(どの箱に入るかもランダム)
  const goldBoxNos = new Set();
  const goldCount = perCartonCount(cfg.goldPerCarton);
  if (goldCount > 0 && pool.GOLD && pool.GOLD.length > 0) {
    placeCartonCards(distinctNames(pool.GOLD, goldCount), "GOLD", new Set(), goldBoxNos);
  }

  // ドリームレア: 金トレジャーが入った箱には封入されない
  const dreamCount = perCartonCount(cfg.dreamPerCarton);
  if (dreamCount > 0 && pool.DREAM && pool.DREAM.length > 0) {
    placeCartonCards(distinctNames(pool.DREAM, dreamCount), "DM", goldBoxNos, null);
  }

  return carton;
}

// 弾ごとに1カートンを生成し、指定パック数を無作為に選ぶ
// selections: [{ set, count }]
function openPacks(selections) {
  const opened = [];
  for (const { set, count } of selections) {
    if (count <= 0) continue;
    const carton = buildCarton(set);
    opened.push(...sample(carton, Math.min(count, carton.length)));
  }
  return opened;
}

// ---- 表示 ----

const HIT_RARITIES = ["DM", "OR", "SR", "CPT", "SILVER", "GOLD", "SEC"];

function render(packs, multiSet) {
  const result = document.getElementById("result");
  result.innerHTML = "";

  const counts = { DM: 0, OR: 0, SEC: 0, GOLD: 0, SR: 0, CPT: 0, SILVER: 0, BLACK: 0, VR: 0 };

  packs.forEach((pack, i) => {
    const packEl = document.createElement("section");
    packEl.className = "pack";
    packEl.style.animationDelay = `${Math.min(i, 20) * 0.08}s`;

    const origin =
      (multiSet ? `${pack.setName} ` : "") +
      `${pack.boxNo}箱目 / ${pack.packNo}パック目`;
    const head = document.createElement("header");
    head.className = "pack-head";
    head.innerHTML =
      `<span class="pack-title">パック ${i + 1}</span>` +
      `<span class="pack-origin">${origin}</span>`;
    packEl.appendChild(head);

    const list = document.createElement("ul");
    list.className = "card-list";
    for (const c of pack.cards) {
      if (c.rarity in counts) counts[c.rarity]++;
      const meta = RARITY[c.rarity];
      const li = document.createElement("li");
      li.className = `card-row ${meta.cls}` + (HIT_RARITIES.includes(c.rarity) ? " hit" : "");
      // シクは元のレアリティも表示する(例: シク(SR枠))
      const baseNote = c.base
        ? `<span class="sec-base">(${RARITY[c.base].label}枠)</span>`
        : "";
      li.innerHTML =
        `<span class="badge" title="${meta.name}">${meta.label}</span>` +
        `<span class="card-name">${c.name}${baseNote}</span>`;
      list.appendChild(li);
    }
    packEl.appendChild(list);
    result.appendChild(packEl);
  });

  const summary = document.getElementById("summary");
  const parts = [];
  if (counts.DM) parts.push(`ドリームレア ${counts.DM}枚`);
  if (counts.OR) parts.push(`オーバーレア ${counts.OR}枚`);
  if (counts.SEC) parts.push(`シークレット ${counts.SEC}枚`);
  if (counts.GOLD) parts.push(`金トレジャー ${counts.GOLD}枚`);
  if (counts.SR) parts.push(`SR ${counts.SR}枚`);
  if (counts.CPT) parts.push(`キャラプレミアムトレジャー ${counts.CPT}枚`);
  if (counts.SILVER) parts.push(`銀トレジャー ${counts.SILVER}枚`);
  if (counts.BLACK) parts.push(`黒トレジャー ${counts.BLACK}枚`);
  if (counts.VR) parts.push(`VR ${counts.VR}枚`);
  summary.textContent = parts.length
    ? `${packs.length}パック開封 — 当たり: ${parts.join(" / ")}`
    : `${packs.length}パック開封 — 当たりなし……次のカートンに期待!`;
  summary.classList.toggle(
    "has-hit",
    counts.DM + counts.OR + counts.SEC + counts.GOLD + counts.SR + counts.CPT + counts.SILVER > 0
  );
}

// ---- 弾選択UI ----

function buildSetSelector() {
  const container = document.getElementById("set-select");
  SETS.forEach((set, i) => {
    const row = document.createElement("div");
    row.className = "set-option";
    row.dataset.setId = set.id;

    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "set-check";
    cb.checked = i === 0; // 初期状態は先頭の弾のみ選択
    label.appendChild(cb);
    label.appendChild(document.createTextNode(set.name));

    const num = document.createElement("input");
    num.type = "number";
    num.className = "set-count";
    num.min = "1";
    num.max = String(Math.min(MAX_TOTAL_PACKS, cartonSize(set)));
    num.value = String(DEFAULT_PACKS_TO_OPEN);
    num.disabled = !cb.checked;
    num.setAttribute("aria-label", `${set.name} の開封パック数`);

    const unit = document.createElement("span");
    unit.className = "set-unit";
    unit.textContent = "パック";

    cb.addEventListener("change", () => {
      num.disabled = !cb.checked;
    });

    row.appendChild(label);
    row.appendChild(num);
    row.appendChild(unit);
    container.appendChild(row);
  });
}

function getSelections() {
  const selections = [];
  for (const row of document.querySelectorAll("#set-select .set-option")) {
    const cb = row.querySelector(".set-check");
    if (!cb.checked) continue;
    const set = SETS.find((s) => s.id === row.dataset.setId);
    const max = Math.min(MAX_TOTAL_PACKS, cartonSize(set));
    let count = parseInt(row.querySelector(".set-count").value, 10);
    if (isNaN(count)) count = 0;
    count = Math.max(0, Math.min(count, max));
    if (count > 0) selections.push({ set, count });
  }
  return selections;
}

if (typeof document !== "undefined" && document.getElementById("set-select")) {
  buildSetSelector();

  document.getElementById("open-btn").addEventListener("click", () => {
    const selections = getSelections();
    const summary = document.getElementById("summary");
    if (selections.length === 0) {
      summary.textContent = "開封する弾にチェックを入れ、パック数を1以上にしてください";
      summary.classList.remove("has-hit");
      return;
    }
    const total = selections.reduce((sum, s) => sum + s.count, 0);
    if (total > MAX_TOTAL_PACKS) {
      summary.textContent = `開封できるのは合計${MAX_TOTAL_PACKS}パックまでです(現在 ${total}パック)`;
      summary.classList.remove("has-hit");
      return;
    }
    render(openPacks(selections), selections.length > 1);
    document.getElementById("open-btn").textContent = "もう一度開封する(新しいカートン)";
  });
}
