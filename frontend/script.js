/* Patrol Planner dashboard (vanilla JS, Chart.js for charts, canvas for the map). */
"use strict";

const API = "/api";
const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/* ==========================================================================
   State
   ========================================================================== */
let campusGraph = null;
let currentStrategies = [];
let lastSolve = null;              // response of /stackelberg/solve
let coverage = {};                 // node id -> coverage probability under the SSE policy
let highlightedRoute = [];         // node ids of the route drawn on the map
let selectedStrategyId = null;
let currentAttackerTarget = null;  // node NAME the rational attacker picks
let currentAttackerProbs = {};     // node NAME -> attack probability (bounded)
let lastAttacker = null;
let lastBaselines = null;
let comparisonView = null;   // per-target coverage under each policy
let evaluationData = null;
let currentEvalTab = "rational";

const charts = {};
const POLICY = {
    fixed: { name: "Fixed schedule", long: "Fixed Schedule Patrol" },
    uniform_random: { name: "Uniform random", long: "Uniform Random Patrol" },
    game_theoretic: { name: "Game-theoretic", long: "Game-Theoretic Stackelberg Patrol" },
};
const POLICY_KEYS = ["fixed", "uniform_random", "game_theoretic"];

/* ==========================================================================
   Utilities
   ========================================================================== */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fix = (x, d = 2) => Number(x).toFixed(d);
const pct = (x, d = 1) => `${(Number(x) * 100).toFixed(d)}%`;
const signed = (x, d = 2) => (x > 0 ? "+" : "") + Number(x).toFixed(d);
const arrow = (route) => route.map(esc).join(" &rarr; ");

function fixedRouteId() {
    const v = $("fixedStrategySelect").value;
    return /^S\d+$/.test(v) ? v : undefined;
}

function readNumber(id, fallback) {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) ? v : fallback;
}

function setText(id, text) {
    const el = $(id);
    if (el.textContent === String(text)) return;
    el.textContent = text;
    if (!reducedMotion.matches) {
        el.classList.remove("bump");
        void el.offsetWidth; // restart the animation
        el.classList.add("bump");
    }
}

