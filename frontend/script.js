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

function drawGraph() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!campusGraph) return;
    
    // Draw edges
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    
    campusGraph.edges.forEach(edge => {
        const source = campusGraph.nodes.find(n => n.id === edge.source);
        const target = campusGraph.nodes.find(n => n.id === edge.destination);
        if (source && target) {
            ctx.beginPath();
            let isHighlightedEdge = false;
            if (highlightedRoute.length > 1) {
                for (let i = 0; i < highlightedRoute.length - 1; i++) {
                    if ((highlightedRoute[i] === source.id && highlightedRoute[i+1] === target.id) || 
                        (highlightedRoute[i] === target.id && highlightedRoute[i+1] === source.id)) {
                        isHighlightedEdge = true;
                        break;
                    }
                }
            }
            
            ctx.strokeStyle = isHighlightedEdge ? "#10b981" : "rgba(255, 255, 255, 0.2)";
            ctx.lineWidth = isHighlightedEdge ? 4 : 2;
            
            ctx.moveTo(source.x, source.y);
            ctx.lineTo(target.x, target.y);
            ctx.stroke();
            
            const mx = (source.x + target.x) / 2;
            const my = (source.y + target.y) / 2;
            ctx.fillStyle = "#94a3b8";
            ctx.font = "12px Inter";
            ctx.fillText(`${edge.travel_time}m`, mx + 5, my - 5);
        }
    });

    // Draw nodes
    campusGraph.nodes.forEach(node => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 20, 0, Math.PI * 2);
        
        let fillColor = "#94a3b8";
        if (highlightedRoute.includes(node.id)) {
            fillColor = "#10b981";
        }
        if (currentAttackerTarget === node.name) {
            fillColor = "#ef4444";
        } else if (currentAttackerProbs[node.name] > 0.05) {
            const intensity = Math.min(1.0, currentAttackerProbs[node.name] * 1.5);
            fillColor = `rgba(239, 68, 68, ${intensity})`;
        }
        
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px Inter";
        ctx.textAlign = "center";
        ctx.fillText(node.name, node.x, node.y - 30);
        ctx.fillStyle = "#f59e0b";
        ctx.fillText(`Val: ${node.target_value}`, node.x, node.y + 35);
    });
}

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

