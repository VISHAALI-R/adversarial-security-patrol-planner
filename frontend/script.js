const API_BASE_URL = "http://localhost:8000/api";

let campusGraph = null;
let currentStrategies = [];
let highlightedRoute = [];
let currentAttackerTarget = null;
let currentAttackerProbs = {};

let attackerChart = null;
let baselineChart = null;
let stackelbergChartInstance = null;

let evaluationData = null;
let currentEvalTab = "rational"; // "rational" or "bounded"

let chartDetectionInstance = null;
let chartSuccessInstance = null;
let chartDefenderUtilityInstance = null;
let chartUnpredictabilityInstance = null;

const canvas = document.getElementById("campusMapCanvas");
const ctx = canvas.getContext("2d");
const mapTooltip = document.getElementById("mapNodeTooltip");
const tooltipTitle = document.getElementById("tooltipTitle");
const tooltipValue = document.getElementById("tooltipValue");
const tooltipStatus = document.getElementById("tooltipStatus");
const hudActiveRoute = document.getElementById("hudActiveRoute");

const btnGenerate = document.getElementById("btnGenerate");
const btnRunStackelberg = document.getElementById("btnRunStackelberg");
const btnAnalyzeAttacker = document.getElementById("btnAnalyzeAttacker");
const btnRunSim = document.getElementById("btnRunSim");
const btnRunEvaluation = document.getElementById("btnRunEvaluation");

const btnRunFullEval = document.getElementById("btnRunFullEval");
const btnRefreshResults = document.getElementById("btnRefreshResults");
const btnResetDashboard = document.getElementById("btnResetDashboard");

const tabRationalBtn = document.getElementById("tabRationalBtn");
const tabBoundedBtn = document.getElementById("tabBoundedBtn");

btnGenerate.addEventListener("click", handleGenerateStrategy);
btnRunStackelberg.addEventListener("click", handleRunStackelberg);
btnAnalyzeAttacker.addEventListener("click", handleAnalyzeAttacker);
btnRunSim.addEventListener("click", handleRunSimulation);
btnRunEvaluation.addEventListener("click", handleRunEvaluation);

btnRunFullEval.addEventListener("click", handleRunFullEvaluation);
btnRefreshResults.addEventListener("click", handleRefreshResults);
btnResetDashboard.addEventListener("click", handleResetDashboard);

tabRationalBtn.addEventListener("click", () => switchEvalTab("rational"));
tabBoundedBtn.addEventListener("click", () => switchEvalTab("bounded"));

// Retina / High-DPI Canvas Setup
let dpr = window.devicePixelRatio || 1;
function setupCanvasDpi() {
    dpr = window.devicePixelRatio || 1;
    const displayWidth = 620;
    const displayHeight = 420;
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    ctx.scale(dpr, dpr);
}
setupCanvasDpi();
window.addEventListener("resize", () => {
    setupCanvasDpi();
    drawGraph();
});