function toast(message, type = "info", ms = 4600) {
    const icons = { error: "ph-warning-circle", success: "ph-check-circle", info: "ph-info" };
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="ph ${icons[type] || icons.info}" aria-hidden="true"></i><span>${esc(message)}</span>`;
    $("toasts").appendChild(el);
    const remove = () => { el.classList.add("out"); setTimeout(() => el.remove(), 260); };
    setTimeout(remove, ms);
    el.addEventListener("click", remove);
}

async function api(path, options) {
    let res;
    try {
        res = await fetch(API + path, options);
    } catch (e) {
        setBackend(false);
        throw new Error("Cannot reach the backend. Start it with: uvicorn backend.main:app");
    }
    if (!res.ok) {
        let detail = "";
        try { detail = (await res.json()).detail; } catch (e) { /* non-JSON error body */ }
        throw new Error(typeof detail === "string" && detail ? detail : `Request failed (${res.status})`);
    }
    return res.json();
}
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/* Run an async action behind a button: spinner, no double submit, errors surface as a toast. */
async function guarded(btn, loadingLabel, fn) {
    if (btn.classList.contains("is-loading")) return;
    const label = btn.querySelector(".btn-label");
    const original = label.textContent;
    btn.classList.add("is-loading");
    btn.setAttribute("aria-busy", "true");
    label.textContent = loadingLabel;
    try {
        await fn();
    } catch (err) {
        console.error(err);
        toast(err.message || "Something went wrong.", "error");
    } finally {
        btn.classList.remove("is-loading");
        btn.removeAttribute("aria-busy");
        label.textContent = original;
    }
}

function show(id, visible = true) { $(id).hidden = !visible; }
function swap(emptyId, resultId, hasResult) { show(emptyId, !hasResult); show(resultId, hasResult); }

function skeletonRows(tbody, cols, rows = 4) {
    tbody.innerHTML = Array.from({ length: rows }, () =>
        `<tr>${Array.from({ length: cols }, () => `<td><span class="skeleton"></span></td>`).join("")}</tr>`).join("");
}

/* ==========================================================================
   Theme + palette (canvas and charts read their colours from the CSS tokens)
   ========================================================================== */
let P = {};
function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    P = {
        stage: g("--surface-2"), surface: g("--surface"), s3: g("--surface-3"),
        line: g("--line"), lineStrong: g("--line-strong"),
        text: g("--text"), text2: g("--text-2"), muted: g("--muted"),
        accent: g("--accent"), onAccent: g("--on-accent"), bad: g("--bad"), warn: g("--warn"), good: g("--good"),
    };
}

function currentTheme() {
    const explicit = document.documentElement.getAttribute("data-theme");
    if (explicit) return explicit;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function syncThemeIcon() {
    const dark = currentTheme() === "dark";
    $("themeToggle").innerHTML = `<i class="ph ${dark ? "ph-sun" : "ph-moon"}" aria-hidden="true"></i>`;
    $("themeToggle").setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
}

function onThemeChanged() {
    readPalette();
    syncThemeIcon();
    renderAllCharts();
    requestDraw();
}

$("themeToggle").addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("patrol-theme", next); } catch (e) { /* storage blocked */ }
    onThemeChanged();
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onThemeChanged);

/* ==========================================================================
   Backend status + pipeline
   ========================================================================== */
function setBackend(up) {
    const box = $("backendStatus");
    box.dataset.state = up ? "up" : "down";
    $("backendStatusText").textContent = up ? "Backend connected" : "Backend offline";
}

const STEPS = ["generate", "solve", "analyze", "simulate", "benchmark"];
const stepsDone = new Set();
function renderPipeline(active = null) {
    document.querySelectorAll("#pipeline li").forEach((li) => {
        const key = li.dataset.step;
        li.classList.toggle("done", stepsDone.has(key));
        li.classList.toggle("active", key === active && !stepsDone.has(key));
    });
}
function markStep(step) { stepsDone.add(step); renderPipeline(STEPS.find((s) => !stepsDone.has(s))); }

/* ==========================================================================
   Map canvas
   ========================================================================== */
const canvas = $("campusMapCanvas");
const ctx = canvas.getContext("2d");
const stage = $("mapStage");
const mapTooltip = $("mapNodeTooltip");
const FONT = "Geist, system-ui, sans-serif";
const MONO = "'Geist Mono', ui-monospace, monospace";

let vw = 0, vh = 0, dpr = 1;
let nodePos = {};      // node id -> {x, y} in CSS pixels
let hoveredNode = null;
let rafId = null;

function computeLayout() {
    nodePos = {};
    if (!campusGraph || !campusGraph.nodes.length) return;
    const xs = campusGraph.nodes.map((n) => n.x);
    const ys = campusGraph.nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const padX = Math.min(96, vw * 0.16);
    const padTop = 56, padBottom = 60;
    const availW = Math.max(1, vw - padX * 2);
    const availH = Math.max(1, vh - padTop - padBottom);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    // The graph is a schematic, so each axis scales to fill the stage (capped so wide or tall
    // stages do not stretch it absurdly). This keeps rows far enough apart for their labels.
    const sx = Math.min(availW / rangeX, 2.4);
    const sy = Math.min(availH / rangeY, 1.5);
    const ox = (vw - rangeX * sx) / 2;
    const oy = padTop + (availH - rangeY * sy) / 2;

    campusGraph.nodes.forEach((n) => {
        nodePos[n.id] = { x: ox + (n.x - minX) * sx, y: oy + (n.y - minY) * sy };
    });
}

function resizeCanvas() {
    const r = stage.getBoundingClientRect();
    vw = Math.max(1, r.width);
    vh = Math.max(1, r.height);
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    computeLayout();
    requestDraw();
}
new ResizeObserver(resizeCanvas).observe(stage);

/* The map only animates while something on it moves (a selected route or a threat ring). */
function needsAnimation() {
    return !reducedMotion.matches && (highlightedRoute.length > 1 || currentAttackerTarget !== null);
}
function requestDraw() {
    if (rafId === null) rafId = requestAnimationFrame(frame);
}
function frame(t) {
    rafId = null;
    drawGraph(t);
    if (needsAnimation()) requestDraw();
}
reducedMotion.addEventListener("change", requestDraw);

function pill(x, y, w, h, fill, stroke) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(h / 2, 8));
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

function routeSegments() {
    const pts = highlightedRoute.map((id) => nodePos[id]).filter(Boolean);
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        segs.push({ a: pts[i], b: pts[i + 1], len, start: total });
        total += len;
    }
    return { segs, total };
}

function isRouteEdge(a, b) {
    for (let i = 0; i < highlightedRoute.length - 1; i++) {
        const u = highlightedRoute[i], v = highlightedRoute[i + 1];
        if ((u === a && v === b) || (u === b && v === a)) return true;
    }
    return false;
}

function drawGraph(t = 0) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    if (!campusGraph) {
        ctx.fillStyle = P.muted;
        ctx.font = `500 13px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Loading campus graph", vw / 2, vh / 2);
        return;
    }
    const animate = needsAnimation();

    /* Edges */
    campusGraph.edges.forEach((edge) => {
        const a = nodePos[edge.source], b = nodePos[edge.destination];
        if (!a || !b) return;
        const onRoute = isRouteEdge(edge.source, edge.destination);

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineCap = "round";
        ctx.strokeStyle = onRoute ? P.accent : P.lineStrong;
        ctx.lineWidth = onRoute ? 3 : 1.5;
        ctx.stroke();

        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const label = `${edge.travel_time}m`;
        ctx.font = `500 11px ${MONO}`;
        const w = ctx.measureText(label).width + 14;
        pill(mx - w / 2, my - 10, w, 20, P.surface, onRoute ? P.accent : P.line);
        ctx.fillStyle = onRoute ? P.accent : P.text2;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, mx, my + 0.5);
    });

    /* Patrol token travelling the selected route */
    if (highlightedRoute.length > 1) {
        const { segs, total } = routeSegments();
        if (segs.length) {
            let d = animate ? ((t / 1000) * 110) % (total + 50) : total;
            d = Math.min(d, total);
            const seg = segs.find((s) => d <= s.start + s.len) || segs[segs.length - 1];
            const k = seg.len ? (d - seg.start) / seg.len : 0;
            const px = seg.a.x + (seg.b.x - seg.a.x) * k;
            const py = seg.a.y + (seg.b.y - seg.a.y) * k;
            ctx.globalAlpha = 0.22;
            ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fillStyle = P.accent; ctx.fill();
            ctx.globalAlpha = 1;
            ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fillStyle = P.accent; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = P.surface; ctx.stroke();
        }
    }

    /* Nodes */
    campusGraph.nodes.forEach((node) => {
        const p = nodePos[node.id];
        if (!p) return;
        const onRoute = highlightedRoute.includes(node.id);
        const isThreat = currentAttackerTarget === node.name;
        const isHover = hoveredNode && hoveredNode.id === node.id;
        const r = isHover ? 18 : 16;
        const cov = coverage[node.id];

        /* Coverage ring: share of patrols that pass through this checkpoint */
        if (cov !== undefined) {
            ctx.beginPath(); ctx.arc(p.x, p.y, 24, 0, Math.PI * 2);
            ctx.strokeStyle = P.line; ctx.lineWidth = 3; ctx.stroke();
            if (cov > 0.001) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, cov));
                ctx.strokeStyle = P.accent; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.stroke();
            }
        }

        /* Intruder target ring */
        if (isThreat) {
            ctx.save();
            ctx.beginPath(); ctx.arc(p.x, p.y, 32, 0, Math.PI * 2);
            ctx.setLineDash([6, 6]);
            ctx.lineDashOffset = animate ? -t / 45 : 0;
            ctx.strokeStyle = P.bad; ctx.lineWidth = 2; ctx.stroke();
            ctx.restore();
        }

        /* Body */
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isThreat ? P.bad : onRoute ? P.accent : P.s3;
        ctx.fill();
        const prob = currentAttackerProbs[node.name];
        if (!isThreat && !onRoute && prob > 0.05) {
            ctx.globalAlpha = Math.min(0.9, Math.max(0.3, prob * 1.8));
            ctx.fillStyle = P.bad; ctx.fill();
            ctx.globalAlpha = 1;
        }
        ctx.lineWidth = isHover ? 3 : 2;
        ctx.strokeStyle = isThreat ? P.bad : onRoute ? P.accent : P.lineStrong;
        ctx.stroke();

        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = isThreat || onRoute ? P.onAccent : P.muted;
        ctx.fill();

        /* Name label */
        ctx.font = `600 12px ${FONT}`;
        const nameW = ctx.measureText(node.name).width + 18;
        pill(p.x - nameW / 2, p.y - 52, nameW, 22, P.surface, P.line);
        ctx.fillStyle = P.text;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(node.name, p.x, p.y - 40.5);

        /* Value + coverage label */
        const vText = `V${node.target_value}`;
        const cText = cov !== undefined ? pct(cov, 0) : "";
        ctx.font = `600 11px ${MONO}`;
        const vW = ctx.measureText(vText).width;
        const cW = cText ? ctx.measureText(cText).width : 0;
        const gap = cText ? 8 : 0;
        const totalW = vW + cW + gap + 16;
        const top = p.y + 31;
        pill(p.x - totalW / 2, top, totalW, 20, P.surface, P.line);
        ctx.textAlign = "left";
        ctx.fillStyle = node.target_value >= 8 ? P.warn : P.text2;
        ctx.fillText(vText, p.x - totalW / 2 + 8, top + 10.5);
        if (cText) {
            ctx.fillStyle = P.accent;
            ctx.fillText(cText, p.x - totalW / 2 + 8 + vW + gap, top + 10.5);
        }
    });
}

