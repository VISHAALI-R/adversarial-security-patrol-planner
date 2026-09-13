import pytest
import numpy as np
from backend.models import CampusGraphModel, NodeModel, EdgeModel
from backend.graph_model import CampusGraph
from backend.stackelberg_solver import get_target_coverage_matrix, solve_stackelberg_game

def test_coverage_matrix():
    strategies = [["1", "2"], ["2", "3"], ["3"]]
    targets = ["1", "2", "3"]
    C = get_target_coverage_matrix(strategies, targets)
    
    # target 1 in strat 0
    assert C[0, 0] == 1
    assert C[0, 1] == 0
    # target 2 in strat 0, 1
    assert C[1, 0] == 1
    assert C[1, 1] == 1
    assert C[1, 2] == 0
    
def test_solve_stackelberg():
    # Simple 2-target example
    # T1: val = 10 (defender_reward=0, penalty=-10, attacker_reward=10, penalty=0)
    # T2: val = 5 (defender_reward=0, penalty=-5, attacker_reward=5, penalty=0)
    # 2 strategies: cover T1, cover T2
    nodes = [
        NodeModel(id="1", name="T1", target_value=10, attacker_reward=10, defender_penalty=-10),
        NodeModel(id="2", name="T2", target_value=5, attacker_reward=5, defender_penalty=-5)
    ]
    graph = CampusGraph(CampusGraphModel(nodes=nodes, edges=[]))
    strategies = [["1"], ["2"]]
    
    probs, cov, attacker_best, u_d, u_a = solve_stackelberg_game(graph, strategies)
    
    # Check probabilities sum to 1
    assert sum(probs) == pytest.approx(1.0, abs=0.001)
    
    # In equilibrium, attacker should be indifferent if possible.
    # U_a(T1) = 10(1-p1)
    # U_a(T2) = 5(1-p2)
    # Since p1+p2=1, 10(1-p1) = 5(p1) => 10 - 10p1 = 5p1 => 15p1 = 10 => p1 = 2/3
    # Wait: U_a(T2) = 5(1 - (1-p1)) = 5p1
    # 10 - 10p1 = 5p1 => 15p1 = 10 => p1 = 2/3, p2 = 1/3
    assert probs[0] == pytest.approx(2/3, abs=0.01)
    assert probs[1] == pytest.approx(1/3, abs=0.01)
