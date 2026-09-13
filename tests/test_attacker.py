import pytest
from backend.models import CampusGraphModel, NodeModel
from backend.graph_model import CampusGraph
from backend.attacker import get_attacker_utilities, evaluate_rational_attacker, evaluate_bounded_rational_attacker

@pytest.fixture
def test_graph():
    nodes = [
        NodeModel(id="1", name="Target A", target_value=10, attacker_reward=10, defender_reward=10, attacker_penalty=-5, defender_penalty=-10),
        NodeModel(id="2", name="Target B", target_value=5, attacker_reward=5, defender_reward=5, attacker_penalty=-2, defender_penalty=-5),
        NodeModel(id="3", name="Target C", target_value=10, attacker_reward=10, defender_reward=20, attacker_penalty=-5, defender_penalty=-5), # Tie break test node
        NodeModel(id="4", name="Target D", target_value=0, attacker_reward=-5, defender_reward=-5, attacker_penalty=-10, defender_penalty=-10) # Negative utility test
    ]
    return CampusGraph(CampusGraphModel(nodes=nodes, edges=[]))

def test_rational_max_utility(test_graph):
    # 1. Rational attacker selects the maximum-utility target.
    # No coverage: A=10, B=5
    res = evaluate_rational_attacker(test_graph, {"1": 0.0, "2": 0.0})
    assert res["best_response"] in ["Target A", "Target C"]

def test_rational_handles_ties(test_graph):
    # 2. Rational attacker handles tied utilities correctly (breaks tie for defender max utility).
    # A and C have attacker reward = 10.
    # A defender reward = 10, C defender reward = 20.
    # Attacker tie breaks in favor of defender -> Target C should be chosen.
    res = evaluate_rational_attacker(test_graph, {"1": 0.0, "3": 0.0})
    assert res["best_response"] == "Target C"
    assert res["best_response_utility"] == 10.0

def test_bounded_probs_sum_to_one(test_graph):
    # 3. Bounded-rational probabilities sum to 1.
    res = evaluate_bounded_rational_attacker(test_graph, {}, lambda_val=1.0)
    probs_sum = sum(res["target_probabilities"].values())
    assert pytest.approx(probs_sum) == 1.0

def test_higher_lambda_closer_to_best_response(test_graph):
    # 4. Higher lambda produces behavior closer to the best response.
    # Best response is A or C (10) vs B (5).
    res_low = evaluate_bounded_rational_attacker(test_graph, {}, lambda_val=0.1)
    res_high = evaluate_bounded_rational_attacker(test_graph, {}, lambda_val=2.0)
    assert res_high["target_probabilities"]["Target A"] > res_low["target_probabilities"]["Target A"]

def test_lower_lambda_more_distributed(test_graph):
    # 5. Lower lambda produces a more distributed probability.
    res_low = evaluate_bounded_rational_attacker(test_graph, {}, lambda_val=0.01)
    # Target A and Target B probabilities should be closer to each other than with lambda=1.0
    res_high = evaluate_bounded_rational_attacker(test_graph, {}, lambda_val=1.0)
    diff_low = abs(res_low["target_probabilities"]["Target A"] - res_low["target_probabilities"]["Target B"])
    diff_high = abs(res_high["target_probabilities"]["Target A"] - res_high["target_probabilities"]["Target B"])
    assert diff_low < diff_high

def test_negative_utilities_handled(test_graph):
    # 6. Negative utilities are handled correctly.
    # If all targets have negative expected utility, attacker still chooses best (least negative).
    # Coverage = 1.0 means attacker gets penalty.
    # A penalty = -5, B penalty = -2.
    res = evaluate_rational_attacker(test_graph, {"1": 1.0, "2": 1.0, "3": 1.0, "4": 1.0})
    assert res["best_response"] == "Target B"
    assert res["best_response_utility"] == -2.0

def test_invalid_lambda_rejected(test_graph):
    # 7. Zero/invalid lambda is rejected.
    with pytest.raises(ValueError):
        evaluate_bounded_rational_attacker(test_graph, {}, lambda_val=0.0)
    with pytest.raises(ValueError):
        evaluate_bounded_rational_attacker(test_graph, {}, lambda_val=-1.0)

def test_missing_target_data_handled(test_graph):
    # 8. Missing target data is handled safely.
    # Target not explicitly covered defaults to 0 coverage.
    res = evaluate_rational_attacker(test_graph, {"1": 1.0}) # 2, 3, 4 missing
    assert "Target B" in res["target_utilities"]
    assert res["target_utilities"]["Target B"] == 5.0 # (1 - 0) * 5

def test_attacker_uses_actual_coverage(test_graph):
    # 9. Attacker uses actual Stackelberg coverage probabilities.
    # If A has 10 reward, B has 5 reward.
    # We set coverage for A such that it is less appealing than B.
    # A utility = 0.6 * (-5) + 0.4 * 10 = -3 + 4 = 1
    # C utility = 0.6 * (-5) + 0.4 * 10 = 1
    # B utility = 5
    res = evaluate_rational_attacker(test_graph, {"1": 0.6, "2": 0.0, "3": 0.6})
    assert res["best_response"] == "Target B"

def test_results_are_reproducible(test_graph):
    # 10. Results are reproducible where randomness is used by the simulation.
    # The bounded_rational_attacker math should be deterministic for the same inputs.
    res1 = evaluate_bounded_rational_attacker(test_graph, {"1": 0.5, "2": 0.2}, lambda_val=1.5)
    res2 = evaluate_bounded_rational_attacker(test_graph, {"1": 0.5, "2": 0.2}, lambda_val=1.5)
    assert res1["target_probabilities"] == res2["target_probabilities"]