/* Hover / touch tooltip */
function nodeAt(x, y) {
    if (!campusGraph) return null;
    let best = null, bestD = 30;
    campusGraph.nodes.forEach((n) => {
        const p = nodePos[n.id];
        if (!p) return;
        const d = Math.hypot(x - p.x, y - p.y);
        if (d < bestD) { best = n; bestD = d; }
    });
    return best;
}

function updateTooltip(e) {
    const rect = canvas.getBoundingClientRect();
    const node = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    const changed = (node && node.id) !== (hoveredNode && hoveredNode.id);
    hoveredNode = node;
    canvas.style.cursor = node ? "pointer" : "default";

    if (!node) {
        mapTooltip.classList.remove("visible");
        if (changed) requestDraw();
        return;
    }
    const p = nodePos[node.id];
    $("tooltipTitle").textContent = node.name;
    const cov = coverage[node.id];
    $("tooltipValue").textContent = `Value ${node.target_value} of 10` + (cov !== undefined ? `, covered ${pct(cov)}` : "");

    const status = $("tooltipStatus");
    const prob = currentAttackerProbs[node.name];
    if (currentAttackerTarget === node.name) {
        status.textContent = "Intruder's best response"; status.style.color = P.bad;
    } else if (prob !== undefined) {
        status.textContent = `Attack probability ${pct(prob)}`; status.style.color = prob > 0.15 ? P.bad : P.warn;
    } else if (highlightedRoute.includes(node.id)) {
        status.textContent = "On the selected route"; status.style.color = P.accent;
    } else {
        status.textContent = "Not on the selected route"; status.style.color = P.muted;
    }
    mapTooltip.style.left = `${Math.min(Math.max(p.x, 90), vw - 90)}px`;
    mapTooltip.style.top = `${p.y}px`;
    mapTooltip.classList.add("visible");
    if (changed) requestDraw();
}
canvas.addEventListener("pointermove", updateTooltip);
canvas.addEventListener("pointerdown", updateTooltip);
canvas.addEventListener("pointerleave", () => {
    hoveredNode = null;
    mapTooltip.classList.remove("visible");
    requestDraw();
});

/* ==========================================================================
   Charts
   ========================================================================== */
function chartDefaults() {
    if (typeof Chart === "undefined") return false;
    Chart.defaults.color = P.muted;
    Chart.defaults.font.family = FONT;
    Chart.defaults.font.size = 12;
    Chart.defaults.animation = reducedMotion.matches ? false : { duration: 600, easing: "easeOutQuart" };
    return true;
}

function chartOptions({ max, legend = false, percent = false } = {}) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
            y: {
                beginAtZero: true, max,
                border: { display: false },
                grid: { color: P.line },
                ticks: { color: P.muted, callback: percent ? (v) => `${v}%` : undefined },
            },
            x: { grid: { display: false }, border: { color: P.lineStrong }, ticks: { color: P.muted, maxRotation: 0, autoSkip: false } },
        },
        plugins: {
            legend: { display: legend, labels: { color: P.text2, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "rectRounded" } },
            tooltip: {
                backgroundColor: P.surface, borderColor: P.lineStrong, borderWidth: 1,
                titleColor: P.text, bodyColor: P.text2, padding: 10, cornerRadius: 8, boxPadding: 4,
            },
        },
    };
}

function makeChart(key, canvasId, config) {
    if (!chartDefaults()) return;
    if (charts[key]) charts[key].destroy();
    charts[key] = new Chart($(canvasId).getContext("2d"), config);
}

