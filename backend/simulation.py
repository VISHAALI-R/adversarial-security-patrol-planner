import numpy as np
import random
from typing import List, Dict, Any
from backend.graph_model import CampusGraph
from backend.attacker import evaluate_rational_attacker, evaluate_bounded_rational_attacker
from backend.baselines import get_patrol_policy, sample_patrol_strategy

def run_engine_simulation(
    graph: CampusGraph, 
    strategies: List[Any], 
    stackelberg_probs: List[float], 
    num_rounds: int,
    patrol_policy: str = "game_theoretic",
    attacker_type: str = "rational",
    lambda_val: float = 1.0,
    random_seed: int = None,
    fixed_id: str = None
) -> Dict[str, Any]:
    
    if num_rounds <= 0:
        raise ValueError("Number of simulation rounds must be greater than 0")
        
    if random_seed is not None:
        np.random.seed(random_seed)
        random.seed(random_seed)

    # Standardize strategies format if passed as raw list of route_ids
    norm_strategies = []
    for i, s in enumerate(strategies):
        if isinstance(s, dict):
            norm_strategies.append(s)
        elif isinstance(s, list):
            norm_strategies.append({
                "strategy_id": i + 1,
                "route_ids": s,
                "route": s
            })
        else:
            norm_strategies.append({"strategy_id": i + 1, "route_ids": []})
    strategies = norm_strategies
        
    policy = get_patrol_policy(patrol_policy, strategies, stackelberg_probs, fixed_id)
    probs_dict = policy.get("probabilities", {})
    
    if not probs_dict:
        raise ValueError("No valid strategies found to simulate.")
        
    target_coverage = {target_id: 0.0 for target_id in graph.get_nodes()}
    
    # Map node names to node IDs safely for both ID and name representations
    name_to_id = {graph.get_node_data(n_id).get("name", n_id): n_id for n_id in graph.get_nodes()}
    for n_id in graph.get_nodes():
        name_to_id[n_id] = n_id

    for i, strat_dict in enumerate(strategies):
        s_id = f"S{i+1}"
        p = probs_dict.get(s_id, 0.0)
        route_nodes = strat_dict.get("route_ids", strat_dict.get("route", []))
        for node in route_nodes:
            n_key = name_to_id.get(node, node)
            if n_key in target_coverage:
                target_coverage[n_key] += p

            
    # Coverage is fixed for the whole run, so the attacker's response is computed once.
    rational_target_name = None
    bounded_names, bounded_probs = [], []
    if attacker_type == "rational":
        rational_target_name = evaluate_rational_attacker(graph, target_coverage).get("best_response")
    elif attacker_type in ["bounded", "bounded_rational"]:
        tp = evaluate_bounded_rational_attacker(graph, target_coverage, lambda_val)["target_probabilities"]
        bounded_names = list(tp.keys())
        bounded_probs = [tp[n] for n in bounded_names]
    else:
        raise ValueError(f"Invalid attacker type: {attacker_type}")

    detected_count = 0
    total_def_util = 0.0
    total_att_util = 0.0
    recent_log = []
    
    # Policy sampling and route lookups are loop-invariant, so prepare them once. Sampling with
    # a precomputed CDF and one uniform draw is exactly what np.random.choice does internally,
    # so seeded runs reproduce the same sequence while avoiding per-round list rebuilding.
    sample_keys = list(probs_dict.keys())
    sample_probs = np.array([probs_dict[k] for k in sample_keys], dtype=float)
    if abs(sample_probs.sum() - 1.0) > 1e-4:
        raise ValueError(f"Probabilities must sum to 1.0, got {sample_probs.sum()}")
    if (sample_probs < 0).any():
        raise ValueError("Probabilities cannot be negative")
    sample_cdf = sample_probs.cumsum()
    sample_cdf /= sample_cdf[-1]

    route_cache = {}
    for i, strat in enumerate(strategies):
        raw = strat.get("route_ids", strat.get("route", []))
        ids = [name_to_id.get(n, n) for n in raw]
        route_cache[f"S{i+1}"] = (ids, [graph.get_node_data(n).get("name", n) for n in ids])

    for r in range(1, num_rounds + 1):
        chosen_s_id = sample_keys[int(sample_cdf.searchsorted(np.random.random_sample(), side="right"))]
        patrol_route_ids, patrol_route_names = route_cache[chosen_s_id]

        if attacker_type == "rational":
            target_name = rational_target_name
        else:
            # Bounded-rational (quantal response): sample a target from the softmax
            # distribution each round instead of always taking the argmax.
            target_name = str(np.random.choice(bounded_names, p=bounded_probs))

        target_id = None
        for n_id in graph.get_nodes():
            if graph.get_node_data(n_id).get("name", n_id) == target_name or n_id == target_name:
                target_id = n_id
                break
                
        if not target_id:
            target_id = graph.get_nodes()[0]
            target_name = graph.get_node_data(target_id).get("name", target_id)
            
        detected = (target_id in patrol_route_ids) or (target_name in patrol_route_ids)
        if detected:
            detected_count += 1

            
        node_data = graph.get_node_data(target_id)
        if detected:
            u_d = float(node_data.get('defender_reward', 0))
            u_a = float(node_data.get('attacker_penalty', 0))
        else:
            u_d = float(node_data.get('defender_penalty', 0))
            u_a = float(node_data.get('attacker_reward', 0))
            
        total_def_util += u_d
        total_att_util += u_a
        
        if r > num_rounds - 10:
            recent_log.append({
                "round": r,
                "patrol_strategy": chosen_s_id,
                "patrol_route": patrol_route_names,
                "attacker_type": attacker_type,
                "attacker_target": target_name,
                "target_coverage": detected,
                "detected": detected,
                "defender_utility": u_d,
                "attacker_utility": u_a
            })
            
    avg_def_util = total_def_util / num_rounds if num_rounds > 0 else 0.0
    avg_att_util = total_att_util / num_rounds if num_rounds > 0 else 0.0
    det_prob = detected_count / num_rounds if num_rounds > 0 else 0.0
    succ_rate = (num_rounds - detected_count) / num_rounds if num_rounds > 0 else 0.0
    
    return {
        "status": "success",
        "rounds": num_rounds,
        "num_simulations": num_rounds,
        "detected_attacks": detected_count,
        "detected_count": detected_count,
        "successful_attacks": num_rounds - detected_count,
        "detection_probability": det_prob,
        "attack_success_rate": succ_rate,
        "average_defender_utility": avg_def_util,
        "avg_defender_utility": avg_def_util,
        "average_attacker_utility": avg_att_util,
        "avg_attacker_utility": avg_att_util,
        "recent_log": recent_log
    }

def run_simulation(
    graph: CampusGraph, 
    strategies: List[Any], 
    stackelberg_probs: List[float], 
    num_rounds: int,
    attacker_type: str = "rational",
    lambda_val: float = 1.0,
    random_seed: int = None
) -> Dict[str, Any]:
    """Backward compatibility wrapper for existing tests/modules."""
    return run_engine_simulation(
        graph=graph,
        strategies=strategies,
        stackelberg_probs=stackelberg_probs,
        num_rounds=num_rounds,
        patrol_policy="game_theoretic",
        attacker_type=attacker_type,
        lambda_val=lambda_val,
        random_seed=random_seed
    )
