import math
import numpy as np
from typing import List, Dict, Any, Tuple, Optional
from backend.baselines import get_patrol_policy
from backend.simulation import run_engine_simulation

def calculate_entropy(probabilities: List[float]) -> float:
    """
    Calculates Shannon entropy H = -sum(p_i * ln(p_i)) for a given probability distribution.
    
    Note: Entropy is used as a proxy for patrol-policy unpredictability, not as a perfect
    measurement of real-world unpredictability.
    """
    if not probabilities:
        return 0.0
    probs = np.array(probabilities, dtype=float)
    probs = probs[probs > 1e-10]
    if len(probs) == 0:
        return 0.0
    return float(-np.sum(probs * np.log(probs)))

def calculate_normalized_entropy(probabilities: List[float]) -> float:
    """
    Calculates normalized Shannon entropy H / ln(N), where N is the total number
    of feasible patrol strategies. If N <= 1, returns 0.0.
    
    Note: Entropy is used as a proxy for patrol-policy unpredictability, not as a perfect
    measurement of real-world unpredictability.
    """
    n = len(probabilities)
    if n <= 1:
        return 0.0
    h = calculate_entropy(probabilities)
    max_h = math.log(n)
    if max_h <= 1e-10:
        return 0.0
    norm_h = h / max_h
    return float(np.clip(norm_h, 0.0, 1.0))

def calculate_wilson_ci(k: int, n: int, confidence: float = 0.95) -> Tuple[float, float, float]:
    """
    Calculates the 95% Wilson score interval for binomial detection probability (k successes in n trials).
    Returns (detection_probability, lower_bound, upper_bound).
    """
    if n <= 0:
        return (0.0, 0.0, 0.0)
    
    p = k / n
    if confidence == 0.95:
        z = 1.959963984540054
    else:
        z = 1.96
        
    denom = 1.0 + (z**2) / n
    center = (p + (z**2) / (2 * n)) / denom
    half_width = (z * math.sqrt((p * (1.0 - p) / n) + ((z**2) / (4 * (n**2))))) / denom
    
    lower = max(0.0, center - half_width)
    upper = min(1.0, center + half_width)
    
    return (float(p), float(lower), float(upper))

def evaluate_performance(sim_results: Dict[str, Any], probabilities: List[float]) -> Dict[str, Any]:
    """
    Calculates single-simulation metrics including detection prob, attack success, utilities,
    unpredictability, and Wilson confidence interval. Maintains backward compatibility with Step 6.
    """
    num_sims = sim_results.get("rounds", sim_results.get("num_simulations", 1))
    detected = sim_results.get("detected_attacks", sim_results.get("detected_count", 0))
    
    if num_sims <= 0:
        det_prob = 0.0
        succ_rate = 0.0
        ci_lower = 0.0
        ci_upper = 0.0
    else:
        det_prob, ci_lower, ci_upper = calculate_wilson_ci(detected, num_sims)
        succ_rate = (num_sims - detected) / num_sims
        
    entropy = calculate_entropy(probabilities)
    norm_entropy = calculate_normalized_entropy(probabilities)
    
    return {
        "detection_probability": det_prob,
        "confidence_interval_lower": ci_lower,
        "confidence_interval_upper": ci_upper,
        "attack_success_rate": succ_rate,
        "defender_utility": float(sim_results.get("average_defender_utility", sim_results.get("avg_defender_utility", 0.0))),
        "attacker_utility": float(sim_results.get("average_attacker_utility", sim_results.get("avg_attacker_utility", 0.0))),
        "unpredictability_entropy": entropy,
        "unpredictability": norm_entropy,
        "normalized_entropy": norm_entropy
    }

