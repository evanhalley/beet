/* Beet — Main window. Three-pane: sidebar / list / detail.
   Two layout variants:
     "v1": classic — sidebar (sections+filters) | dense list | detail card
     "v2": lanes — horizontal kanban-ish lanes per section + detail rail
*/

function MainWindow({ variant = "v1", selectedId, onSelect, paused, refreshing, onRefresh, onTogglePause, updateReady, onSettings, settingsOpen }) {
  const lists = {
    needs: MOCK.needs, reviews: MOCK.reviews, inflight: MOCK.inflight, runs: MOCK.runs, recent: MOCK.recent,
  };
  const allItems = [...lists.needs, ...lists.reviews, ...lists.inflight];
  const sel = allItems.find(x => x.id === selectedId) || lists.needs[0];

  if (variant === "v2") return <MainWindowLanes selectedId={selectedId || sel.id} onSelect={onSelect} paused={paused} refreshing={refreshing} onRefresh={onRefresh} onTogglePause={onTogglePause} updateReady={updateReady} onSettings={onSettings}/>;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", borderRadius: 12, overflow: "hidden", boxShadow: "0 0 0 0.5px var(--border-strong), var(--shadow-lg)" }}>
      <TitleBar refreshing={refreshing} paused={paused} onRefresh={onRefresh} onTogglePause={onTogglePause} onSettings={onSettings} settingsOpen={settingsOpen}/>
      {updateReady && <UpdateBanner/>}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "200px 1fr 380px", minHeight: 0 }}>
        <Sidebar/>
        <div style={{ borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)", overflow: "auto", background: "var(--bg)" }}>
          <ListGroup title="Needs Action" icon="🔴" tone="danger" items={lists.needs} selectedId={sel.id} onSelect={onSelect} type="needs"/>
          <ListGroup title="Review Requests" icon="👀" items={lists.reviews} selectedId={sel.id} onSelect={onSelect} type="review"/>
          <ListGroup title="In Flight" icon="🚀" items={lists.inflight} selectedId={sel.id} onSelect={onSelect} type="inflight"/>
          <ListGroup title="Standalone Runs" icon="⚙️" items={lists.runs} selectedId={sel.id} onSelect={onSelect} type="run"/>
          <ListGroup title="Recently Resolved" icon="✅" items={lists.recent} selectedId={sel.id} onSelect={onSelect} type="recent" muted defaultCollapsed/>
        </div>
        <DetailPane item={sel}/>
      </div>
    </div>
  );
}

function UpdateBanner() {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap: 10,
      padding: "7px 14px",
      background: "linear-gradient(90deg, var(--accent-soft), transparent 80%)",
      borderBottom: "1px solid var(--border)",
      fontSize: 12,
    }}>
      <span style={{ display:"inline-flex", color:"var(--accent)" }}>{I.refresh()}</span>
      <span style={{ color: "var(--text)", fontWeight: 500 }}>An update is ready to install.</span>
      <span style={{ color: "var(--text-muted)" }}>Beet restarts in place — your tray and queries pick up where they left off.</span>
      <span style={{ flex: 1 }}/>
      <button style={{ padding: "3px 8px", borderRadius: 6, fontWeight: 500, fontSize: 11.5, color: "var(--text-muted)" }}>Later</button>
      <button style={{
        padding: "4px 10px", borderRadius: 6, fontWeight: 500, fontSize: 11.5,
        background: "var(--accent)", color: "var(--accent-fg)",
      }}>Restart now</button>
    </div>
  );
}