function renderStackelbergChart() {
    if (!lastSolve) return;
    const rows = currentStrategies
        .map((s, i) => ({ id: `S${i + 1}`, p: lastSolve.probabilities[i] || 0 }))
        .filter((r) => r.p > 1e-6)
        .sort((a, b) => b.p - a.p);
    makeChart("stack", "stackelbergChart", {
        type: "bar",
        data: { labels: rows.map((r) => r.id), datasets: [{ label: "Probability (%)", data: rows.map((r) => +(r.p * 100).toFixed(2)), backgroundColor: P.accent, borderRadius: 4, maxBarThickness: 44 }] },
        options: chartOptions({ percent: true }),
    });
}

function renderAttackerChart() {
    if (!lastAttacker) return;
    const { labels, data, type } = lastAttacker;
    const top = Math.max(...data);
    const colors = type === "rational"
        ? data.map((v) => (v === top ? P.bad : P.lineStrong))
        : data.map((v) => { const a = Math.round(Math.min(1, Math.max(0.25, v * 1.5)) * 255).toString(16).padStart(2, "0"); return P.bad.length === 7 ? P.bad + a : P.bad; });
    makeChart("attacker", "attackerChart", {
        type: "bar",
        data: { labels: labels.map((l) => l.split(" ")), datasets: [{ label: type === "rational" ? "Expected utility" : "Attack probability", data, backgroundColor: colors, borderRadius: 4, maxBarThickness: 44 }] },
        options: chartOptions(),
    });
}

function renderBaselineChart() {
    if (!comparisonView) return;
    const { nodes, cov } = comparisonView;
    const series = (policy, color) => ({
        label: POLICY[policy].name, backgroundColor: color, borderRadius: 3, maxBarThickness: 22,
        data: nodes.map((n) => +(cov[policy][n.id] * 100).toFixed(1)),
    });
    makeChart("baseline", "baselineChart", {
        type: "bar",
        data: { labels: nodes.map((n) => n.name.split(" ")), datasets: [series("fixed", P.bad), series("uniform_random", P.warn), series("game_theoretic", P.accent)] },
        options: chartOptions({ legend: true, max: 100, percent: true }),
    });
}

function renderEvalCharts() {
    const tab = evalTab();
    if (!tab) return;
    const colors = [P.bad, P.warn, P.accent];
    const labels = POLICY_KEYS.map((k) => POLICY[k].name);
    const col = (fn) => POLICY_KEYS.map((k) => fn(tab.data[k]));
    const bar = (key, id, label, data, opts) => makeChart(key, id, {
        type: "bar",
        data: { labels, datasets: [{ label, data, backgroundColor: colors, borderRadius: 4, maxBarThickness: 64 }] },
        options: chartOptions(opts),
    });
    bar("det", "chartDetection", "Detection (%)", col((m) => +(m.detection_probability * 100).toFixed(2)), { max: 100, percent: true });
    bar("succ", "chartSuccess", "Attack success (%)", col((m) => +(m.attack_success_rate * 100).toFixed(2)), { max: 100, percent: true });
    bar("util", "chartDefenderUtility", "Defender payoff", col((m) => +m.defender_utility.toFixed(3)));
    bar("ent", "chartUnpredictability", "Normalized entropy", col((m) => +m.unpredictability.toFixed(3)), { max: 1 });
}

function renderAllCharts() {
    renderStackelbergChart();
    renderAttackerChart();
    renderBaselineChart();
    renderEvalCharts();
}

/* ==========================================================================
   Route selection
   ========================================================================== */
function strategyRow(strat, cells) {
    const tr = document.createElement("tr");
    tr.dataset.selectable = "";
    tr.dataset.id = strat.strategy_id;
    tr.tabIndex = 0;
    tr.innerHTML = cells;
    const pick = () => selectStrategy(strat);
    tr.addEventListener("click", pick);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    return tr;
}

function selectStrategy(strat) {
    selectedStrategyId = strat.strategy_id;
    document.querySelectorAll("tr[data-selectable]").forEach((r) => r.classList.toggle("active-row", Number(r.dataset.id) === strat.strategy_id));
    highlightedRoute = strat.route_ids || strat.route;
    const chip = $("hudActiveRoute");
    chip.textContent = `S${strat.strategy_id}: ${strat.route.join(" → ")}`;
    chip.classList.add("on");
    requestDraw();
}

function clearSelection() {
    selectedStrategyId = null;
    highlightedRoute = [];
    $("hudActiveRoute").textContent = "No route selected";
    $("hudActiveRoute").classList.remove("on");
    document.querySelectorAll("tr.active-row").forEach((r) => r.classList.remove("active-row"));
}

/* ==========================================================================
   Step 1-2: routes and equilibrium
   ========================================================================== */
async function generateStrategies() {
    const shift = readNumber("shiftDuration", 30);
    const maxCp = Math.floor(readNumber("maxCheckpoints", 5));
    if (shift <= 0) throw new Error("Shift duration must be greater than zero.");
    if (maxCp < 1) throw new Error("A route needs at least one checkpoint.");

    clearDownstream();
    clearSelection();
    renderPipeline("generate");
    show("strategyEmpty", false);
    show("strategyResult", true);
    skeletonRows($("strategyTableBody"), 4, 5);

    $("statShift").textContent = `${shift} min`;
    let data;
    try {
        data = await post("/strategies/generate", { patrol_units: 1, shift_duration: shift, max_checkpoints: maxCp });
    } catch (err) {
        swap("strategyEmpty", "strategyResult", false);
        throw err;
    }
    currentStrategies = data.strategies || [];

    if (!currentStrategies.length) {
        swap("strategyEmpty", "strategyResult", false);
        $("strategyEmpty").querySelector("p").innerHTML = "<strong>No feasible routes</strong>No route fits inside this shift length. Increase the shift duration.";
        throw new Error("No feasible routes within these limits.");
    }

    $("strategyCount").textContent = currentStrategies.length;
    const tbody = $("strategyTableBody");
    tbody.innerHTML = "";
    currentStrategies.forEach((s) => {
        tbody.appendChild(strategyRow(s, `
            <td class="id-cell">S${s.strategy_id}</td>
            <td>${arrow(s.route)}</td>
            <td class="num">${s.total_travel_time}m</td>
            <td class="num">${s.covered_targets.length}</td>`));
    });

    const sel = $("fixedStrategySelect");
    sel.disabled = false;
    sel.innerHTML = currentStrategies.map((s, i) => `<option value="S${i + 1}">S${i + 1}: ${esc(s.route.join(" → "))}</option>`).join("");

    markStep("generate");
    await solveEquilibrium();
}

