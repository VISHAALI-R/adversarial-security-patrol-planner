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
    random_seed: int = None
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
        
    policy = get_patrol_policy(patrol_policy, strategies, stackelberg_probs)
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

            
    detected_count = 0
    total_def_util = 0.0
    total_att_util = 0.0
    recent_log = []
    
    for r in range(1, num_rounds + 1):
        chosen_s_id = sample_patrol_strategy(policy)
        idx = int(chosen_s_id[1:]) - 1
        chosen_strategy = strategies[idx]
        raw_patrol_route = chosen_strategy.get("route_ids", chosen_strategy.get("route", []))

        patrol_route_ids = [name_to_id.get(n, n) for n in raw_patrol_route]
        
        patrol_route_names = []
        for n_id in patrol_route_ids:
            node_data = graph.get_node_data(n_id)
            patrol_route_names.append(node_data.get("name", n_id))
            
        if attacker_type == "rational":
            att_res = evaluate_rational_attacker(graph, target_coverage)
        elif attacker_type in ["bounded", "bounded_rational"]:
            att_res = evaluate_bounded_rational_attacker(graph, target_coverage, lambda_val)
        else:
            raise ValueError(f"Invalid attacker type: {attacker_type}")
            
        target_name = att_res.get("best_response")
        
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