// Auto-Fit Coordinate Normalizer
function getScreenCoords(node) {
    if (!campusGraph || !campusGraph.nodes || campusGraph.nodes.length === 0) {
        return { x: node.x, y: node.y };
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    campusGraph.nodes.forEach(n => {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
    });

    const displayW = canvas.width / dpr;
    const displayH = canvas.height / dpr;

    const padX = 70;
    const padTop = 50;
    const padBottom = 60;

    const availW = displayW - padX * 2;
    const availH = displayH - padTop - padBottom;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    const scale = Math.min(availW / rangeX, availH / rangeY);
    const offsetX = (displayW - rangeX * scale) / 2;
    const offsetY = padTop + (availH - rangeY * scale) / 2;

    return {
        x: offsetX + (node.x - minX) * scale,
        y: offsetY + (node.y - minY) * scale
    };
}

// Animation loop for cyber patrol pulses
let animProgress = 0;
let hoveredNode = null;

function animate() {
    animProgress = (animProgress + 0.007) % 1.0;
    drawGraph();
    requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

function drawGraph() {
    const displayW = canvas.width / dpr;
    const displayH = canvas.height / dpr;
    ctx.clearRect(0, 0, displayW, displayH);
    if (!campusGraph) return;

    // 1. Draw Edges
    campusGraph.edges.forEach(edge => {
        const source = campusGraph.nodes.find(n => n.id === edge.source);
        const target = campusGraph.nodes.find(n => n.id === edge.destination);
        if (source && target) {
            const sCoords = getScreenCoords(source);
            const tCoords = getScreenCoords(target);

            let isHighlightedEdge = false;
            let patrolDirForward = true;

            if (highlightedRoute.length > 1) {
                for (let i = 0; i < highlightedRoute.length - 1; i++) {
                    if (highlightedRoute[i] === source.id && highlightedRoute[i+1] === target.id) {
                        isHighlightedEdge = true;
                        patrolDirForward = true;
                        break;
                    } else if (highlightedRoute[i] === target.id && highlightedRoute[i+1] === source.id) {
                        isHighlightedEdge = true;
                        patrolDirForward = false;
                        break;
                    }
                }
            }

            ctx.beginPath();
            ctx.moveTo(sCoords.x, sCoords.y);
            ctx.lineTo(tCoords.x, tCoords.y);

            if (isHighlightedEdge) {
                // Outer glow
                ctx.strokeStyle = "rgba(16, 185, 129, 0.4)";
                ctx.lineWidth = 6;
                ctx.stroke();

                // Inner core
                ctx.strokeStyle = "#10b981";
                ctx.lineWidth = 3;
                ctx.stroke();

                // Animated light pulse
                const pulseT = patrolDirForward ? animProgress : (1 - animProgress);
                const px = sCoords.x + (tCoords.x - sCoords.x) * pulseT;
                const py = sCoords.y + (tCoords.y - sCoords.y) * pulseT;

                ctx.beginPath();
                ctx.arc(px, py, 4, 0, Math.PI * 2);
                ctx.fillStyle = "#ffffff";
                ctx.shadowColor = "#34d399";
                ctx.shadowBlur = 10;
                ctx.fill();
                ctx.shadowBlur = 0; // reset
            } else {
                ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.setLineDash([]); // reset
            }

            // Edge travel time badge
            const mx = (sCoords.x + tCoords.x) / 2;
            const my = (sCoords.y + tCoords.y) / 2;
            
            // Badge background pill
            ctx.fillStyle = "rgba(11, 18, 34, 0.85)";
            ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(mx - 15, my - 10, 30, 20, 6);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isHighlightedEdge ? "#34d399" : "#94a3b8";
            ctx.font = "600 10px 'JetBrains Mono', monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(`${edge.travel_time}m`, mx, my);
        }
    });

    // 2. Draw Nodes
    campusGraph.nodes.forEach(node => {
        const coords = getScreenCoords(node);
        const isHighlighted = highlightedRoute.includes(node.id);
        const isAttackerTarget = (currentAttackerTarget === node.name);
        const isHovered = (hoveredNode && hoveredNode.id === node.id);

        const nodeRadius = isHovered ? 21 : 18;

        // Threat or Patrol Glow Halos
        if (isAttackerTarget) {
            // Pulsing target reticle
            const pulse = 1 + Math.sin(Date.now() / 150) * 0.2;
            ctx.beginPath();
            ctx.arc(coords.x, coords.y, 30 * pulse, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(239, 68, 68, 0.5)";
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 6]);
            ctx.stroke();
            ctx.setLineDash([]);
        } else if (isHighlighted) {
            ctx.beginPath();
            ctx.arc(coords.x, coords.y, 25, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
            ctx.fill();
        }

        // Node base circle
        ctx.beginPath();
        ctx.arc(coords.x, coords.y, nodeRadius, 0, Math.PI * 2);

        let fillColor = "#1e293b";
        let strokeColor = "rgba(255, 255, 255, 0.3)";

        if (isAttackerTarget) {
            fillColor = "#ef4444";
            strokeColor = "#fca5a5";
        } else if (isHighlighted) {
            fillColor = "#10b981";
            strokeColor = "#a7f3d0";
        } else if (currentAttackerProbs[node.name] > 0.05) {
            const intensity = Math.min(1.0, currentAttackerProbs[node.name] * 1.8);
            fillColor = `rgba(239, 68, 68, ${Math.max(0.35, intensity)})`;
            strokeColor = "#f87171";
        } else if (node.target_value >= 9) {
            fillColor = "#1e1b4b";
            strokeColor = "#818cf8";
        }

        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isHovered ? 3 : 2;
        ctx.stroke();

        // Checkpoint Inner Core
        ctx.beginPath();
        ctx.arc(coords.x, coords.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = isHighlighted ? "#ffffff" : (isAttackerTarget ? "#ffffff" : "rgba(255, 255, 255, 0.6)");
        ctx.fill();

        // Node Name Label (Capsule background)
        const nameText = node.name;
        ctx.font = "700 11px 'Plus Jakarta Sans', sans-serif";
        const nameWidth = ctx.measureText(nameText).width;
        
        ctx.fillStyle = "rgba(8, 15, 32, 0.85)";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(coords.x - nameWidth / 2 - 8, coords.y - 34, nameWidth + 16, 18, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#f8fafc";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(nameText, coords.x, coords.y - 25);

        // Value Badge Pill
        const valText = `VAL ${node.target_value}`;
        ctx.font = "700 9px 'JetBrains Mono', monospace";
        const valWidth = ctx.measureText(valText).width;

        const valBg = node.target_value >= 8 ? "rgba(245, 158, 11, 0.25)" : "rgba(255, 255, 255, 0.08)";
        const valBorder = node.target_value >= 8 ? "rgba(245, 158, 11, 0.5)" : "rgba(255, 255, 255, 0.15)";
        const valColor = node.target_value >= 8 ? "#fbbf24" : "#94a3b8";

        ctx.fillStyle = valBg;
        ctx.strokeStyle = valBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(coords.x - valWidth / 2 - 6, coords.y + 22, valWidth + 12, 16, 999);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = valColor;
        ctx.fillText(valText, coords.x, coords.y + 30);
    });
}

// Canvas Mouse Move & Tooltip Hover Interaction
canvas.addEventListener("mousemove", (e) => {
    if (!campusGraph || !campusGraph.nodes) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    let matchedNode = null;
    campusGraph.nodes.forEach(node => {
        const coords = getScreenCoords(node);
        const dist = Math.hypot(mouseX - coords.x, mouseY - coords.y);
        if (dist <= 26) {
            matchedNode = node;
        }
    });

    hoveredNode = matchedNode;

    if (matchedNode) {
        canvas.style.cursor = "pointer";
        const coords = getScreenCoords(matchedNode);
        
        tooltipTitle.textContent = `${matchedNode.name} (ID: ${matchedNode.id})`;
        tooltipValue.textContent = `Asset Valuation: ${matchedNode.target_value} / 10`;

        const isPatrolled = highlightedRoute.includes(matchedNode.id);
        const isThreat = (currentAttackerTarget === matchedNode.name);
        const threatProb = currentAttackerProbs[matchedNode.name];

        if (isThreat) {
            tooltipStatus.textContent = "PRIMARY ATTACKER TARGET (MAX UTILITY)";
            tooltipStatus.style.color = "#f87171";
        } else if (threatProb !== undefined) {
            tooltipStatus.textContent = `Intruder Prob: ${(threatProb * 100).toFixed(1)}%`;
            tooltipStatus.style.color = threatProb > 0.15 ? "#f87171" : "#fbbf24";
        } else if (isPatrolled) {
            tooltipStatus.textContent = "Protected on Current Patrol Route";
            tooltipStatus.style.color = "#34d399";
        } else {
            tooltipStatus.textContent = "Unpatrolled on Active Route";
            tooltipStatus.style.color = "#94a3b8";
        }

        mapTooltip.style.left = `${coords.x}px`;
        mapTooltip.style.top = `${coords.y}px`;
        mapTooltip.classList.add("visible");
    } else {
        canvas.style.cursor = "crosshair";
        mapTooltip.classList.remove("visible");
    }
});

canvas.addEventListener("mouseleave", () => {
    hoveredNode = null;
    mapTooltip.classList.remove("visible");
});

// Initialize Dashboard Data
async function initDashboard() {
    try {
        const res = await fetch(`${API_BASE_URL}/campus`);
        campusGraph = await res.json();
        
        document.getElementById("statLocations").textContent = campusGraph.nodes.length;
        document.getElementById("statRoutes").textContent = campusGraph.edges.length;
        
        let highest = campusGraph.nodes.reduce((max, node) => node.target_value > max.target_value ? node : max, campusGraph.nodes[0]);
        document.getElementById("statHighestValue").textContent = `${highest.name} (${highest.target_value})`;
        
        drawGraph();
    } catch (err) {
        console.error("Failed to fetch campus graph", err);
    }
}

initDashboard();

// Step 2: Feasible Strategies Generation
async function handleGenerateStrategy() {
    btnGenerate.disabled = true;
    btnGenerate.innerHTML = `<span class="pulse-dot"></span> Computing...`;
    document.getElementById("placeholderGen").style.display = "block";
    document.getElementById("placeholderGen").textContent = "Computing feasible DFS patrol schedules...";
    document.getElementById("strategyTableContainer").style.display = "none";
    highlightedRoute = [];
    hudActiveRoute.textContent = "ROUTE: UNASSIGNED";
    drawGraph();
    
    try {
        const patrolUnits = parseInt(document.getElementById("patrolUnits").value) || 1;
        const shiftDuration = parseFloat(document.getElementById("shiftDuration").value) || 30;
        const maxCheckpoints = parseInt(document.getElementById("maxCheckpoints").value) || 5;
        
        document.getElementById("statUnits").textContent = patrolUnits;
        document.getElementById("statShift").textContent = `${shiftDuration} min`;

        const reqPayload = {
            patrol_units: patrolUnits,
            shift_duration: shiftDuration,
            max_checkpoints: maxCheckpoints
        };

        const res = await fetch(`${API_BASE_URL}/strategies/generate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(reqPayload)
        });
        
        const data = await res.json();
        currentStrategies = data.strategies;

        if (!currentStrategies || currentStrategies.length === 0) {
            document.getElementById("placeholderGen").textContent = "No feasible strategies found within time/checkpoint constraints.";
            return;
        }

        document.getElementById("placeholderGen").style.display = "none";
        document.getElementById("strategyTableContainer").style.display = "block";
        
        const tbody = document.getElementById("strategyTableBody");
        tbody.innerHTML = "";
        
        currentStrategies.forEach(strat => {
            const tr = document.createElement("tr");
            tr.style.cursor = "pointer";
            
            tr.innerHTML = `
                <td style="font-weight: 700; color: #34d399; font-family: 'JetBrains Mono', monospace;">S${strat.strategy_id}</td>
                <td>${strat.route.join(" &rarr; ")}</td>
                <td style="font-family: 'JetBrains Mono', monospace;">${strat.total_travel_time}m</td>
                <td style="color: var(--text-secondary);">${strat.covered_targets.join(", ")}</td>
            `;
            
            tr.addEventListener("click", () => selectStrategy(strat, tr));
            tbody.appendChild(tr);
        });

        // Setup Fixed Strategy Dropdown
        const fixedSelect = document.getElementById("fixedStrategySelect");
        fixedSelect.innerHTML = "";
        currentStrategies.forEach((strat, i) => {
            const opt = document.createElement("option");
            opt.value = `S${i+1}`;
            opt.textContent = `Strategy S${i+1}: ${strat.route.join(" → ")}`;
            fixedSelect.appendChild(opt);
        });

        // Automatically trigger Stackelberg Optimization background state setup
        await solveStackelbergInternal(false);
        await fetchBaselines();

    } catch (err) {
        console.error(err);
        alert("Unable to generate strategies. Please verify backend status.");
        document.getElementById("placeholderGen").textContent = "Error generating strategies.";
    } finally {
        btnGenerate.disabled = false;
        btnGenerate.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> Generate Feasible Strategies`;
    }
}

function selectStrategy(strat, trElement) {
    const rows = document.querySelectorAll("#strategyTableBody tr");
    rows.forEach(r => r.classList.remove("active-row"));
    trElement.classList.add("active-row");
    
    highlightedRoute = strat.route_ids || strat.route;
    hudActiveRoute.textContent = `ROUTE: S${strat.strategy_id} (${strat.route.join("→")})`;
    drawGraph();
}

// Step 3: Stackelberg Optimization
async function solveStackelbergInternal(showUI = true) {
    if (!currentStrategies || currentStrategies.length === 0) {
        if (showUI) alert("Please generate feasible patrol strategies first.");
        return null;
    }

    const patrolUnits = parseInt(document.getElementById("patrolUnits").value) || 1;
    const shiftDuration = parseFloat(document.getElementById("shiftDuration").value) || 30;

    const simReq = {
        game_config: {
            patrol_units: patrolUnits,
            shift_duration: shiftDuration,
            graph: campusGraph
        },
        num_simulations: 1,
        attacker_config: { type: "rational", lambda_val: 1.0 },
        strategy_probabilities: {},
        strategies: currentStrategies.map(s => s.route_ids || s.route)
    };

    const res = await fetch(`${API_BASE_URL}/stackelberg/solve`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(simReq)
    });

    if (!res.ok) {
        throw new Error("Unable to calculate the optimal patrol policy.");
    }

    const data = await res.json();

    if (showUI) {
        renderStackelbergResults(data);
    }
    return data;
}

async function handleRunStackelberg() {
    btnRunStackelberg.disabled = true;
    btnRunStackelberg.innerHTML = `<span class="pulse-dot"></span> Solving LP...`;
    
    try {
        await solveStackelbergInternal(true);
        await fetchBaselines();
    } catch (err) {
        console.error(err);
        alert("Unable to calculate the optimal patrol policy. Please check input parameters.");
    } finally {
        btnRunStackelberg.disabled = false;
        btnRunStackelberg.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Solve Stackelberg LP`;
    }
}

function renderStackelbergResults(data) {
    document.getElementById("stackelbergResultsContainer").style.display = "block";
    
    document.getElementById("stackDefenderUtility").textContent = data.defender_utility.toFixed(2);
    document.getElementById("stackAttackerUtility").textContent = data.attacker_utility.toFixed(2);
    document.getElementById("stackBestResponse").textContent = data.attacker_best_response || "--";

    // Pair strategy info with calculated probabilities and sort highest to lowest
    const stratsWithProb = currentStrategies.map((s, i) => {
        const prob = data.probabilities[i] || 0.0;
        return { strategy: s, prob: prob, id: `S${i+1}` };
    });

    stratsWithProb.sort((a, b) => b.prob - a.prob);

    const tbody = document.getElementById("stackelbergTableBody");
    tbody.innerHTML = "";

    const labels = [];
    const probData = [];

    stratsWithProb.forEach(item => {
        labels.push(item.id);
        probData.push((item.prob * 100).toFixed(1));

        const tr = document.createElement("tr");
        tr.style.cursor = "pointer";
        tr.innerHTML = `
            <td style="font-weight: 700; color: #34d399; font-family: 'JetBrains Mono', monospace;">${item.id}</td>
            <td>${item.strategy.route.join(" &rarr; ")}</td>
            <td style="text-align: right; font-weight: 700; color: #34d399; font-family: 'JetBrains Mono', monospace;">${(item.prob * 100).toFixed(1)}%</td>
        `;
        tr.addEventListener("click", () => selectStrategy(item.strategy, tr));
        tbody.appendChild(tr);
    });

    // Draw Stackelberg Bar Chart
    const ctxStack = document.getElementById('stackelbergChart').getContext('2d');
    if (stackelbergChartInstance) stackelbergChartInstance.destroy();

    const gradient = ctxStack.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, '#10b981');
    gradient.addColorStop(1, '#047857');

    stackelbergChartInstance = new Chart(ctxStack, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Stackelberg Probability (%)',
                data: probData,
                backgroundColor: gradient,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { 
                    beginAtZero: true, 
                    max: 100, 
                    ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 11 } }, 
                    grid: { color: 'rgba(255,255,255,0.06)' } 
                },
                x: { 
                    ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 11 } }, 
                    grid: { display: false } 
                }
            },
            plugins: { 
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(11, 18, 34, 0.95)',
                    titleColor: '#38bdf8',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(56, 189, 248, 0.3)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8
                }
            }
        }
    });
}

// Step 4: Attacker Model UI Logic
const attackerRadios = document.getElementsByName("attackerType");
const lambdaGroup = document.getElementById("lambdaInputGroup");
const lambdaValInput = document.getElementById("lambdaVal");
const lambdaDisplay = document.getElementById("lambdaDisplay");
const attackerExplanation = document.getElementById("attackerExplanation");
const radioLabelRational = document.getElementById("radioLabelRational");
const radioLabelBounded = document.getElementById("radioLabelBounded");

if (lambdaValInput) {
    lambdaValInput.addEventListener("input", (e) => {
        if (lambdaDisplay) lambdaDisplay.textContent = parseFloat(e.target.value).toFixed(1);
    });
}

attackerRadios.forEach(radio => {
    radio.addEventListener("change", (e) => {
        if (e.target.value === "bounded") {
            radioLabelBounded.classList.add("active");
            radioLabelRational.classList.remove("active");
            lambdaGroup.style.display = "block";
            attackerExplanation.textContent = '"The intruder chooses targets probabilistically according to their expected utility via Softmax (Bounded Rationality)."';
        } else {
            radioLabelRational.classList.add("active");
            radioLabelBounded.classList.remove("active");
            lambdaGroup.style.display = "none";
            attackerExplanation.textContent = '"The intruder always chooses the target location with the highest expected utility."';
        }
    });
});

async function handleAnalyzeAttacker() {
    if (!currentStrategies || currentStrategies.length === 0) {
        alert("Please generate feasible patrol strategies first.");
        return;
    }

    btnAnalyzeAttacker.disabled = true;
    btnAnalyzeAttacker.innerHTML = `<span class="pulse-dot"></span> Analyzing...`;
    
    try {
        const type = document.querySelector('input[name="attackerType"]:checked').value;
        const lambdaVal = parseFloat(document.getElementById("lambdaVal").value) || 1.0;
        
        const reqPayload = { attacker_type: type, lambda: lambdaVal };

        const res = await fetch(`${API_BASE_URL}/attacker/evaluate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(reqPayload)
        });
        
        if (!res.ok) {
            alert("Error running attacker model. Did you generate strategies first?");
            return;
        }
        
        const data = await res.json();
        renderAttackerResults(data);
        
    } catch (err) {
        console.error(err);
        alert("Error connecting to backend attacker analysis endpoint.");
    } finally {
        btnAnalyzeAttacker.disabled = false;
        btnAnalyzeAttacker.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Analyze Threat Response`;
    }
}

function renderAttackerResults(data) {
    document.getElementById("attackerResultsSection").style.display = "block";
    const tbody = document.getElementById("attackerTableBody");
    tbody.innerHTML = "";
    
    currentAttackerTarget = null;
    currentAttackerProbs = {};
    
    let labels = [];
    let chartData = [];
    
    if (data.attacker_type === "rational") {
        document.getElementById("rationalResults").style.display = "block";
        document.getElementById("bestResponseTarget").textContent = data.best_response;
        document.getElementById("bestResponseUtility").textContent = data.best_response_utility.toFixed(2);
        document.getElementById("attackerTableMetricHeader").textContent = "Expected Utility";
        
        currentAttackerTarget = data.best_response;
        
        for (const [target, utility] of Object.entries(data.target_utilities)) {
            labels.push(target);
            chartData.push(utility);
            
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="font-weight: 600;">${target}</td>
                <td style="text-align: right; font-family: 'JetBrains Mono', monospace; color: #f87171; font-weight: 700;">${utility.toFixed(2)}</td>
            `;
            tbody.appendChild(tr);
        }
        
        drawAttackerChart(labels, chartData, "Expected Utility", "rational");
        
    } else {
        document.getElementById("rationalResults").style.display = "none";
        document.getElementById("attackerTableMetricHeader").textContent = "Attack Probability";
        
        currentAttackerProbs = data.target_probabilities;
        
        for (const [target, prob] of Object.entries(data.target_probabilities)) {
            labels.push(target);
            chartData.push(prob);
            
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="font-weight: 600;">${target}</td>
                <td style="text-align: right; font-family: 'JetBrains Mono', monospace; color: #fbbf24; font-weight: 700;">${(prob * 100).toFixed(1)}%</td>
            `;
            tbody.appendChild(tr);
        }
        
        drawAttackerChart(labels, chartData, "Attack Probability", "bounded");
    }
    
    drawGraph();
}

function drawAttackerChart(labels, data, labelName, type) {
    const ctxAtt = document.getElementById('attackerChart').getContext('2d');
    if (attackerChart) attackerChart.destroy();
    
    let bgColors = (type === "rational")
        ? data.map(v => v === Math.max(...data) ? '#ef4444' : 'rgba(148, 163, 184, 0.4)')
        : data.map(v => `rgba(248, 113, 113, ${Math.max(0.25, v * 1.5)})`);

    attackerChart = new Chart(ctxAtt, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ label: labelName, data: data, backgroundColor: bgColors, borderRadius: 6 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            },
            plugins: { 
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(11, 18, 34, 0.95)',
                    titleColor: '#38bdf8',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(56, 189, 248, 0.3)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8
                }
            }
        }
    });
}

// Step 5: Baseline Strategy Comparison Logic
const fixedSelect = document.getElementById("fixedStrategySelect");
fixedSelect.addEventListener("change", fetchBaselines);

async function fetchBaselines() {
    if (currentStrategies.length === 0) return;
    document.getElementById("comparisonSection").style.display = "block";
    
    try {
        const fixedId = fixedSelect.value;
        const url = fixedId ? `${API_BASE_URL}/baselines?fixed_id=${fixedId}` : `${API_BASE_URL}/baselines`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch baselines");
        
        const data = await res.json();
        renderBaselineResults(data);
    } catch (err) {
        console.error("Error fetching baselines:", err);
    }
}

function renderBaselineResults(data) {
    const fixed = data.fixed;
    const uniform = data.uniform_random;
    const game = data.game_theoretic;
    
    if (!fixed || !fixed.probabilities) return;
    const strategyKeys = Object.keys(fixed.probabilities);
    
    const headerRow = document.getElementById("baselineTableHeaderRow");
    headerRow.innerHTML = '<th>Patrol Policy</th>';
    strategyKeys.forEach(s => {
        headerRow.innerHTML += `<th style="text-align: right;">${s}</th>`;
    });
    
    const tbody = document.getElementById("baselineTableBody");
    tbody.innerHTML = "";
    
    const renderRow = (name, probsData, color) => {
        const tr = document.createElement("tr");
        let html = `<td style="font-weight: 700; color: ${color};">${name}</td>`;
        strategyKeys.forEach(s => {
            const val = probsData[s] || 0.0;
            html += `<td style="text-align: right; font-family: 'JetBrains Mono', monospace;">${(val * 100).toFixed(1)}%</td>`;
        });
        tr.innerHTML = html;
        return tr;
    };
    
    tbody.appendChild(renderRow("Fixed Schedule", fixed.probabilities, "#f87171"));
    tbody.appendChild(renderRow("Uniform Random", uniform.probabilities, "#fbbf24"));
    tbody.appendChild(renderRow("Game-Theoretic", game.probabilities, "#34d399"));
    
    drawBaselineChart(strategyKeys, fixed.probabilities, uniform.probabilities, game.probabilities);
}

function drawBaselineChart(labels, fixedProbs, uniformProbs, gameProbs) {
    const ctxBase = document.getElementById('baselineChart').getContext('2d');
    if (baselineChart) baselineChart.destroy();
    
    const fixedData = labels.map(l => (fixedProbs[l] || 0) * 100);
    const uniformData = labels.map(l => (uniformProbs[l] || 0) * 100);
    const gameData = labels.map(l => (gameProbs[l] || 0) * 100);

    baselineChart = new Chart(ctxBase, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Fixed Schedule', data: fixedData, backgroundColor: '#ef4444', borderRadius: 6 },
                { label: 'Uniform Random', data: uniformData, backgroundColor: '#f59e0b', borderRadius: 6 },
                { label: 'Game-Theoretic', data: gameData, backgroundColor: '#10b981', borderRadius: 6 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
            },
            plugins: { 
                legend: { labels: { color: '#e2e8f0', font: { family: 'Plus Jakarta Sans' } } },
                tooltip: {
                    backgroundColor: 'rgba(11, 18, 34, 0.95)',
                    borderColor: 'rgba(56, 189, 248, 0.3)',
                    borderWidth: 1,
                    cornerRadius: 8
                }
            }
        }
    });
}

// Step 6: Attack Simulation Engine Logic
async function handleRunSimulation() {
    if (!currentStrategies || currentStrategies.length === 0) {
        alert("Please generate feasible patrol strategies first.");
        return;
    }

    btnRunSim.disabled = true;
    btnRunSim.innerHTML = `<span class="pulse-dot"></span> Simulating...`;

    try {
        const rounds = parseInt(document.getElementById("simRounds").value) || 1000;
        const policy = document.getElementById("simPolicy").value;
        const attackerType = document.getElementById("simAttackerType").value;
        const seed = parseInt(document.getElementById("simSeed").value) || 42;
        const lambdaVal = parseFloat(document.getElementById("lambdaVal").value) || 1.0;

        const reqPayload = {
            rounds: rounds,
            patrol_policy: policy,
            attacker_type: attackerType,
            lambda: lambdaVal,
            random_seed: seed
        };

        const res = await fetch(`${API_BASE_URL}/simulation/run`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(reqPayload)
        });

        if (!res.ok) {
            alert("Simulation failed. Please check backend parameters.");
            return;
        }

        const data = await res.json();
        renderSimulationResults(data);

    } catch (err) {
        console.error("Simulation error:", err);
        alert("Failed to connect to simulation API.");
    } finally {
        btnRunSim.disabled = false;
        btnRunSim.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Run Attack Simulation`;
    }
}

function renderSimulationResults(data) {
    document.getElementById("simResultsSection").style.display = "block";
    
    document.getElementById("simTotalRounds").textContent = data.rounds.toLocaleString();
    document.getElementById("simDetected").textContent = data.detected_attacks.toLocaleString();
    document.getElementById("simSuccessful").textContent = data.successful_attacks.toLocaleString();
    document.getElementById("simDetectionProb").textContent = `${(data.detection_probability * 100).toFixed(1)}%`;

    const tbody = document.getElementById("simLogTableBody");
    tbody.innerHTML = "";

    if (data.recent_log && data.recent_log.length > 0) {
        data.recent_log.forEach(entry => {
            const tr = document.createElement("tr");
            
            const badge = entry.detected 
                ? '<span class="badge-tag badge-detected">INTERCEPTED</span>'
                : '<span class="badge-tag badge-breach">BREACH</span>';

            tr.innerHTML = `
                <td style="font-family: 'JetBrains Mono', monospace;">#${entry.round}</td>
                <td style="font-weight: 600;">${entry.patrol_strategy}</td>
                <td style="font-weight: 600;">${entry.attacker_target}</td>
                <td>${badge}</td>
                <td style="text-align: right; font-family: 'JetBrains Mono', monospace; color: #38bdf8;">${entry.defender_utility}</td>
            `;
            tbody.appendChild(tr);
        });
    }
}

// Step 7: Performance Evaluation & Statistical Benchmark Logic
function switchEvalTab(tab) {
    currentEvalTab = tab;
    if (tab === "rational") {
        tabRationalBtn.classList.add("active");
        tabBoundedBtn.classList.remove("active");
    } else {
        tabBoundedBtn.classList.add("active");
        tabRationalBtn.classList.remove("active");
    }
    if (evaluationData) {
        renderEvaluationDashboard();
    }
}

async function handleRunEvaluation() {
    btnRunEvaluation.disabled = true;
    btnRunEvaluation.innerHTML = `<span class="pulse-dot"></span> Benchmarking...`;
    
    try {
        const rounds = parseInt(document.getElementById("evalRounds").value) || 1000;
        const experiments = parseInt(document.getElementById("evalExperiments").value) || 10;
        const lambdaVal = parseFloat(document.getElementById("evalLambda").value) || 1.0;
        const seed = parseInt(document.getElementById("evalSeed").value) || 42;
        
        const reqPayload = {
            rounds: rounds,
            experiments: experiments,
            lambda: lambdaVal,
            random_seed: seed
        };
        
        const res = await fetch(`${API_BASE_URL}/evaluation/compare`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(reqPayload)
        });
        
        if (!res.ok) {
            alert("Error running evaluation API.");
            return;
        }
        
        evaluationData = await res.json();
        document.getElementById("evalResultsContainer").style.display = "block";
        renderEvaluationDashboard();
        
    } catch (err) {
        console.error("Evaluation error:", err);
        alert("Failed to connect to evaluation endpoint.");
    } finally {
        btnRunEvaluation.disabled = false;
        btnRunEvaluation.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> Execute Empirical Benchmark`;
    }
}

function renderEvaluationDashboard() {
    if (!evaluationData) return;
    
    const isRational = (currentEvalTab === "rational");
    const tabData = isRational ? evaluationData.rational_attacker : evaluationData.bounded_rational_attacker;
    const tabSummary = isRational ? evaluationData.rational_summary : evaluationData.bounded_summary;
    
    if (!tabData) return;
    
    // Indicators
    const bestStrats = tabSummary.best_strategy;
    document.getElementById("indBestDetection").textContent = bestStrats.best_detection;
    document.getElementById("indBestDetectionVal").textContent = `${(bestStrats.best_detection_val * 100).toFixed(1)}% Interception Ratio`;
    
    document.getElementById("indBestUtility").textContent = bestStrats.best_defender_utility;
    document.getElementById("indBestUtilityVal").textContent = `Payoff: ${bestStrats.best_defender_utility_val.toFixed(2)}`;
    
    document.getElementById("indMostUnpredictable").textContent = bestStrats.most_unpredictable;
    document.getElementById("indMostUnpredictableVal").textContent = `Normalized Entropy: ${bestStrats.most_unpredictable_val.toFixed(2)}`;
    
    // Table with 95% Wilson Confidence Intervals
    const tbody = document.getElementById("evalTableBody");
    tbody.innerHTML = "";
    
    const policyNames = {
        "fixed": "Fixed Schedule Patrol",
        "uniform_random": "Uniform Random Patrol",
        "game_theoretic": "Game-Theoretic Patrol"
    };
    
    const policyColors = {
        "fixed": "#f87171",
        "uniform_random": "#fbbf24",
        "game_theoretic": "#34d399"
    };
    
    ["fixed", "uniform_random", "game_theoretic"].forEach(pKey => {
        const m = tabData[pKey];
        if (!m) return;
        
        const tr = document.createElement("tr");
        
        const detPct = (m.detection_probability * 100).toFixed(1);
        const ciLowPct = (m.confidence_interval_lower * 100).toFixed(1);
        const ciUpPct = (m.confidence_interval_upper * 100).toFixed(1);
        const succPct = (m.attack_success_rate * 100).toFixed(1);
        const defUtil = m.defender_utility.toFixed(2);
        const attUtil = m.attacker_utility.toFixed(2);
        const unpred = m.unpredictability.toFixed(2);
        
        tr.innerHTML = `
            <td style="font-weight: 700; color: ${policyColors[pKey]};">${policyNames[pKey]}</td>
            <td style="text-align: right; font-family: 'JetBrains Mono', monospace;">${detPct}% <span style="font-size: 0.75rem; color: #94a3b8;">[${ciLowPct}%, ${ciUpPct}%]</span></td>
            <td style="text-align: right; font-family: 'JetBrains Mono', monospace;">${succPct}%</td>
            <td style="text-align: right; font-family: 'JetBrains Mono', monospace;">${defUtil}</td>
            <td style="text-align: right; font-family: 'JetBrains Mono', monospace;">${attUtil}</td>
            <td style="text-align: right; font-family: 'JetBrains Mono', monospace;">${unpred}</td>
        `;
        tbody.appendChild(tr);
    });
    
    // Render 4 Polished Visualizers
    renderEvaluationCharts(tabData);

    // Dynamic Security Insights & Recommendations update strictly derived from empirical data
    updateSecurityInsightsAndRecommendation(tabSummary, tabData);
}

function updateSecurityInsightsAndRecommendation(summary, tabData) {
    const bestDetName = summary.best_strategy.best_detection;
    const bestDetVal = (summary.best_strategy.best_detection_val * 100).toFixed(1);
    
    const lowestSuccVal = (Math.min(tabData.fixed.attack_success_rate, tabData.uniform_random.attack_success_rate, tabData.game_theoretic.attack_success_rate) * 100).toFixed(1);
    const mostUnpredName = summary.best_strategy.most_unpredictable;
    const mostUnpredVal = summary.best_strategy.most_unpredictable_val.toFixed(2);

    document.getElementById("insightTextDetection").innerHTML = `The highest detection probability was achieved by <strong style="color: #34d399;">${bestDetName}</strong> (${bestDetVal}%).`;
    document.getElementById("insightTextSuccess").innerHTML = `The lowest attack breach rate was achieved by <strong style="color: #34d399;">${bestDetName}</strong> (${lowestSuccVal}%).`;
    document.getElementById("insightTextUnpred").innerHTML = `The highest patrol schedule unpredictability was achieved by <strong style="color: #fbbf24;">${mostUnpredName}</strong> (${mostUnpredVal} normalized entropy).`;

    // Dynamic recommendation text strictly matching actual calculations
    const recTitle = document.getElementById("recStrategyTitle");
    const recText = document.getElementById("recStrategyText");
    const recTradeoffs = document.getElementById("recTradeoffsBox");

    recTitle.textContent = bestDetName;
    recText.textContent = `${bestDetName} demonstrated superior performance across repeated randomized trials with an interception probability of ${bestDetVal}% and expected defender payoff of ${summary.best_strategy.best_defender_utility_val.toFixed(2)}.`;

    if (bestDetName.includes("Game-Theoretic")) {
        recTradeoffs.innerHTML = `
            <strong style="color: #38bdf8;">Empirical Rationale & Operational Trade-offs:</strong>
            <ul style="margin-top: 0.5rem; padding-left: 1.2rem; line-height: 1.6;">
                <li><strong>Optimal Target Valuation Weighting:</strong> Allocates surveillance probabilities proportional to checkpoint asset values, ensuring high-value locations remain strongly protected.</li>
                <li><strong>Strategic Randomization:</strong> Retains high unpredictability against observing adversaries, eliminating exploitable patrol patterns.</li>
            </ul>
        `;
    } else {
        recTradeoffs.innerHTML = `
            <strong style="color: #38bdf8;">Empirical Rationale & Operational Trade-offs:</strong>
            <ul style="margin-top: 0.5rem; padding-left: 1.2rem; line-height: 1.6;">
                <li><strong>Maximal Spatial Entropy:</strong> Equalizes path coverage to keep adversaries guessing across all perimeter corridors.</li>
                <li><strong>Uniform Resource Distribution:</strong> Note that uniform coverage treats low-value checkpoints with equal weight to critical infrastructure.</li>
            </ul>
        `;
    }
}

function renderEvaluationCharts(tabData) {
    const labels = ["Fixed Schedule", "Uniform Random", "Game-Theoretic"];
    const colors = ["#ef4444", "#f59e0b", "#10b981"];
    
    const detData = [tabData.fixed.detection_probability * 100, tabData.uniform_random.detection_probability * 100, tabData.game_theoretic.detection_probability * 100];
    const succData = [tabData.fixed.attack_success_rate * 100, tabData.uniform_random.attack_success_rate * 100, tabData.game_theoretic.attack_success_rate * 100];
    const defUtilData = [tabData.fixed.defender_utility, tabData.uniform_random.defender_utility, tabData.game_theoretic.defender_utility];
    const unpredData = [tabData.fixed.unpredictability, tabData.uniform_random.unpredictability, tabData.game_theoretic.unpredictability];
    
    const commonScales = {
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#94a3b8' } },
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 11 } } }
    };
    
    const commonPlugins = {
        legend: { display: false },
        tooltip: {
            backgroundColor: 'rgba(11, 18, 34, 0.95)',
            borderColor: 'rgba(56, 189, 248, 0.3)',
            borderWidth: 1,
            cornerRadius: 8
        }
    };

    const ctxDet = document.getElementById("chartDetection").getContext("2d");
    if (chartDetectionInstance) chartDetectionInstance.destroy();
    chartDetectionInstance = new Chart(ctxDet, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Detection Prob (%)', data: detData, backgroundColor: colors, borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: commonScales, plugins: commonPlugins }
    });
    
    const ctxSucc = document.getElementById("chartSuccess").getContext("2d");
    if (chartSuccessInstance) chartSuccessInstance.destroy();
    chartSuccessInstance = new Chart(ctxSucc, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Attack Success Rate (%)', data: succData, backgroundColor: colors, borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: commonScales, plugins: commonPlugins }
    });
    
    const ctxDef = document.getElementById("chartDefenderUtility").getContext("2d");
    if (chartDefenderUtilityInstance) chartDefenderUtilityInstance.destroy();
    chartDefenderUtilityInstance = new Chart(ctxDef, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Defender Utility', data: defUtilData, backgroundColor: colors, borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: commonScales, plugins: commonPlugins }
    });
    
    const ctxUnpred = document.getElementById("chartUnpredictability").getContext("2d");
    if (chartUnpredictabilityInstance) chartUnpredictabilityInstance.destroy();
    chartUnpredictabilityInstance = new Chart(ctxUnpred, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Normalized Entropy', data: unpredData, backgroundColor: colors, borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { ...commonScales, y: { ...commonScales.y, max: 1.0 } }, plugins: commonPlugins }
    });
}

// Master Action Buttons Logic
async function handleRunFullEvaluation() {
    btnRunFullEval.disabled = true;
    btnRunFullEval.innerHTML = `<span class="pulse-dot"></span> Executing Mission Workflow...`;

    try {
        // Step 1: Generate Strategies
        await handleGenerateStrategy();
        
        // Step 2: Run Stackelberg Optimization
        await solveStackelbergInternal(true);
        
        // Step 3: Analyze Attacker
        await handleAnalyzeAttacker();
        
        // Step 4: Run Simulation
        await handleRunSimulation();
        
        // Step 5: Run Multi-Experiment Evaluation
        await handleRunEvaluation();

        // Scroll smoothly to Recommendations
        document.getElementById("recommendationSection").scrollIntoView({ behavior: "smooth" });

    } catch (err) {
        console.error("Full evaluation error:", err);
        alert("Full evaluation encountered an error. Please verify backend status.");
    } finally {
        btnRunFullEval.disabled = false;
        btnRunFullEval.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Run Full Evaluation Workflow`;
    }
}

async function handleRefreshResults() {
    btnRefreshResults.disabled = true;
    btnRefreshResults.innerHTML = `<span class="pulse-dot"></span> Refreshing...`;
    try {
        const res = await fetch(`${API_BASE_URL}/dashboard/summary`);
        const data = await res.json();
        if (data.has_generated_state) {
            await fetchBaselines();
            if (evaluationData) renderEvaluationDashboard();
        } else {
            alert("No active generated strategy state found. Click 'Generate Feasible Strategies' or 'Run Full Evaluation'.");
        }
    } catch (err) {
        console.error("Refresh error:", err);
    } finally {
        btnRefreshResults.disabled = false;
        btnRefreshResults.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> Refresh State`;
    }
}

async function handleResetDashboard() {
    if (!confirm("Are you sure you want to reset the command console state?")) return;
    
    btnResetDashboard.disabled = true;
    btnResetDashboard.innerHTML = `<span class="pulse-dot"></span> Resetting...`;

    try {
        await fetch(`${API_BASE_URL}/dashboard/reset`, { method: 'POST' });
        
        currentStrategies = [];
        highlightedRoute = [];
        currentAttackerTarget = null;
        currentAttackerProbs = {};
        evaluationData = null;

        hudActiveRoute.textContent = "ROUTE: UNASSIGNED";
        document.getElementById("strategyTableContainer").style.display = "none";
        document.getElementById("placeholderGen").style.display = "block";
        document.getElementById("placeholderGen").textContent = "Configure patrol parameters and click 'Generate Feasible Strategies'.";
        
        document.getElementById("stackelbergResultsContainer").style.display = "none";
        document.getElementById("attackerResultsSection").style.display = "none";
        document.getElementById("comparisonSection").style.display = "none";
        document.getElementById("simResultsSection").style.display = "none";
        document.getElementById("evalResultsContainer").style.display = "none";

        document.getElementById("insightTextDetection").textContent = "Run empirical benchmark to calculate statistically verified detection metrics.";
        document.getElementById("insightTextSuccess").textContent = "Run empirical benchmark to calculate attack breach ratios.";
        document.getElementById("insightTextUnpred").textContent = "Run empirical benchmark to calculate policy Shannon entropy.";

        document.getElementById("recStrategyTitle").textContent = "Game-Theoretic Stackelberg Patrol";
        document.getElementById("recStrategyText").textContent = "Run Full Evaluation to determine optimal patrol recommendation.";

        drawGraph();

    } catch (err) {
        console.error("Reset error:", err);
    } finally {
        btnResetDashboard.disabled = false;
        btnResetDashboard.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg> Reset Console`;
    }
}
