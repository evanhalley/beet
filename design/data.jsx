/* Mock data for Beet — generic placeholder names per spec. */

const MOCK = {
  user: { login: "you", initials: "YO", avatar: "#c96442" },
  lastUpdated: "12s ago",
  rateLimit: { remaining: 4842, total: 5000, resetIn: "38m" },

  needs: [
    {
      id: "pr:acme/api#412",
      kind: "pr",
      repo: "acme/api",
      num: 412,
      title: "Fix race condition in auth token refresh",
      author: "you",
      reason: "ejected",
      reasonText: "Ejected from merge queue",
      mqPos: null,
      enteredQueueMin: 18,
      score: 14,
      age: "3m",
      additions: 84, deletions: 22,
      checks: { state: "success", failing: [] },
      activity: { mentions: 0, replies: 0 },
      branch: "fix-auth-race",
      unread: true,
    },
    {
      id: "pr:acme/billing#389",
      kind: "pr",
      repo: "acme/billing",
      num: 389,
      title: "Ship payment retry with exponential backoff",
      author: "you",
      reason: "checks_failing",
      reasonText: "Checks failing",
      failing: ["integration-tests", "lint"],
      score: 11,
      age: "12m",
      additions: 412, deletions: 31,
      checks: { state: "failure", failing: ["integration-tests", "lint"] },
      activity: { mentions: 0, replies: 1 },
      branch: "billing-retry",
      unread: true,
    },
    {
      id: "pr:acme/platform#501",
      kind: "pr",
      repo: "acme/platform",
      num: 501,
      title: "Refactor auth provider to support OIDC",
      author: "rina",
      reason: "mention",
      reasonText: "@rina mentioned you",
      score: 9,
      age: "47m",
      additions: 240, deletions: 88,
      checks: { state: "pending", failing: [] },
      activity: { mentions: 1, replies: 0 },
      branch: "platform/oidc",
      unread: true,
    },
  ],

  reviews: [
    { id:"pr:acme/platform#501", repo:"acme/platform", num:501, title:"Refactor auth provider to support OIDC", author:"rina", team:true, score:11, additions:240, deletions:88, age:"2h", checks:{state:"pending"}, draft:false, unread:true },
    { id:"pr:acme/gateway#498",  repo:"acme/gateway",  num:498, title:"Add request timeout middleware to gateway", author:"kai",  team:true, score:8,  additions:120, deletions:18,  age:"5h", checks:{state:"success"}, draft:false, unread:true },
    { id:"pr:acme/search#492",   repo:"acme/search",   num:492, title:"Search index v2 — Tantivy backend",        author:"mo",   team:false, score:7,  additions:540, deletions:220, age:"1d", checks:{state:"success"}, draft:false, unread:false },
    { id:"pr:acme/api#476",      repo:"acme/api",      num:476, title:"Cleanup deprecated /v1 routes",            author:"leo",  team:true, score:5,  additions:12,  deletions:380, age:"3d", checks:{state:"success"}, draft:false, unread:false },
    { id:"pr:foo/bar#84",        repo:"foo/bar",       num:84,  title:"wip: experimental rate limiter",           author:"sam",  team:false, score:2,  additions:60,  deletions:4,   age:"5d", checks:{state:"neutral"}, draft:true,  unread:false },
  ],

  inflight: [
    { id:"pr:acme/api#412", repo:"acme/api", num:412, title:"Fix race condition in auth token refresh", state:"merge_queue", mqPos:2, age:"3m", additions:84, deletions:22, checks:{state:"success"} },
    { id:"pr:acme/api#405", repo:"acme/api", num:405, title:"Bump deps (weekly)", state:"in_review", age:"2h", additions:1248, deletions:1180, checks:{state:"success"} },
    { id:"pr:acme/web#221", repo:"acme/web", num:221, title:"Adopt the new design tokens",  state:"open", age:"1d", additions:320, deletions:218, checks:{state:"pending"} },
  ],

  runs: [
    { id:"run:acme/api#9482", repo:"acme/api", name:"deploy-prod",     event:"workflow_dispatch", status:"completed",   conclusion:"success", branch:"main", age:"3m",   duration:"2m 14s", actor:"you", runNum:482  },
    { id:"run:acme/web#1247", repo:"acme/web", name:"nightly-e2e",     event:"schedule",          status:"in_progress", conclusion:null,      branch:"main", age:"14m",  duration:null,     actor:"you", runNum:1247 },
    { id:"run:acme/api#9479", repo:"acme/api", name:"release-canary",  event:"workflow_dispatch", status:"completed",   conclusion:"failure", branch:"main", age:"1h",   duration:"8m 02s", actor:"you", runNum:479  },
  ],

  recent: [
    { id:"pr:acme/api#401",      repo:"acme/api",      num:401, title:"Expand /metrics endpoint with cache stats",  state:"merged", age:"1h",  by:"you" },
    { id:"pr:acme/web#218",      repo:"acme/web",      num:218, title:"Reduce bundle size on the auth route",       state:"merged", age:"4h",  by:"you" },
    { id:"run:acme/api#9477",    repo:"acme/api",      name:"deploy-staging", state:"success", age:"6h" },
    { id:"pr:acme/platform#499", repo:"acme/platform", num:499, title:"Drop unused feature flag",                   state:"merged", age:"22h", by:"rina" },
  ],
};