function TitleBar({ refreshing, paused, onRefresh, onTogglePause, onSettings, settingsOpen }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 14px", background: "var(--bg-elev)",
      borderBottom: "1px solid var(--border)",
      WebkitAppRegion: "drag",
    }}>
      <span style={{ display:"inline-flex", gap: 6 }}>
        <span style={{ width: 11, height: 11, borderRadius: 6, background: "#ff5f57"}}/>
        <span style={{ width: 11, height: 11, borderRadius: 6, background: "#ffbd2e"}}/>
        <span style={{ width: 11, height: 11, borderRadius: 6, background: "#28c93f"}}/>
      </span>
      <span style={{ width: 12 }}/>
      <BeetMark size={18}/>
      <span style={{ fontWeight: 600, fontSize: 13, letterSpacing: -0.2 }}>Beet</span>
      <span style={{ flex: 1 }}/>
      <div style={{
        display:"flex", alignItems:"center", gap: 6,
        padding: "3px 8px", borderRadius: 7,
        background: "var(--panel-2)", border: "1px solid var(--border)",
        color: "var(--text-faint)", fontSize: 11.5, minWidth: 220,
      }}>
        {I.search()} <span>Search PRs, runs, repos…</span> <span style={{ flex: 1 }}/>
        <span className="mono" style={{ fontSize: 10, opacity: 0.6 }}>⌘K</span>
      </div>
      <span style={{ flex: 1 }}/>
      <PollingDot spinning={refreshing} paused={paused}/>
      <button style={iconBtn} onClick={onRefresh}>{I.refresh()}</button>
      <button style={iconBtn} onClick={onTogglePause}>{paused ? I.play() : <span style={{ display:"inline-flex", gap:1 }}><span style={{width:2,height:9,background:"currentColor"}}/><span style={{width:2,height:9,background:"currentColor"}}/></span>}</button>
      <button style={{ ...iconBtn, background: settingsOpen ? "var(--accent-soft)" : "transparent", color: settingsOpen ? "var(--accent)" : "var(--text-muted)" }} onClick={onSettings}>{I.settings()}</button>
    </div>
  );
}

const iconBtn = {
  display:"inline-flex", alignItems:"center", justifyContent:"center",
  width: 24, height: 24, borderRadius: 5,
  color: "var(--text-muted)",
};

