import pytest
from backend.baselines import get_patrol_policy, sample_patrol_strategy

def test_fixed_policy_always_selects_same_strategy():
    # 1. Fixed policy always selects the same strategy.
    policy = get_patrol_policy("fixed", ["a", "b"], [0.5, 0.5], "S2")
    assert policy["selected_strategy"] == "S2"
    assert policy["probabilities"]["S2"] == 1.0

def test_fixed_probabilities_sum_to_1():
    # 2. Fixed probabilities sum to 1.
    policy = get_patrol_policy("fixed", ["a", "b", "c"], [0.3, 0.3, 0.4])
    # Defaults to S1 if no fixed_id provided
    assert sum(policy["probabilities"].values()) == 1.0

def test_uniform_probabilities_are_equal():
    # 3. Uniform probabilities are equal.
    policy = get_patrol_policy("uniform_random", ["a", "b", "c", "d"], [])
    probs = list(policy["probabilities"].values())
    assert all(p == 0.25 for p in probs)

def test_uniform_probabilities_sum_to_1():
    # 4. Uniform probabilities sum to 1.
    policy = get_patrol_policy("uniform_random", ["a", "b", "c"], [])
    assert pytest.approx(sum(policy["probabilities"].values())) == 1.0

def test_game_theoretic_probabilities_match():
    # 5. Game-theoretic probabilities exactly match Step 3 output.
    stack_probs = [0.1, 0.2, 0.7]
    policy = get_patrol_policy("game_theoretic", ["a", "b", "c"], stack_probs)
    assert pytest.approx(policy["probabilities"]["S1"]) == 0.1
    assert pytest.approx(policy["probabilities"]["S2"]) == 0.2
    assert pytest.approx(policy["probabilities"]["S3"]) == 0.7

def test_weighted_sampling_respects_probabilities():
    # 6. Weighted sampling respects probabilities.
    policy = {
        "probabilities": {
            "S1": 1.0,
            "S2": 0.0
        }
    }
    # It should always pick S1
    for _ in range(10):
        assert sample_patrol_strategy(policy) == "S1"

def test_invalid_policy_type_returns_error():
    # 7. Invalid policy type returns an appropriate error.
    with pytest.raises(ValueError):
        get_patrol_policy("unknown_policy", ["a"], [])

def test_empty_strategy_list_handled_safely():
    # 8. Empty strategy list is handled safely.
    policy = get_patrol_policy("uniform_random", [], [])
    assert policy["probabilities"] == {}
    with pytest.raises(ValueError):
        sample_patrol_strategy(policy)

def test_probability_values_are_valid():
    # 9. Probability values are valid (no negatives).
    # Game theoretic with negative input should floor to 0
    policy = get_patrol_policy("game_theoretic", ["a", "b"], [-0.5, 1.5])
    assert policy["probabilities"]["S1"] == 0.0
    assert policy["probabilities"]["S2"] == 1.0
    
    with pytest.raises(ValueError, match="Probabilities cannot be negative"):
        sample_patrol_strategy({"probabilities": {"S1": -0.5, "S2": 1.5}})

def test_dynamic_strategy_counts_work_correctly():
    # 10. Dynamic strategy counts work correctly.
    strategies = [f"Strat_{i}" for i in range(10)]
    policy = get_patrol_policy("uniform_random", strategies, [])
    assert len(policy["probabilities"]) == 10
    assert policy["probabilities"]["S10"] == 0.1
