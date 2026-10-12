// Builds README.md and the SVG cards in out/ from live data: the GitHub
// contribution calendar, and the project list on eddyzow.net (the site's
// <template id="project-data">), so editing the site updates this profile too.
// Runs in .github/workflows/render.yml. Locally:
//   GITHUB_TOKEN=$(gh auth token) node render.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { BOSTON, CLOUDS, ICE, LAND, SF } from "./earth.mjs";

const LOGIN = "eddyzow";
const SITE = "https://eddyzow.net";
const TZ = "America/Los_Angeles";
const PROJECT_COUNT = 6;
const SHADOW = 8; // hard "sticker" shadow offset, like the site's cards
const LINKS = [
  ["eddyzow.net", SITE],
  ["LinkedIn", "https://linkedin.com/in/eddyzow"],
  ["YouTube", "https://youtube.com/eddyzow"],
  ["Last.fm", "https://www.last.fm/user/eddyzow"],
];

// tokens from docs/style.css on the site
const C = {
  bg: "#0a0920",
  elev: "#16143c",
  fg: "#f3f0ff",
  soft: "#cdc9ee",
  muted: "#9894c4",
  line: "rgba(190,188,255,0.22)",
  ink: "#04031a",
  accent: "#ffb45e",
  accentSoft: "rgba(255,180,94,0.12)",
  accentLine: "rgba(255,180,94,0.45)",
};

const root = new URL("./", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const METRICS = JSON.parse(read("fonts/metrics.json"));
const FACES = {
  serif: ["F", "normal", "Georgia,serif"],
  italic: ["FI", "italic", "Georgia,serif"],
  sans: ["G", "normal", "system-ui,sans-serif"],
  mono: ["GM", "normal", "ui-monospace,monospace"],
};

const nf = new Intl.NumberFormat("en-US");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const f1 = (n) => +n.toFixed(1);

// ------------------------------------------------------------------- text

function measure(text, font, size, tracking = 0) {
  const m = METRICS[font];
  let units = 0;
  for (const ch of text) units += m.adv[ch] ?? m.upm * 0.6;
  return (units / m.upm) * size + tracking * [...text].length;
}

// Greedy word wrap; the last kept line gets an ellipsis if text overflows.
function wrap(text, font, size, maxW, maxLines) {
  const lines = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (!cur || measure(next, font, size) <= maxW) {
      cur = next;
      continue;
    }
    lines.push(cur);
    cur = word;
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1].split(" ");
  while (last.length > 1 && measure(`${last.join(" ")}…`, font, size) > maxW) last.pop();
  kept[maxLines - 1] = `${last.join(" ").replace(/[,;:.]$/, "")}…`;
  return kept;
}

// As many " · "-separated items as fit, dropping whole items from the end.
function fitList(text, font, size, maxW) {
  const items = text.split(" · ");
  while (items.length > 1 && measure(items.join(" · "), font, size) > maxW) items.pop();
  return items.join(" · ");
}

// ------------------------------------------------------------------- svg

const BASE_CSS = `
@keyframes twinkle{50%{opacity:.2}}
@keyframes roll{to{transform:translateY(var(--to))}}
@keyframes ping{from{opacity:.7;transform:scale(1)}to{opacity:0;transform:scale(3.2)}}
@keyframes march{to{stroke-dashoffset:-60}}
.tw{animation:twinkle 3s ease-in-out infinite}
.roll{animation:roll 1.9s cubic-bezier(.16,1,.3,1)}
.ping{transform-box:fill-box;transform-origin:center;animation:ping 2.4s cubic-bezier(.16,1,.3,1) infinite}
.march{animation:march 5s linear infinite}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

function fontCss(body) {
  return Object.entries(FACES)
    .filter(([name]) => new RegExp(`class="(?:[^"]* )?${name}[ "]`).test(body))
    .map(([name, [family, style, fallback]]) => {
      const data = read(`fonts/${name}.woff`).toString("base64");
      return `@font-face{font-family:${family};font-style:${style};src:url(data:font/woff;base64,${data}) format("woff")}.${name}{font-family:${family},${fallback};font-style:${style}}`;
    })
    .join("");
}

