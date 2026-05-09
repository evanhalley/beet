/* Beet — Settings panel.
   Surfaces every option the spec calls out in §11: PAT + validation,
   teams, penalized bots, task-URL regex, the 5 notification toggles,
   polling interval, mute & pin lists, Show All, theme, rate-limit. */

function SettingsPanel({ onClose }) {
  const [tab, setTab] = React.useState("account");
  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", flexDirection: "column",
      background: "var(--bg)", borderRadius: 12, overflow: "hidden",
      boxShadow: "0 0 0 0.5px var(--border-strong), var(--shadow-lg)",
      color: "var(--text)",
    }}>
      <div style={{
        display:"flex", alignItems:"center", gap: 10,
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        background: "linear-gradient(180deg, var(--panel), var(--bg))",
      }}>
        <BeetMark size={18}/>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Settings</span>
        <span style={{ flex: 1 }}/>
        {onClose && <button onClick={onClose} style={{
          width: 22, height: 22, borderRadius: 11,
          color: "var(--text-faint)", display:"inline-flex", alignItems:"center", justifyContent:"center",
        }}>×</button>}
      </div>
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "180px 1fr", minHeight: 0 }}>
        <SettingsNav tab={tab} setTab={setTab}/>
        <div style={{ overflowY: "auto", padding: "20px 28px" }}>
          {tab === "account"       && <AccountTab/>}
          {tab === "notifications" && <NotificationsTab/>}
          {tab === "polling"       && <PollingTab/>}
          {tab === "filters"       && <FiltersTab/>}
          {tab === "scoring"       && <ScoringTab/>}
          {tab === "appearance"    && <AppearanceTab/>}
        </div>
      </div>
    </div>
  );
}

function SettingsNav({ tab, setTab }) {
  const items = [
    { id: "account",       label: "Account",        icon: "user" },
    { id: "notifications", label: "Notifications",  icon: "bell" },
    { id: "polling",       label: "Polling & rate", icon: "refresh" },
    { id: "filters",       label: "Mute & pin",     icon: "mute" },
    { id: "scoring",       label: "Scoring",        icon: "score" },
    { id: "appearance",    label: "Appearance",     icon: "theme" },
  ];
  return (
    <nav style={{
      borderRight: "1px solid var(--border)",
      background: "var(--panel)",
      padding: "16px 10px",
      display: "flex", flexDirection: "column", gap: 1,
    }}>
      {items.map(i => (
        <button key={i.id} onClick={() => setTab(i.id)} style={{
          display:"flex", alignItems:"center", gap: 9,
          padding: "7px 10px", borderRadius: 6,
          fontSize: 12.5, fontWeight: tab === i.id ? 600 : 500,
          color: tab === i.id ? "var(--accent)" : "var(--text-muted)",
          background: tab === i.id ? "var(--accent-soft)" : "transparent",
          textAlign: "left",
        }}>
          <NavIcon name={i.icon}/>
          {i.label}
        </button>
      ))}
      <span style={{ flex: 1 }}/>
      <div style={{ padding: "6px 10px", fontSize: 10.5, color: "var(--text-faint)", lineHeight: 1.5 }}>
        Beet 1.0.2
      </div>
    </nav>
  );
}

function NavIcon({ name }) {
  const props = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "user":    return <svg {...props}><circle cx="8" cy="6" r="2.5"/><path d="M3.5 13c.5-2 2.4-3 4.5-3s4 1 4.5 3"/></svg>;
    case "bell":    return <svg {...props}><path d="M3.5 11h9l-1-1.5V7a3.5 3.5 0 1 0-7 0v2.5z"/><path d="M6.5 12.5a1.5 1.5 0 0 0 3 0"/></svg>;
    case "refresh": return <svg {...props}><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 3v2.5h-2.5"/></svg>;
    case "mute":    return <svg {...props}><path d="M3 6.5h2.5L8 4v8L5.5 9.5H3z"/><path d="M11 6l3 3M14 6l-3 3"/></svg>;
    case "score":   return <svg {...props}><path d="M3 12l3-4 3 2 4-6"/></svg>;
    case "theme":   return <svg {...props}><circle cx="8" cy="8" r="3"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.7 3.7l1 1M11.3 11.3l1 1M3.7 12.3l1-1M11.3 4.7l1-1"/></svg>;
  }
}

// Tabs ──────────────────────────────────────────────────────────

