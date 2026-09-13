import numpy as np
from scipy.optimize import linprog
from backend.graph_model import CampusGraph
from typing import List, Dict, Tuple

def get_target_coverage_matrix(strategies: List[List[str]], targets: List[str]) -> np.ndarray:
    """
    Returns a matrix C where C[i][j] = 1 if strategy j covers target i, else 0.
    """
    num_targets = len(targets)
    num_strategies = len(strategies)
    C = np.zeros((num_targets, num_strategies))
    
    for j, strategy in enumerate(strategies):
        for i, target in enumerate(targets):
            if target in strategy:
                C[i, j] = 1
                
    return C

def solve_stackelberg_game(graph: CampusGraph, strategies: List[List[str]]) -> Tuple[List[float], Dict[str, float], str, float, float]:
    """
    Solves the Stackelberg Security Game to find the Strong Stackelberg Equilibrium.
    Returns:
    - probabilities over strategies
    - target coverage probabilities
    - attacker best response target
    - expected defender utility
    - expected attacker utility
    """
    targets = graph.get_nodes()
    num_targets = len(targets)
    num_strategies = len(strategies)
    
    if num_strategies == 0:
        raise ValueError("No feasible strategies provided.")
        
    C = get_target_coverage_matrix(strategies, targets)
    
    best_defender_utility = -float('inf')
    best_p = None
    best_target = None
    best_attacker_utility = None
    best_coverage = None
    
    # Attacker rewards and penalties
    # U_a(t) = c_t * attacker_penalty + (1 - c_t) * attacker_reward
    # U_d(t) = c_t * defender_reward + (1 - c_t) * defender_penalty
    
    a_r = np.array([graph.get_node_data(t).get('attacker_reward', 0) for t in targets])
    a_p = np.array([graph.get_node_data(t).get('attacker_penalty', 0) for t in targets])
    d_r = np.array([graph.get_node_data(t).get('defender_reward', 0) for t in targets])
    d_p = np.array([graph.get_node_data(t).get('defender_penalty', 0) for t in targets])
    
    # For Strong Stackelberg Equilibrium, we solve an LP for each possible best-response target t_star
    for star_idx in range(num_targets):
        # We want to maximize U_d(t_star)
        # U_d(t_star) = c_{t_star} * d_r[t_star] + (1 - c_{t_star}) * d_p[t_star]
        # Maximize: c_{t_star} * (d_r[t_star] - d_p[t_star])
        # Which is equivalent to minimizing: -c_{t_star} * (d_r[t_star] - d_p[t_star])
        
        # Variables: p_1, p_2, ..., p_{num_strategies}
        c_star_coefs = C[star_idx, :]
        obj = -c_star_coefs * (d_r[star_idx] - d_p[star_idx])
        
        # Constraints:
        # 1. sum(p) == 1
        A_eq = np.ones((1, num_strategies))
        b_eq = np.array([1.0])
        
        # 2. Attacker best response condition: U_a(t_star) >= U_a(t) for all t
        # c_{t_star}*a_p[t_star] + (1-c_{t_star})*a_r[t_star] >= c_t*a_p[t] + (1-c_t)*a_r[t]
        # c_t*(a_r[t] - a_p[t]) - c_{t_star}*(a_r[t_star] - a_p[t_star]) <= a_r[t_star] - a_r[t]
        
        A_ub = np.zeros((num_targets, num_strategies))
        b_ub = np.zeros(num_targets)
        
        for t_idx in range(num_targets):
            if t_idx == star_idx:
                continue
            
            # c_t coefs: C[t_idx, :]
            # c_{t_star} coefs: C[star_idx, :]
            
            term1 = C[t_idx, :] * (a_r[t_idx] - a_p[t_idx])
            term2 = C[star_idx, :] * (a_r[star_idx] - a_p[star_idx])
            
            A_ub[t_idx, :] = term2 - term1
            b_ub[t_idx] = a_r[star_idx] - a_r[t_idx]
            
        bounds = [(0, 1) for _ in range(num_strategies)]
        
        # Remove the trivial star_idx constraint row to avoid issues
        A_ub_clean = np.delete(A_ub, star_idx, axis=0)
        b_ub_clean = np.delete(b_ub, star_idx)
        
        res = linprog(c=obj, A_ub=A_ub_clean, b_ub=b_ub_clean, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method='highs')
        
        if res.success:
            p = res.x
            # Recalculate utilities to check
            c = C @ p
            u_d_star = c[star_idx] * d_r[star_idx] + (1 - c[star_idx]) * d_p[star_idx]
            u_a_star = c[star_idx] * a_p[star_idx] + (1 - c[star_idx]) * a_r[star_idx]
            
            if u_d_star > best_defender_utility:
                best_defender_utility = u_d_star
                best_p = p
                best_target = targets[star_idx]
                best_attacker_utility = u_a_star
                best_coverage = c
                
    if best_p is None:
        # Fallback to uniform if no feasible solution (should not happen in standard SSG)
        best_p = np.ones(num_strategies) / num_strategies
        c = C @ best_p
        
        # Compute manually which is best response
        u_a = c * a_p + (1 - c) * a_r
        best_target_idx = np.argmax(u_a)
        best_target = targets[best_target_idx]
        best_attacker_utility = u_a[best_target_idx]
        best_defender_utility = c[best_target_idx] * d_r[best_target_idx] + (1 - c[best_target_idx]) * d_p[best_target_idx]
        best_coverage = c

    # Round slightly to handle floating point issues
    best_p = np.round(best_p, 5)
    best_p = best_p / np.sum(best_p) # re-normalize
    
    coverage_dict = {targets[i]: best_coverage[i] for i in range(num_targets)}
    
    return best_p.tolist(), coverage_dict, best_target, float(best_defender_utility), float(best_attacker_utility)