function svg(w, h, label, body, css = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
<style>${fontCss(body)}${BASE_CSS}${css}</style>
${body}
</svg>
`;
}

// A card face with an ink outline and a hard offset shadow.
function frame(fw, fh, { r = 20, sh = SHADOW } = {}) {
  return `<rect x="${sh}" y="${sh}" width="${fw - 1.5}" height="${fh - 1.5}" rx="${r}" fill="${C.ink}"/>
<rect x="1.5" y="1.5" width="${fw - 3}" height="${fh - 3}" rx="${r - 1.5}" fill="${C.bg}" stroke="${C.ink}" stroke-width="3"/>`;
}

const hairline = (fw, fh, r = 20) =>
  `<rect x="4.5" y="4.5" width="${fw - 9}" height="${fh - 9}" rx="${r - 4.5}" stroke="${C.line}"/>`;

// mulberry32: a fixed seed keeps the stars put between renders
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const twinkle = (rand) =>
  ` class="tw" style="animation-delay:-${f1(rand() * 6)}s;animation-duration:${f1(2.6 + rand() * 3.6)}s"`;

function starfield(rand, n, w, h) {
  let out = "";
  for (let i = 0; i < n; i++) {
    const r = rand() < 0.12 ? 1.3 + rand() * 0.8 : 0.5 + rand() * 0.7;
    const o = f1(0.25 + rand() * 0.6);
    const tw = rand() < 0.4 ? twinkle(rand) : "";
    out += `<circle cx="${f1(rand() * w)}" cy="${f1(rand() * h)}" r="${r.toFixed(2)}" fill="${C.fg}" opacity="${o}"${tw}/>`;
  }
  return out;
}

// four-point sparkle
const glint = (x, y, s) =>
  `M${f1(x)} ${f1(y - s)}Q${f1(x)} ${f1(y)} ${f1(x + s)} ${f1(y)}Q${f1(x)} ${f1(y)} ${f1(x)} ${f1(y + s)}Q${f1(x)} ${f1(y)} ${f1(x - s)} ${f1(y)}Q${f1(x)} ${f1(y)} ${f1(x)} ${f1(y - s)}Z`;

// Soft painted blobs: turbulence-displaced ellipses, blurred.
function nebula(blobs) {
  return `<filter id="paint" x="-50%" y="-50%" width="200%" height="200%"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="80" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="16"/></filter>
<g filter="url(#paint)">${blobs.map(([cx, cy, rx, ry, color, o]) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}" opacity="${o}"/>`).join("")}</g>`;
}

// Each digit spins one full turn and lands back on itself. Frame zero is the
// real number, so a viewer that snapshots without animating still reads it.
function odometer(value, x, y, size, delay, id) {
  const dw = (METRICS.serif.tnum / METRICS.serif.upm) * size;
  const lh = size * 1.15;
  let cx = x;
  let cols = "";
  [...value].forEach((ch, k) => {
    if (!/\d/.test(ch)) {
      cols += `<text x="${f1(cx)}" y="${y}">${esc(ch)}</text>`;
      cx += measure(ch, "serif", size);
      return;
    }
    const d = Number(ch);
    const tspans = Array.from({ length: 11 }, (_, j) => `<tspan x="${f1(cx)}" y="${f1(y + j * lh)}">${(d + j) % 10}</tspan>`).join("");
    cols += `<text class="roll" style="--to:${f1(-10 * lh)}px;animation-delay:${(delay + k * 0.07).toFixed(2)}s">${tspans}</text>`;
    cx += dw;
  });
  return `<clipPath id="${id}"><rect x="${f1(x - 4)}" y="${f1(y - size)}" width="${f1(cx - x + 8)}" height="${f1(size * 1.25)}"/></clipPath>
<g clip-path="url(#${id})" class="serif" font-size="${size}" fill="${C.fg}" style="font-variant-numeric:tabular-nums">${cols}</g>`;
}

// ------------------------------------------------------------------- hero

// Illustrated Earth: equirectangular coastlines slide inside a clipped disc,
// with cel shading, pen hatching on the night side, and an orbiting moon that
// passes behind and in front of the planet.
function planet(cx, cy, R) {
  const MW = Math.round(2 * Math.PI * R * 0.95);
  const px = (lon) => ((lon + 180) / 360) * MW;
  const py = (lat) => cy - (lat / 90) * R * 1.05;
  const ring = (pts) => `M${pts.map(([lon, lat]) => `${f1(px(lon))} ${f1(py(lat))}`).join("L")}Z`;
  const [ax, ay, bx, by] = [px(SF[0]), py(SF[1]), px(BOSTON[0]), py(BOSTON[1])];
  const x0 = cx - px(-97); // open over North America
  const orx = R * 1.48;
  const ory = R * 0.36;
  const orbit = `M${f1(cx + orx)} ${cy}A${f1(orx)} ${f1(ory)} 0 1 0 ${f1(cx - orx)} ${cy}A${f1(orx)} ${f1(ory)} 0 1 0 ${f1(cx + orx)} ${cy}`;
  const tilt = `rotate(-14 ${cx} ${cy})`;
  const moon = (clip) => `<g transform="${tilt}"><g clip-path="url(#${clip})">
<path d="${orbit}" stroke="${C.line}" stroke-width="1.4" stroke-dasharray="3 6"/>
<g><circle r="10" fill="#dcd7f7" stroke="${C.ink}" stroke-width="2.4"/><circle cx="-3" cy="-2.5" r="2.6" fill="#aaa4dc"/><circle cx="3.6" cy="3" r="1.7" fill="#aaa4dc"/><animateMotion dur="18s" repeatCount="indefinite" path="${orbit}"/></g>
</g></g>`;
  const tiles = (id) => `<use href="#${id}" x="${f1(x0 - MW)}"/><use href="#${id}" x="${f1(x0)}"/>`;

  return `<defs>
<g id="strip">
<g fill="#63c97f" stroke="${C.ink}" stroke-width="1.6" stroke-linejoin="round">${LAND.map((r) => `<path d="${ring(r)}"/>`).join("")}</g>
<g fill="#eef0ff" stroke="${C.ink}" stroke-width="1.6" stroke-linejoin="round">${ICE.map((r) => `<path d="${ring(r)}"/>`).join("")}</g>
<path d="M${f1(ax)} ${f1(ay)}Q${f1((ax + bx) / 2)} ${f1(Math.min(ay, by) - R * 0.3)} ${f1(bx)} ${f1(by)}" stroke="${C.accent}" stroke-width="2.4" stroke-dasharray="1 5" stroke-linecap="round"/>
${[[ax, ay], [bx, by]].map(([x, y]) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="3.4" fill="${C.accent}" stroke="${C.ink}" stroke-width="1.6"/>`).join("")}
</g>
<g id="clouds" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round">${CLOUDS.map(([lon, lat, len]) => {
    const [x, y, w] = [px(lon), py(lat), (len / 360) * MW];
    return `<path d="M${f1(x)} ${f1(y)}h${f1(w)}M${f1(x + w * 0.3)} ${f1(y + 5)}h${f1(w * 0.55)}"/>`;
  }).join("")}</g>
