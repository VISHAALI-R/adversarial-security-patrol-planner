import pytest
from backend.models import CampusGraphModel, NodeModel
from backend.graph_model import CampusGraph
from backend.simulation import run_simulation
from backend.evaluation import evaluate_performance

def test_simulation_engine():
    nodes = [
        NodeModel(id="1", name="T1", attacker_reward=10, defender_penalty=-10)
    ]
    graph = CampusGraph(CampusGraphModel(nodes=nodes, edges=[]))
    strategies = [["1"]]
    probs = [1.0] # always patrolled
    
    res = run_simulation(graph, strategies, probs, 100, "rational", 1.0)
    assert res["detected_count"] == 100
    assert res["successful_attacks"] == 0
    
def test_evaluation():
    sim_res = {
        "num_simulations": 100,
        "detected_count": 80,
        "successful_attacks": 20,
        "avg_defender_utility": -2.0,
        "avg_attacker_utility": 2.0
    }
    probs = [0.5, 0.5]
    metrics = evaluate_performance(sim_res, probs)
    
    assert metrics["detection_probability"] == 0.8
    assert metrics["attack_success_rate"] == 0.2
    assert metrics["unpredictability_entropy"] > 0
