// --- storage ---
const KEY = "proto_crm_customers_v1";
const load = () => JSON.parse(localStorage.getItem(KEY) || "[]");
const save = (rows) => localStorage.setItem(KEY, JSON.stringify(rows));

const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

const STATUS = ["LEAD", "ACTIVE", "RISK", "CLOSED"];
const STATUS_LABEL = {
  LEAD: "LEAD",
  ACTIVE: "ACTIVE",
  RISK: "RISK",
  CLOSED: "CLOSED",
};

let state = {
  customers: load(),
  selectedId: null,
  q: "",
  status: "ALL",
};

const el = (id) => document.getElementById(id);

// --- render board ---
function groupByStatus(rows){
  const map = { LEAD: [], ACTIVE: [], RISK: [], CLOSED: [] };
  rows.forEach(r => map[r.status]?.push(r));
  return map;
}

function matchFilter(c){
  const q = state.q.trim().toLowerCase();
  const statusOk = state.status === "ALL" ? true : c.status === state.status;
  if(!statusOk) return false;

  if(!q) return true;
  const hay = [
    c.name, c.company, c.owner, (c.tags||[]).join(","), c.notes
  ].join(" ").toLowerCase();
  return hay.includes(q);
}

function renderBoard(){
  const rows = state.customers.filter(matchFilter);
  const grouped = groupByStatus(rows);

  const board = el("board");
  board.innerHTML = "";

  STATUS.forEach(st => {
    const col = document.createElement("div");
    col.className = "col";
    col.innerHTML = `
      <div class="col-head">
        <div>${STATUS_LABEL[st]}</div>
        <div class="badge">${grouped[st].length}</div>
      </div>
      <div class="cards" id="cards-${st}"></div>
    `;
    board.appendChild(col);

    const list = col.querySelector(`#cards-${st}`);
    grouped[st]
      .sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0))
      .forEach(c => list.appendChild(renderCard(c)));
  });
}

