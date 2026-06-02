function startApp() {

// ===================== STORAGE (Firebase) =====================
async function load(key, fallback) {
  try {
    const val = await window.__fbGet("renshan/" + key);
    return val !== null ? val : fallback;
  } catch(e) { return fallback; }
}
async function save(key, value) {
  try { await window.__fbSet("renshan/" + key, value); } catch(e) { console.error(e); }
}

// ===================== CONSTANTS =====================
const PASSWORD_HASH = "aed9e955f35f371272a0fcd55fd4ae779e2ea63e1a589547b748d6317b41030f";
const FLOORS = [
  { label: "A", rooms: ["A01"] },
  { label: "B", rooms: ["B01", "B02"] },
  { label: "C", rooms: ["C01", "C02"] },
  { label: "D", rooms: ["D01", "D02"] },
];
const ROOMS = FLOORS.flatMap(f => f.rooms);
const ROOM_TYPES = { 2: "雙人房", 3: "三人房", 4: "四人房", 5: "五人房" };
const FLOOR_COLORS = {
  "A": { bg:"#1e2e1e", border:"#2e4a2e", accent:"#4a8a4a" },
  "B": { bg:"#1e1e2e", border:"#2e2e4a", accent:"#5a5aaa" },
  "C": { bg:"#2e1e1e", border:"#4a2e2e", accent:"#aa5a5a" },
  "D": { bg:"#2a2214", border:"#4a3a1e", accent:"#aa8a3a" },
};

// 舊房號 → 新房號 對照表（自動搬移用）
const ROOM_MIGRATION = {
  "101":"A01","201":"B01","202":"B02",
  "301":"C01","302":"C02","401":"D01","402":"D02"
};

const defaultAssignments = Object.fromEntries(ROOMS.map(r => [r, []]));
const defaultRoomConfig  = Object.fromEntries(ROOMS.map(r => [r, 2]));
const defaultRoomPasswords = Object.fromEntries(ROOMS.map(r => [r, ""]));

async function sha256(msg) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

// ===================== 自動搬移舊資料 =====================
async function migrateIfNeeded(assignments) {
  // 檢查是否有任何舊 key 存在
  const hasOldKeys = Object.keys(ROOM_MIGRATION).some(oldKey => assignments[oldKey] !== undefined);
  if (!hasOldKeys) return assignments;

  console.log("偵測到舊房號資料，自動搬移中…");
  const migrated = { ...defaultAssignments };

  // 把舊 key 的資料搬到新 key
  for (const [oldKey, newKey] of Object.entries(ROOM_MIGRATION)) {
    if (assignments[oldKey] && assignments[oldKey].length > 0) {
      migrated[newKey] = assignments[oldKey];
    }
  }
  // 保留已經是新 key 的資料
  for (const room of ROOMS) {
    if (assignments[room] && assignments[room].length > 0) {
      migrated[room] = assignments[room];
    }
  }

  // 存回 Firebase
  await save("assignments", migrated);
  console.log("搬移完成");
  return migrated;
}

// ===================== HOOKS =====================
const { useState, useEffect } = React;

// ===================== MAIN APP =====================
function App() {
  const [isAdmin, setIsAdmin]               = useState(false);
  const [showLogin, setShowLogin]           = useState(false);
  const [guests, setGuests]                 = useState([]);
  const [assignments, setAssignments]       = useState(defaultAssignments);
  const [roomConfig, setRoomConfig]         = useState(defaultRoomConfig);
  const [roomPasswords, setRoomPasswords]   = useState(defaultRoomPasswords);
  const [announcements, setAnnouncements]   = useState([]);
  const [loading, setLoading]               = useState(true);
  const [dragging, setDragging]             = useState(null);
  const [dragOver, setDragOver]             = useState(null);
  const [toast, setToast]                   = useState(null);

  useEffect(() => {
    (async () => {
      const [g, a, rc, rp, an] = await Promise.all([
        load("guests", []),
        load("assignments", defaultAssignments),
        load("roomConfig", defaultRoomConfig),
        load("roomPasswords", defaultRoomPasswords),
        load("announcements", []),
      ]);
      const migratedA = await migrateIfNeeded(a);
      setGuests(g); setAssignments(migratedA); setRoomConfig(rc);
      setRoomPasswords(rp); setAnnouncements(an);
      setLoading(false);
    })();
  }, []);

  const toast_ = (msg, type="ok") => { setToast({msg,type}); setTimeout(()=>setToast(null),2400); };

  const upGuests        = async g  => { setGuests(g);          await save("guests", g); };
  const upAssign        = async a  => { setAssignments(a);     await save("assignments", a); };
  const upRoomCfg       = async rc => { setRoomConfig(rc);     await save("roomConfig", rc); };
  const upRoomPasswords = async rp => { setRoomPasswords(rp);  await save("roomPasswords", rp); };
  const upAnnounce      = async an => { setAnnouncements(an);  await save("announcements", an); };

  const assignedIds = new Set(Object.values(assignments).flat());
  const unassigned  = guests.filter(g => !assignedIds.has(g.id));

  const onDragStart = (guestId, fromRoom) => setDragging({ guestId, fromRoom });

  const onDrop = async (toRoom) => {
    if (!dragging) return;
    const { guestId, fromRoom } = dragging;
    if (fromRoom === toRoom) { setDragging(null); setDragOver(null); return; }
    const cap = roomConfig[toRoom] || 2;
    if ((assignments[toRoom]||[]).length >= cap) {
      toast_(`房間 ${toRoom} 已滿（${cap}人）`, "err");
      setDragging(null); setDragOver(null); return;
    }
    const na = { ...assignments };
    if (fromRoom !== null) na[fromRoom] = na[fromRoom].filter(id => id !== guestId);
    na[toRoom] = [...(na[toRoom]||[]), guestId];
    await upAssign(na); setDragging(null); setDragOver(null);
  };

  const onDropUnassigned = async () => {
    if (!dragging || dragging.fromRoom === null) { setDragging(null); setDragOver(null); return; }
    const na = { ...assignments };
    na[dragging.fromRoom] = na[dragging.fromRoom].filter(id => id !== dragging.guestId);
    await upAssign(na); setDragging(null); setDragOver(null);
  };

  const togglePay   = async id => upGuests(guests.map(g => g.id===id ? {...g, paid:!g.paid} : g));
  const renameGuest = async (id, name) => upGuests(guests.map(g => g.id===id ? {...g, name} : g));
  const deleteGuest = async id => {
    const na = Object.fromEntries(Object.entries(assignments).map(([r,ids]) => [r, ids.filter(x=>x!==id)]));
    await upAssign(na);
    await upGuests(guests.filter(g => g.id !== id));
    toast_("已刪除住客");
  };
  const updateRoomPassword = async (room, pw) => {
    const nrp = { ...roomPasswords, [room]: pw };
    await upRoomPasswords(nrp);
  };

  if (loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0d1014",color:"#e8dcc8",fontSize:18}}>
      載入中…
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#0d1014",color:"#e8dcc8",fontFamily:"'Georgia',serif"}}>
      {toast && (
        <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",
          background:toast.type==="err"?"#7f1d1d":"#1a3a2a",color:"#fff",
          padding:"10px 20px",borderRadius:8,zIndex:9999,fontSize:14,
          fontFamily:"sans-serif",whiteSpace:"nowrap",boxShadow:"0 4px 16px rgba(0,0,0,0.6)"}}>
          {toast.msg}
        </div>
      )}
      {showLogin && (
        <LoginModal
          onLogin={async pw => {
            const h = await sha256(pw);
            if (h === PASSWORD_HASH) { setIsAdmin(true); setShowLogin(false); toast_("歡迎，管理員！"); }
            else toast_("密碼錯誤", "err");
          }}
          onClose={() => setShowLogin(false)}
        />
      )}
      <Board
        isAdmin={isAdmin} guests={guests} assignments={assignments}
        roomConfig={roomConfig} roomPasswords={roomPasswords} announcements={announcements}
        unassigned={unassigned} dragging={dragging} dragOver={dragOver}
        setDragOver={setDragOver} onDragStart={onDragStart}
        onDrop={onDrop} onDropUnassigned={onDropUnassigned}
        togglePay={togglePay} deleteGuest={deleteGuest} renameGuest={renameGuest}
        upGuests={upGuests} upRoomCfg={upRoomCfg} upAnnounce={upAnnounce}
        updateRoomPassword={updateRoomPassword} toast_={toast_}
        onAdminLogin={() => setShowLogin(true)}
        onAdminLogout={() => { setIsAdmin(false); toast_("已登出"); }}
      />
    </div>
  );
}