def aggregate_experiments(experiments_data: List[Dict[str, float]], total_detected: int, total_rounds: int) -> Dict[str, Any]:
    """
    Aggregates metrics across multiple independent simulation experiments.
    Returns mean, min, max, std for each major metric along with overall Wilson CI.
    """
    if not experiments_data:
        return {
            "detection_probability": 0.0,
            "confidence_interval_lower": 0.0,
            "confidence_interval_upper": 0.0,
            "attack_success_rate": 0.0,
            "defender_utility": 0.0,
            "attacker_utility": 0.0,
            "unpredictability": 0.0,
            "metrics_stats": {}
        }
        
    det_probs = [d["detection_probability"] for d in experiments_data]
    succ_rates = [d["attack_success_rate"] for d in experiments_data]
    def_utils = [d["defender_utility"] for d in experiments_data]
    att_utils = [d["attacker_utility"] for d in experiments_data]
    unpredictabilities = [d["unpredictability"] for d in experiments_data]
    
    _, ci_lower, ci_upper = calculate_wilson_ci(total_detected, total_rounds)
    
    def compute_stats(arr: List[float]) -> Dict[str, float]:
        a = np.array(arr, dtype=float)
        return {
            "mean": float(np.mean(a)),
            "min": float(np.min(a)),
            "max": float(np.max(a)),
            "std": float(np.std(a))
        }
        
    det_stats = compute_stats(det_probs)
    succ_stats = compute_stats(succ_rates)
    def_stats = compute_stats(def_utils)
    att_stats = compute_stats(att_utils)
    unpred_stats = compute_stats(unpredictabilities)
    
    return {
        "detection_probability": det_stats["mean"],
        "confidence_interval_lower": ci_lower,
        "confidence_interval_upper": ci_upper,
        "attack_success_rate": succ_stats["mean"],
        "defender_utility": def_stats["mean"],
        "attacker_utility": att_stats["mean"],
        "unpredictability": unpred_stats["mean"],
        "stats": {
            "detection_probability": det_stats,
            "attack_success_rate": succ_stats,
            "defender_utility": def_stats,
            "attacker_utility": att_stats,
            "unpredictability": unpred_stats
        }
    }

def evaluate_policy_single_or_multi(
    graph: Any,
    strategies: List[Any],
    stackelberg_probs: List[float],
    policy_type: str,
    attacker_type: str = "rational",
    rounds: int = 1000,
    experiments: int = 10,
    lambda_val: float = 1.0,
    random_seed: Optional[int] = 42
) -> Dict[str, Any]:
    """
    Evaluates a specific patrol policy across multiple independent simulation experiments.
    Ensures statistical fairness by maintaining identical inputs across policies.
    """
    policy = get_patrol_policy(policy_type, strategies, stackelberg_probs)
    probs_list = list(policy.get("probabilities", {}).values())
    
    exp_metrics_list = []
    total_detected = 0
    total_rounds = 0
    
    for exp_idx in range(experiments):
        seed = (random_seed + exp_idx * 100) if random_seed is not None else None
        sim_res = run_engine_simulation(
            graph=graph,
            strategies=strategies,
            stackelberg_probs=stackelberg_probs,
            num_rounds=rounds,
            patrol_policy=policy_type,
            attacker_type=attacker_type,
            lambda_val=lambda_val,
            random_seed=seed
        )
        
        m = evaluate_performance(sim_res, probs_list)
        exp_metrics_list.append(m)
        
        total_detected += sim_res.get("detected_attacks", 0)
        total_rounds += rounds

    aggregated = aggregate_experiments(exp_metrics_list, total_detected, total_rounds)
    return aggregated