<clipPath id="globe"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>
<clipPath id="back"><rect x="${cx - 2 * R}" y="${cy - 2 * R}" width="${4 * R}" height="${2 * R}"/></clipPath>
<clipPath id="front"><rect x="${cx - 2 * R}" y="${cy}" width="${4 * R}" height="${2 * R}"/></clipPath>
<radialGradient id="ocean" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#5a97f7"/><stop offset="1" stop-color="#2245b4"/></radialGradient>
<radialGradient id="atmo"><stop offset=".78" stop-color="#8cc4ff" stop-opacity=".45"/><stop offset="1" stop-color="#8cc4ff" stop-opacity="0"/></radialGradient>
<radialGradient id="limb"><stop offset=".72" stop-color="${C.ink}" stop-opacity="0"/><stop offset="1" stop-color="${C.ink}" stop-opacity=".4"/></radialGradient>
<pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(135)"><path d="M0 0V5" stroke="${C.ink}" stroke-width="1.4"/></pattern>
<mask id="night"><rect x="${cx - R}" y="${cy - R}" width="${2 * R}" height="${2 * R}" fill="#fff"/><circle cx="${f1(cx - R * 0.3)}" cy="${f1(cy - R * 0.34)}" r="${f1(R * 1.12)}" fill="#000"/></mask>
</defs>
<g>
${moon("back")}
<circle cx="${cx}" cy="${cy}" r="${R + 16}" fill="url(#atmo)"/>
<g clip-path="url(#globe)">
<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#ocean)"/>
<g class="spin">${tiles("strip")}</g>
<g fill="#eef0ff" stroke="${C.ink}" stroke-width="1.6"><ellipse cx="${cx}" cy="${cy - R}" rx="${f1(R * 0.75)}" ry="${f1(R * 0.2)}"/><ellipse cx="${cx}" cy="${cy + R}" rx="${f1(R * 0.9)}" ry="${f1(R * 0.22)}"/></g>
<g class="drift">${tiles("clouds")}</g>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#limb)"/>
<g mask="url(#night)"><rect x="${cx - R}" y="${cy - R}" width="${2 * R}" height="${2 * R}" fill="${C.ink}" opacity=".42"/><rect x="${cx - R}" y="${cy - R}" width="${2 * R}" height="${2 * R}" fill="url(#hatch)" opacity=".55"/></g>
<ellipse cx="${f1(cx - R * 0.42)}" cy="${f1(cy - R * 0.46)}" rx="${f1(R * 0.22)}" ry="${f1(R * 0.11)}" transform="rotate(-35 ${f1(cx - R * 0.42)} ${f1(cy - R * 0.46)})" fill="#fff" opacity=".35"/>
</g>
<circle cx="${cx}" cy="${cy}" r="${R}" stroke="${C.ink}" stroke-width="3.5"/>
${moon("front")}
</g>`;
}

function hero(s) {
  const fw = 840;
  const fh = 300;
  const [cx, cy, R] = [690, 150, 88];
  const MW = Math.round(2 * Math.PI * R * 0.95);
  const status = `${s.activity} · ${nf.format(s.total)} contributions in the past year`;
  const tw = measure(status, "mono", 12);
  const body = `${frame(fw, fh)}
