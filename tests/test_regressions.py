"""Regression tests for bugs found during the end-to-end audit."""
import numpy as np
import pytest

from backend.main import DEFAULT_CAMPUS
from backend.models import CampusGraphModel
from backend.graph_model import CampusGraph
from backend.strategy_generator import generate_feasible_strategies
from backend.stackelberg_solver import solve_stackelberg_game, get_target_coverage_matrix
from backend.attacker import evaluate_rational_attacker
from backend.simulation import run_engine_simulation


@pytest.fixture(scope="module")
def graph():
    return CampusGraph(CampusGraphModel(**DEFAULT_CAMPUS))


def routes(graph, shift, checkpoints):
    return [s["route_ids"] for s in generate_feasible_strategies(graph, shift, checkpoints)]


@pytest.mark.parametrize("shift,checkpoints", [(5, 3), (8, 4), (10, 4), (15, 5), (30, 5)])
def test_attacker_actually_picks_the_solvers_target(graph, shift, checkpoints):
    """The SSE must survive normalisation: a rational attacker facing the returned
    probabilities must choose the target the solver assumed (no rounding-induced flip)."""
    S = routes(graph, shift, checkpoints)
    p, cov, target, u_d, _ = solve_stackelberg_game(graph, S)

    nodes = graph.get_nodes()
    C = get_target_coverage_matrix(S, nodes)
    coverage = {n: float(x) for n, x in zip(nodes, C @ np.array(p))}
    chosen = evaluate_rational_attacker(graph, coverage)["best_response"]
    assert chosen == graph.get_node_data(target)["name"]
    assert sum(p) == pytest.approx(1.0)
    assert min(p) >= 0.0


def test_simulation_defender_utility_matches_solver(graph):
    S = routes(graph, 30, 5)
    p, _, _, u_d, _ = solve_stackelberg_game(graph, S)
    res = run_engine_simulation(graph, S, p, 6000, "game_theoretic", "rational", random_seed=7)
    assert res["average_defender_utility"] == pytest.approx(u_d, abs=0.25)


def test_bounded_attacker_samples_targets_not_argmax(graph):
    """With a tiny lambda the quantal-response attacker is almost uniform, so over many
    rounds it must hit many different targets (previously it always took the argmax)."""
    S = routes(graph, 30, 5)
    p, *_ = solve_stackelberg_game(graph, S)
    # recent_log only holds the last 10 rounds, so collect targets across many short runs
    seen = set()
    for seed in range(40):
        r = run_engine_simulation(graph, S, p, 10, "uniform_random", "bounded", 0.01, random_seed=seed)
        seen.update(e["attacker_target"] for e in r["recent_log"])
    assert len(seen) >= 4


def test_large_lambda_bounded_matches_rational(graph):
    S = routes(graph, 30, 5)
    p, *_ = solve_stackelberg_game(graph, S)
    rat = run_engine_simulation(graph, S, p, 200, "uniform_random", "rational", random_seed=1)
    bnd = run_engine_simulation(graph, S, p, 200, "uniform_random", "bounded", 500.0, random_seed=1)
    assert {e["attacker_target"] for e in bnd["recent_log"]} == {e["attacker_target"] for e in rat["recent_log"]}


def test_api_flow_generate_then_solve_uses_node_ids():
    """The dashboard sends the routes it got from /strategies/generate straight to
    /stackelberg/solve. Those routes must carry node ids (not display names), otherwise the
    coverage matrix is all zeros and the 'equilibrium' is meaningless."""
    from fastapi.testclient import TestClient
    from backend.main import app

    client = TestClient(app)
    gen = client.post("/api/strategies/generate", json={"shift_duration": 30, "max_checkpoints": 5}).json()
    assert all(s["route_ids"] for s in gen["strategies"])

    for key in ("route_ids", "route"):  # ids from the response, or names as a fallback
        payload = {
            "game_config": {"shift_duration": 30, "graph": DEFAULT_CAMPUS},
            "attacker_config": {"type": "rational"},
            "strategy_probabilities": {},
            "strategies": [s[key] for s in gen["strategies"]],
        }
        res = client.post("/api/stackelberg/solve", json=payload)
        assert res.status_code == 200
        body = res.json()
        assert max(body["target_coverage"].values()) > 0.5
        assert sum(1 for p in body["probabilities"] if p > 1e-6) > 1
        assert body["defender_utility"] > 0


def test_solve_rejects_unknown_checkpoints():
    from fastapi.testclient import TestClient
    from backend.main import app

    res = TestClient(app).post("/api/stackelberg/solve", json={
        "game_config": {"shift_duration": 30, "graph": DEFAULT_CAMPUS},
        "attacker_config": {"type": "rational"},
        "strategy_probabilities": {},
        "strategies": [["nowhere"]],
    })
    assert res.status_code == 422


def test_fixed_route_choice_reaches_simulation_and_benchmark():
    from fastapi.testclient import TestClient
    from backend.main import app

    client = TestClient(app)
    gen = client.post("/api/strategies/generate", json={"shift_duration": 30, "max_checkpoints": 5}).json()
    payload = {
        "game_config": {"shift_duration": 30, "graph": DEFAULT_CAMPUS},
        "attacker_config": {"type": "rational"},
        "strategy_probabilities": {},
        "strategies": [s["route_ids"] for s in gen["strategies"]],
    }
    client.post("/api/stackelberg/solve", json=payload)

    # S1 is Admin Office alone (covers no high-value target); S36 is a long route through the server room.
    weak = client.post("/api/simulation/run", json={"rounds": 200, "patrol_policy": "fixed", "random_seed": 1, "fixed_id": "S1"}).json()
    strong = client.post("/api/simulation/run", json={"rounds": 200, "patrol_policy": "fixed", "random_seed": 1, "fixed_id": "S36"}).json()
    assert {e["patrol_strategy"] for e in weak["recent_log"]} == {"S1"}
    assert {e["patrol_strategy"] for e in strong["recent_log"]} == {"S36"}
    # A rational attacker always dodges a deterministic route (detection 0 either way), but the
    # best target left uncovered is worth 10 against S1 and only 6 against S36.
    assert weak["average_defender_utility"] == pytest.approx(-10.0)
    assert strong["average_defender_utility"] == pytest.approx(-6.0)

    ev = client.post("/api/evaluation/compare", json={"rounds": 100, "experiments": 2, "fixed_id": "S36"}).json()
    ev_default = client.post("/api/evaluation/compare", json={"rounds": 100, "experiments": 2}).json()
    assert ev["rational_attacker"]["fixed"]["defender_utility"] > ev_default["rational_attacker"]["fixed"]["defender_utility"]
