'use strict';

const fs = require('fs');
const path = require('path');

const GITHUB_USER = process.env.GITHUB_REPOSITORY_OWNER || 'Skismail57';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const TZ = process.env.TZ_PROFILE || 'Asia/Calcutta';
const OUT_DIR = path.resolve(__dirname, '..', '..');
const NOW = new Date();
const NOW_ISO = NOW.toISOString();
const NOW_LOCAL = NOW.toLocaleString('en-US', {
  timeZone: TZ,
  year: 'numeric', month: 'short', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function numFmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n || 0));
}

const C = {
  bg0: '#060811', bg1: '#0a1424', bg2: '#0f1f3d', border: '#1c2b4a',
  cyan: '#22d3ee', purple: '#8b5cf6', pink: '#f472b6', green: '#22c55e',
  emerald: '#39ff88', title: '#00eaff', text: '#93c5fd', textDim: '#64748b',
  accent: '#60a5fa',
};

async function gql(query) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Skismail57-Profile-Generator',
      ...(GITHUB_TOKEN ? { Authorization: 'bearer ' + GITHUB_TOKEN } : {}),
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error('GQL ' + res.status);
  const data = await res.json();
  if (data.errors) console.warn('GQL warnings:', data.errors.slice(0, 3).map(e => e.message).join(' | '));
  return data.data || {};
}
async function rest(p) {
  const res = await fetch('https://api.github.com' + p, {
    headers: {
      'User-Agent': 'Skismail57-Profile-Generator',
      Accept: 'application/vnd.github+json',
      ...(GITHUB_TOKEN ? { Authorization: 'Bearer ' + GITHUB_TOKEN } : {}),
    },
  });
  if (!res.ok) throw new Error('REST ' + res.status + ' ' + p);
  return res.json();
}
async function restPaginated(basePath, maxPages = 10) {
  const all = [];
  for (let i = 1; i <= maxPages; i++) {
    const sep = basePath.includes('?') ? '&' : '?';
    const page = await rest(basePath + sep + 'per_page=100&page=' + i);
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < 100) break;
  }
  return all;
}

async function loadFromGQL() {
  const q = `{
    user(login: "${GITHUB_USER}") {
      login name bio
      followers { totalCount } following { totalCount }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
        totalCount
        nodes {
          name stargazerCount forkCount primaryLanguage { name }
          languages(first: 15, orderBy: {field: SIZE, direction: DESC}) {
            totalSize edges { size node { name } }
          }
          issues(states: OPEN) { totalCount } pullRequests(states: OPEN) { totalCount }
        }
      }
      contributionsCollection {
        totalCommitContributions totalIssueContributions totalPullRequestContributions totalPullRequestReviewContributions
        contributionCalendar {
          totalContributions weeks { contributionDays { weekday date contributionCount color level } }
        }
      }
      pullRequests { totalCount }
      issues { totalCount }
      gists { totalCount }
    }
  }`;
  const d = await gql(q);
  const u = d && d.user; if (!u) return null;
  const nodes = (u.repositories && u.repositories.nodes) || [];
  let stars = 0, forks = 0;
  const langAgg = new Map();
  for (const r of nodes) {
    stars += r.stargazerCount || 0;
    forks += r.forkCount || 0;
    if (r.languages && r.languages.edges) for (const e of r.languages.edges) {
      langAgg.set(e.node.name, (langAgg.get(e.node.name) || 0) + (e.size || 0));
    }
  }
  const cc = u.contributionsCollection || {};
  const cal = cc.contributionCalendar || { totalContributions: 0, weeks: [] };
  const weeks = cal.weeks || [];
  const days = [];
  for (const w of weeks) for (const dy of (w.contributionDays || [])) days.push(dy);
  const daysSorted = [...days].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  let cur = 0, longest = 0, running = 0;
  for (const dy of daysSorted) {
    const c = dy.contributionCount || 0;
    if (cur === 0 && c === 0) {
      const dyDate = new Date(dy.date + 'T00:00:00Z');
      const todayUTC = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));
      const diffDays = Math.round((todayUTC - dyDate) / 86400000);
      if (diffDays <= 1) continue; // skip if today or yesterday still empty
      if (diffDays > 1) break;
    }
    if (c > 0) cur++;
    else break;
  }
  for (const dy of days) {
    if ((dy.contributionCount || 0) > 0) { running++; longest = Math.max(longest, running); }
    else running = 0;
  }
  const prsAll = (u.pullRequests && u.pullRequests.totalCount) || (cc.totalPullRequestContributions || 0);
  const issuesAll = (u.issues && u.issues.totalCount) || (cc.totalIssueContributions || 0);
  const langs = [...langAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const total = langs.reduce((s, [, v]) => s + v, 0) || 1;
  return {
    user: {
      login: u.login, name: u.name || u.login, bio: u.bio || '',
      followers: (u.followers && u.followers.totalCount) || 0,
      following: (u.following && u.following.totalCount) || 0,
    },
    repos: (u.repositories && u.repositories.totalCount) || 0, stars, forks,
    commits: cc.totalCommitContributions || 0,
    prs: prsAll, issues: issuesAll,
    totalContribs: cal.totalContributions || 0,
    currentStreak: cur, longestStreak: longest,
    gists: (u.gists && u.gists.totalCount) || 0,
    langs: langs.map(([name, size]) => ({ name, size, pct: Math.max(0.2, (size / total) * 100) })),
    days, weeks,
    events: null,
  };
}