async function handleGenerateStrategy() {
    btnGenerate.disabled = true;
    btnGenerate.textContent = "Computing...";
    document.getElementById("placeholderGen").style.display = "block";
    document.getElementById("placeholderGen").textContent = "Computing...";
    document.getElementById("strategyTableContainer").style.display = "none";
    highlightedRoute = [];
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
            tr.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
            tr.style.cursor = "pointer";
            
            tr.innerHTML = `
                <td style="padding: 0.5rem; font-weight: bold; color: #10b981;">S${strat.strategy_id}</td>
                <td style="padding: 0.5rem;">${strat.route.join(" &rarr; ")}</td>
                <td style="padding: 0.5rem;">${strat.total_travel_time} min</td>
                <td style="padding: 0.5rem;">${strat.covered_targets.join(", ")}</td>
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
            opt.textContent = `Strategy S${i+1}`;
            fixedSelect.appendChild(opt);
        });

        // Automatically trigger Stackelberg Optimization background state setup
        await solveStackelbergInternal(false);
        await fetchBaselines();

    } catch (err) {
        console.error(err);
        alert("Unable to generate strategies. Please check backend status.");
        document.getElementById("placeholderGen").textContent = "Error generating strategies.";
    } finally {
        btnGenerate.disabled = false;
        btnGenerate.textContent = "Generate Strategies";
    }
}

function selectStrategy(strat, trElement) {
    const rows = document.querySelectorAll("#strategyTableBody tr");
    rows.forEach(r => r.style.backgroundColor = "transparent");
    trElement.style.backgroundColor = "rgba(16, 185, 129, 0.2)";
    
    highlightedRoute = strat.route_ids || strat.route;
    drawGraph();
}

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
    btnRunStackelberg.textContent = "Solving LP...";
    
    try {
        await solveStackelbergInternal(true);
        await fetchBaselines();
    } catch (err) {
        console.error(err);
        alert("Unable to calculate the optimal patrol policy. Please check input parameters.");
    } finally {
        btnRunStackelberg.disabled = false;
        btnRunStackelberg.textContent = "Run Stackelberg Optimization";
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
        tr.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
        tr.innerHTML = `
            <td style="padding: 0.5rem; font-weight: bold;">${item.id}</td>
            <td style="padding: 0.5rem;">${item.strategy.route.join(" &rarr; ")}</td>
            <td style="padding: 0.5rem; text-align: right; font-weight: bold; color: #10b981;">${(item.prob * 100).toFixed(1)}%</td>
        `;
        tbody.appendChild(tr);
    });

    // Draw Stackelberg Chart
    const ctxStack = document.getElementById('stackelbergChart').getContext('2d');
    if (stackelbergChartInstance) stackelbergChartInstance.destroy();

    stackelbergChartInstance = new Chart(ctxStack, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Stackelberg Probability (%)',
                data: probData,
                backgroundColor: '#10b981',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// Attacker Model UI Logic
const attackerRadios = document.getElementsByName("attackerType");
const lambdaGroup = document.getElementById("lambdaInputGroup");
const attackerExplanation = document.getElementById("attackerExplanation");

attackerRadios.forEach(radio => {
    radio.addEventListener("change", (e) => {
        if (e.target.value === "bounded") {
            lambdaGroup.style.display = "block";
            attackerExplanation.textContent = '"The intruder chooses targets probabilistically according to their expected utility, representing imperfect or bounded decision-making."';
        } else {
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
    btnAnalyzeAttacker.textContent = "Analyzing...";
    
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
        btnAnalyzeAttacker.textContent = "Analyze Attacker";
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
            tr.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
            tr.innerHTML = `
                <td style="padding: 0.5rem;">${target}</td>
                <td style="padding: 0.5rem; text-align: right;">${utility.toFixed(2)}</td>
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
            tr.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
            tr.innerHTML = `
                <td style="padding: 0.5rem;">${target}</td>
                <td style="padding: 0.5rem; text-align: right;">${(prob * 100).toFixed(1)}%</td>
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
        ? data.map(v => v === Math.max(...data) ? '#ef4444' : 'rgba(148, 163, 184, 0.5)')
        : data.map(v => `rgba(239, 68, 68, ${Math.max(0.2, v)})`);

    attackerChart = new Chart(ctxAtt, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ label: labelName, data: data, backgroundColor: bgColors, borderWidth: 0 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// Baseline Comparison Logic
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
    headerRow.innerHTML = '<th style="padding: 0.5rem; text-align: left;">Policy</th>';
    strategyKeys.forEach(s => {
        headerRow.innerHTML += `<th style="padding: 0.5rem; text-align: right;">${s}</th>`;
    });
    
    const tbody = document.getElementById("baselineTableBody");
    tbody.innerHTML = "";
    
    const renderRow = (name, probsData, color) => {
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
        let html = `<td style="padding: 0.5rem; text-align: left; font-weight: bold; color: ${color};">${name}</td>`;
        strategyKeys.forEach(s => {
            const val = probsData[s] || 0.0;
            html += `<td style="padding: 0.5rem; text-align: right;">${(val * 100).toFixed(1)}%</td>`;
        });
        tr.innerHTML = html;
        return tr;
    };
    
    tbody.appendChild(renderRow("Fixed Schedule", fixed.probabilities, "#ef4444"));
    tbody.appendChild(renderRow("Uniform Random", uniform.probabilities, "#f59e0b"));
    tbody.appendChild(renderRow("Game-Theoretic", game.probabilities, "#10b981"));
    
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
                { label: 'Fixed Schedule', data: fixedData, backgroundColor: '#ef4444' },
                { label: 'Uniform Random', data: uniformData, backgroundColor: '#f59e0b' },
                { label: 'Game-Theoretic', data: gameData, backgroundColor: '#10b981' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
            },
            plugins: { legend: { labels: { color: '#fff' } } }
        }
    });
}

// Attack Simulation Engine Logic
async function handleRunSimulation() {
    if (!currentStrategies || currentStrategies.length === 0) {
        alert("Please generate feasible patrol strategies first.");
        return;
    }

    btnRunSim.disabled = true;
    btnRunSim.textContent = "Simulating Attacks...";

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
        btnRunSim.textContent = "Run Simulation";
    }
}

function renderSimulationResults(data) {
    document.getElementById("simResultsSection").style.display = "block";
    
    document.getElementById("simTotalRounds").textContent = data.rounds;
    document.getElementById("simDetected").textContent = data.detected_attacks;
    document.getElementById("simSuccessful").textContent = data.successful_attacks;
    document.getElementById("simDetectionProb").textContent = `${(data.detection_probability * 100).toFixed(1)}%`;

    const tbody = document.getElementById("simLogTableBody");
    tbody.innerHTML = "";

    if (data.recent_log && data.recent_log.length > 0) {
        data.recent_log.forEach(entry => {
            const tr = document.createElement("tr");
            tr.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
            
            const badge = entry.detected 
                ? '<span style="color: #10b981; font-weight: bold;">DETECTED</span>'
                : '<span style="color: #ef4444; font-weight: bold;">BREACH</span>';

            tr.innerHTML = `
                <td style="padding: 0.4rem;">#${entry.round}</td>
                <td style="padding: 0.4rem; font-weight: bold;">${entry.patrol_strategy}</td>
                <td style="padding: 0.4rem;">${entry.attacker_target}</td>
                <td style="padding: 0.4rem;">${badge}</td>
                <td style="padding: 0.4rem; text-align: right;">${entry.defender_utility}</td>
            `;
            tbody.appendChild(tr);
        });
    }
}

// Step 7 & 8 Performance Evaluation Logic
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
    btnRunEvaluation.textContent = "Evaluating...";
    
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
        btnRunEvaluation.textContent = "Run Performance Evaluation";
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
    document.getElementById("indBestDetectionVal").textContent = `${(bestStrats.best_detection_val * 100).toFixed(1)}% Detection Prob`;
    
    document.getElementById("indBestUtility").textContent = bestStrats.best_defender_utility;
    document.getElementById("indBestUtilityVal").textContent = `Utility: ${bestStrats.best_defender_utility_val.toFixed(2)}`;
    
    document.getElementById("indMostUnpredictable").textContent = bestStrats.most_unpredictable;
    document.getElementById("indMostUnpredictableVal").textContent = `Normalized Entropy: ${bestStrats.most_unpredictable_val.toFixed(2)}`;
    
    // Table
    const tbody = document.getElementById("evalTableBody");
    tbody.innerHTML = "";
    
    const policyNames = {
        "fixed": "Fixed Schedule Patrol",
        "uniform_random": "Uniform Random Patrol",
        "game_theoretic": "Game-Theoretic Patrol"
    };
    
    const policyColors = {
        "fixed": "#ef4444",
        "uniform_random": "#f59e0b",
        "game_theoretic": "#10b981"
    };
    
    ["fixed", "uniform_random", "game_theoretic"].forEach(pKey => {
        const m = tabData[pKey];
        if (!m) return;
        
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
        
        const detPct = (m.detection_probability * 100).toFixed(1);
        const ciLowPct = (m.confidence_interval_lower * 100).toFixed(1);
        const ciUpPct = (m.confidence_interval_upper * 100).toFixed(1);
        const succPct = (m.attack_success_rate * 100).toFixed(1);
        const defUtil = m.defender_utility.toFixed(2);
        const attUtil = m.attacker_utility.toFixed(2);
        const unpred = m.unpredictability.toFixed(2);
        
        tr.innerHTML = `
            <td style="padding: 0.75rem 0.5rem; text-align: left; font-weight: bold; color: ${policyColors[pKey]};">${policyNames[pKey]}</td>
            <td style="padding: 0.75rem 0.5rem;">${detPct}% <span style="font-size: 0.8rem; color: #94a3b8;">[${ciLowPct}%, ${ciUpPct}%]</span></td>
            <td style="padding: 0.75rem 0.5rem;">${succPct}%</td>
            <td style="padding: 0.75rem 0.5rem;">${defUtil}</td>
            <td style="padding: 0.75rem 0.5rem;">${attUtil}</td>
            <td style="padding: 0.75rem 0.5rem;">${unpred}</td>
        `;
        tbody.appendChild(tr);
    });
    
    // Render 4 Charts
    renderEvaluationCharts(tabData);

    // Dynamic Security Insights & Recommendations update based strictly on actual data
    updateSecurityInsightsAndRecommendation(tabSummary, tabData);
}

function updateSecurityInsightsAndRecommendation(summary, tabData) {
    const bestDetName = summary.best_strategy.best_detection;
    const bestDetVal = (summary.best_strategy.best_detection_val * 100).toFixed(1);
    
    const lowestSuccVal = (Math.min(tabData.fixed.attack_success_rate, tabData.uniform_random.attack_success_rate, tabData.game_theoretic.attack_success_rate) * 100).toFixed(1);
    const mostUnpredName = summary.best_strategy.most_unpredictable;
    const mostUnpredVal = summary.best_strategy.most_unpredictable_val.toFixed(2);

    document.getElementById("insightTextDetection").innerHTML = `The highest detection probability was achieved by <strong>${bestDetName}</strong> (${bestDetVal}%).`;
    document.getElementById("insightTextSuccess").innerHTML = `The lowest attack success rate was achieved by <strong>${bestDetName}</strong> (${lowestSuccVal}%).`;
    document.getElementById("insightTextUnpred").innerHTML = `The highest patrol unpredictability was achieved by <strong>${mostUnpredName}</strong> (${mostUnpredVal} normalized entropy).`;

    // Dynamic recommendation text strictly matching actual calculations
    const recTitle = document.getElementById("recStrategyTitle");
    const recText = document.getElementById("recStrategyText");
    const recTradeoffs = document.getElementById("recTradeoffsBox");

    recTitle.textContent = bestDetName;
    recText.textContent = `${bestDetName} achieved the highest empirical detection probability (${bestDetVal}%) and strongest defender utility (${summary.best_strategy.best_defender_utility_val.toFixed(2)}) in this multi-experiment benchmark.`;

    if (bestDetName.includes("Game-Theoretic")) {
        recTradeoffs.innerHTML = `
            <strong>Performance Trade-offs & Rationale:</strong>
            <ul style="margin-top: 0.5rem; padding-left: 1.2rem; line-height: 1.4;">
                <li><strong>Optimal Protection:</strong> Strategically allocates patrol probabilities based on checkpoint values, minimizing high-risk vulnerability.</li>
                <li><strong>Controlled Randomization:</strong> Prevents intruder exploitation without wasting patrol effort equally across low-value locations.</li>
            </ul>
        `;
    } else {
        recTradeoffs.innerHTML = `
            <strong>Performance Trade-offs & Rationale:</strong>
            <ul style="margin-top: 0.5rem; padding-left: 1.2rem; line-height: 1.4;">
                <li><strong>High Coverage Entropy:</strong> Maximizes route randomness, forcing the intruder to make sub-optimal target choices.</li>
                <li><strong>Equal Resource Distribution:</strong> Spreads patrol effort evenly across all feasible routes regardless of checkpoint value.</li>
            </ul>
        `;
    }
}

function renderEvaluationCharts(tabData) {
    const labels = ["Fixed", "Uniform Random", "Game-Theoretic"];
    const colors = ["#ef4444", "#f59e0b", "#10b981"];
    
    const detData = [tabData.fixed.detection_probability * 100, tabData.uniform_random.detection_probability * 100, tabData.game_theoretic.detection_probability * 100];
    const succData = [tabData.fixed.attack_success_rate * 100, tabData.uniform_random.attack_success_rate * 100, tabData.game_theoretic.attack_success_rate * 100];
    const defUtilData = [tabData.fixed.defender_utility, tabData.uniform_random.defender_utility, tabData.game_theoretic.defender_utility];
    const unpredData = [tabData.fixed.unpredictability, tabData.uniform_random.unpredictability, tabData.game_theoretic.unpredictability];
    
    const commonScales = {
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#94a3b8' } },
        x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
    };
    
    const ctxDet = document.getElementById("chartDetection").getContext("2d");
    if (chartDetectionInstance) chartDetectionInstance.destroy();
    chartDetectionInstance = new Chart(ctxDet, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Detection Prob (%)', data: detData, backgroundColor: colors }] },
        options: { responsive: true, maintainAspectRatio: false, scales: commonScales, plugins: { legend: { display: false } } }
    });
    
    const ctxSucc = document.getElementById("chartSuccess").getContext("2d");
    if (chartSuccessInstance) chartSuccessInstance.destroy();
    chartSuccessInstance = new Chart(ctxSucc, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Attack Success Rate (%)', data: succData, backgroundColor: colors }] },
        options: { responsive: true, maintainAspectRatio: false, scales: commonScales, plugins: { legend: { display: false } } }
    });
    
    const ctxDef = document.getElementById("chartDefenderUtility").getContext("2d");
    if (chartDefenderUtilityInstance) chartDefenderUtilityInstance.destroy();
    chartDefenderUtilityInstance = new Chart(ctxDef, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Defender Utility', data: defUtilData, backgroundColor: colors }] },
        options: { responsive: true, maintainAspectRatio: false, scales: commonScales, plugins: { legend: { display: false } } }
    });
    
    const ctxUnpred = document.getElementById("chartUnpredictability").getContext("2d");
    if (chartUnpredictabilityInstance) chartUnpredictabilityInstance.destroy();
    chartUnpredictabilityInstance = new Chart(ctxUnpred, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Normalized Entropy', data: unpredData, backgroundColor: colors }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { ...commonScales, y: { ...commonScales.y, max: 1.0 } }, plugins: { legend: { display: false } } }
    });
}

// Master Action Buttons Logic
async function handleRunFullEvaluation() {
    btnRunFullEval.disabled = true;
    btnRunFullEval.textContent = "Running Full Workflow...";

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
        btnRunFullEval.textContent = "Run Full Evaluation";
    }
}

async function handleRefreshResults() {
    btnRefreshResults.disabled = true;
    btnRefreshResults.textContent = "Refreshing...";
    try {
        const res = await fetch(`${API_BASE_URL}/dashboard/summary`);
        const data = await res.json();
        if (data.has_generated_state) {
            await fetchBaselines();
            if (evaluationData) renderEvaluationDashboard();
        } else {
            alert("No active generated strategy state found. Click 'Generate Strategies' or 'Run Full Evaluation'.");
        }
    } catch (err) {
        console.error("Refresh error:", err);
    } finally {
        btnRefreshResults.disabled = false;
        btnRefreshResults.textContent = "Refresh Results";
    }
}

async function handleResetDashboard() {
    if (!confirm("Are you sure you want to reset the dashboard state?")) return;
    
    btnResetDashboard.disabled = true;
    btnResetDashboard.textContent = "Resetting...";

    try {
        await fetch(`${API_BASE_URL}/dashboard/reset`, { method: 'POST' });
        
        currentStrategies = [];
        highlightedRoute = [];
        currentAttackerTarget = null;
        currentAttackerProbs = {};
        evaluationData = null;

        document.getElementById("strategyTableContainer").style.display = "none";
        document.getElementById("placeholderGen").style.display = "block";
        document.getElementById("placeholderGen").textContent = "Click 'Generate Strategies' to view feasible patrol paths.";
        
        document.getElementById("stackelbergResultsContainer").style.display = "none";
        document.getElementById("attackerResultsSection").style.display = "none";
        document.getElementById("comparisonSection").style.display = "none";
        document.getElementById("simResultsSection").style.display = "none";
        document.getElementById("evalResultsContainer").style.display = "none";

        document.getElementById("insightTextDetection").textContent = "Run evaluation to view empirical detection metrics.";
        document.getElementById("insightTextSuccess").textContent = "Run evaluation to view empirical attack success rates.";
        document.getElementById("insightTextUnpred").textContent = "Run evaluation to view empirical unpredictability metrics.";

        document.getElementById("recStrategyTitle").textContent = "Game-Theoretic Stackelberg Patrol";
        document.getElementById("recStrategyText").textContent = "Run Full Evaluation to determine optimal patrol recommendation.";

        drawGraph();

    } catch (err) {
        console.error("Reset error:", err);
    } finally {
        btnResetDashboard.disabled = false;
        btnResetDashboard.textContent = "Reset Dashboard";
    }
}
