import pytest
from fastapi.testclient import TestClient
from backend.main import app, DEFAULT_CAMPUS

client = TestClient(app)

def test_dashboard_summary_api():
    response = client.get("/api/dashboard/summary")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "campus" in data
    assert "strategy_count" in data

def test_dashboard_reset_api():
    response = client.post("/api/dashboard/reset")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"

def test_full_workflow_api():
    # 1. Reset
    client.post("/api/dashboard/reset")
    
    # 2. Generate Strategies
    gen_res = client.post("/api/strategies/generate", json={
        "patrol_units": 1,
        "shift_duration": 30.0,
        "max_checkpoints": 5
    })
    assert gen_res.status_code == 200
    assert gen_res.json()["total_strategies"] > 0
    
    # 3. Solve Stackelberg
    strategies = [s["route"] for s in gen_res.json()["strategies"]]
    solve_res = client.post("/api/stackelberg/solve", json={
        "game_config": {
            "patrol_units": 1,
            "shift_duration": 30.0,
            "graph": DEFAULT_CAMPUS
        },
        "num_simulations": 1,
        "attacker_config": {"type": "rational", "lambda_val": 1.0},
        "strategy_probabilities": {},
        "strategies": strategies
    })

    assert solve_res.status_code == 200
    
    # 4. Attacker Evaluation
    att_res = client.post("/api/attacker/evaluate", json={"attacker_type": "rational"})
    assert att_res.status_code == 200
    
    # 5. Simulation Engine
    sim_res = client.post("/api/simulation/run", json={
        "rounds": 50,
        "patrol_policy": "game_theoretic",
        "attacker_type": "rational",
        "lambda": 1.0,
        "random_seed": 42
    })
    assert sim_res.status_code == 200
    assert sim_res.json()["rounds"] == 50
    
    # 6. Evaluation Compare
    eval_res = client.post("/api/evaluation/compare", json={
        "rounds": 50,
        "experiments": 2,
        "lambda": 1.0,
        "random_seed": 42
    })
    assert eval_res.status_code == 200
    assert "rational_attacker" in eval_res.json()
    assert "bounded_rational_attacker" in eval_res.json()