<clipPath id="face"><rect x="3" y="3" width="${fw - 6}" height="${fh - 6}" rx="17"/></clipPath>
<g clip-path="url(#face)">
${nebula([[700, 80, 220, 120, "#6b4dff", 0.5], [540, 260, 170, 90, "#ff5fa8", 0.22], [170, 30, 230, 80, "#38c6c0", 0.14]])}
${starfield(rng(7), 130, fw, fh)}
${planet(cx, cy, R)}
</g>
<text class="serif" x="46" y="142" font-size="86" letter-spacing="-2.6" fill="${C.fg}">Eddy <tspan class="italic">Zhao</tspan></text>
<text class="sans" x="49" y="186" font-size="18.5" fill="${C.soft}">Astrophysics &amp; Computer Science at UC Berkeley.</text>
<g>
<rect x="48" y="214" width="${f1(tw + 54)}" height="32" rx="16" fill="${C.elev}" stroke="${C.line}"/>
<circle class="ping" cx="67" cy="230" r="4" fill="${C.accent}"/><circle cx="67" cy="230" r="4" fill="${C.accent}"/>
<text class="mono" x="81" y="234.2" font-size="12" fill="${C.soft}">${esc(status)}</text>
</g>
${hairline(fw, fh)}`;
  const css = `