// ===================== LOGIN MODAL =====================
function LoginModal({ onLogin, onClose }) {
  const [pw, setPw] = useState("");
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}}>
      <div style={{background:"#1a1e2a",border:"1px solid #3a3050",borderRadius:16,
        padding:"36px 28px",width:"100%",maxWidth:340,textAlign:"center"}}>
        <div style={{fontSize:28,marginBottom:6}}>🔑</div>
        <div style={{fontFamily:"sans-serif",color:"#a09080",fontSize:13,marginBottom:20}}>人山民宿 管理員登入</div>
        <input type="password" placeholder="請輸入密碼" value={pw}
          onChange={e=>setPw(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&onLogin(pw)}
          style={{width:"100%",padding:"11px 14px",borderRadius:8,border:"1px solid #3a3050",
            background:"#0d1014",color:"#e8dcc8",fontSize:15,marginBottom:14,
            boxSizing:"border-box",outline:"none"}}
          autoFocus />
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={()=>onLogin(pw)} color="#6b5b95" label="確認登入" />
          <Btn onClick={onClose} color="#2a2a3a" label="取消" />
        </div>
      </div>
    </div>
  );
}

// ===================== BOARD =====================
function Board({ isAdmin, guests, assignments, roomConfig, roomPasswords, announcements,
  unassigned, dragging, dragOver, setDragOver, onDragStart, onDrop, onDropUnassigned,
  togglePay, deleteGuest, renameGuest, upGuests, upRoomCfg, upAnnounce,
  updateRoomPassword, toast_, onAdminLogin, onAdminLogout }) {
  const [showAddGuest, setShowAddGuest] = useState(false);
  const [showAnnounce, setShowAnnounce] = useState(false);
  const [showRoomCfg,  setShowRoomCfg]  = useState(false);
  return (
    <div style={{maxWidth:600,margin:"0 auto",padding:"16px 12px 48px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div>
          <h1 style={{margin:0,fontSize:22,letterSpacing:3,color:"#e8dcc8"}}>人山民宿</h1>
          <div style={{color:"#7a6a5a",fontSize:11,marginTop:1,fontFamily:"sans-serif"}}>RENSHAN HOMESTAY · 4/23–4/24</div>
        </div>
        {isAdmin
          ? <button onClick={onAdminLogout} style={smallBtn("#2a2030","#9a7aba")}>登出</button>
          : <button onClick={onAdminLogin}  style={smallBtn("#1a1e2a","#7a6a9a")}>管理員</button>
        }
      </div>
      {isAdmin && (
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          <ActionBtn onClick={()=>setShowAddGuest(true)} icon="＋" label="新增住客" color="#4a6a4a" />
          <ActionBtn onClick={()=>setShowAnnounce(true)} icon="📋" label="公佈欄"   color="#4a4a7a" />
          <ActionBtn onClick={()=>setShowRoomCfg(true)}  icon="⚙"  label="房型設定" color="#6a4a2a" />
        </div>
      )}
      {announcements.length > 0 && <AnnounceBanner announcements={announcements} />}
      <UnassignedPool
        guests={unassigned} isAdmin={isAdmin} dragging={dragging} dragOver={dragOver}
        setDragOver={setDragOver} onDragStart={onDragStart}
        onDropUnassigned={onDropUnassigned} togglePay={togglePay}
        deleteGuest={deleteGuest} renameGuest={renameGuest}
      />
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {FLOORS.map(floor => (
          <FloorRow key={floor.label} floor={floor}
            assignments={assignments} guests={guests} roomConfig={roomConfig}
            roomPasswords={roomPasswords} isAdmin={isAdmin}
            dragging={dragging} dragOver={dragOver} setDragOver={setDragOver}
            onDragStart={onDragStart} onDrop={onDrop}
            togglePay={togglePay} deleteGuest={deleteGuest} renameGuest={renameGuest}
            updateRoomPassword={updateRoomPassword}
          />
        ))}
      </div>
      {showAddGuest && (
        <AddGuestModal onClose={()=>setShowAddGuest(false)}
          onAdd={async name => {
            await upGuests([...guests, {id:`g_${Date.now()}`,name,paid:false}]);
            toast_(`已新增：${name}`); setShowAddGuest(false);
          }} />
      )}
      {showAnnounce && (
        <AnnounceModal announcements={announcements} onClose={()=>setShowAnnounce(false)}
          onSave={async list => { await upAnnounce(list); toast_("公佈欄已更新"); }} />
      )}
      {showRoomCfg && (
        <RoomCfgModal roomConfig={roomConfig} onClose={()=>setShowRoomCfg(false)}
          onSave={async rc => { await upRoomCfg(rc); toast_("房型設定已更新"); setShowRoomCfg(false); }} />
      )}
    </div>
  );
}

// ===================== FLOOR ROW =====================
function FloorRow({ floor, assignments, guests, roomConfig, roomPasswords, isAdmin,
  dragging, dragOver, setDragOver, onDragStart, onDrop,
  togglePay, deleteGuest, renameGuest, updateRoomPassword }) {
  const fc = FLOOR_COLORS[floor.label] || FLOOR_COLORS["A"];
  return (
    <div style={{background:fc.bg,border:`1px solid ${fc.border}`,borderRadius:12,overflow:"hidden"}}>
      <div style={{padding:"6px 12px",borderBottom:`1px solid ${fc.border}`,display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontFamily:"sans-serif",fontSize:12,fontWeight:700,color:fc.accent,letterSpacing:1}}>{floor.label}</span>
        <span style={{fontFamily:"sans-serif",fontSize:11,color:"#5a5060"}}>{floor.rooms.length}間</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:`repeat(${floor.rooms.length},1fr)`}}>
        {floor.rooms.map((room,i) => (
          <RoomCard key={room} room={room}
            capacity={roomConfig[room]||2} guestIds={assignments[room]||[]}
            password={roomPasswords[room]||""}
            guests={guests} isAdmin={isAdmin}
            dragging={dragging} dragOver={dragOver} setDragOver={setDragOver}
            onDragStart={onDragStart} onDrop={onDrop}
            togglePay={togglePay} deleteGuest={deleteGuest} renameGuest={renameGuest}
            updateRoomPassword={updateRoomPassword}
            borderLeft={i>0} />
        ))}
      </div>
    </div>
  );
}