function AccountTab() {
  return (
    <Stack>
      <H>Account</H>
      <Field label="GitHub username" hint="Auto-detected from token. Editable for testing.">
        <Input value="ev"/>
      </Field>
      <Field label="Personal access token" hint="Stored locally via Tauri Store. Never sent anywhere except api.github.com.">
        <div style={{ display:"flex", gap: 8 }}>
          <Input value="ghp_•••••••••••••••••••••••••••••••••••" mono/>
          <button style={btn()}>Validate</button>
        </div>
        <div style={{ marginTop: 8, display:"flex", alignItems:"center", gap: 8, flexWrap: "wrap" }}>
          <Pill tone="success" soft>● valid</Pill>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Last checked 12s ago.</span>
        </div>
      </Field>
      <Field label="Required scopes">
        <ScopesGrid scopes={[
          { name: "repo",         status: "ok" },
          { name: "read:org",     status: "ok" },
          { name: "read:user",    status: "ok" },
          { name: "user:email",   status: "ok" },
          { name: "notifications", status: "missing" },
        ]}/>
      </Field>
      <Field label="Teams to track" hint="org/team — used for PR-author team detection in the priority score.">
        <ChipInput chips={["acme/platform", "acme/api-eng"]} placeholder="acme/team-name"/>
      </Field>
    </Stack>
  );
}