async function loadFromREST() {
  const u = await rest('/users/' + GITHUB_USER);
  const repos = await restPaginated('/users/' + GITHUB_USER + '/repos?type=owner');
  const ownerRepos = repos.filter(r => !r.fork);
  let stars = 0, forks = 0;
  const langAgg = new Map();
  for (const r of ownerRepos) {
    stars += r.stargazers_count || 0;
    forks += r.forks_count || 0;
    try {
      const rl = await rest('/repos/' + GITHUB_USER + '/' + r.name + '/languages');
      for (const k of Object.keys(rl || {})) langAgg.set(k, (langAgg.get(k) || 0) + (Number(rl[k]) || 0));
    } catch (_) { /* ignore */ }
  }
  const langs = [...langAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const totalLang = langs.reduce((s, [, v]) => s + v, 0) || 1;

  // Author totals via search (best-effort, might rate-limit)
  let prTotal = 0, issueTotal = 0;
  try {
    const prOp = (await rest('/search/issues?q=author%3A' + GITHUB_USER + '+is%3Apr&per_page=1')).total_count || 0;
    const prCl = (await rest('/search/issues?q=author%3A' + GITHUB_USER + '+is%3Apr+is%3Aclosed&per_page=1')).total_count || 0;
    const isOp = (await rest('/search/issues?q=author%3A' + GITHUB_USER + '+is%3Aissue&per_page=1')).total_count || 0;
    const isCl = (await rest('/search/issues?q=author%3A' + GITHUB_USER + '+is%3Aissue+is%3Aclosed&per_page=1')).total_count || 0;
    prTotal = prOp + prCl; issueTotal = isOp + isCl;
  } catch (_) {}

  // Public events for activity streaks + commits count from PushEvent distinct_size
  const events = await restPaginated('/users/' + GITHUB_USER + '/events/public', 10);
  const dayMap = new Map();
  let pushes = 0;
  for (const e of events) {
    const d = new Date(e.created_at);
    const key = d.toISOString().slice(0, 10);
    const slot = dayMap.get(key) || { count: 0, pushes: 0 };
    slot.count++;
    if (e.type === 'PushEvent') {
      let p = 0;
      const pl = e.payload || {};
      if (Array.isArray(pl.commits)) p = pl.commits.length;
      if (!p) p = Number(pl.distinct_size) || 0;
      if (!p) p = Number(pl.size) || 0;
      if (!p) p = 1; // at minimum a push represents 1 commit event
      slot.pushes += p; pushes += p;
    }
    dayMap.set(key, slot);
  }
  const today = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));
  // streaks from events
  let cur = 0, longest = 0, running = 0;
  const keysDesc = [...dayMap.keys()].sort().reverse();
  for (let i = 0; i <= 1; i++) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    if (keysDesc[0] === d) break;
    // if first active date is more than 1 day behind, current streak = 0 but we still want longest
    const firstActive = keysDesc[0];
    if (firstActive) {
      const diff = Math.round((today - new Date(firstActive + 'T00:00:00Z')) / 86400000);
      if (diff > 1 && i === 0) { cur = 0; break; }
    }
  }
  if (cur === 0 && keysDesc[0]) {
    const firstActive = keysDesc[0];
    const diff = Math.round((today - new Date(firstActive + 'T00:00:00Z')) / 86400000);
    if (diff <= 1) {
      let expected = firstActive;
      while (dayMap.has(expected)) { cur++; const dt = new Date(expected + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() - 1); expected = dt.toISOString().slice(0, 10); }
    }
  }
  const keysAsc = [...dayMap.keys()].sort();
  for (const k of keysAsc) {
    const s = dayMap.get(k);
    if (s.count > 0 || s.pushes > 0) { running++; longest = Math.max(longest, running); }
    else running = 0;
  }

  // Contribution calendar approximation from events per day (53 weeks x 7 days)
  const weeks = [];
  const start = new Date(today.getTime() - 52 * 7 * 86400000);
  // align start to Sunday
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 7) % 7));
  const todayStr = today.toISOString().slice(0, 10);
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let dw = 0; dw < 7; dw++) {
      const d = new Date(start.getTime() + (w * 7 + dw) * 86400000);
      const key = d.toISOString().slice(0, 10);
      if (key > todayStr) continue;
      const slot = dayMap.get(key) || { count: 0, pushes: 0 };
      let level = 0, c = slot.pushes > 0 ? slot.pushes : slot.count;
      if (c > 0) level = 1;
      if (c >= 3) level = 2;
      if (c >= 8) level = 3;
      if (c >= 16) level = 4;
      days.push({ weekday: dw, date: key, contributionCount: c, level });
    }
    if (days.length) weeks.push({ contributionDays: days });
  }
  const flatDays = weeks.flatMap(w => w.contributionDays || []);
  const totalContribs = flatDays.reduce((s, d) => s + (d.contributionCount || 0), 0);

  return {
    user: {
      login: u.login, name: u.name || u.login, bio: u.bio || '',
      followers: u.followers || 0,
      following: u.following || 0,
    },
    repos: ownerRepos.length, stars, forks,
    commits: pushes,
    prs: prTotal, issues: issueTotal,
    totalContribs,
    currentStreak: cur, longestStreak: longest,
    gists: u.public_gists || 0,
    langs: langs.map(([name, size]) => ({ name, size, pct: Math.max(0.2, (size / totalLang) * 100) })),
    days: flatDays, weeks,
    events,
  };
}