function renderCard(c){
  const div = document.createElement("div");
  div.className = "item";
  div.onclick = () => selectCustomer(c.id);

  const tags = (c.tags || []).slice(0,4).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("");
  const last = c.lastContact ? `최근 ${c.lastContact}` : "최근 접촉 없음";
  const next = c.nextAction ? ` / 다음 ${c.nextAction}` : "";
  div.innerHTML = `
    <div class="name">${escapeHtml(c.name || "(이름없음)")}</div>
    <div class="meta">${escapeHtml(c.company || "-")} · ${escapeHtml(c.owner || "-")}</div>
    <div class="meta">${last}${next}</div>
    <div class="tags">${tags}</div>
  `;
  return div;
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// --- detail ---
function selectCustomer(id){
  state.selectedId = id;
  const c = state.customers.find(x => x.id === id);
  if(!c) return;

  el("emptyDetail").classList.add("hidden");
  el("detailForm").classList.remove("hidden");

  el("dName").value = c.name || "";
  el("dCompany").value = c.company || "";
  el("dOwner").value = c.owner || "";
  el("dStatus").value = c.status || "LEAD";
  el("dLastContact").value = c.lastContact || "";
  el("dNextAction").value = c.nextAction || "";
  el("dTags").value = (c.tags || []).join(",");
  el("dNotes").value = c.notes || "";

  // greet in chat
  pushBot(`선택됨: ${c.name} (${c.company || "회사 미상"})\n원하시면 “한줄요약/다음액션/리스크체크”를 눌러보세요.`);
}

function upsertCustomer(patch){
  const now = Date.now();
  const idx = state.customers.findIndex(x => x.id === patch.id);
  if(idx >= 0){
    state.customers[idx] = { ...state.customers[idx], ...patch, updatedAt: now };
  } else {
    state.customers.unshift({ ...patch, updatedAt: now, createdAt: now });
  }
  save(state.customers);
  renderBoard();
}

function deleteCustomer(id){
  state.customers = state.customers.filter(x => x.id !== id);
  save(state.customers);
  state.selectedId = null;
  renderBoard();
  resetDetail();
}

function resetDetail(){
  el("detailForm").classList.add("hidden");
  el("emptyDetail").classList.remove("hidden");
}

// --- chat / agent (rule-based mock) ---
function pushMe(text){ pushMsg("me","나",text); }
function pushBot(text){ pushMsg("bot","Agent",text); }
function pushMsg(cls, who, text){
  const chat = el("chat");
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  div.innerHTML = `<div class="who">${who}</div><div class="body">${escapeHtml(text).replaceAll("\n","<br/>")}</div>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function getSelected(){
  return state.customers.find(x => x.id === state.selectedId) || null;
}

function agentAnswer(prompt){
  const c = getSelected();
  if(!c){
    return "먼저 왼쪽에서 고객을 선택해주세요.";
  }

  const tags = (c.tags || []).map(t=>t.trim()).filter(Boolean);
  const riskTag = tags.some(t => /위험|연체|부실|민원|소송/i.test(t));
  const stale = isStale(c.lastContact);

  const p = prompt.toLowerCase();

  if(p.includes("한 줄") || p.includes("한줄") || p.includes("요약")){
    return [
      `${c.name} (${c.company || "회사 미상"}) — 상태 ${c.status}.`,
      `담당: ${c.owner || "미지정"} / 태그: ${tags.join(", ") || "-"}`,
      `최근접촉: ${c.lastContact || "-"} / 다음액션: ${c.nextAction || "-"}`,
    ].join("\n");
  }

  if(p.includes("다음") || p.includes("액션") || p.includes("추천")){
    const actions = [];
    actions.push("1) 최근 상담/요청사항을 3줄로 정리해 CRM 메모 업데이트");
    actions.push("2) 다음 액션일 확정(콜/방문/서류요청) + 고객에게 캘린더 제안");
    if(stale) actions.push("3) 최근 접촉이 오래됨 → ‘안부/현황 체크’ 메시지 템플릿 발송");
    else actions.push("3) 직전 대화 이슈 후속(견적/조건/서류) 체크리스트 공유");
    if(riskTag || c.status === "RISK") actions.push("4) 리스크 포인트(연체/민원/재무악화) 관련 확인 질문 3개 준비");
    return actions.join("\n");
  }

  if(p.includes("리스크") || p.includes("이상") || p.includes("체크")){
    const points = [];
    points.push("- 최근 접촉 공백 여부: " + (stale ? "주의(오래됨)" : "양호"));
    points.push("- 태그 기반 위험신호: " + (riskTag || c.status==="RISK" ? "있음" : "특이사항 없음"));
    points.push("- 확인 질문 예시:");
    points.push("  1) 최근 3개월 매출/현금흐름 변동이 있었나요?");
    points.push("  2) 결제/상환 일정 이슈(지연/연체) 징후가 있었나요?");
    points.push("  3) 민원/분쟁/소송 등 대외 리스크가 있나요?");
    return points.join("\n");
  }

  if(p.includes("스크립트") || p.includes("상담")){
    return [
      `안녕하세요 ${c.name}님, 지난번 논의했던 건 관련해 진행 상황 확인드리려고 연락드렸습니다.`,
      `1) 현재 가장 우선순위가 높은 니즈가 무엇인지(자금/결제/운영자금/투자 등) 다시 한 번 확인드려도 될까요?`,
      `2) 필요 서류/데이터는 최소화해서 안내드리겠습니다. 오늘 통화 후 체크리스트를 문자/메일로 보내드릴게요.`,
      `3) 다음 단계(조건 제안/심사/실행) 일정은 ${c.nextAction || "이번 주 내"} 기준으로 잡아도 괜찮을까요?`,
    ].join("\n");
  }

  // default
  return "가능한 요청 예시: ‘이 고객 요약’, ‘다음 액션 추천’, ‘리스크 체크’, ‘상담 스크립트’";
}

function isStale(dateStr){
  if(!dateStr) return true;
  const d = new Date(dateStr + "T00:00:00");
  const diffDays = (Date.now() - d.getTime()) / (1000*60*60*24);
  return diffDays > 21;
}

// --- export/import ---
function downloadJson(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --- wire up ---
function init(){
  renderBoard();

  el("search").addEventListener("input", (e) => {
    state.q = e.target.value;
    renderBoard();
  });

  el("statusFilter").addEventListener("change", (e) => {
    state.status = e.target.value;
    renderBoard();
  });

  // add modal
  const modal = el("modal");
  el("btnAdd").onclick = () => { modal.showModal(); el("mName").focus(); };

  el("mCreate").onclick = (e) => {
    // allow dialog close after validating required field
    const name = el("mName").value.trim();
    if(!name){ e.preventDefault(); el("mName").focus(); return; }

    const c = {
      id: uid(),
      name,
      company: el("mCompany").value.trim(),
      owner: el("mOwner").value.trim(),
      status: el("mStatus").value,
      tags: el("mTags").value.split(",").map(s=>s.trim()).filter(Boolean),
      notes: "",
      lastContact: "",
      nextAction: ""
    };
    upsertCustomer(c);

    // reset fields
    el("mName").value = ""; el("mCompany").value = ""; el("mOwner").value = "";
    el("mTags").value = ""; el("mStatus").value = "LEAD";
    pushBot("새 고객이 추가되었습니다. 왼쪽 보드에서 선택해보세요.");
  };

  // detail save
  el("detailForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = state.selectedId;
    if(!id) return;

    upsertCustomer({
      id,
      name: el("dName").value.trim(),
      company: el("dCompany").value.trim(),
      owner: el("dOwner").value.trim(),
      status: el("dStatus").value,
      lastContact: el("dLastContact").value,
      nextAction: el("dNextAction").value,
      tags: el("dTags").value.split(",").map(s=>s.trim()).filter(Boolean),
      notes: el("dNotes").value
    });
    pushBot("저장 완료. 이제 Agent에게 ‘요약’ 또는 ‘다음 액션’을 요청해보세요.");
  });

  // delete
  el("btnDelete").onclick = () => {
    const c = getSelected();
    if(!c) return;
    const ok = confirm(`정말 삭제할까요? (${c.name})`);
    if(!ok) return;
    deleteCustomer(c.id);
    pushBot("삭제되었습니다.");
  };

  // chat send
  const send = () => {
    const text = el("prompt").value.trim();
    if(!text) return;
    pushMe(text);
    el("prompt").value = "";
    const answer = agentAnswer(text);
    pushBot(answer);
  };
  el("btnSend").onclick = send;
  el("prompt").addEventListener("keydown", (e) => {
    if(e.key === "Enter") send();
  });

  // quick chips
  document.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const q = btn.dataset.q;
      el("prompt").value = q;
      el("btnSend").click();
    });
  });

  // seed
  el("btnSeed").onclick = () => {
    const seeded = [
      {
        id: uid(), name:"김민지", company:"민지상사", owner:"RM 강태희",
        status:"LEAD", tags:["제조업","대출상담"], notes:"운영자금 문의. 매출 변동성 있음.",
        lastContact: "2025-12-10", nextAction:"2025-12-27"
      },
      {
        id: uid(), name:"이준호", company:"준호테크", owner:"RM 박서연",
        status:"ACTIVE", tags:["IT","급여이체"], notes:"ERP 연동 관심. 결제/정산 자동화 논의.",
        lastContact: "2025-12-21", nextAction:"2025-12-29"
      },
      {
        id: uid(), name:"최유라", company:"유라무역", owner:"RM 강태희",
        status:"RISK", tags:["무역","고위험","연체주의"], notes:"연체 가능성 모니터링 필요. 자료 요청 예정.",
        lastContact: "2025-11-28", nextAction:"2025-12-26"
      },
      {
        id: uid(), name:"정현수", company:"현수푸드", owner:"RM 김도윤",
        status:"CLOSED", tags:["유통"], notes:"계약 종료(경쟁사 전환). 재접촉은 2026 Q1 검토.",
        lastContact: "2025-10-02", nextAction:""
      }
    ];
    state.customers = seeded;
    save(state.customers);
    renderBoard();
    pushBot("샘플데이터를 불러왔습니다. 고객을 선택해보세요.");
  };

  // reset
  el("btnReset").onclick = () => {
    const ok = confirm("모든 데이터를 초기화할까요? (localStorage 삭제)");
    if(!ok) return;
    localStorage.removeItem(KEY);
    state.customers = [];
    state.selectedId = null;
    renderBoard();
    resetDetail();
    el("chat").innerHTML = "";
    pushBot("초기화 완료.");
  };

  // export/import
  el("btnExport").onclick = () => {
    downloadJson("customers-export.json", { customers: state.customers, exportedAt: new Date().toISOString() });
  };

  el("fileImport").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;
    const text = await file.text();
    try{
      const obj = JSON.parse(text);
      if(!obj.customers || !Array.isArray(obj.customers)) throw new Error("Invalid format");
      state.customers = obj.customers;
      save(state.customers);
      renderBoard();
      pushBot("가져오기 완료.");
    }catch(err){
      alert("가져오기 실패: JSON 형식을 확인하세요.");
    }finally{
      e.target.value = "";
    }
  });

  pushBot("안내: 이 프로토타입은 브라우저에만 저장됩니다(localStorage). 배포하면 URL을 QR로 공유할 수 있어요.");
}

init();