function NotificationsTab() {
  const triggers = [
    { id: "eject",   ttl: "Ejected from merge queue",   sub: "🚨 High priority. Always recommended on.",  on: true,  hi: true },
    { id: "checks",  ttl: "Checks failing on your PR",  sub: "Once per head SHA — re-runs on the same SHA stay quiet.", on: true },
    { id: "review",  ttl: "New review request for you", sub: "Fires once when you become a requested reviewer.", on: true },
    { id: "mention", ttl: "Comment or @mention",        sub: "Replies to your reviews and direct mentions.", on: true },
    { id: "run",     ttl: "Workflow run finished",      sub: "Standalone runs you triggered. Silenced for PR-attached runs.", on: false },
  ];
  return (
    <Stack>
      <H>Notifications</H>
      <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 4px", lineHeight: 1.55 }}>
        Beet keeps a tight notification budget. Each trigger is individually toggleable; OS Do Not Disturb still wins.
      </p>
      <div style={{ display:"flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        {triggers.map((t, i) => (
          <div key={t.id} style={{
            display:"grid", gridTemplateColumns: "1fr auto", gap: 12,
            padding: "12px 14px",
            borderTop: i ? "1px solid var(--border)" : "none",
            background: t.hi ? "linear-gradient(90deg, var(--danger-soft), transparent 60%)" : "transparent",
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display:"flex", alignItems:"center", gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{t.ttl}</span>
                {t.hi && <Pill tone="danger">high priority</Pill>}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>{t.sub}</div>
            </div>
            <Toggle on={t.on}/>
          </div>
        ))}
      </div>
    </Stack>
  );
}

function PollingTab() {
  return (
    <Stack>
      <H>Polling & rate limit</H>
      <Field label="Polling interval" hint="Defaults to 60s. Beet doubles intervals on battery and when the window is hidden, and quarters them when rate-limit remaining drops below 100.">
        <Slider min={15} max={600} value={60} marks={[15, 60, 120, 300, 600]} unit="s"/>
      </Field>
      <Field label="Repo scan window" hint="Repos pushed to within this window count as 'active'. Pinned repos always poll regardless.">
        <Radio options={[{v:"7", l:"7 days"}, {v:"30", l:"30 days"}, {v:"90", l:"90 days"}]} value="30"/>
      </Field>
      <Field label="Rate limit">
        <RateMeter remaining={4842} total={5000} resetIn="38m"/>
      </Field>
      <Field label="Updates">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Pill tone="accent" soft>● update ready · v1.0.3</Pill>
          <button style={btn("primary")}>Restart to update</button>
          <button style={btn()}>Check for updates</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Auto-update via tauri-plugin-updater. Restart picks up where you left off — tray and queries resume mid-flight.
        </div>
      </Field>
    </Stack>
  );
}

function FiltersTab() {
  const muted = [
    { scope: "repo", value: "acme/legacy-archive" },
    { scope: "repo", value: "foo/bar" },
    { scope: "org",  value: "old-org" },
  ];
  const pinned = [
    { value: "acme/api" },
    { value: "acme/platform" },
  ];
  return (
    <Stack>
      <H>Mute & pin</H>
      <Field label="Pinned repos" hint="Always poll on the fast interval. Highlighted in the UI with a pin glyph.">
        <List items={pinned.map(p => ({ icon: <PinGlyph size={11}/>, primary: p.value, action: "Unpin" }))}/>
        <AddRow placeholder="owner/repo" cta="Pin"/>
      </Field>
      <Field label="Muted repos & orgs" hint="Hidden from every section, never count toward badge.">
        <List items={muted.map(m => ({
          icon: <Pill tone="neutral">{m.scope}</Pill>,
          primary: m.value, action: "Unmute"
        }))}/>
        <AddRow placeholder="owner/repo or owner" cta="Mute"/>
      </Field>
      <Field label="Show approved PRs" hint="When off, PRs you've approved are demoted out of the Review Requests section.">
        <Toggle on={false}/>
      </Field>
    </Stack>
  );
}

function ScoringTab() {
  return (
    <Stack>
      <H>Scoring</H>
      <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 4px", lineHeight: 1.55 }}>
        Inherited from PRZ. Score is computed only for review-request PRs; everything else sorts by recency.
      </p>
      <Field label="Penalized bots" hint="PRs authored by these accounts get −10. Useful for noisy automation.">
        <ChipInput chips={["dependabot", "renovate", "github-actions[bot]"]} placeholder="bot-username"/>
      </Field>
      <Field label="Task URL regex" hint="Matched IDs render as chips on PR rows. Click a chip to open the task.">
        <Input mono value="https://your-company\\.atlassian\\.net/browse/[A-Z]+-\\d+"/>
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "var(--panel)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginBottom: 4, fontWeight: 500, letterSpacing: 0.4, textTransform: "uppercase" }}>Preview · matched in #412</div>
          <TaskChips ids={["PROJ-1842"]}/>
        </div>
      </Field>
      <Field label="Score weights" hint="Read-only in V1 — change in source. Listed for transparency.">
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <tbody>
            {[
              ["Author is on a team I'm in", "+6"],
              ["Requested reviewer (not just CC'd via team)", "+3"],
              ["I've commented", "+2"],
              ["I've reviewed", "+2"],
              ["I've approved", "−100"],
              ["additions > 250", "−1"],
              ["deletions > 250", "−1"],
              ["not updated in > 10 days", "−1"],
              ["created > 60d AND not updated > 60d (stale)", "drop"],
              ["draft", "−5"],
              ["author in penalized bots", "−10"],
            ].map(([k, v], i) => (
              <tr key={k} style={{ borderTop: i ? "1px solid var(--border)" : "none" }}>
                <td style={{ padding: "7px 0", color: "var(--text-muted)" }}>{k}</td>
                <td style={{ padding: "7px 0", textAlign: "right", fontFamily: "var(--font-mono)", color: v.startsWith("−") ? "var(--danger)" : v.startsWith("+") ? "var(--success)" : "var(--text-faint)" }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Field>
    </Stack>
  );
}

function AppearanceTab() {
  return (
    <Stack>
      <H>Appearance</H>
      <Field label="Theme">
        <Radio options={[{v:"auto",l:"Auto"},{v:"light",l:"Light"},{v:"dark",l:"Dark"}]} value="dark"/>
      </Field>
      <Field label="Density">
        <Radio options={[{v:"compact",l:"Compact"},{v:"comfy",l:"Comfy"}]} value="comfy"/>
      </Field>
      <Field label="Show priority score on rows">
        <Toggle on={true}/>
      </Field>
      <Field label="Show section emoji" hint="🔴 👀 🚀 ⚙️ ✅ in section headers. Off swaps to monochrome glyphs.">
        <Toggle on={true}/>
      </Field>
      <Field label="Auto-launch on login" hint="Beet launches at login and stays in the tray. Uses tauri-plugin-autostart.">
        <Toggle on={true}/>
      </Field>
    </Stack>
  );
}

// ─────────────── tiny atoms ───────────────

function Stack({ children }) { return <div style={{ display:"flex", flexDirection:"column", gap: 22, maxWidth: 620 }}>{children}</div>; }
function H({ children }) { return <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 -8px", letterSpacing: -0.1 }}>{children}</h2>; }
function Field({ label, hint, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}
function Input({ value, mono }) {
  return (
    <input defaultValue={value} className={mono ? "mono" : ""} style={{
      width: "100%", padding: "7px 10px",
      fontSize: mono ? 11.5 : 12.5,
      borderRadius: 6,
      background: "var(--panel)",
      border: "1px solid var(--border)",
      color: "var(--text)",
      fontFamily: mono ? "var(--font-mono)" : "inherit",
    }}/>
  );
}
function btn(kind) {
  const base = { padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" };
  if (kind === "primary") return { ...base, background: "var(--accent)", color: "var(--accent-fg)" };
  return { ...base, background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)" };
}
function Toggle({ on }) {
  return (
    <span style={{
      display:"inline-flex", width: 32, height: 18, borderRadius: 999,
      background: on ? "var(--accent)" : "var(--border-strong)",
      padding: 2, transition: "background .12s",
    }}>
      <span style={{
        width: 14, height: 14, borderRadius: 999, background: "#fff",
        marginLeft: on ? 14 : 0,
        transition: "margin .12s",
        boxShadow: "0 1px 2px rgba(0,0,0,.2)",
      }}/>
    </span>
  );
}
function Radio({ options, value }) {
  return (
    <div style={{ display:"inline-flex", padding: 2, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 7 }}>
      {options.map(o => (
        <button key={o.v} style={{
          padding: "5px 12px", borderRadius: 5, fontSize: 12, fontWeight: 500,
          background: o.v === value ? "var(--bg)" : "transparent",
          color: o.v === value ? "var(--text)" : "var(--text-muted)",
          boxShadow: o.v === value ? "0 0 0 0.5px var(--border-strong)" : "none",
        }}>{o.l}</button>
      ))}
    </div>
  );
}
function ChipInput({ chips, placeholder }) {
  return (
    <div style={{
      display:"flex", flexWrap: "wrap", gap: 5,
      padding: "6px 8px",
      borderRadius: 6, background: "var(--panel)",
      border: "1px solid var(--border)",
      minHeight: 32,
    }}>
      {chips.map(c => (
        <span key={c} className="mono" style={{
          display:"inline-flex", alignItems:"center", gap: 4,
          padding: "2px 7px",
          fontSize: 11, fontWeight: 500,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 4,
        }}>
          {c}
          <span style={{ color: "var(--text-faint)", cursor: "pointer" }}>×</span>
        </span>
      ))}
      <input placeholder={placeholder} style={{
        flex: 1, minWidth: 120,
        background: "transparent",
        fontSize: 11.5,
        fontFamily: "var(--font-mono)",
        color: "var(--text)",
      }}/>
    </div>
  );
}
function ScopesGrid({ scopes }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6 }}>
      {scopes.map(s => (
        <div key={s.name} style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "6px 9px",
          background: s.status === "ok" ? "var(--success-soft)" : "var(--warn-soft)",
          border: "1px solid " + (s.status === "ok" ? "var(--success-border)" : "var(--warn-border)"),
          borderRadius: 5,
          fontSize: 11,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: s.status === "ok" ? "var(--success)" : "var(--warn)" }}/>
          <span className="mono" style={{ color: s.status === "ok" ? "var(--success)" : "var(--warn)" }}>{s.name}</span>
          {s.status !== "ok" && <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)" }}>missing</span>}
        </div>
      ))}
    </div>
  );
}
function Slider({ min, max, value, marks, unit }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap: 12 }}>
        <div style={{ flex: 1, position: "relative", height: 22, display: "flex", alignItems: "center" }}>
          <div style={{ width: "100%", height: 4, borderRadius: 2, background: "var(--panel-2)" }}/>
          <div style={{ position: "absolute", left: 0, width: pct + "%", height: 4, borderRadius: 2, background: "var(--accent)" }}/>
          <div style={{ position: "absolute", left: `calc(${pct}% - 7px)`, width: 14, height: 14, borderRadius: 8, background: "var(--bg)", border: "1.5px solid var(--accent)", boxShadow: "var(--shadow-sm)" }}/>
        </div>
        <span className="mono" style={{ fontSize: 12, color: "var(--text)", minWidth: 38, textAlign: "right" }}>{value}{unit}</span>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop: 6, paddingRight: 50 }}>
        {marks.map(m => <span key={m} className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>{m}{unit}</span>)}
      </div>
    </div>
  );
}
function RateMeter({ remaining, total, resetIn }) {
  const pct = (remaining / total) * 100;
  return (
    <div>
      <div style={{ display:"flex", alignItems:"baseline", gap: 6, marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{remaining.toLocaleString()}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>of {total.toLocaleString()} requests remaining</span>
        <span style={{ flex: 1 }}/>
        <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>resets in {resetIn}</span>
      </div>
      <div style={{ width: "100%", height: 5, borderRadius: 3, background: "var(--panel-2)", overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: "var(--success)" }}/>
      </div>
    </div>
  );
}
function List({ items }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
      {items.map((it, i) => (
        <div key={i} style={{
          display:"flex", alignItems:"center", gap: 10,
          padding: "8px 12px",
          borderTop: i ? "1px solid var(--border)" : "none",
          fontSize: 12,
        }}>
          <span style={{ display:"inline-flex" }}>{it.icon}</span>
          <span className="mono" style={{ color: "var(--text)" }}>{it.primary}</span>
          <span style={{ flex: 1 }}/>
          <button style={{ fontSize: 11, color: "var(--text-muted)", padding: "2px 8px", borderRadius: 4 }}>{it.action}</button>
        </div>
      ))}
    </div>
  );
}
function AddRow({ placeholder, cta }) {
  return (
    <div style={{ display:"flex", gap: 6, marginTop: 8 }}>
      <input placeholder={placeholder} className="mono" style={{
        flex: 1, padding: "6px 10px", fontSize: 11.5,
        background: "var(--panel)", border: "1px solid var(--border)",
        borderRadius: 6, color: "var(--text)",
        fontFamily: "var(--font-mono)",
      }}/>
      <button style={btn("primary")}>{cta}</button>
    </div>
  );
}

window.SettingsPanel = SettingsPanel;