async function solveEquilibrium() {
    if (!currentStrategies.length) throw new Error("Generate routes first.");
    renderPipeline("solve");
    show("stackEmpty", false);
    show("stackelbergResultsContainer", true);
    skeletonRows($("stackelbergTableBody"), 3, 4);

    const data = await post("/stackelberg/solve", {
        game_config: { patrol_units: 1, shift_duration: readNumber("shiftDuration", 30), graph: campusGraph },
        num_simulations: 1,
        attacker_config: { type: "rational", lambda_val: 1.0 },
        strategy_probabilities: {},
        strategies: currentStrategies.map((s) => s.route_ids || s.route),
    });
    lastSolve = data;
    coverage = data.target_coverage || {};
    renderStackelberg();
    markStep("solve");
    $("btnSamplePatrol").disabled = false;
    await fetchBaselines();
    requestDraw();
}

function renderStackelberg() {
    const d = lastSolve;
    setText("stackDefenderUtility", fix(d.defender_utility));
    setText("stackAttackerUtility", fix(d.attacker_utility));
    const best = campusGraph.nodes.find((n) => n.id === d.attacker_best_response);
    setText("stackBestResponse", best ? best.name : d.attacker_best_response || "-");

    const rows = currentStrategies.map((s, i) => ({ s, p: d.probabilities[i] || 0 })).sort((a, b) => b.p - a.p);
    const tbody = $("stackelbergTableBody");
    tbody.innerHTML = "";
    rows.forEach(({ s, p }) => {
        const tr = strategyRow(s, `
            <td class="id-cell">S${s.strategy_id}</td>
            <td>${arrow(s.route)}</td>
            <td class="num ${p > 1e-6 ? "c-good" : ""}" style="${p > 1e-6 ? "" : "color:var(--muted)"}">${pct(p)}</td>`);
        tbody.appendChild(tr);
    });
    if (selectedStrategyId) document.querySelectorAll(`tr[data-id="${selectedStrategyId}"]`).forEach((r) => r.classList.add("active-row"));
    renderStackelbergChart();
}

async function samplePatrol() {
    if (!lastSolve) throw new Error("Solve the equilibrium first.");
    const res = await post("/policy/sample", { policy_type: "game_theoretic" });
    const idx = parseInt(String(res.selected_strategy).slice(1), 10) - 1;
    const strat = currentStrategies[idx];
    if (!strat) throw new Error("The sampled route is out of date. Generate routes again.");
    selectStrategy(strat);
    toast(`Sampled ${res.selected_strategy}, chosen with probability ${pct(lastSolve.probabilities[idx] || 0)}.`, "info");
}

/* ==========================================================================
   Step 3: attacker
   ========================================================================== */
const radioRational = $("radioLabelRational");
const radioBounded = $("radioLabelBounded");
document.getElementsByName("attackerType").forEach((radio) => {
    radio.addEventListener("change", (e) => {
        const bounded = e.target.value === "bounded";
        radioBounded.classList.toggle("active", bounded);
        radioRational.classList.toggle("active", !bounded);
        show("lambdaInputGroup", bounded);
        $("attackerExplanation").textContent = bounded
            ? "The intruder picks targets at random, weighted by expected utility through a softmax. Higher λ means closer to rational."
            : "The intruder evaluates the patrol's coverage and attacks the checkpoint with the highest expected utility.";
    });
});
$("lambdaVal").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    $("lambdaDisplay").textContent = Number.isFinite(v) ? v.toFixed(1) : "-";
});

async function analyzeAttacker() {
    if (!currentStrategies.length) throw new Error("Generate routes first.");
    renderPipeline("analyze");
    const type = document.querySelector('input[name="attackerType"]:checked').value;
    const lambda = readNumber("lambdaVal", 1.0);
    if (type === "bounded" && lambda <= 0) throw new Error("Lambda must be greater than zero.");
    const data = await post("/attacker/evaluate", { attacker_type: type, lambda });
    renderAttacker(data);
    markStep("analyze");
}

function renderAttacker(data) {
    swap("attackerEmpty", "attackerResultsSection", true);
    const tbody = $("attackerTableBody");
    tbody.innerHTML = "";
    currentAttackerTarget = null;
    currentAttackerProbs = {};
    const labels = [], values = [];

    if (data.attacker_type === "rational") {
        show("rationalResults", true);
        setText("bestResponseTarget", data.best_response);
        setText("bestResponseUtility", fix(data.best_response_utility));
        $("attackerTableMetricHeader").textContent = "Expected utility";
        currentAttackerTarget = data.best_response;
        Object.entries(data.target_utilities).forEach(([name, u]) => {
            labels.push(name); values.push(u);
            tbody.insertAdjacentHTML("beforeend", `<tr><td>${esc(name)}</td><td class="num ${name === data.best_response ? "c-bad" : ""}">${signed(u)}</td></tr>`);
        });
        lastAttacker = { labels, data: values, type: "rational" };
    } else {
        show("rationalResults", false);
        $("attackerTableMetricHeader").textContent = "Attack probability";
        currentAttackerProbs = data.target_probabilities;
        Object.entries(data.target_probabilities).forEach(([name, p]) => {
            labels.push(name); values.push(p);
            tbody.insertAdjacentHTML("beforeend", `<tr><td>${esc(name)}</td><td class="num">${pct(p)}</td></tr>`);
        });
        lastAttacker = { labels, data: values, type: "bounded" };
    }
    renderAttackerChart();
    requestDraw();
}