const PR_DETAIL = {
  "pr:acme/api#412": {
    body: "The merge queue ejected this PR after the integration suite hit a flaky timeout on the third retry. CI is green again — re-queueing.",
    timeline: [
      { who:"you",  when:"3m",  type:"event",   text:"Ejected from merge queue · timeout in integration-tests" },
      { who:"bot",  when:"4m",  type:"checks",  text:"All required checks passing on 8a3f12c" },
      { who:"you",  when:"18m", type:"event",   text:"Entered merge queue at position 4" },
      { who:"rina", when:"42m", type:"approve", text:"Approved" },
      { who:"you",  when:"1h",  type:"commit",  text:"Address review comments — drop the retry budget" },
    ],
    reviewers: [{login:"rina", state:"approved"}, {login:"kai", state:"approved"}],
    runs: [
      { name:"build",        status:"completed", conclusion:"success" },
      { name:"unit",         status:"completed", conclusion:"success" },
      { name:"integration",  status:"completed", conclusion:"success" },
      { name:"lint",         status:"completed", conclusion:"success" },
    ],
  },
  "pr:acme/billing#389": {
    body: "Adds an exponential backoff to the payment retry path. integration-tests is failing on a snapshot diff — looking now.",
    timeline: [
      { who:"bot",  when:"12m", type:"checks",   text:"integration-tests failed · 2 of 14 cases" },
      { who:"bot",  when:"13m", type:"checks",   text:"lint failed · missing return type" },
      { who:"kai",  when:"38m", type:"comment",  text:"Reply to your review thread on retry budget" },
      { who:"you",  when:"1h",  type:"commit",   text:"Wire backoff into the gateway client" },
    ],
    reviewers: [{login:"kai", state:"changes_requested"}],
    runs: [
      { name:"build",        status:"completed", conclusion:"success" },
      { name:"unit",         status:"completed", conclusion:"success" },
      { name:"integration",  status:"completed", conclusion:"failure" },
      { name:"lint",         status:"completed", conclusion:"failure" },
    ],
  },
  "pr:acme/platform#501": {
    body: "Pulls token rotation into a hook so we can re-use it from the desktop client. Discussion thread is on the OIDC scope shape.",
    timeline: [
      { who:"rina", when:"47m", type:"comment",  text:"@you mind taking another look?" },
      { who:"rina", when:"1h",  type:"commit",   text:"Refactor: extract useTokenRotation" },
      { who:"you",  when:"3h",  type:"review",   text:"Reviewed · 4 comments" },
    ],
    reviewers: [{login:"you", state:"requested"}, {login:"kai", state:"requested"}],
    runs: [
      { name:"build",  status:"in_progress", conclusion:null },
      { name:"unit",   status:"completed", conclusion:"success" },
    ],
  },
};

window.MOCK = MOCK;
window.PR_DETAIL = PR_DETAIL;