// ===================== ROOM CARD =====================
function RoomCard({ room, capacity, guestIds, guests, password, isAdmin,
  dragging, dragOver, setDragOver, onDragStart, onDrop,
  togglePay, deleteGuest, renameGuest, updateRoomPassword, borderLeft }) {
  const roomGuests  = guestIds.map(id => guests.find(g=>g.id===id)).filter(Boolean);
  const isFull      = roomGuests.length >= capacity;
  const isTarget    = dragOver === `room_${room}`;
  const [editingPw, setEditingPw] = useState(false);
  const [pwDraft,   setPwDraft]   = useState(password);

  const savePw = async () => {
    await updateRoomPassword(room, pwDraft.trim());
    setEditingPw(false);
  };

  return (
    <div
      onDragOver={e=>{ if(isAdmin){e.preventDefault();setDragOver(`room_${room}`);}}}
      onDragLeave={()=>setDragOver(null)}
      onDrop={()=>{ if(isAdmin) onDrop(room); }}
      style={{padding:10,minHeight:90,boxSizing:"border-box",
        borderLeft:borderLeft?"1px solid rgba(255,255,255,0.06)":"none",
        background:isTarget?"rgba(107,91,149,0.2)":"transparent",transition:"background 0.15s"}}>

      {/* 房號 + 人數 */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontFamily:"sans-serif",fontWeight:700,fontSize:15,color:"#e8dcc8"}}>{room}</span>
          <span style={{fontFamily:"sans-serif",fontSize:10,color:"#6a5a7a",background:"rgba(0,0,0,0.3)",padding:"1px 6px",borderRadius:8}}>
            {ROOM_TYPES[capacity]||`${capacity}人`}
          </span>
        </div>
        <span style={{fontFamily:"sans-serif",fontSize:11,color:isFull?"#c45a5a":"#5a8a5a"}}>
          {roomGuests.length}/{capacity}
        </span>
      </div>

      {/* 房間密碼（僅管理員可見） */}
      {isAdmin && (
        <div style={{marginBottom:7}}>
          {editingPw ? (
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              <input
                autoFocus value={pwDraft}
                onChange={e=>setPwDraft(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter") savePw(); if(e.key==="Escape") setEditingPw(false); }}
                placeholder="房間密碼"
                style={{flex:1,padding:"3px 7px",borderRadius:5,border:"1px solid #3a3050",
                  background:"#0d1014",color:"#e8dcc8",fontSize:11,fontFamily:"sans-serif",outline:"none"}}
              />
              <button onClick={savePw}
                style={{...tinyBtn,background:"#2a4a2a",color:"#5ae05a",fontSize:10}}>✓</button>
              <button onClick={()=>setEditingPw(false)}
                style={{...tinyBtn,background:"#2a2a3a",fontSize:10}}>✕</button>
            </div>
          ) : (
            <div onClick={()=>{ setPwDraft(password); setEditingPw(true); }}
              style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",
                padding:"2px 6px",borderRadius:5,border:"1px dashed #2a2a3a",
                background:"rgba(0,0,0,0.2)"}}>
              <span style={{fontSize:10,color:"#5a4a6a",fontFamily:"sans-serif"}}>🔒</span>
              <span style={{fontFamily:"sans-serif",fontSize:11,
                color: password ? "#9080c0" : "#3a2a4a",
                fontStyle: password ? "normal" : "italic"}}>
                {password || "點擊設定密碼"}
              </span>
              {password && <span style={{fontSize:9,color:"#4a3a5a",fontFamily:"sans-serif",marginLeft:"auto"}}>✏️</span>}
            </div>
          )}
        </div>
      )}

      {/* 住客列表 */}
      <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {roomGuests.map(g => (
          <GuestCard key={g.id} guest={g} isAdmin={isAdmin} fromRoom={room}
            onDragStart={onDragStart} togglePay={togglePay}
            deleteGuest={deleteGuest} renameGuest={renameGuest} />
        ))}
        {roomGuests.length===0 && (
          <div style={{textAlign:"center",color:"#2e2e3e",fontFamily:"sans-serif",fontSize:12,padding:"8px 0"}}>
            {isAdmin?"拖曳至此":"—"}
          </div>
        )}
      </div>
    </div>
  );
}