def evaluate_policies(
    graph: Any,
    strategies: List[Any],
    stackelberg_probs: List[float],
    rounds: int = 1000,
    experiments: int = 10,
    attacker_type: str = "rational",
    lambda_val: float = 1.0,
    random_seed: Optional[int] = 42
) -> Dict[str, Any]:
    """
    Evaluates Fixed, Uniform Random, and Game-Theoretic policies for a single attacker model.
    Determines best performing policies empirically and generates concise explanation.
    """
    policies = ["fixed", "uniform_random", "game_theoretic"]
    results = {}
    
    for pol in policies:
        results[pol] = evaluate_policy_single_or_multi(
            graph=graph,
            strategies=strategies,
            stackelberg_probs=stackelberg_probs,
            policy_type=pol,
            attacker_type=attacker_type,
            rounds=rounds,
            experiments=experiments,
            lambda_val=lambda_val,
            random_seed=random_seed
        )
        
    # Determine best strategies empirically from actual results
    best_det_policy = max(policies, key=lambda p: results[p]["detection_probability"])
    best_def_policy = max(policies, key=lambda p: results[p]["defender_utility"])
    most_unpred_policy = max(policies, key=lambda p: results[p]["unpredictability"])
    
    policy_names = {
        "fixed": "Fixed Schedule Patrol",
        "uniform_random": "Uniform Random Patrol",
        "game_theoretic": "Game-Theoretic Stackelberg Patrol"
    }
    
    best_summary = {
        "best_detection": policy_names[best_det_policy],
        "best_detection_val": results[best_det_policy]["detection_probability"],
        "best_defender_utility": policy_names[best_def_policy],
        "best_defender_utility_val": results[best_def_policy]["defender_utility"],
        "most_unpredictable": policy_names[most_unpred_policy],
        "most_unpredictable_val": results[most_unpred_policy]["unpredictability"]
    }
    
    # Generate dynamic explanation strictly backed by empirical findings
    gt_det = results["game_theoretic"]["detection_probability"]
    ur_det = results["uniform_random"]["detection_probability"]
    fx_det = results["fixed"]["detection_probability"]
    
    if best_det_policy == "game_theoretic":
        explanation = (
            f"The Game-Theoretic policy achieved the highest detection probability ({gt_det*100:.1f}%) "
            f"in this experiment because its patrol probabilities were optimized against the attacker's best response, "
            f"outperforming Uniform Random ({ur_det*100:.1f}%) and Fixed Schedule ({fx_det*100:.1f}%)."
        )
    elif best_det_policy == "uniform_random":
        explanation = (
            f"The Uniform Random policy achieved the highest detection probability ({ur_det*100:.1f}%) "
            f"under this specific setup, providing high coverage entropy compared to Game-Theoretic ({gt_det*100:.1f}%) "
            f"and Fixed Schedule ({fx_det*100:.1f}%)."
        )
    else:
        explanation = (
            f"The Fixed Schedule policy achieved a detection probability of {fx_det*100:.1f}%, "
            f"compared to {gt_det*100:.1f}% for Game-Theoretic and {ur_det*100:.1f}% for Uniform Random."
        )
        
    return {
        "policies": results,
        "best_strategy": best_summary,
        "explanation": explanation
    }

def evaluate_all_attacker_models(
    graph: Any,
    strategies: List[Any],
    stackelberg_probs: List[float],
    rounds: int = 1000,
    experiments: int = 10,
    lambda_val: float = 1.0,
    random_seed: Optional[int] = 42
) -> Dict[str, Any]:
    """
    Evaluates policy performance under both Rational and Bounded-Rational attacker models.
    Returns structured results matching Step 7 requirements.
    """
    rational_res = evaluate_policies(
        graph=graph,
        strategies=strategies,
        stackelberg_probs=stackelberg_probs,
        rounds=rounds,
        experiments=experiments,
        attacker_type="rational",
        lambda_val=lambda_val,
        random_seed=random_seed
    )
    
    bounded_res = evaluate_policies(
        graph=graph,
        strategies=strategies,
        stackelberg_probs=stackelberg_probs,
        rounds=rounds,
        experiments=experiments,
        attacker_type="bounded",
        lambda_val=lambda_val,
        random_seed=random_seed
    )
    
    return {
        "rational_attacker": rational_res["policies"],
        "bounded_rational_attacker": bounded_res["policies"],
        "rational_summary": {
            "best_strategy": rational_res["best_strategy"],
            "explanation": rational_res["explanation"]
        },
        "bounded_summary": {
            "best_strategy": bounded_res["best_strategy"],
            "explanation": bounded_res["explanation"]
        }
    }