function head(w, h, id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
  <linearGradient id="g-bg-${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${C.bg1}"/><stop offset="100%" stop-color="${C.bg0}"/>
  </linearGradient>
  <linearGradient id="g-title-${id}" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${C.cyan}"/><stop offset="100%" stop-color="${C.purple}"/>
  </linearGradient>
  <filter id="g-shadow-${id}"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.35"/></filter>
</defs>`;
}
const foot = '</svg>';
function cardBg(id, w, h, r = 18) { return `<rect rx="${r}" width="${w}" height="${h}" fill="url(#g-bg-${id})" stroke="${C.border}" stroke-width="1.2"/>`; }

function write(name, content) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, content, 'utf8');
  console.log('wrote', name, (content.length / 1024).toFixed(1), 'KB');
}

function buildStats(d) {
  const W = 520, H = 220, id = 's';
  const items = [
    ['Repos', d.repos, C.cyan],
    ['Stars', d.stars, C.pink],
    ['Followers', d.user.followers, C.purple],
    ['Commits', d.commits, C.green],
    ['PRs', d.prs, C.cyan],
    ['Issues', d.issues, C.accent],
    ['Contribs', d.totalContribs, C.emerald],
    ['Gists', d.gists, C.text],
  ];
  let body = head(W, H, id) + cardBg(id, W, H);
  body += `<text x="28" y="38" font-family="Consolas,monospace" font-size="18" font-weight="700" fill="url(#g-title-${id})">${esc(d.user.name)} · @${esc(d.user.login)}</text>`;
  body += `<text x="28" y="58" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">auto-updated · ${NOW_LOCAL} (${TZ}) · ${GITHUB_TOKEN ? 'token auth' : 'public REST'}</text>`;
  for (let i = 0; i < items.length; i++) {
    const [label, val, color] = items[i];
    const cx = 28 + ((i % 4) * 120);
    const cy = 96 + (Math.floor(i / 4) * 62);
    body += `<g filter="url(#g-shadow-${id})"><rect x="${cx - 4}" y="${cy - 22}" width="110" height="54" rx="12" fill="${C.bg2}" stroke="${C.border}"/></g>`;
    body += `<text x="${cx + 2}" y="${cy + 4}" font-family="Consolas,monospace" font-size="10" fill="${C.textDim}">${esc(label)}</text>`;
    body += `<text x="${cx + 2}" y="${cy + 26}" font-family="Consolas,monospace" font-size="20" font-weight="800" fill="${color}">${esc(numFmt(val))}</text>`;
  }
  body += `<text x="28" y="200" font-family="Consolas,monospace" font-size="12" fill="${C.text}">🔥 Current Streak: <tspan font-weight="800" fill="${C.cyan}">${d.currentStreak}</tspan>   ⭐ Longest: <tspan font-weight="800" fill="${C.purple}">${d.longestStreak}</tspan>   🍴 Forks: <tspan font-weight="800" fill="${C.pink}">${numFmt(d.forks)}</tspan>   Following: <tspan font-weight="800" fill="${C.green}">${d.user.following}</tspan></text>`;
  body += foot;
  return body;
}
function buildLangs(d) {
  const W = 520, H = 300, id = 'l';
  const palette = [C.cyan, C.purple, C.pink, C.green, C.emerald, C.accent, '#facc15', '#fb923c'];
  const langs = d.langs.length ? d.langs : [{ name: 'No data', pct: 100, size: 1 }];
  let cum = 0; const segs = langs.map((l, i) => {
    const start = cum; cum += l.pct;
    return { ...l, start, end: cum, color: palette[i % palette.length] };
  });
  const barY = 96, barH = 18, barX = 32, barW = W - 64;
  let body = head(W, H, id) + cardBg(id, W, H);
  body += `<text x="28" y="38" font-family="Consolas,monospace" font-size="18" font-weight="700" fill="url(#g-title-${id})">Most Used Languages</text>`;
  body += `<text x="28" y="58" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">bytes aggregated across ${d.repos} public repos · ${NOW_LOCAL}</text>`;
  for (const s of segs) {
    const x = barX + (s.start / 100) * barW;
    const w = Math.max(0.5, ((s.end - s.start) / 100) * barW);
    body += `<rect x="${x.toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="${barH}" rx="4" fill="${s.color}"/>`;
  }
  let ly = barY + 52;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]; const col = i % 2; const row = Math.floor(i / 2);
    const lx = 36 + col * 228; const yy = ly + row * 28;
    body += `<rect x="${lx}" y="${yy - 10}" width="14" height="14" rx="3" fill="${s.color}"/>`;
    body += `<text x="${lx + 22}" y="${yy}" font-family="Consolas,monospace" font-size="12" fill="${C.text}">${esc(s.name)}</text>`;
    body += `<text x="${lx + 182}" y="${yy}" font-family="Consolas,monospace" font-size="12" font-weight="700" fill="${s.color}">${s.pct.toFixed(1)}%</text>`;
  }
  body += foot; return body;
}
function buildTrophies(d) {
  const W = 860, H = 220, id = 't';
  const T = (c, t1, t2, t3) => c >= t3 ? 3 : c >= t2 ? 2 : c >= t1 ? 1 : 0;
  const defs = [
    { key: 'repos', title: 'Repos', value: d.repos, t1: 1, t2: 5, t3: 10, icon: '📦' },
    { key: 'stars', title: 'Stars', value: d.stars, t1: 1, t2: 10, t3: 25, icon: '⭐' },
    { key: 'followers', title: 'Followers', value: d.user.followers, t1: 1, t2: 5, t3: 20, icon: '👥' },
    { key: 'commits', title: 'Commits', value: d.commits, t1: 5, t2: 50, t3: 200, icon: '💚' },
    { key: 'prs', title: 'PRs', value: d.prs, t1: 1, t2: 10, t3: 50, icon: '🔀' },
    { key: 'streak', title: 'Best Streak', value: d.longestStreak, t1: 2, t2: 7, t3: 21, icon: '🔥' },
    { key: 'contribs', title: 'Contribs', value: d.totalContribs, t1: 25, t2: 100, t3: 500, icon: '✅' },
    { key: 'issues', title: 'Issues', value: d.issues, t1: 1, t2: 5, t3: 20, icon: '📋' },
  ];
  const tierFills = [C.bg2, '#0b1e33', '#1a0f3a', '#2a0f1e'];
  const tierColors = [C.textDim, C.green, C.cyan, C.pink];
  let body = head(W, H, id) + cardBg(id, W, H);
  body += `<text x="28" y="38" font-family="Consolas,monospace" font-size="18" font-weight="700" fill="url(#g-title-${id})">Achievements &amp; Trophies</text>`;
  body += `<text x="28" y="58" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">TIER 1 → 2 → 3 at milestone thresholds · ${NOW_LOCAL}</text>`;
  for (let i = 0; i < defs.length; i++) {
    const t = defs[i];
    const tier = T(t.value, t.t1, t.t2, t.t3);
    const color = tierColors[tier]; const fill = tierFills[tier];
    const cx = 40 + (i * 102), cy = 110;
    body += `<g filter="url(#g-shadow-${id})"><rect x="${cx}" y="${cy - 40}" width="88" height="92" rx="14" fill="${fill}" stroke="${color}" stroke-width="1.3"/></g>`;
    body += `<text x="${cx + 44}" y="${cy - 6}" text-anchor="middle" font-size="24">${t.icon}</text>`;
    body += `<text x="${cx + 44}" y="${cy + 18}" text-anchor="middle" font-family="Consolas,monospace" font-size="10" fill="${C.text}">${esc(t.title)} · ${esc(numFmt(t.value))}</text>`;
    body += `<text x="${cx + 44}" y="${cy + 40}" text-anchor="middle" font-family="Consolas,monospace" font-size="11" font-weight="800" fill="${color}">TIER ${tier}</text>`;
  }
  body += foot; return body;
}
function buildActivity(d) {
  const W = 860, H = 280, id = 'a';
  const weeks = d.weeks || [];
  const cols = Math.max(weeks.length, 52);
  const padX = 28, padY = 58;
  const cell = Math.min(12, Math.floor((W - padX * 2) / cols));
  const gap = 2.5;
  const levels = [C.bg2, '#052e16', '#14532d', '#16a34a', '#4ade80'];
  const w26 = weeks.slice(-26);
  const daily = w26.flatMap(w => (w.contributionDays || []).map(c => c.contributionCount || 0));
  const avg = daily.length ? daily.reduce((s, v) => s + v, 0) / daily.length : 0;
  let body = head(W, H, id) + cardBg(id, W, H);
  body += `<text x="28" y="38" font-family="Consolas,monospace" font-size="18" font-weight="700" fill="url(#g-title-${id})">Contribution Activity</text>`;
  body += `<text x="28" y="56" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">${numFmt(d.totalContribs)} total contributions · 26-week avg ${avg.toFixed(1)}/day · ${NOW_LOCAL}</text>`;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let top = 0;
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i]; const days = w.contributionDays || [];
    if (days.length && i % 4 === 0 && days[0]) {
      const d0 = new Date(days[0].date + 'T00:00:00Z');
      body += `<text x="${(padX + i * (cell + gap) - 1).toFixed(1)}" y="${padY - 14}" font-family="Consolas,monospace" font-size="10" fill="${C.textDim}">${months[d0.getUTCMonth()]}</text>`;
    }
    for (let j = 0; j < days.length; j++) {
      const dy = days[j]; const lvl = Math.min(4, dy.level || 0);
      const x = padX + i * (cell + gap), y = padY + j * (cell + gap);
      body += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell}" height="${cell}" rx="2.4" fill="${levels[lvl]}"/>`;
      top = Math.max(top, y + cell);
    }
  }
  const ly = top + 28;
  body += `<text x="${padX}" y="${ly}" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">Less</text>`;
  for (let k = 0; k < levels.length; k++) {
    const lx = padX + 42 + k * (cell + gap) * 1.6;
    body += `<rect x="${lx.toFixed(1)}" y="${ly - 11}" width="${cell}" height="${cell}" rx="2.4" fill="${levels[k]}"/>`;
  }
  body += `<text x="${padX + 42 + levels.length * (cell + gap) * 1.6 + 8}" y="${ly}" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">More</text>`;
  body += foot; return body;
}
function buildDashboard(d) {
  const W = 900, H = 420, id = 'd';
  let body = head(W, H, id) + cardBg(id, W, H, 22);
  body += `<rect x="0" y="0" width="${W}" height="92" rx="22" fill="url(#g-title-${id})" opacity="0.08"/>`;
  body += `<text x="32" y="46" font-family="Consolas,monospace" font-size="24" font-weight="800" fill="url(#g-title-${id})">⚡ ${esc(d.user.name)} — Live GitHub Dashboard</text>`;
  body += `<text x="32" y="72" font-family="Consolas,monospace" font-size="12" fill="${C.textDim}">@${esc(d.user.login)} · auto-generated · ${NOW_LOCAL} (${TZ}) · auth: ${GITHUB_TOKEN ? 'GITHUB_TOKEN' : 'public REST'}</text>`;
  const kpis = [
    ['📦 Repositories', d.repos, C.cyan],
    ['⭐ Total Stars', d.stars, C.pink],
    ['👥 Followers', d.user.followers, C.purple],
    ['📈 Commits', d.commits, C.green],
    ['🔀 Pull Requests', d.prs, C.accent],
    ['✅ Contributions', d.totalContribs, C.emerald],
    ['🔥 Current Streak', d.currentStreak, C.cyan],
    ['📏 Longest Streak', d.longestStreak, C.purple],
    ['🍴 Forks', d.forks, C.pink],
    ['👤 Following', d.user.following, C.green],
  ];
  for (let i = 0; i < kpis.length; i++) {
    const [label, val, color] = kpis[i];
    const cx = 28 + ((i % 5) * 170);
    const cy = 118 + (Math.floor(i / 5) * 74);
    body += `<g filter="url(#g-shadow-${id})"><rect x="${cx}" y="${cy - 10}" width="156" height="60" rx="12" fill="${C.bg2}" stroke="${C.border}"/></g>`;
    body += `<text x="${cx + 12}" y="${cy + 12}" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">${esc(label)}</text>`;
    body += `<text x="${cx + 12}" y="${cy + 40}" font-family="Consolas,monospace" font-size="22" font-weight="800" fill="${color}">${esc(numFmt(val))}</text>`;
  }
  const by = 284;
  body += `<text x="28" y="${by}" font-family="Consolas,monospace" font-size="14" font-weight="700" fill="${C.title}">💻 Top Languages</text>`;
  const top5 = d.langs.slice(0, 5);
  const palette = [C.cyan, C.purple, C.pink, C.green, C.accent];
  for (let i = 0; i < 6; i++) {
    const l = top5[i]; if (!l) break;
    const yy = by + 22 + i * 20;
    const pctW = ((l.pct || 0) / 100) * 380;
    body += `<text x="36" y="${yy + 4}" font-family="Consolas,monospace" font-size="12" fill="${C.text}">${esc(l.name)}</text>`;
    body += `<rect x="160" y="${yy - 10}" width="380" height="12" rx="6" fill="${C.bg2}"/>`;
    body += `<rect x="160" y="${yy - 10}" width="${pctW.toFixed(1)}" height="12" rx="6" fill="${palette[i % palette.length]}"/>`;
    body += `<text x="552" y="${yy + 4}" font-family="Consolas,monospace" font-size="12" font-weight="700" fill="${palette[i % palette.length]}">${(l.pct || 0).toFixed(1)}%</text>`;
  }
  body += `<rect x="620" y="${by - 6}" width="252" height="120" rx="14" fill="${C.bg2}" stroke="${C.border}"/>`;
  body += `<text x="636" y="${by + 16}" font-family="Consolas,monospace" font-size="14" font-weight="700" fill="${C.title}">🚀 Quick Stats</text>`;
  const quick = [
    ['Public gists:', d.gists, C.cyan],
    ['PRs + Issues:', d.prs + d.issues, C.purple],
    ['Active days:', d.days.filter(x => (x.contributionCount || 0) > 0).length, C.green],
  ];
  for (let i = 0; i < quick.length; i++) {
    const [label, val, color] = quick[i];
    const yy = by + 46 + i * 24;
    body += `<text x="636" y="${yy}" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">${esc(label)}</text>`;
    body += `<text x="860" y="${yy}" text-anchor="end" font-family="Consolas,monospace" font-size="12" font-weight="800" fill="${color}">${numFmt(val)}</text>`;
  }
  body += `<text x="636" y="${by + 116}" font-family="Consolas,monospace" font-size="10" fill="${C.textDim}">Auto refresh via GitHub Actions every day</text>`;
  body += foot; return body;
}

async function main() {
  console.log('user:', GITHUB_USER, 'token:', GITHUB_TOKEN ? 'set' : 'unset');
  let d = null;
  if (GITHUB_TOKEN) {
    try { d = await loadFromGQL(); console.log('data source: graphql'); }
    catch (e) { console.warn('GraphQL failed, falling back to REST:', e.message); }
  }
  if (!d) { d = await loadFromREST(); console.log('data source: REST'); }
  console.log('data:', {
    repos: d.repos, stars: d.stars, forks: d.forks,
    followers: d.user.followers, following: d.user.following, gists: d.gists,
    commits: d.commits, prs: d.prs, issues: d.issues, totalContribs: d.totalContribs,
    currentStreak: d.currentStreak, longestStreak: d.longestStreak,
    langs: d.langs.map(l => l.name + ':' + l.pct.toFixed(1) + '%'),
  });
  write('stats.svg', buildStats(d));
  write('langs.svg', buildLangs(d));
  write('trophies.svg', buildTrophies(d));
  write('activity.svg', buildActivity(d));
  write('dashboard.svg', buildDashboard(d));
  console.log('done at', NOW_LOCAL);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