@keyframes spin{to{transform:translateX(${MW}px)}}
.spin{animation:spin 70s linear infinite}
.drift{animation:spin 40s linear infinite}`;
  return svg(fw + SHADOW, fh + SHADOW, "Eddy Zhao. Astrophysics & Computer Science at UC Berkeley.", body, css);
}

// ------------------------------------------------------------------- sky

const STAR = [[0.9, 0.22], [1.4, 0.5], [1.9, 0.72], [2.4, 0.88], [3, 1]]; // [r, opacity] by level

// The contribution calendar as a night sky: one star per day, brightness by
// activity, the busiest days joined into a constellation.
function sky(s, stamp) {
  const fw = 840;
  const fh = 400;
  const [X, Y, RH] = [36, 100, 22];
  const pitch = (fw - 2 * X) / s.weeks.length;
  const rand = rng(3);
  const top = new Set(
    s.days.filter((d) => d.count).sort((a, b) => b.count - a.count || b.date.localeCompare(a.date)).slice(0, 8).map((d) => d.date),
  );
  const pos = new Map();
  let stars = "";
  let glints = "";
  s.weeks.forEach((week, w) =>
    week.forEach((d) => {
      const x = X + pitch * (w + 0.5);
      const y = Y + RH * (d.weekday + 0.5);
      pos.set(d.date, [f1(x), f1(y)]);
      const [r, o] = STAR[d.level];
      const hot = top.has(d.date);
      const tw = d.level >= 2 ? twinkle(rand) : "";
      stars += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" fill="${hot ? C.accent : C.fg}" opacity="${o}"${tw}/>`;
      if (hot || d.level === 4) glints += `<path d="${glint(x, y, hot ? 8 : 6)}" fill="${hot ? C.accent : C.fg}" opacity="${hot ? 0.9 : 0.55}"${tw}/>`;
    }),
  );
  const path = [...top].sort().map((date) => pos.get(date).join(" "));
  const [bx, by] = pos.get(s.best.date);

  let months = "";
  let lastW = -9;
  s.weeks.forEach((week, w) => {
    const month = week[0].date.slice(5, 7);
    if (w && month === s.weeks[w - 1][0].date.slice(5, 7)) return;
    if (w - lastW < 3) return;
    lastW = w;
    const label = new Date(`${week[0].date}T12:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    months += `<text x="${f1(X + pitch * w)}" y="${Y + 7 * RH + 20}">${label.toUpperCase()}</text>`;
  });

  const col = (fw - 2 * X) / 4;
  const stats = [
    [nf.format(s.total), "contributions"],
    [String(s.current), "day streak"],
    [String(s.longest), "longest streak"],
    [String(s.active), "active days"],
  ]
    .map(([value, label], i) => {
      const x = X + i * col;
      const divider = i ? `<path d="M${f1(x - 22)} 316V376" stroke="${C.line}" stroke-dasharray="3 4"/>` : "";
      return `${divider}${odometer(value, x, 348, 44, 0.35 + i * 0.12, `odo${i}`)}
<text class="mono" x="${f1(x)}" y="372" font-size="10.5" letter-spacing="1.2" fill="${C.muted}">${label.toUpperCase()}</text>`;
    })
    .join("\n");

  const best = `BEST DAY · ${fmtDay(s.best.date).toUpperCase()} · ${s.best.count}`;
  const bestW = measure(best, "mono", 10.5, 1.2);
  const body = `${frame(fw, fh)}
<clipPath id="face"><rect x="3" y="3" width="${fw - 6}" height="${fh - 6}" rx="17"/></clipPath>
<linearGradient id="trail" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
<g clip-path="url(#face)">
${nebula([[620, 170, 260, 70, "#6b4dff", 0.28], [160, 230, 200, 50, "#38c6c0", 0.1]])}
<g transform="translate(${X + 140} ${Y - 26}) rotate(22)"><g class="shoot"><rect width="90" height="1.6" rx=".8" fill="url(#trail)"/><circle cx="90" cy=".8" r="1.7" fill="#fff"/></g></g>
</g>
<text class="serif" x="${X}" y="62" font-size="32" letter-spacing="-.8" fill="${C.fg}">A year <tspan class="italic">in stars</tspan></text>
<text class="mono" x="${fw - X}" y="50" text-anchor="end" font-size="10.5" letter-spacing="1.2" fill="${C.muted}">UPDATED ${esc(stamp)}</text>
<path d="${glint(fw - X - bestW - 9, 64.5, 5.5)}" fill="${C.accent}"/>
<text class="mono" x="${fw - X}" y="68" text-anchor="end" font-size="10.5" letter-spacing="1.2" fill="${C.accent}">${esc(best)}</text>
${path.length > 1 ? `<path class="march" d="M${path.join("L")}" stroke="${C.accentLine}" stroke-width="1.2" stroke-dasharray="2 5"/>` : ""}
${stars}
${glints}
<circle class="ping" cx="${bx}" cy="${by}" r="5" stroke="${C.accent}" stroke-width="1" style="animation-duration:3.6s"/>
<g class="mono" font-size="10" letter-spacing="1.2" fill="${C.muted}">${months}</g>
<path d="M${X} 292H${fw - X}" stroke="${C.line}" stroke-dasharray="3 5"/>
${stats}
${hairline(fw, fh)}`;
  const css = `
@keyframes shoot{0%{opacity:0;transform:translateX(0)}1%{opacity:1}7%,100%{opacity:0;transform:translateX(340px)}}
.shoot{opacity:0;animation:shoot 9s cubic-bezier(.3,0,.7,1) 2s infinite}`;
  const label = `${nf.format(s.total)} contributions in the past year. Current streak ${s.current} days, longest ${s.longest}, ${s.active} active days.`;
  return svg(fw + SHADOW, fh + SHADOW, label, body, css);
}

// ------------------------------------------------------------------- cards

// A sticker tab, so the title reads on both GitHub themes, trailing a dashed
// orbit out to a small planet.
function heading(title) {
  const fw = 840;
  const [th, sh] = [54, 5];
  const tw = Math.ceil(measure(title, "serif", 30, -0.6) + 44);
  return svg(fw, th + sh, title, `${frame(tw, th, { r: 20, sh })}
<text class="serif" x="22" y="37" font-size="30" letter-spacing="-.6" fill="${C.fg}">${esc(title)}</text>
<path class="march" d="M${tw + 18} ${th / 2}H${fw - 30}" stroke="${C.muted}" stroke-width="1.5" stroke-dasharray="3 7"/>
<circle cx="${fw - 16}" cy="${th / 2}" r="8" fill="${C.accent}" stroke="${C.ink}" stroke-width="2.5"/>`);
}

function hostLabel(href) {
  const u = new URL(href, `${SITE}/`);
  return `${u.host.replace(/^www\./, "")}${u.pathname}`.replace(/\/$/, "");
}

function card(p, image, repo, now) {
  const fw = 412;
  const fh = 370;
  const IH = 196;
  const PAD = 24;
  const stars = repo?.stargazerCount;
  const meta = [p.year, stars && `${stars} star${stars === 1 ? "" : "s"}`, repo && `updated ${ago(repo.pushedAt, now)}`].filter(Boolean).join(" · ");
  const host = `${hostLabel(p.href)} ↗`;
  const pillW = Math.min(measure(host, "mono", 10.5) + 24, fw - PAD * 2);
  const [hostText] = wrap(host, "mono", 10.5, pillW - 24, 1);
  const stack = fitList(p.stack ?? "", "mono", 10.5, fw - PAD * 2 - pillW - 14);
  const lines = wrap(p.desc, "sans", 13.5, fw - PAD * 2, 3);
  let event = "";
  if (p.event) {
    const [text] = wrap(p.event, "mono", 10.5, fw - 64, 1);
    const ew = measure(text, "mono", 10.5) + 24;
    event = `<rect x="16" y="${IH - 40}" width="${f1(ew)}" height="24" rx="12" fill="${C.bg}" stroke="${C.ink}" stroke-width="2"/>
<text class="mono" x="28" y="${IH - 24.3}" font-size="10.5" fill="${C.fg}">${esc(text)}</text>`;
  }
  const body = `${frame(fw, fh)}
<clipPath id="img"><path d="M3 ${IH}V20a17 17 0 0 1 17-17H${fw - 20}a17 17 0 0 1 17 17V${IH}Z"/></clipPath>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".5" stop-color="${C.bg}" stop-opacity="0"/><stop offset="1" stop-color="${C.bg}" stop-opacity=".75"/></linearGradient>
<g clip-path="url(#img)">
<image class="kb" href="${image}" x="3" y="3" width="${fw - 6}" height="${IH - 3}" preserveAspectRatio="xMidYMid slice"/>
<rect x="3" y="3" width="${fw - 6}" height="${IH - 3}" fill="url(#fade)"/>
</g>
<path d="M3 ${IH}H${fw - 3}" stroke="${C.ink}" stroke-width="3"/>
${event}
<text class="mono" x="${fw - PAD}" y="${IH + 42}" text-anchor="end" font-size="10.5" fill="${C.muted}">${esc(meta)}</text>
<text class="serif" x="${PAD}" y="${IH + 44}" font-size="27" letter-spacing="-.5" fill="${C.fg}">${esc(p.title)}</text>
<text class="sans" font-size="13.5" fill="${C.soft}">${lines.map((l, i) => `<tspan x="${PAD}" y="${IH + 72 + i * 20}">${esc(l)}</tspan>`).join("")}</text>
<text class="mono" x="${PAD}" y="${fh - 33.3}" font-size="10.5" fill="${C.muted}">${esc(stack)}</text>
<rect x="${f1(fw - PAD - pillW)}" y="${fh - 49}" width="${f1(pillW)}" height="24" rx="12" fill="${C.accentSoft}" stroke="${C.accentLine}"/>
<text class="mono" x="${f1(fw - PAD - pillW + 12)}" y="${fh - 33.3}" font-size="10.5" fill="${C.accent}">${esc(hostText)}</text>
${hairline(fw, fh)}`;
  const css = `
@keyframes kb{to{transform:scale(1.08)}}
.kb{transform-box:fill-box;transform-origin:center;animation:kb 22s ease-in-out infinite alternate}`;
  return svg(fw + SHADOW, fh + SHADOW, `${p.title}: ${p.desc}`, body, css);
}

function pill(label) {
  const text = `${label} ↗`;
  const fh = 40;
  const sh = 4;
  const fw = Math.ceil(measure(text, "mono", 13) + 44);
  return svg(fw + sh, fh + sh, label, `${frame(fw, fh, { r: 20, sh })}
<text class="mono" x="${fw / 2}" y="${fh / 2 + 4.5}" text-anchor="middle" font-size="13" fill="${C.fg}">${esc(text)}</text>`);
}

function readme(s, projects) {
  const img = (src, alt, size = 'width="100%"') => `<img src="${src}" ${size} alt="${esc(alt)}">`;
  const link = (href, inner) => `<a href="${esc(new URL(href, `${SITE}/`).href)}">${inner}</a>`;
  const cards = projects.map((p, i) => link(p.href, img(`out/project-${i + 1}.svg`, `${p.title}: ${p.desc}`, 'width="49%"')));
  const rows = [];
  for (let i = 0; i < cards.length; i += 2) rows.push(cards.slice(i, i + 2).join(" "));
  return `<!-- Generated by render.mjs. Edit that file, not this one. -->
<div align="center">

${link(SITE, img("out/hero.svg", "Eddy Zhao. Astrophysics & Computer Science at UC Berkeley."))}

${img("out/sky.svg", `${nf.format(s.total)} contributions in the past year. Current streak ${s.current} days, longest ${s.longest}, ${s.active} active days.`)}

${img("out/projects.svg", "Projects")}

${rows.join("\n\n")}

${LINKS.map(([label, href], i) => link(href, img(`out/link-${i + 1}.svg`, label, 'height="44"'))).join(" ")}

<sub>Redrawn every six hours from my GitHub activity and <a href="${SITE}">eddyzow.net</a>.</sub>

</div>
`;
}

// ------------------------------------------------------------------- data

const ymd = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(date);
const fmtDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function ago(iso, now) {
  const days = Math.floor((now - Date.parse(iso)) / 864e5);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

async function fetchOk(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} → ${res.status} ${await res.text()}`);
  return res;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", mdash: "—", ndash: "–", hellip: "…", eacute: "é", middot: "·" };
const decode = (s) =>
  s.replace(/&(#x?[\da-f]+|\w+);/gi, (m, e) =>
    e[0] !== "#" ? (ENTITIES[e] ?? m) : String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))),
  );