// ===================== UNASSIGNED POOL =====================
function UnassignedPool({ guests, isAdmin, dragging, dragOver, setDragOver,
  onDragStart, onDropUnassigned, togglePay, deleteGuest, renameGuest }) {
  const isTarget = dragOver === "unassigned";
  return (
    <div
      onDragOver={e=>{ if(isAdmin){e.preventDefault();setDragOver("unassigned");}}}
      onDragLeave={()=>setDragOver(null)}
      onDrop={()=>{ if(isAdmin) onDropUnassigned(); }}
      style={{background:isTarget?"#2a1e3a":"#141020",
        border:`1px solid ${isTarget?"#6b5b95":"#221830"}`,
        borderRadius:12,padding:"10px 12px",marginBottom:12,transition:"all 0.18s"}}>
      <div style={{fontFamily:"sans-serif",color:"#9070b0",fontSize:12,fontWeight:700,marginBottom:8,letterSpacing:1}}>
        待分配住客 <span style={{color:"#6a5080",fontWeight:400}}>({guests.length}人)</span>
      </div>
      {guests.length===0 ? (
        <div style={{color:"#2e2040",fontFamily:"sans-serif",fontSize:12,textAlign:"center",padding:"8px 0"}}>
          {isAdmin?"可從房間拖回":"所有人已入住"}
        </div>
      ) : (
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {guests.map(g => (
            <GuestCard key={g.id} guest={g} isAdmin={isAdmin} fromRoom={null}
              onDragStart={onDragStart} togglePay={togglePay}
              deleteGuest={deleteGuest} renameGuest={renameGuest} inline />
          ))}
        </div>
      )}
    </div>
  );
}