function Sidebar() {
  return (
    <div style={{ background: "var(--panel)", padding: "12px 8px", display:"flex", flexDirection:"column", gap: 14, overflow: "auto" }}>
      <SidebarGroup title="Triage">
        <SidebarItem icon="🔴" label="Needs Action" badge={MOCK.needs.length} active/>
        <SidebarItem icon="👀" label="Review Requests" badge={MOCK.reviews.length}/>
        <SidebarItem icon="🚀" label="In Flight" badge={MOCK.inflight.length}/>
        <SidebarItem icon="⚙️" label="Standalone Runs" badge={MOCK.runs.length}/>
        <SidebarItem icon="✅" label="Recently Resolved" muted/>
      </SidebarGroup>

      <SidebarGroup title="Filters">
        <SidebarItem icon={<CheckDot state="failure"/>} label="Failing only"/>
        <SidebarItem icon={<CheckDot state="pending"/>} label="Pending only"/>
        <SidebarItem icon={<span style={{ fontSize: 11, color:"var(--accent)" }}>★</span>} label="My team only"/>
      </SidebarGroup>

      <SidebarGroup title="Pinned">
        <SidebarItem icon={I.pin()} label="acme/api"/>
        <SidebarItem icon={I.pin()} label="acme/platform"/>
      </SidebarGroup>

      <SidebarGroup title="Muted">
        <SidebarItem icon={I.mute()} label="acme/legacy" muted/>
      </SidebarGroup>

      <span style={{ flex: 1 }}/>
      <div style={{
        margin: "4px 8px 0", padding: "8px 10px",
        border: "1px solid var(--border)", borderRadius: 8,
        background: "var(--bg-elev)", fontSize: 11, color: "var(--text-faint)",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--success)" }}/>
          <span style={{ color:"var(--text-muted)", fontWeight: 500 }}>Rate limit</span>
          <span style={{ flex: 1 }}/>
          <span className="mono">{MOCK.rateLimit.remaining}/{MOCK.rateLimit.total}</span>
        </div>
        <div style={{ height: 3, background: "var(--panel-2)", borderRadius: 2, overflow:"hidden" }}>
          <div style={{ height: "100%", width: `${(MOCK.rateLimit.remaining / MOCK.rateLimit.total)*100}%`, background: "var(--success)" }}/>
        </div>
        <div style={{ marginTop: 4 }}>resets in {MOCK.rateLimit.resetIn}</div>
      </div>
    </div>
  );
}

function SidebarGroup({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.06, color: "var(--text-faint)", padding: "0 10px 4px" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
    </div>
  );
}

function SidebarItem({ icon, label, badge, active, muted }) {
  return (
    <button style={{
      display:"flex", alignItems:"center", gap: 8,
      padding: "5px 10px", borderRadius: 6,
      background: active ? "var(--accent-soft)" : "transparent",
      color: active ? "var(--accent)" : muted ? "var(--text-faint)" : "var(--text)",
      fontSize: 12.5, fontWeight: active ? 600 : 500,
      width: "100%", textAlign: "left",
    }}>
      <span style={{ display:"inline-flex", width: 14, alignItems:"center", justifyContent:"center" }}>{typeof icon === "string" ? icon : icon}</span>
      <span style={{ flex: 1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</span>
      {badge != null && (
        <span className="mono" style={{
          fontSize: 10.5, padding: "0 5px", borderRadius: 999,
          background: active ? "var(--accent)" : "var(--panel-2)",
          color: active ? "var(--accent-fg)" : "var(--text-faint)",
        }}>{badge}</span>
      )}
    </button>
  );
}

function ListGroup({ title, icon, items, selectedId, onSelect, type, tone, muted, defaultCollapsed }) {
  const [collapsed, setCollapsed] = React.useState(!!defaultCollapsed);
  if (!items?.length) return null;
  return (
    <div>
      <button onClick={() => setCollapsed(c => !c)} style={{
        width:"100%", display:"flex", alignItems:"center", gap: 8,
        padding: "12px 16px 8px",
        fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.06,
        color: tone === "danger" ? "var(--danger)" : muted ? "var(--text-faint)" : "var(--text-muted)",
        background: tone === "danger" ? "var(--danger-soft)" : "transparent",
        textAlign: "left",
      }}>
        <span>{icon}</span>
        <span>{title}</span>
        <span className="mono" style={{ fontSize: 10.5, padding:"0 5px", borderRadius: 999, background:"var(--panel-2)", color:"var(--text-faint)" }}>{items.length}</span>
        <span style={{ flex:1 }}/>
        <span style={{ display:"inline-flex", color:"var(--text-faint)", transform: collapsed ? "rotate(-90deg)" : "rotate(0)", transition: "transform .15s" }}>{I.chev()}</span>
      </button>
      {!collapsed && items.map(it => (
        <ListItem key={it.id} item={it} type={type} active={it.id === selectedId} onClick={() => onSelect(it.id)} />
      ))}
    </div>
  );
}

function ListItem({ item, type, active, onClick }) {
  const isPR = type === "needs" || type === "review" || type === "inflight";
  return (
    <button onClick={onClick} style={{
      width: "100%", display: "grid",
      gridTemplateColumns: "auto 1fr auto",
      gap: 10, alignItems: "center",
      padding: "calc(var(--row-pad-y) + 1px) 16px",
      background: active ? "var(--accent-soft)" : "transparent",
      borderTop: "1px solid var(--border)",
      borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
      paddingLeft: active ? 14 : 16,
      textAlign: "left",
    }}>
      <UnreadDot unread={item.unread}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ display:"flex", alignItems:"center", gap: 6, marginBottom: 3 }}>
          {isPinned(item.repo) && <PinGlyph/>}
          <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>{item.repo}</span>
          {item.num && <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>#{item.num}</span>}
          {item.runNum && <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>#{item.runNum}</span>}
          {type === "needs"   && <ReasonBadge reason={item.reason}/>}
          {type === "inflight"&& <Lifecycle state={item.state} mqPos={item.mqPos}/>}
          {type === "review"  && item.team && <Pill tone="accent">team</Pill>}
          {type === "review"  && item.draft && <Pill tone="neutral">draft</Pill>}
          {type === "run"     && <RunStatus status={item.status} conclusion={item.conclusion}/>}
          {item.taskUrls && <TaskChips ids={item.taskUrls}/>}
        </div>
        <div style={{
          fontWeight: item.unread ? 600 : 500,
          color: item.unread ? "var(--text)" : "var(--text-muted)",
          fontSize: 13,
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
        }}>{item.title || item.name}</div>
        <div style={{ display:"flex", alignItems:"center", gap: 8, marginTop: 4, fontSize: 11, color: "var(--text-faint)" }}>
          {item.author && <><Avatar login={item.author} size={12}/><span>{item.author}</span><span>·</span></>}
          {item.actor && <><Avatar login={item.actor} size={12}/><span>{item.actor}</span><span>·</span></>}
          {item.branch && <><span className="mono">{item.branch}</span><span>·</span></>}
          {item.age && <span>{item.age}</span>}
          {(item.additions != null) && <><span>·</span><DiffStat add={item.additions} del={item.deletions}/></>}
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap: 5 }}>
        {item.checks && <CheckDot state={item.checks.state}/>}
        {type === "review" && <ScoreBar score={item.score} width={26}/>}
      </div>
    </button>
  );
}

function UnreadDot({ unread }) {
  return <span style={{ display:"inline-block", width:6, height:6, borderRadius: 3, background: unread ? "var(--accent)" : "transparent" }}/>;
}

// ─────────── Detail pane ───────────
function DetailPane({ item }) {
  if (!item) return null;
  const detail = PR_DETAIL[item.id] || PR_DETAIL["pr:acme/api#412"];
  return (
    <div style={{ background: "var(--panel)", overflow: "auto" }}>
      <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display:"flex", alignItems:"center", gap: 6, fontSize: 11.5, color:"var(--text-faint)", marginBottom: 8 }} className="mono">
          <span>{item.repo}</span>
          <span>·</span>
          <span>#{item.num}</span>
          {item.branch && <><span>·</span><span>{item.branch}</span></>}
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3, letterSpacing: -0.2, marginBottom: 10 }}>
          {item.title}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap: 8, flexWrap:"wrap" }}>
          {item.reason && <ReasonBadge reason={item.reason}/>}
          {item.state && <Lifecycle state={item.state} mqPos={item.mqPos}/>}
          {item.checks && <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><CheckDot state={item.checks.state}/><span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{item.checks.state}</span></span>}
          {item.score != null && <ScoreBar score={item.score} width={36}/>}
          <span style={{ flex: 1 }}/>
          <button style={{
            display:"inline-flex", alignItems:"center", gap: 4,
            padding: "4px 10px", borderRadius: 7,
            background: "var(--accent)", color: "var(--accent-fg)",
            fontSize: 11.5, fontWeight: 500,
          }}>Open on GitHub {I.ext()}</button>
        </div>
      </div>

      <Block title="Body">
        <div style={{ color: "var(--text-muted)", fontSize: 12.5, lineHeight: 1.55 }}>
          {detail.body}
        </div>
      </Block>

      <Block title="Reviewers">
        <div style={{ display:"flex", flexDirection:"column", gap: 6 }}>
          {detail.reviewers.map((r) => (
            <div key={r.login} style={{ display:"flex", alignItems:"center", gap: 8 }}>
              <Avatar login={r.login} size={18}/>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>@{r.login}</span>
              <span style={{ flex: 1 }}/>
              {r.state === "approved" && <Pill tone="success">approved</Pill>}
              {r.state === "changes_requested" && <Pill tone="danger">changes requested</Pill>}
              {r.state === "requested" && <Pill tone="info">awaiting</Pill>}
            </div>
          ))}
        </div>
      </Block>

      <Block title="Checks">
        <div style={{ display:"flex", flexDirection:"column", gap: 4 }}>
          {detail.runs.map((r) => (
            <div key={r.name} style={{ display:"flex", alignItems:"center", gap: 8, padding: "5px 0" }}>
              <CheckDot state={r.conclusion === "success" ? "success" : r.conclusion === "failure" ? "failure" : r.status === "in_progress" ? "pending" : "neutral"}/>
              <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{r.name}</span>
              <span style={{ flex: 1 }}/>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                {r.status === "in_progress" ? "running…" : r.conclusion}
              </span>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Activity">
        <div style={{ display:"flex", flexDirection:"column", gap: 0, position: "relative" }}>
          {detail.timeline.map((e, i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns: "20px 1fr auto", gap: 8, padding: "6px 0", alignItems: "center" }}>
              <span style={{ display:"flex", alignItems:"center", justifyContent:"center", width: 20, color: timelineColor(e.type) }}>
                {timelineIcon(e.type)}
              </span>
              <div style={{ fontSize: 12, color:"var(--text-muted)" }}>
                {e.who && <span style={{ color:"var(--text)", fontWeight: 500 }}>@{e.who} </span>}
                {e.text}
              </div>
              <span className="mono" style={{ fontSize: 10.5, color:"var(--text-faint)" }}>{e.when}</span>
            </div>
          ))}
        </div>
      </Block>
    </div>
  );
}