async function siteProjects() {
  const html = await (await fetchOk(SITE)).text();
  const template = html.match(/<template id="project-data">([\s\S]*?)<\/template>/)?.[1];
  if (!template) throw new Error(`no <template id="project-data"> on ${SITE}`);
  const all = [...template.matchAll(/<div\s([^>]*)>([\s\S]*?)<\/div>/g)].map(([, attrs, body]) => ({
    ...Object.fromEntries([...attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)])),
    desc: decode(body.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()),
  }));
  const projects = all.filter((p) => p.earlier !== "true" && p.title && p.href && p.image).slice(0, PROJECT_COUNT);
  if (projects.length < PROJECT_COUNT) throw new Error(`only ${projects.length} projects parsed from ${SITE}`);
  return projects;
}

async function dataUri(url) {
  const res = await fetchOk(url);
  const type = res.headers.get("content-type")?.split(";")[0] ?? "";
  if (!type.startsWith("image/")) throw new Error(`${url} is ${type || "untyped"}, not an image`);
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

// owner/name pattern is strict because it's spliced into the query
const REPO_RE = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

async function github(projects, token) {
  const sources = projects.map((p) => p.source?.match(REPO_RE));
  const aliases = sources.map((m, i) => (m ? `r${i}: repository(owner: "${m[1]}", name: "${m[2]}") { stargazerCount pushedAt }` : "")).join("\n");
  const query = `query($login: String!) {
  user(login: $login) { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date weekday contributionCount } } } } }
  ${aliases}
}`;
  const res = await fetchOk("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": LOGIN },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  const { data, errors = [] } = await res.json();
  if (!data?.user) throw new Error(`GraphQL: ${JSON.stringify(errors)}`);
  // private source repos come back NOT_FOUND; those cards just skip live stats
  for (const e of errors) console.warn(`no repo stats: ${e.message}`);
  return { calendar: data.user.contributionsCollection.contributionCalendar, repos: sources.map((_, i) => data[`r${i}`] ?? null) };
}

function calendarStats(cal, now) {
  // Brightness on a log scale against the busiest day. GitHub's own quartile
  // levels flatten everything when one day is a big outlier.
  const max = Math.max(1, ...cal.weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)));
  const level = (n) => (n ? Math.min(4, 1 + Math.floor((4 * Math.log(n)) / Math.log(max + 1))) : 0);
  const weeks = cal.weeks.map((w) =>
    w.contributionDays.map((d) => ({ date: d.date, weekday: d.weekday, count: d.contributionCount, level: level(d.contributionCount) })),
  );
  const days = weeks.flat();
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let i = days.length - 1;
  if (!days[i].count) i--; // today keeps the streak alive until it's over
  let current = 0;
  for (; i >= 0 && days[i].count; i--) current++;
  const last = days.findLast((d) => d.count)?.date;
  const today = ymd(now);
  const yesterday = ymd(new Date(now - 864e5));
  const activity = !last ? "Quiet lately" : last >= today ? "Active today" : last === yesterday ? "Active yesterday" : `Last active ${fmtDay(last)}`;
  return {
    weeks,
    days,
    total: cal.totalContributions,
    longest,
    current,
    active: days.filter((d) => d.count).length,
    best: days.reduce((a, d) => (d.count > a.count ? d : a)),
    activity,
  };
}