/* ==========================================================================
   Baselines
   ========================================================================== */
$("fixedStrategySelect").addEventListener("change", () => fetchBaselines().catch((e) => toast(e.message, "error")));

async function fetchBaselines() {
    if (!currentStrategies.length) return;
    const fixedId = $("fixedStrategySelect").value;
    lastBaselines = await api(fixedId ? `/baselines?fixed_id=${encodeURIComponent(fixedId)}` : "/baselines");
    renderBaselines();
}

/* What the attacker actually observes: the share of patrols that pass through each target. */
function policyCoverage(probs) {
    const cov = {};
    campusGraph.nodes.forEach((n) => { cov[n.id] = 0; });
    currentStrategies.forEach((s, i) => {
        const p = probs[`S${i + 1}`] || 0;
        (s.route_ids || []).forEach((id) => { if (id in cov) cov[id] += p; });
    });
    return cov;
}

function renderBaselines() {
    const data = lastBaselines;
    if (!data || !data.fixed || !data.fixed.probabilities) return;
    swap("comparisonEmpty", "comparisonResult", true);

    const cov = {
        fixed: policyCoverage(data.fixed.probabilities),
        uniform_random: policyCoverage(data.uniform_random.probabilities),
        game_theoretic: policyCoverage(data.game_theoretic.probabilities),
    };
    const nodes = campusGraph.nodes.slice().sort((a, b) => b.target_value - a.target_value);
    comparisonView = { nodes, cov };

    const tbody = $("baselineTableBody");
    tbody.innerHTML = "";
    nodes.forEach((n) => {
        const cell = (k) => `<td class="num">${pct(cov[k][n.id], 0)}</td>`;
        tbody.insertAdjacentHTML("beforeend",
            `<tr><td>${esc(n.name)}</td><td class="num">${n.target_value}</td>${cell("fixed")}${cell("uniform_random")}${cell("game_theoretic")}</tr>`);
    });
    renderBaselineChart();
}

/* ==========================================================================
   Step 4: simulation
   ========================================================================== */
async function runSimulation() {
    if (!currentStrategies.length) throw new Error("Generate routes first.");
    renderPipeline("simulate");
    const rounds = Math.floor(readNumber("simRounds", 1000));
    if (rounds < 1) throw new Error("Rounds must be at least 1.");
    const data = await post("/simulation/run", {
        rounds,
        patrol_policy: $("simPolicy").value,
        attacker_type: $("simAttackerType").value,
        lambda: readNumber("lambdaVal", 1.0),
        random_seed: Math.floor(readNumber("simSeed", 42)),
        fixed_id: fixedRouteId(),
    });
    renderSimulation(data);
    markStep("simulate");
}

function renderSimulation(d) {
    swap("simEmpty", "simResult", true);
    setText("simTotalRounds", d.rounds.toLocaleString());
    setText("simDetected", d.detected_attacks.toLocaleString());
    setText("simSuccessful", d.successful_attacks.toLocaleString());
    setText("simDetectionProb", pct(d.detection_probability));
    setText("simDefUtil", signed(d.average_defender_utility));
    setText("simAttUtil", signed(d.average_attacker_utility));

    const split = $("simSplit").children;
    split[0].style.flex = `${d.detection_probability} 1 0`;
    split[1].style.flex = `${1 - d.detection_probability} 1 0`;

    const tbody = $("simLogTableBody");
    tbody.innerHTML = "";
    (d.recent_log || []).forEach((e) => {
        const idx = parseInt(String(e.patrol_strategy).slice(1), 10) - 1;
        const strat = currentStrategies[idx];
        const badge = e.detected ? `<span class="badge badge-good">Intercepted</span>` : `<span class="badge badge-bad">Breached</span>`;
        const cells = `
            <td class="mono">#${e.round}</td>
            <td class="id-cell">${esc(e.patrol_strategy)}</td>
            <td>${esc(e.attacker_target)}</td>
            <td>${badge}</td>
            <td class="num">${signed(e.defender_utility, 0)}</td>`;
        if (strat) {
            tbody.appendChild(strategyRow(strat, cells));
        } else {
            tbody.insertAdjacentHTML("beforeend", `<tr>${cells}</tr>`);
        }
    });
}

/* ==========================================================================
   Step 5: benchmark + insights
   ========================================================================== */
function evalTab() {
    if (!evaluationData) return null;
    const rational = currentEvalTab === "rational";
    return {
        data: rational ? evaluationData.rational_attacker : evaluationData.bounded_rational_attacker,
        summary: rational ? evaluationData.rational_summary : evaluationData.bounded_summary,
    };
}

function switchEvalTab(tab) {
    currentEvalTab = tab;
    const rational = tab === "rational";
    $("tabRationalBtn").classList.toggle("active", rational);
    $("tabBoundedBtn").classList.toggle("active", !rational);
    $("tabRationalBtn").setAttribute("aria-selected", rational);
    $("tabBoundedBtn").setAttribute("aria-selected", !rational);
    if (evaluationData) renderEvaluation();
}