function timelineIcon(t) {
  if (t === "approve") return I.check();
  if (t === "checks") return <CheckDot state="failure"/>;
  if (t === "comment") return I.msg();
  if (t === "review") return I.check();
  if (t === "commit") return I.diff();
  if (t === "event") return I.alert();
  return I.dot();
}
function timelineColor(t) {
  if (t === "approve") return "var(--success)";
  if (t === "checks") return "var(--danger)";
  if (t === "event") return "var(--warn)";
  if (t === "review") return "var(--accent)";
  return "var(--text-muted)";
}

function Block({ title, children }) {
  return (
    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, textTransform:"uppercase", letterSpacing: 0.06, color: "var(--text-faint)", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

// ─────────── V2: Lanes layout ───────────
function MainWindowLanes({ selectedId, onSelect, paused, refreshing, onRefresh, onTogglePause, updateReady, onSettings }) {
  const all = [...MOCK.needs, ...MOCK.reviews, ...MOCK.inflight];
  const sel = all.find(x => x.id === selectedId) || MOCK.needs[0];

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", borderRadius: 12, overflow: "hidden", boxShadow: "0 0 0 0.5px var(--border-strong), var(--shadow-lg)" }}>
      <TitleBar refreshing={refreshing} paused={paused} onRefresh={onRefresh} onTogglePause={onTogglePause} onSettings={onSettings}/>
      {updateReady && <UpdateBanner/>}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 380px", minHeight: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "var(--border)", overflow: "hidden" }}>
          <Lane title="Needs Action" icon="🔴" tone="danger">
            {MOCK.needs.map(it => <CardRow key={it.id} item={it} kind="needs" active={it.id === sel.id} onClick={() => onSelect(it.id)}/>)}
          </Lane>
          <Lane title="Review Requests" icon="👀">
            {MOCK.reviews.slice(0,4).map(it => <CardRow key={it.id} item={it} kind="review" active={it.id === sel.id} onClick={() => onSelect(it.id)}/>)}
          </Lane>
          <Lane title="In Flight" icon="🚀">
            {MOCK.inflight.map(it => <CardRow key={it.id} item={it} kind="inflight" active={it.id === sel.id} onClick={() => onSelect(it.id)}/>)}
          </Lane>
          <Lane title="Standalone Runs" icon="⚙️">
            {MOCK.runs.map(it => <CardRow key={it.id} item={it} kind="run"/>)}
          </Lane>
        </div>
        <DetailPane item={sel}/>
      </div>
    </div>
  );
}

function Lane({ title, icon, tone, children }) {
  return (
    <div style={{ background: "var(--bg)", display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
      <div style={{
        padding: "10px 12px",
        background: tone === "danger" ? "var(--danger-soft)" : "var(--panel)",
        borderBottom: "1px solid var(--border)",
        fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.06,
        color: tone === "danger" ? "var(--danger)" : "var(--text-muted)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span>{icon}</span><span>{title}</span>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function CardRow({ item, kind, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: "100%", textAlign: "left",
      padding: "10px 12px",
      borderRadius: 8,
      background: active ? "var(--accent-soft)" : "var(--bg-elev)",
      border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap: 6, fontSize: 11 }}>
        {isPinned(item.repo) && <PinGlyph/>}
        <span className="mono" style={{ color: "var(--text-faint)" }}>{item.repo}</span>
        {item.num && <span className="mono" style={{ color: "var(--text-faint)" }}>#{item.num}</span>}
        <span style={{ flex: 1 }}/>
        {kind === "needs" && <ReasonBadge reason={item.reason}/>}
        {kind === "inflight" && <Lifecycle state={item.state} mqPos={item.mqPos}/>}
        {kind === "review" && item.team && <Pill tone="accent">team</Pill>}
        {kind === "run" && <RunStatus status={item.status} conclusion={item.conclusion}/>}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: item.unread ? 600 : 500, lineHeight: 1.35, color: "var(--text)" }}>
        {item.title || item.name}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap: 6, fontSize: 11, color: "var(--text-faint)" }}>
        {item.author && <Avatar login={item.author} size={12}/>}
        {item.author && <span>{item.author}</span>}
        {item.age && <><span>·</span><span>{item.age}</span></>}
        <span style={{ flex: 1 }}/>
        {item.checks && <CheckDot state={item.checks.state}/>}
        {kind === "review" && <ScoreBar score={item.score} width={20}/>}
      </div>
    </button>
  );
}

window.MainWindow = MainWindow;