// ===================== GUEST CARD =====================
function GuestCard({ guest, isAdmin, fromRoom, onDragStart, togglePay, deleteGuest, renameGuest, inline }) {
  const [sheet, setSheet]           = useState(false);
  const [renaming, setRenaming]     = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [newName, setNewName]       = useState(guest.name);

  const openSheet = (e) => {
    if (!isAdmin) return;
    e.stopPropagation();
    setNewName(guest.name); setRenaming(false); setConfirming(false); setSheet(true);
  };
  const closeSheet = () => { setSheet(false); setRenaming(false); setConfirming(false); };
  const handleRename = async () => {
    if (newName.trim() && newName.trim() !== guest.name) await renameGuest(guest.id, newName.trim());
    closeSheet();
  };
  const handleDelete = async () => { await deleteGuest(guest.id); closeSheet(); };

  return (
    <>
      <div draggable={isAdmin && !sheet}
        onDragStart={()=>isAdmin && !sheet && onDragStart(guest.id, fromRoom)}
        onClick={openSheet}
        style={{background:"rgba(0,0,0,0.35)",
          border:`1px solid ${guest.paid?"#2a4a2a":"#3a2a2a"}`,borderRadius:7,
          padding:inline?"5px 8px":"6px 9px",cursor:isAdmin?"pointer":"default",
          display:"flex",alignItems:"center",gap:5,userSelect:"none",flexShrink:0,
          WebkitTapHighlightColor:"transparent"}}>
        <div style={{width:7,height:7,borderRadius:"50%",flexShrink:0,background:guest.paid?"#4a9a4a":"#9a4a4a"}} />
        <span style={{fontFamily:"sans-serif",fontSize:12,color:"#e0d0c0",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {guest.name}
        </span>
        <span style={{fontFamily:"sans-serif",fontSize:10,color:guest.paid?"#4a8a4a":"#8a4a4a",flexShrink:0}}>
          {guest.paid?"已繳":"未繳"}
        </span>
      </div>

      {sheet && (
        <div onClick={closeSheet}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:3000,
            display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:"#1a1e2a",border:"1px solid #3a3050",
              borderRadius:"16px 16px 0 0",padding:"20px 20px 36px",width:"100%",maxWidth:480}}>
            <div style={{fontFamily:"sans-serif",fontSize:15,fontWeight:700,color:"#e8dcc8",marginBottom:16,textAlign:"center"}}>
              {guest.name}
            </div>
            {renaming ? (
              <div>
                <input autoFocus value={newName} onChange={e=>setNewName(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&handleRename()}
                  style={{...iStyle,marginBottom:12}} placeholder="輸入新名稱" />
                <div style={{display:"flex",gap:8}}>
                  <Btn onClick={handleRename}           color="#6b5b95" label="確認改名" />
                  <Btn onClick={()=>setRenaming(false)} color="#2a2a3a" label="取消" />
                </div>
              </div>
            ) : confirming ? (
              <div>
                <div style={{fontFamily:"sans-serif",fontSize:14,color:"#e05a5a",textAlign:"center",marginBottom:16}}>
                  確定要刪除「{guest.name}」？
                </div>
                <div style={{display:"flex",gap:8}}>
                  <Btn onClick={handleDelete}             color="#7f1d1d" label="確定刪除" />
                  <Btn onClick={()=>setConfirming(false)} color="#2a2a3a" label="取消" />
                </div>
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <button onClick={async()=>{ await togglePay(guest.id); closeSheet(); }}
                  style={{...sheetBtn,background:guest.paid?"#2a1a1a":"#1a2a1a",color:guest.paid?"#e05a5a":"#5ae05a"}}>
                  {guest.paid?"✗ 標記為未繳費":"✓ 標記為已繳費"}
                </button>
                <button onClick={()=>setRenaming(true)} style={{...sheetBtn,background:"#1e1e2e",color:"#9090e0"}}>
                  ✏️ 更改姓名
                </button>
                <button onClick={()=>setConfirming(true)} style={{...sheetBtn,background:"#2a1a1a",color:"#e05a5a"}}>
                  🗑 刪除住客
                </button>
                <button onClick={closeSheet} style={{...sheetBtn,background:"#141414",color:"#6a6a6a",marginTop:4}}>
                  取消
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const sheetBtn = {width:"100%",padding:"13px 0",borderRadius:10,border:"none",cursor:"pointer",fontSize:15,fontFamily:"sans-serif",fontWeight:500};

// ===================== ANNOUNCE BANNER =====================
function AnnounceBanner({ announcements }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{background:"#181410",border:"1px solid #3a2e10",borderRadius:12,marginBottom:12,overflow:"hidden"}}>
      <div onClick={()=>setOpen(o=>!o)}
        style={{padding:"10px 14px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontFamily:"sans-serif",color:"#c4a96b",fontWeight:700,fontSize:13}}>📋 公佈欄 · {announcements.length}則</span>
        <span style={{color:"#7a6a3a",fontSize:12}}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <div style={{padding:"0 14px 14px",borderTop:"1px solid #2a2010"}}>
          {announcements.map((a,i)=>(
            <div key={i} style={{marginTop:10,paddingBottom:10,borderBottom:i<announcements.length-1?"1px solid #2a2010":"none"}}>
              <div style={{color:"#c4a96b",fontWeight:700,fontSize:13,fontFamily:"sans-serif",marginBottom:3}}>{a.title}</div>
              <div style={{color:"#a09070",fontSize:13,fontFamily:"sans-serif",whiteSpace:"pre-wrap",lineHeight:1.6}}>{a.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===================== ADD GUEST MODAL =====================
function AddGuestModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  return (
    <Modal title="新增住客" onClose={onClose}>
      <input autoFocus placeholder="住客姓名" value={name}
        onChange={e=>setName(e.target.value)}
        onKeyDown={e=>e.key==="Enter"&&name.trim()&&onAdd(name.trim())}
        style={iStyle} />
      <div style={{display:"flex",gap:8,marginTop:14}}>
        <Btn onClick={()=>name.trim()&&onAdd(name.trim())} color="#6b5b95" label="新增" />
        <Btn onClick={onClose} color="#2a2a3a" label="取消" />
      </div>
    </Modal>
  );
}

// ===================== ANNOUNCE MODAL =====================
function AnnounceModal({ announcements, onClose, onSave }) {
  const [list, setList]       = useState(announcements.map(a=>({...a})));
  const [editIdx, setEditIdx] = useState(null);
  const [form, setForm]       = useState({title:"",content:""});
  const startEdit = idx => { setEditIdx(idx); setForm(idx===-1?{title:"",content:""}:{...list[idx]}); };
  const saveEdit  = () => {
    if (!form.title.trim()) return;
    const nl=[...list];
    if(editIdx===-1) nl.push({...form}); else nl[editIdx]={...form};
    setList(nl); setEditIdx(null);
  };
  return (
    <Modal title="公佈欄管理" onClose={onClose} wide>
      {editIdx!==null ? (
        <div>
          <label style={lStyle}>公告標題</label>
          <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} style={iStyle} placeholder="例：智慧大門密碼" />
          <label style={{...lStyle,marginTop:10}}>公告內容</label>
          <textarea value={form.content} onChange={e=>setForm(f=>({...f,content:e.target.value}))}
            rows={5} style={{...iStyle,resize:"vertical"}} placeholder={"例：密碼 9527\n轉帳：玉山銀行 1234-5678"} />
          <div style={{display:"flex",gap:8,marginTop:14}}>
            <Btn onClick={saveEdit} color="#6b5b95" label="儲存" />
            <Btn onClick={()=>setEditIdx(null)} color="#2a2a3a" label="取消" />
          </div>
        </div>
      ) : (
        <>
          {list.map((a,i)=>(
            <div key={i} style={{background:"#0d1014",border:"1px solid #2a2a3a",borderRadius:8,padding:"10px 12px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{color:"#c4a96b",fontWeight:700,fontFamily:"sans-serif",fontSize:13}}>{a.title}</div>
                <div style={{color:"#a09070",fontFamily:"sans-serif",fontSize:12,marginTop:3,whiteSpace:"pre-wrap"}}>{a.content}</div>
              </div>
              <div style={{display:"flex",gap:5,flexShrink:0,marginLeft:10}}>
                <button onClick={()=>startEdit(i)} style={{...tinyBtn,background:"#2a2a3a"}}>✏️</button>
                <button onClick={()=>setList(list.filter((_,j)=>j!==i))} style={{...tinyBtn,background:"#3a1a1a",color:"#c45a5a"}}>✕</button>
              </div>
            </div>
          ))}
          {list.length===0 && <div style={{color:"#3a3040",fontFamily:"sans-serif",fontSize:13,textAlign:"center",padding:"16px 0"}}>尚無公告</div>}
          <div style={{display:"flex",gap:8,marginTop:14}}>
            <Btn onClick={()=>startEdit(-1)} color="#3a3050" label="＋ 新增" />
            <Btn onClick={()=>{ onSave(list); onClose(); }} color="#2a4a2a" label="✓ 發布" />
          </div>
        </>
      )}
    </Modal>
  );
}

// ===================== ROOM CFG MODAL =====================
function RoomCfgModal({ roomConfig, onClose, onSave }) {
  const [cfg, setCfg] = useState({...roomConfig});
  return (
    <Modal title="房型容量設定" onClose={onClose}>
      {FLOORS.map(floor=>(
        <div key={floor.label}>
          <div style={{fontFamily:"sans-serif",fontSize:11,color:"#7a6a5a",marginBottom:6,marginTop:10,letterSpacing:1}}>{floor.label}</div>
          {floor.rooms.map(room=>(
            <div key={room} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontFamily:"sans-serif",color:"#c0b0a0",fontSize:13}}>房間 {room}</span>
              <div style={{display:"flex",gap:5}}>
                {[2,3,4,5].map(n=>(
                  <button key={n} onClick={()=>setCfg(c=>({...c,[room]:n}))} style={{
                    padding:"4px 10px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,
                    background:cfg[room]===n?"#6b5b95":"#2a2a3a",color:cfg[room]===n?"#fff":"#a09080",fontFamily:"sans-serif"
                  }}>{n}人</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      <div style={{display:"flex",gap:8,marginTop:16}}>
        <Btn onClick={()=>onSave(cfg)} color="#6b5b95" label="儲存" />
        <Btn onClick={onClose} color="#2a2a3a" label="取消" />
      </div>
    </Modal>
  );
}

// ===================== MODAL WRAPPER =====================
function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:14}}>
      <div style={{background:"#1a1e2a",border:"1px solid #3a3050",borderRadius:14,padding:"22px 20px",width:"100%",maxWidth:wide?520:360,maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h2 style={{margin:0,fontSize:16,color:"#e8dcc8",fontFamily:"sans-serif"}}>{title}</h2>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#7a6a5a",cursor:"pointer",fontSize:18,lineHeight:1,padding:4}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ===================== SHARED ATOMS =====================
function ActionBtn({ onClick, icon, label, color }) {
  return (
    <button onClick={onClick} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:5,
      padding:"9px 0",borderRadius:9,border:"none",cursor:"pointer",
      background:color+"33",color:"#e8dcc8",fontSize:13,fontFamily:"sans-serif",outline:`1px solid ${color}55`}}>
      <span style={{fontSize:14}}>{icon}</span>{label}
    </button>
  );
}
function Btn({ onClick, color, label }) {
  return (
    <button onClick={onClick} style={{flex:1,padding:"10px 0",borderRadius:8,border:"none",background:color,color:"#e8dcc8",cursor:"pointer",fontSize:14,fontFamily:"sans-serif"}}>
      {label}
    </button>
  );
}
function smallBtn(bg, color) {
  return {padding:"6px 14px",borderRadius:8,border:"none",background:bg,color,cursor:"pointer",fontSize:12,fontFamily:"sans-serif"};
}
const tinyBtn  = {padding:"3px 7px",borderRadius:5,border:"none",cursor:"pointer",fontSize:12,background:"#2a2a3a",color:"#e8dcc8"};
const iStyle   = {width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #3a3050",background:"#0d1014",color:"#e8dcc8",fontSize:14,fontFamily:"sans-serif",boxSizing:"border-box",outline:"none",display:"block"};
const lStyle   = {display:"block",color:"#a09080",fontFamily:"sans-serif",fontSize:12,marginBottom:5};

// ===================== MOUNT =====================
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);

} // end startApp

if (window.__firebaseReady) {
  startApp();
} else {
  document.addEventListener("firebase-ready", startApp);
}