async function runBenchmark() {
    if (!currentStrategies.length) throw new Error("Generate routes first.");
    renderPipeline("benchmark");
    const rounds = Math.floor(readNumber("evalRounds", 1000));
    const experiments = Math.floor(readNumber("evalExperiments", 10));
    const lambda = readNumber("evalLambda", 1.0);
    if (rounds < 1 || experiments < 1) throw new Error("Rounds and trials must be at least 1.");
    if (lambda <= 0) throw new Error("Lambda must be greater than zero.");
    evaluationData = await post("/evaluation/compare", { rounds, experiments, lambda, random_seed: Math.floor(readNumber("evalSeed", 42)), fixed_id: fixedRouteId() });
    swap("evalEmpty", "evalResultsContainer", true);
    renderEvaluation();
    markStep("benchmark");
}

function renderEvaluation() {
    const tab = evalTab();
    if (!tab) return;
    const { data, summary } = tab;
    const best = summary.best_strategy;

    setText("indBestDetection", best.best_detection);
    setText("indBestDetectionVal", `${pct(best.best_detection_val)} of attacks intercepted`);
    setText("indBestUtility", best.best_defender_utility);
    setText("indBestUtilityVal", `payoff ${signed(best.best_defender_utility_val)}`);
    setText("indMostUnpredictable", best.most_unpredictable);
    setText("indMostUnpredictableVal", `entropy ${fix(best.most_unpredictable_val)}`);

    const tbody = $("evalTableBody");
    tbody.innerHTML = "";
    const tone = { fixed: "bad", uniform_random: "warn", game_theoretic: "good" };
    POLICY_KEYS.forEach((k) => {
        const m = data[k];
        if (!m) return;
        tbody.insertAdjacentHTML("beforeend", `
            <tr>
                <td class="c-${tone[k]}" style="font-weight:600">${POLICY[k].name}</td>
                <td class="num">${pct(m.detection_probability)} <span class="ci">[${fix(m.confidence_interval_lower * 100)}, ${fix(m.confidence_interval_upper * 100)}]</span></td>
                <td class="num">${pct(m.attack_success_rate)}</td>
                <td class="num">${signed(m.defender_utility)}</td>
                <td class="num">${signed(m.attacker_utility)}</td>
                <td class="num">${fix(m.unpredictability)}</td>
            </tr>`);
    });

    $("evalExplanation").textContent = summary.explanation;
    renderEvalCharts();
    renderInsights(data, summary);
}

/* The recommendation follows the game's own objective, expected defender payoff,
   and every number quoted below comes from the benchmark that was just run. */
function renderInsights(data, summary) {
    const rational = currentEvalTab === "rational";
    const ranked = POLICY_KEYS.slice().sort((a, b) => data[b].defender_utility - data[a].defender_utility);
    const winner = ranked[0], runnerUp = ranked[1];
    const lowestBreach = Math.min(...POLICY_KEYS.map((k) => data[k].attack_success_rate));
    const best = summary.best_strategy;

    $("insightTextDetection").innerHTML = `Highest detection: <strong>${esc(best.best_detection)}</strong> at ${pct(best.best_detection_val)}.`;
    $("insightTextSuccess").innerHTML = `Lowest breach rate: <strong>${pct(lowestBreach)}</strong>, which is ${pct(1 - lowestBreach)} detection.`;
    $("insightTextUnpred").innerHTML = `Most unpredictable: <strong>${esc(best.most_unpredictable)}</strong> (normalized entropy ${fix(best.most_unpredictable_val)}).`;

    swap("recEmpty", "recResult", true);
    show("recBadge", true);
    $("recStrategyTitle").textContent = POLICY[winner].long;
    $("recStrategyText").textContent =
        `Highest expected defender payoff against the ${rational ? "rational" : "bounded-rational"} attacker: ${signed(data[winner].defender_utility)}, ` +
        `with ${pct(data[winner].detection_probability)} of attacks intercepted. ` +
        `Next best is ${POLICY[runnerUp].name.toLowerCase()} at ${signed(data[runnerUp].defender_utility)}.`;

    const items = [];
    if (winner === "game_theoretic") {
        const used = lastSolve ? lastSolve.probabilities.filter((p) => p > 1e-6).length : null;
        items.push(`<li><b>Targeted coverage.</b> Probability concentrates on ${used !== null ? `${used} of ${currentStrategies.length} routes` : "a few routes"} that guard the targets an attacker would otherwise prefer.</li>`);
        items.push(`<li><b>Less random than uniform.</b> Normalized entropy is ${fix(data.game_theoretic.unpredictability)} against ${fix(data.uniform_random.unpredictability)}, so the schedule is harder to guess only where it matters.</li>`);
        const r = evaluationData.rational_attacker.game_theoretic.defender_utility;
        const b = evaluationData.bounded_rational_attacker.game_theoretic.defender_utility;
        items.push(`<li><b>Attacker model matters.</b> Payoff is ${signed(r)} against a rational attacker and ${signed(b)} against a bounded-rational one with λ=${fix(readNumber("evalLambda", 1), 1)}.</li>`);
    } else if (winner === "uniform_random") {
        items.push(`<li><b>Maximum entropy.</b> Every route is equally likely, so the schedule cannot be predicted.</li>`);
        items.push(`<li><b>No prioritization.</b> Low-value corridors get the same attention as the most valuable targets.</li>`);
    } else {
        items.push(`<li><b>Predictable.</b> The fixed route won in this setup, but an attacker who observes it can always avoid it.</li>`);
    }
    $("recTradeoffsBox").innerHTML = `<h4>Trade-offs</h4><ul>${items.join("")}</ul>`;
}

/* ==========================================================================
   Reset / refresh / full pipeline
   ========================================================================== */