// ------------------------------------------------------------------- main

// node render.mjs --check: offline asserts for the logic that's easy to break
if (process.argv[2] === "--check") {
  const { strict: assert } = await import("node:assert");
  const day = (date, n) => ({ date, weekday: 0, contributionCount: n });
  const cal = { totalContributions: 9, weeks: [{ contributionDays: [day("2026-01-01", 1), day("2026-01-02", 0), day("2026-01-03", 2), day("2026-01-04", 6), day("2026-01-05", 0)] }] };
  const s = calendarStats(cal, new Date("2026-01-05T20:00:00Z"));
  assert.equal(s.current, 2, "an empty today doesn't break the streak");
  assert.equal(s.longest, 2);
  assert.equal(s.best.date, "2026-01-04");
  assert.equal(s.activity, "Active yesterday");
  assert.deepEqual(s.days.map((d) => d.level), [1, 0, 2, 4, 0]);
  const lines = wrap("one two three four five six seven", "sans", 14, 80, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith("…") && measure(lines[1], "sans", 14) <= 80);
  assert.equal(fitList("A · B · C", "mono", 10, measure("A · B", "mono", 10)), "A · B");
  const odo = odometer("1,055", 0, 50, 40, 0, "t");
  assert.equal([...odo.matchAll(/<tspan[^>]*y="50">(\d)/g)].map((m) => m[1]).join(""), "1055", "resting digits sit on the baseline");
  console.log("ok");
  process.exit(0);
}

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is not set (locally: GITHUB_TOKEN=$(gh auth token) node render.mjs)");

const now = new Date();
const projects = await siteProjects();
const [{ calendar, repos }, images] = await Promise.all([
  github(projects, token),
  Promise.all(projects.map((p) => dataUri(new URL(p.image, `${SITE}/`)))),
]);
const s = calendarStats(calendar, now);
const stamp = `${new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(now).toUpperCase()} PT`;

const files = {
  "out/hero.svg": hero(s),
  "out/sky.svg": sky(s, stamp),
  "out/projects.svg": heading("Projects"),
  ...Object.fromEntries(projects.map((p, i) => [`out/project-${i + 1}.svg`, card(p, images[i], repos[i], now)])),
  ...Object.fromEntries(LINKS.map(([label], i) => [`out/link-${i + 1}.svg`, pill(label)])),
  "README.md": readme(s, projects),
};
mkdirSync(new URL("out/", root), { recursive: true });
for (const [path, content] of Object.entries(files)) writeFileSync(new URL(path, root), content);
console.log(`rendered ${Object.keys(files).length} files: ${s.total} contributions, ${s.current}-day streak, ${projects.map((p) => p.title).join(", ")}`);
