import pytest
import numpy as np
from backend.models import CampusGraphModel, NodeModel
from backend.graph_model import CampusGraph
from backend.evaluation import (
    calculate_entropy,
    calculate_normalized_entropy,
    calculate_wilson_ci,
    evaluate_performance,
    aggregate_experiments,
    evaluate_policies,
    evaluate_all_attacker_models
)

def create_sample_graph():
    nodes = [
        NodeModel(id="1", name="Target 1", target_value=10, defender_reward=10, defender_penalty=-10, attacker_reward=10, attacker_penalty=-2),
        NodeModel(id="2", name="Target 2", target_value=5, defender_reward=5, defender_penalty=-5, attacker_reward=5, attacker_penalty=-1)
    ]
    return CampusGraph(CampusGraphModel(nodes=nodes, edges=[]))

# 1. Detection probability calculation
def test_1_detection_probability_calculation():
    sim_res = {"rounds": 100, "detected_attacks": 75, "average_defender_utility": 0.0, "average_attacker_utility": 0.0}
    metrics = evaluate_performance(sim_res, [0.5, 0.5])
    assert abs(metrics["detection_probability"] - 0.75) < 1e-4

# 2. Attack success calculation
def test_2_attack_success_calculation():
    sim_res = {"rounds": 100, "detected_attacks": 75, "average_defender_utility": 0.0, "average_attacker_utility": 0.0}
    metrics = evaluate_performance(sim_res, [0.5, 0.5])
    assert abs(metrics["attack_success_rate"] - 0.25) < 1e-4

# 3. Average utility calculation
def test_3_average_utility_calculation():
    sim_res = {"rounds": 100, "detected_attacks": 50, "average_defender_utility": 4.5, "average_attacker_utility": -1.2}
    metrics = evaluate_performance(sim_res, [1.0])
    assert metrics["defender_utility"] == 4.5
    assert metrics["attacker_utility"] == -1.2

# 4. Entropy calculation
def test_4_entropy_calculation():
    probs = [0.5, 0.5]
    h = calculate_entropy(probs)
    expected_h = -(0.5 * np.log(0.5) + 0.5 * np.log(0.5))
    assert abs(h - expected_h) < 1e-4

# 5. Normalized entropy calculation
def test_5_normalized_entropy_calculation():
    probs = [0.5, 0.5]
    norm_h = calculate_normalized_entropy(probs)
    assert abs(norm_h - 1.0) < 1e-4

# 6. Wilson confidence interval
def test_6_wilson_confidence_interval():
    p, lower, upper = calculate_wilson_ci(78, 100)
    assert abs(p - 0.78) < 1e-4
    assert 0.0 <= lower <= p <= upper <= 1.0
    assert abs(lower - 0.6888) < 0.05
    assert abs(upper - 0.8504) < 0.05

# 7. Policy comparison
def test_7_policy_comparison():
    graph = create_sample_graph()
    strategies = [["1"], ["2"]]
    stack_probs = [0.6, 0.4]
    
    res = evaluate_policies(graph, strategies, stack_probs, rounds=100, experiments=3, attacker_type="rational", random_seed=42)
    assert "policies" in res
    assert "fixed" in res["policies"]
    assert "uniform_random" in res["policies"]
    assert "game_theoretic" in res["policies"]

# 8. Rational attacker comparison
def test_8_rational_attacker_comparison():
    graph = create_sample_graph()
    strategies = [["1"], ["2"]]
    stack_probs = [0.7, 0.3]
    
    res = evaluate_policies(graph, strategies, stack_probs, rounds=50, experiments=2, attacker_type="rational", random_seed=42)
    assert "best_strategy" in res
    assert res["explanation"] != ""

# 9. Bounded-rational attacker comparison
def test_9_bounded_rational_attacker_comparison():
    graph = create_sample_graph()
    strategies = [["1"], ["2"]]
    stack_probs = [0.7, 0.3]
    
    res = evaluate_policies(graph, strategies, stack_probs, rounds=50, experiments=2, attacker_type="bounded", lambda_val=1.5, random_seed=42)
    assert res["policies"]["game_theoretic"]["detection_probability"] >= 0.0

# 10. Multiple experiment aggregation
def test_10_multiple_experiment_aggregation():
    data = [
        {"detection_probability": 0.8, "attack_success_rate": 0.2, "defender_utility": 5.0, "attacker_utility": -2.0, "unpredictability": 0.9},
        {"detection_probability": 0.6, "attack_success_rate": 0.4, "defender_utility": 3.0, "attacker_utility": -1.0, "unpredictability": 0.9}
    ]
    agg = aggregate_experiments(data, total_detected=140, total_rounds=200)
    assert abs(agg["detection_probability"] - 0.7) < 1e-4
    assert abs(agg["attack_success_rate"] - 0.3) < 1e-4

# 11. Mean, min, max, std calculation
def test_11_mean_min_max_std_calculation():
    data = [
        {"detection_probability": 0.8, "attack_success_rate": 0.2, "defender_utility": 5.0, "attacker_utility": -2.0, "unpredictability": 1.0},
        {"detection_probability": 0.6, "attack_success_rate": 0.4, "defender_utility": 3.0, "attacker_utility": -1.0, "unpredictability": 1.0}
    ]
    agg = aggregate_experiments(data, total_detected=140, total_rounds=200)
    det_stats = agg["stats"]["detection_probability"]
    assert det_stats["mean"] == 0.7
    assert det_stats["min"] == 0.6
    assert det_stats["max"] == 0.8
    assert abs(det_stats["std"] - 0.1) < 1e-4

# 12. Correct identification of best-performing policy
def test_12_best_performing_policy_identification():
    graph = create_sample_graph()
    strategies = [["1"], ["2"]]
    stack_probs = [0.8, 0.2]
    
    res = evaluate_policies(graph, strategies, stack_probs, rounds=100, experiments=3, random_seed=42)
    best_det = res["best_strategy"]["best_detection"]
    assert best_det in ["Fixed Schedule Patrol", "Uniform Random Patrol", "Game-Theoretic Stackelberg Patrol"]

# 13. Zero / invalid simulation data handling
def test_13_zero_invalid_data_handling():
    m = evaluate_performance({"rounds": 0, "detected_attacks": 0}, [])
    assert m["detection_probability"] == 0.0
    assert m["confidence_interval_lower"] == 0.0
    assert m["confidence_interval_upper"] == 0.0
    assert m["unpredictability"] == 0.0

# 14. Single-strategy entropy handling
def test_14_single_strategy_entropy_handling():
    probs = [1.0]
    h = calculate_entropy(probs)
    norm_h = calculate_normalized_entropy(probs)
    assert h == 0.0
    assert norm_h == 0.0

# 15. Probability values remaining within valid ranges
def test_15_probability_valid_ranges():
    graph = create_sample_graph()
    strategies = [["1"], ["2"]]
    stack_probs = [0.5, 0.5]
    
    res = evaluate_all_attacker_models(graph, strategies, stack_probs, rounds=50, experiments=2, random_seed=42)
    for model_key in ["rational_attacker", "bounded_rational_attacker"]:
        for pol_key, pol_metrics in res[model_key].items():
            assert 0.0 <= pol_metrics["detection_probability"] <= 1.0
            assert 0.0 <= pol_metrics["confidence_interval_lower"] <= pol_metrics["confidence_interval_upper"] <= 1.0
            assert 0.0 <= pol_metrics["attack_success_rate"] <= 1.0
            assert 0.0 <= pol_metrics["unpredictability"] <= 1.0