function clearDownstream() {
    currentAttackerTarget = null;
    currentAttackerProbs = {};
    lastAttacker = null;
    lastBaselines = null;
    comparisonView = null;
    lastSolve = null;
    coverage = {};
    evaluationData = null;
    ["stack", "attacker", "baseline", "det", "succ", "util", "ent"].forEach((k) => { if (charts[k]) { charts[k].destroy(); delete charts[k]; } });

    swap("stackEmpty", "stackelbergResultsContainer", false);
    swap("attackerEmpty", "attackerResultsSection", false);
    swap("comparisonEmpty", "comparisonResult", false);
    swap("simEmpty", "simResult", false);
    swap("evalEmpty", "evalResultsContainer", false);
    swap("recEmpty", "recResult", false);
    show("recBadge", false);
    $("btnSamplePatrol").disabled = true;

    $("insightTextDetection").textContent = "Run the benchmark to see which policy detects the most attacks.";
    $("insightTextSuccess").textContent = "Run the benchmark to see breach rates.";
    $("insightTextUnpred").textContent = "Run the benchmark to see policy entropy.";

    ["analyze", "simulate", "benchmark", "solve"].forEach((s) => stepsDone.delete(s));
    renderPipeline("generate");
    requestDraw();
}

async function runFullPipeline() {
    await generateStrategies();
    await analyzeAttacker();
    await runSimulation();
    await runBenchmark();
    $("insightsSection").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
    toast("Pipeline finished. The recommendation is at the bottom of the page.", "success");
}

async function refreshState() {
    const data = await api("/dashboard/summary");
    if (!data.has_generated_state) {
        toast("The backend has no solved game yet. Generate routes first.", "info");
        return;
    }
    await fetchBaselines();
    if (evaluationData) renderEvaluation();
    toast("State refreshed from the backend.", "success", 2800);
}

let resetTimer = null;
async function resetDashboard() {
    const btn = $("btnResetDashboard");
    const label = btn.querySelector(".btn-label");
    if (!btn.classList.contains("confirming")) {
        btn.classList.add("confirming");
        label.textContent = "Click again to reset";
        resetTimer = setTimeout(() => { btn.classList.remove("confirming"); label.textContent = "Reset"; }, 3200);
        return;
    }
    clearTimeout(resetTimer);
    btn.classList.remove("confirming");
    label.textContent = "Reset";
    await api("/dashboard/reset", { method: "POST" });
    currentStrategies = [];
    clearSelection();
    clearDownstream();
    swap("strategyEmpty", "strategyResult", false);
    $("strategyEmpty").querySelector("p").innerHTML = "<strong>No routes yet</strong>Set the shift length and generate the feasible routes. Solving starts automatically.";
    $("fixedStrategySelect").innerHTML = "<option>Generate routes first</option>";
    $("fixedStrategySelect").disabled = true;
    stepsDone.clear();
    renderPipeline("generate");
    toast("Console reset.", "info", 2400);
}

/* ==========================================================================
   Wiring
   ========================================================================== */
$("btnGenerate").addEventListener("click", (e) => guarded(e.currentTarget, "Generating", generateStrategies));
$("btnRunStackelberg").addEventListener("click", (e) => guarded(e.currentTarget, "Solving", async () => {
    if (!currentStrategies.length) throw new Error("Generate routes first.");
    await solveEquilibrium();
}));
$("btnAnalyzeAttacker").addEventListener("click", (e) => guarded(e.currentTarget, "Analyzing", analyzeAttacker));
$("btnRunSim").addEventListener("click", (e) => guarded(e.currentTarget, "Simulating", runSimulation));
$("btnRunEvaluation").addEventListener("click", (e) => guarded(e.currentTarget, "Benchmarking", runBenchmark));
$("btnRunFullEval").addEventListener("click", (e) => guarded(e.currentTarget, "Running", runFullPipeline));
$("btnRefreshResults").addEventListener("click", (e) => guarded(e.currentTarget, "Refreshing", refreshState));
$("btnSamplePatrol").addEventListener("click", (e) => guarded(e.currentTarget, "Sampling", samplePatrol));
$("btnResetDashboard").addEventListener("click", () => resetDashboard().catch((err) => toast(err.message, "error")));
$("tabRationalBtn").addEventListener("click", () => switchEvalTab("rational"));
$("tabBoundedBtn").addEventListener("click", () => switchEvalTab("bounded"));

/* Sidebar: highlight the section in view. Anchors scroll natively (smooth via CSS). */
(function initNav() {
    const links = document.querySelectorAll(".rail-links a[data-section]");
    const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            links.forEach((l) => l.classList.toggle("active", l.dataset.section === entry.target.id));
        });
    }, { rootMargin: "-20% 0px -60% 0px", threshold: 0 });
    links.forEach((l) => { const el = $(l.dataset.section); if (el) io.observe(el); });
})();

/* Reveal panels as they scroll into view (state transition, not decoration). */
(function initReveal() {
    const items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) { items.forEach((el) => el.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const siblings = Array.from(entry.target.parentElement.children).filter((c) => c.classList.contains("reveal"));
            entry.target.style.setProperty("--i", siblings.indexOf(entry.target));
            entry.target.classList.add("in");
            io.unobserve(entry.target);
        });
    }, { threshold: 0.08 });
    items.forEach((el) => io.observe(el));
})();

/* ==========================================================================
   Init
   ========================================================================== */
async function init() {
    readPalette();
    syncThemeIcon();
    renderPipeline("generate");
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(requestDraw);
    try {
        campusGraph = await api("/campus");
        setBackend(true);
        $("statLocations").textContent = campusGraph.nodes.length;
        $("statRoutes").textContent = campusGraph.edges.length;
        const top = campusGraph.nodes.reduce((m, n) => (n.target_value > m.target_value ? n : m), campusGraph.nodes[0]);
        $("statHighestValue").textContent = `${top.name} (${top.target_value})`;
        computeLayout();
        requestDraw();
    } catch (err) {
        setBackend(false);
        toast(err.message, "error", 9000);
    }
}
init();
