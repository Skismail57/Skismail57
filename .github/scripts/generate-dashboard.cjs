'use strict';

const fs = require('fs');
const path = require('path');

const GITHUB_USER = process.env.GITHUB_REPOSITORY_OWNER || 'Skismail57';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const OUT_DIR = path.resolve(__dirname, '..', '..');
const TZ = 'Asia/Calcutta';
const NOW_ISO = new Date().toISOString();
const NOW_LOCAL = new Date().toLocaleString('en-US', {
  timeZone: TZ,
  year: 'numeric', month: 'short', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('GQL ' + res.status + ' ' + text.slice(0, 200));
  }
  const data = await res.json();
  if (data.errors) {
    console.warn('GQL warnings:', data.errors.slice(0, 3).map(e => e.message).join(' | '));
  }
  return data.data || {};
}

async function rest(urlPath) {
  const res = await fetch('https://api.github.com' + urlPath, {
    headers: {
      'User-Agent': 'Skismail57-Profile-Generator',
      Accept: 'application/vnd.github+json',
      ...(GITHUB_TOKEN ? { Authorization: 'Bearer ' + GITHUB_TOKEN } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('REST ' + res.status + ' ' + text.slice(0, 200));
  }
  return res.json();
}

async function loadData() {
  const mainQuery = `{
    user(login: "${GITHUB_USER}") {
      login name bio avatarUrl isHireable
      createdAt
      followers { totalCount }
      following { totalCount }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
        totalCount
        nodes {
          name stargazerCount forkCount description primaryLanguage { name color } languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
            totalSize edges { size node { name color } }
          }
          diskUsage pushedAt updatedAt createdAt issues(states: OPEN) { totalCount } pullRequests(states: OPEN) { totalCount }
        }
      }
      contributionsCollection {
        totalCommitContributions totalIssueContributions totalPullRequestContributions totalPullRequestReviewContributions totalRepositoryContributions totalRepositoriesWithContributedCommits
        contributionCalendar {
          totalContributions weeks { contributionDays { weekday date contributionCount color level } }
        }
        restrictedContributionsCount
      }
      pullRequests(first: 1, states: MERGED, orderBy: {field: CREATED_AT, direction: DESC}) { totalCount }
      issues(first: 1) { totalCount }
      gists(first: 1) { totalCount }
      achievements: achievements(first: 20) {
        edges { node { name tier description iconUrl achievement { id } } }
      }
    }
    rateLimit { cost remaining resetAt }
  }`;

  let data = { user: null };
  try {
    data = await gql(mainQuery);
  } catch (e) {
    console.warn('GraphQL failed, using REST fallback:', e.message);
  }

  let user = data && data.user;

  if (!user) {
    try {
      const ru = await rest('/users/' + GITHUB_USER);
      user = {
        login: ru.login,
        name: ru.name || ru.login,
        bio: ru.bio || '',
        followers: { totalCount: ru.followers || 0 },
        following: { totalCount: ru.following || 0 },
        repositories: { totalCount: ru.public_repos || 0, nodes: [] },
        contributionsCollection: { totalCommitContributions: 0, totalPullRequestContributions: 0, totalIssueContributions: 0, contributionCalendar: { totalContributions: ru.total_private_contributions || 0, weeks: [] } },
        pullRequests: { totalCount: 0 },
        issues: { totalCount: 0 },
        gists: { totalCount: ru.public_gists || 0 },
      };
    } catch (e2) {
      console.error('REST also failed', e2.message);
      throw e2;
    }
  }

  const nodes = (user.repositories && user.repositories.nodes) || [];
  let stars = 0, forks = 0;
  const langAgg = new Map();
  for (const r of nodes) {
    stars += r.stargazerCount || 0;
    forks += r.forkCount || 0;
    if (r.languages && r.languages.edges) {
      for (const e of r.languages.edges) {
        const n = e.node.name;
        langAgg.set(n, (langAgg.get(n) || 0) + (e.size || 0));
      }
    }
  }
  const langsArr = [...langAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const totalLangSize = langsArr.reduce((s, [, v]) => s + v, 0) || 1;
  const langs = langsArr.map(([name, size]) => ({ name, size, pct: Math.max(0.2, (size / totalLangSize) * 100) }));

  const cc = user.contributionsCollection || {};
  const cal = cc.contributionCalendar || { totalContributions: 0, weeks: [] };
  const weeks = cal.weeks || [];
  const days = [];
  for (const w of weeks) for (const d of (w.contributionDays || [])) days.push(d);

  const sorted = [...days].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  let currentStreak = 0, longestStreak = 0, running = 0;
  for (const d of sorted) {
    if ((d.contributionCount || 0) > 0) { currentStreak++; break; }
  }
  for (const d of days) {
    if ((d.contributionCount || 0) > 0) { running++; longestStreak = Math.max(longestStreak, running); }
    else running = 0;
  }

  const achievements = (user.achievements && user.achievements.edges) ? user.achievements.edges.map(e => e.node).filter(Boolean) : [];
  return {
    user: {
      login: user.login, name: user.name || user.login, bio: user.bio || '',
      followers: (user.followers && user.followers.totalCount) || 0,
      following: (user.following && user.following.totalCount) || 0,
    },
    repos: (user.repositories && user.repositories.totalCount) || 0,
    stars, forks,
    commits: cc.totalCommitContributions || 0,
    prs: (user.pullRequests && user.pullRequests.totalCount) || (cc.totalPullRequestContributions || 0),
    issues: (user.issues && user.issues.totalCount) || (cc.totalIssueContributions || 0),
    totalContribs: cal.totalContributions || 0,
    currentStreak, longestStreak,
    gists: (user.gists && user.gists.totalCount) || 0,
    langs, days, weeks,
    achievements,
  };
}

const C = {
  bg0: '#060811',
  bg1: '#0a1424',
  bg2: '#0f1f3d',
  border: '#1c2b4a',
  cyan: '#22d3ee',
  purple: '#8b5cf6',
  pink: '#f472b6',
  green: '#22c55e',
  emerald: '#39ff88',
  title: '#00eaff',
  text: '#93c5fd',
  textDim: '#64748b',
  accent: '#60a5fa',
  dot: ['#161B22', '#052E16', '#14532D', '#16A34A', '#4ADE80'],
};

function head(w, h, id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
  <linearGradient id="g-bg-${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${C.bg1}"/>
    <stop offset="100%" stop-color="${C.bg0}"/>
  </linearGradient>
  <linearGradient id="g-title-${id}" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${C.cyan}"/>
    <stop offset="100%" stop-color="${C.purple}"/>
  </linearGradient>
  <filter id="g-shadow-${id}"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.35"/></filter>
</defs>`;
}
const foot = '</svg>';

function cardBg(id, w, h, r = 18) {
  return `<rect rx="${r}" width="${w}" height="${h}" fill="url(#g-bg-${id})" stroke="${C.border}" stroke-width="1.2"/>`;
}

function numFmt(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function write(name, content) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, content, 'utf8');
  console.log('wrote', name, (content.length / 1024).toFixed(1), 'KB');
}

function buildStats(d) {
  const W = 520, H = 220, id = 's';
  const statItems = [
    ['Repos', d.repos, C.cyan, '📦'],
    ['Stars', d.stars, C.pink, '⭐'],
    ['Followers', d.user.followers, C.purple, '👥'],
    ['Commits', d.commits, C.green, '📈'],
    ['PRs', d.prs, C.cyan, '🔀'],
    ['Issues', d.issues, C.accent, '📋'],
    ['Contribs', d.totalContribs, C.emerald, '✅'],
    ['Gists', d.gists, C.text, '📝'],
  ];
  let body = head(W, H, id) + cardBg(id, W, H);
  body += `<text x="28" y="38" font-family="Consolas,monospace" font-size="18" font-weight="700" fill="url(#g-title-${id})">${esc(d.user.name)} · @${esc(d.user.login)}</text>`;
  body += `<text x="28" y="58" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">auto-updated · ${NOW_LOCAL} (${TZ})</text>`;
  let x = 28, y = 96;
  for (let i = 0; i < statItems.length; i++) {
    const [label, val, color, emoji] = statItems[i];
    const cx = x + ((i % 4) * 120);
    const cy = y + (Math.floor(i / 4) * 62);
    body += `<g filter="url(#g-shadow-${id})"><rect x="${cx - 4}" y="${cy - 22}" width="110" height="54" rx="12" fill="${C.bg2}" stroke="${C.border}"/></g>`;
    body += `<text x="${cx + 2}" y="${cy + 4}" font-family="Consolas,monospace" font-size="10" fill="${C.textDim}">${esc(label)}</text>`;
    body += `<text x="${cx + 2}" y="${cy + 26}" font-family="Consolas,monospace" font-size="20" font-weight="800" fill="${color}">${esc(numFmt(val))}</text>`;
  }
  // Streak line
  body += `<text x="28" y="200" font-family="Consolas,monospace" font-size="12" fill="${C.text}">🔥 Current Streak: <tspan font-weight="800" fill="${C.cyan}">${d.currentStreak}</tspan>   ⭐ Longest: <tspan font-weight="800" fill="${C.purple}">${d.longestStreak}</tspan>   🍴 Forks: <tspan font-weight="800" fill="${C.pink}">${numFmt(d.forks)}</tspan>   Following: <tspan font-weight="800" fill="${C.green}">${d.user.following}</tspan></text>`;
  body += foot;
  return body;
}

function buildLangs(d) {
  const W = 520, H = 300, id = 'l';
  const langs = d.langs.length ? d.langs : [{ name: 'No data', pct: 100 }];
  let cumulative = 0;
  const palette = [C.cyan, C.purple, C.pink, C.green, C.emerald, C.accent, '#facc15', '#fb923c'];
  const segs = langs.map((l, i) => {
    const start = cumulative; cumulative += l.pct;
    return { ...l, start, end: cumulative, color: palette[i % palette.length] };
  });
  const barY = 96, barH = 18, barX = 32, barW = W - 64;
  let body = head(W, H, id) + cardBg(id, W, H);
  body += `<text x="28" y="38" font-family="Consolas,monospace" font-size="18" font-weight="700" fill="url(#g-title-${id})">Most Used Languages</text>`;
  body += `<text x="28" y="58" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">based on bytes across ${d.repos} public repos · ${NOW_LOCAL}</text>`;
  for (const s of segs) {
    const x = barX + (s.start / 100) * barW;
    const w = Math.max(0.5, ((s.end - s.start) / 100) * barW);
    body += `<rect x="${x.toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="${barH}" rx="4" fill="${s.color}"/>`;
  }
  let ly = barY + 52;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const col = i % 2;
    const row = Math.floor(i / 2);
    const lx = 36 + col * 228;
    const yy = ly + row * 28;
    body += `<rect x="${lx}" y="${yy - 10}" width="14" height="14" rx="3" fill="${s.color}"/>`;
    body += `<text x="${lx + 22}" y="${yy}" font-family="Consolas,monospace" font-size="12" fill="${C.text}">${esc(s.name)}</text>`;
    body += `<text x="${lx + 182}" y="${yy}" font-family="Consolas,monospace" font-size="12" font-weight="700" fill="${s.color}">${s.pct.toFixed(1)}%</text>`;
  }
  body += foot;
  return body;
}

function buildTrophies(d) {
  const W = 860, H = 220, id = 't';
  const defs = [
    { key: 'repos10', title: '10+ Repos', check: d.repos >= 10, lv: d.repos >= 100 ? 3 : d.repos >= 50 ? 2 : 1 },
    { key: 'stars50', title: '50+ Stars', check: d.stars >= 50, lv: d.stars >= 500 ? 3 : d.stars >= 150 ? 2 : 1 },
    { key: 'follow50', title: '50+ Followers', check: d.user.followers >= 50, lv: d.user.followers >= 500 ? 3 : d.user.followers >= 150 ? 2 : 1 },
    { key: 'commits500', title: '500+ Commits', check: d.commits >= 500, lv: d.commits >= 5000 ? 3 : d.commits >= 2000 ? 2 : 1 },
    { key: 'prs25', title: '25+ PRs', check: d.prs >= 25, lv: d.prs >= 250 ? 3 : d.prs >= 100 ? 2 : 1 },
    { key: 'streak10', title: '10-day Streak', check: d.longestStreak >= 10, lv: d.longestStreak >= 100 ? 3 : d.longestStreak >= 50 ? 2 : 1 },
    { key: 'contrib1k', title: '1K Contributions', check: d.totalContribs >= 1000, lv: d.totalContribs >= 10000 ? 3 : d.totalContribs >= 5000 ? 2 : 1 },
    { key: 'issues10', title: '10+ Issues', check: d.issues >= 10, lv: d.issues >= 100 ? 3 : d.issues >= 50 ? 2 : 1 },
  ];
  const tierColor = ['#64748b', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444'];
  const icons = ['🏆', '⭐', '👥', '💚', '🔀', '🔥', '✅', '📋'];
  let body = head(W, H, id) + cardBg(id, W, H);
  body += `<text x="28" y="38" font-family="Consolas,monospace" font-size="18" font-weight="700" fill="url(#g-title-${id})">Achievements &amp; Trophies</text>`;
  body += `<text x="28" y="58" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">tier 1 → 2 → 3 as milestones scale · auto · ${NOW_LOCAL}</text>`;
  for (let i = 0; i < defs.length; i++) {
    const t = defs[i];
    const cx = 40 + (i * 102);
    const cy = 110;
    const tier = t.check ? Math.max(1, Math.min(3, t.lv)) : 0;
    const color = t.check ? [C.green, C.cyan, C.purple, C.pink][tier] : C.textDim;
    const fill = t.check ? [C.bg2, '#0b1e33', '#1a0f3a', '#2a0f1e'][tier] : C.bg2;
    body += `<g filter="url(#g-shadow-${id})"><rect x="${cx}" y="${cy - 40}" width="88" height="92" rx="14" fill="${fill}" stroke="${color}" stroke-width="1.3"/></g>`;
    body += `<text x="${cx + 44}" y="${cy - 6}" text-anchor="middle" font-size="24">${icons[i]}</text>`;
    body += `<text x="${cx + 44}" y="${cy + 20}" text-anchor="middle" font-family="Consolas,monospace" font-size="10" fill="${C.text}">${esc(t.title)}</text>`;
    body += `<text x="${cx + 44}" y="${cy + 40}" text-anchor="middle" font-family="Consolas,monospace" font-size="11" font-weight="800" fill="${color}">TIER ${tier}</text>`;
  }
  body += foot;
  return body;
}

function buildActivity(d) {
  const W = 860, H = 280, id = 'a';
  const weeks = d.weeks.length ? d.weeks : [];
  const cols = Math.max(weeks.length, 52);
  const rows = 7;
  const padX = 28, padY = 58;
  const cell = Math.min(12, Math.floor((W - padX * 2) / cols));
  const gap = 2.5;
  const levels = [C.bg2, '#052e16', '#14532d', '#16a34a', '#4ade80'];
  let top = 0;
  const weeks26 = weeks.slice(-26);
  const contribs26 = weeks26.flatMap(w => (w.contributionDays || []).map(c => c.contributionCount || 0));
  const total26 = contribs26.reduce((s, v) => s + v, 0);
  const avg = (contribs26.length ? total26 / contribs26.length : 0);
  let body = head(W, H, id) + cardBg(id, W, H);
  body += `<text x="28" y="38" font-family="Consolas,monospace" font-size="18" font-weight="700" fill="url(#g-title-${id})">Contribution Activity</text>`;
  body += `<text x="28" y="56" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">${d.totalContribs} total contributions · 26-week avg ${avg.toFixed(1)}/day · ${NOW_LOCAL}</text>`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const days = w.contributionDays || [];
    if (days.length && i % 4 === 0) {
      const d0 = new Date(days[0].date);
      const label = months[d0.getUTCMonth()];
      const x = padX + i * (cell + gap) - 1;
      body += `<text x="${x.toFixed(1)}" y="${padY - 14}" font-family="Consolas,monospace" font-size="10" fill="${C.textDim}">${label}</text>`;
    }
    for (let j = 0; j < days.length; j++) {
      const day = days[j];
      let lvl = 0;
      const c = day.contributionCount || 0;
      if (c > 0) lvl = 1;
      if (c >= 3) lvl = 2;
      if (c >= 8) lvl = 3;
      if (c >= 16) lvl = 4;
      const x = padX + i * (cell + gap);
      const y = padY + j * (cell + gap);
      body += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell}" height="${cell}" rx="2.4" fill="${levels[lvl]}"/>`;
      top = Math.max(top, y + cell);
    }
  }
  // Legend
  const legendY = top + 28;
  body += `<text x="${padX}" y="${legendY}" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">Less</text>`;
  for (let k = 0; k < levels.length; k++) {
    const lx = padX + 42 + k * (cell + gap) * 1.6;
    body += `<rect x="${lx.toFixed(1)}" y="${legendY - 11}" width="${cell}" height="${cell}" rx="2.4" fill="${levels[k]}"/>`;
  }
  body += `<text x="${padX + 42 + levels.length * (cell + gap) * 1.6 + 8}" y="${legendY}" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">More</text>`;
  body += foot;
  return body;
}

function buildDashboard(d) {
  const W = 900, H = 420, id = 'd';
  let body = head(W, H, id) + cardBg(id, W, H, 22);
  // Big title banner
  body += `<rect x="0" y="0" width="${W}" height="92" rx="22" fill="url(#g-title-${id})" opacity="0.08"/>`;
  body += `<text x="32" y="46" font-family="Consolas,monospace" font-size="24" font-weight="800" fill="url(#g-title-${id})">⚡ ${esc(d.user.name)} — Live GitHub Dashboard</text>`;
  body += `<text x="32" y="72" font-family="Consolas,monospace" font-size="12" fill="${C.textDim}">@${esc(d.user.login)} · auto-generated · ${NOW_LOCAL} (${TZ}) · GITHUB_TOKEN auth: ${GITHUB_TOKEN ? 'yes' : 'no'}</text>`;

  const kpis = [
    ['📦 Repositories', d.repos, C.cyan],
    ['⭐ Total Stars', d.stars, C.pink],
    ['👥 Followers', d.user.followers, C.purple],
    ['📈 Commits (Y)', d.commits, C.green],
    ['🔀 Pull Requests', d.prs, C.accent],
    ['✅ Contributions', d.totalContribs, C.emerald],
    ['🔥 Current Streak', d.currentStreak, C.cyan],
    ['📏 Longest Streak', d.longestStreak, C.purple],
    ['🍴 Forks', d.forks, C.pink],
    ['👤 Following', d.user.following, C.green],
  ];
  let kx = 28, ky = 118;
  for (let i = 0; i < kpis.length; i++) {
    const [label, val, color] = kpis[i];
    const cx = kx + ((i % 5) * 170);
    const cy = ky + (Math.floor(i / 5) * 74);
    body += `<g filter="url(#g-shadow-${id})"><rect x="${cx}" y="${cy - 10}" width="156" height="60" rx="12" fill="${C.bg2}" stroke="${C.border}"/></g>`;
    body += `<text x="${cx + 12}" y="${cy + 12}" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">${esc(label)}</text>`;
    body += `<text x="${cx + 12}" y="${cy + 40}" font-family="Consolas,monospace" font-size="22" font-weight="800" fill="${color}">${esc(numFmt(val))}</text>`;
  }

  // Top langs mini bar (4 best)
  const by = 284;
  body += `<text x="28" y="${by}" font-family="Consolas,monospace" font-size="14" font-weight="700" fill="${C.title}">💻 Top Languages</text>`;
  const langs = d.langs.slice(0, 5);
  const palette = [C.cyan, C.purple, C.pink, C.green, C.accent];
  for (let i = 0; i < 6; i++) {
    const l = langs[i];
    if (!l) break;
    const yy = by + 22 + i * 20;
    const pctW = ((l.pct || 0) / 100) * 380;
    body += `<text x="36" y="${yy + 4}" font-family="Consolas,monospace" font-size="12" fill="${C.text}" width="110">${esc(l.name)}</text>`;
    body += `<rect x="160" y="${yy - 10}" width="380" height="12" rx="6" fill="${C.bg2}"/>`;
    body += `<rect x="160" y="${yy - 10}" width="${pctW.toFixed(1)}" height="12" rx="6" fill="${palette[i % palette.length]}"/>`;
    body += `<text x="552" y="${yy + 4}" font-family="Consolas,monospace" font-size="12" font-weight="700" fill="${palette[i % palette.length]}">${(l.pct || 0).toFixed(1)}%</text>`;
  }

  // Right side: latest activity quick stats
  body += `<rect x="620" y="${by - 6}" width="252" height="120" rx="14" fill="${C.bg2}" stroke="${C.border}"/>`;
  body += `<text x="636" y="${by + 16}" font-family="Consolas,monospace" font-size="14" font-weight="700" fill="${C.title}">🚀 Quick Stats</text>`;
  const quick = [
    ['Public gists:', d.gists, C.cyan],
    ['Total PRs / Issues:', (d.prs + d.issues), C.purple],
    ['Contrib repos >= 1 commit:', (d.days.length ? Math.min(50, new Set(d.days.filter(x => (x.contributionCount || 0) > 0).length).size) : 0), C.green],
  ];
  for (let i = 0; i < quick.length; i++) {
    const [label, val, color] = quick[i];
    const yy = by + 46 + i * 24;
    body += `<text x="636" y="${yy}" font-family="Consolas,monospace" font-size="11" fill="${C.textDim}">${esc(label)}</text>`;
    body += `<text x="860" y="${yy}" text-anchor="end" font-family="Consolas,monospace" font-size="12" font-weight="800" fill="${color}">${numFmt(val)}</text>`;
  }
  body += `<text x="636" y="${by + 116}" font-family="Consolas,monospace" font-size="10" fill="${C.textDim}">refresh via GitHub Actions every day</text>`;

  body += foot;
  return body;
}

async function main() {
  console.log('user:', GITHUB_USER, 'token:', GITHUB_TOKEN ? 'set' : 'unset');
  const d = await loadData();
  console.log('data loaded:', {
    repos: d.repos, stars: d.stars, followers: d.user.followers,
    commits: d.commits, prs: d.prs, issues: d.issues, contribs: d.totalContribs,
    streakCur: d.currentStreak, streakMax: d.longestStreak, langs: d.langs.map(l => l.name),
    achievements: d.achievements.length,
  });
  write('stats.svg', buildStats(d));
  write('langs.svg', buildLangs(d));
  write('trophies.svg', buildTrophies(d));
  write('activity.svg', buildActivity(d));
  write('dashboard.svg', buildDashboard(d));
  console.log('done at', NOW_LOCAL);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
