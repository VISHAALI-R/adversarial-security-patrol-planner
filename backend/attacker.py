import numpy as np
from typing import Dict, Tuple

def get_attacker_utilities(graph, target_coverage: Dict[str, float]) -> Dict[str, float]:
    """
    Calculates expected attacker utility for each target.
    Returns a dictionary mapping node NAMES (not IDs) to their expected utility.
    """
    utilities = {}
    for target_id in graph.get_nodes():
        node_data = graph.get_node_data(target_id)
        name = node_data.get('name', target_id)
        a_r = node_data.get('attacker_reward', 0)
        a_p = node_data.get('attacker_penalty', 0)
        c_t = target_coverage.get(target_id, 0.0)
        
        utilities[name] = float(c_t * a_p + (1 - c_t) * a_r)
    return utilities

def evaluate_rational_attacker(graph, target_coverage: Dict[str, float]) -> Dict:
    utilities = get_attacker_utilities(graph, target_coverage)
    
    best_target_name = None
    best_u = -float('inf')
    best_def_u = -float('inf')
    
    for target_id in graph.get_nodes():
        node_data = graph.get_node_data(target_id)
        name = node_data.get('name', target_id)
        u_a = utilities[name]
        
        d_r = node_data.get('defender_reward', 0)
        d_p = node_data.get('defender_penalty', 0)
        c_t = target_coverage.get(target_id, 0.0)
        u_d = c_t * d_r + (1 - c_t) * d_p
        
        if u_a > best_u + 1e-9:
            best_u = u_a
            best_target_name = name
            best_def_u = u_d
        elif abs(u_a - best_u) <= 1e-9:
            if u_d > best_def_u:
                best_u = u_a
                best_target_name = name
                best_def_u = u_d
                
    return {
        "attacker_type": "rational",
        "target_utilities": utilities,
        "best_response": best_target_name,
        "best_response_utility": best_u
    }

def evaluate_bounded_rational_attacker(graph, target_coverage: Dict[str, float], lambda_val: float) -> Dict:
    if lambda_val <= 0:
        raise ValueError("lambda must be strictly positive")
        
    utilities = get_attacker_utilities(graph, target_coverage)
    names = list(utilities.keys())
    
    if not names:
        return {
            "attacker_type": "bounded",
            "lambda": lambda_val,
            "target_probabilities": {},
            "expected_utilities": {},
            "best_response": None
        }
        
    u_vals = np.array([utilities[name] for name in names], dtype=float)
    
    max_u = np.max(u_vals)
    exp_u = np.exp(lambda_val * (u_vals - max_u))
    sum_exp = np.sum(exp_u)
    
    if sum_exp == 0 or np.isnan(sum_exp):
        probs = np.ones_like(u_vals) / len(u_vals)
    else:
        probs = exp_u / sum_exp
        
    # Ensure they sum exactly to 1.0 safely
    probs = probs / np.sum(probs)
        
    target_probabilities = {name: float(p) for name, p in zip(names, probs)}
    
    best_idx = np.argmax(probs)
    best_target_name = names[best_idx]
    
    return {
        "attacker_type": "bounded",
        "lambda": lambda_val,
        "target_probabilities": target_probabilities,
        "expected_utilities": utilities,
        "best_response": best_target_name
    }

# Adapters for Step 3 (Simulation)
def rational_best_response(graph, target_coverage: Dict[str, float]) -> str:
    res = evaluate_rational_attacker(graph, target_coverage)
    best_name = res["best_response"]
    for target_id in graph.get_nodes():
        if graph.get_node_data(target_id).get('name', target_id) == best_name:
            return target_id
    return None

def bounded_rational_attacker(graph, target_coverage: Dict[str, float], lambda_val: float) -> str:
    res = evaluate_bounded_rational_attacker(graph, target_coverage, lambda_val)
    probs_dict = res["target_probabilities"]
    
    name_to_id = {}
    for target_id in graph.get_nodes():
        name_to_id[graph.get_node_data(target_id).get('name', target_id)] = target_id
        
    names = list(probs_dict.keys())
    probs = [probs_dict[n] for n in names]
    if not names:
        return None
    chosen_name = np.random.choice(names, p=probs)
    return name_to_id[chosen_name]
