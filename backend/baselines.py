import numpy as np
from typing import List, Dict, Any

# Retaining old functions for backward compatibility with Step 3
def uniform_random_policy(num_strategies: int) -> List[float]:
    if num_strategies == 0:
        return []
    prob = 1.0 / num_strategies
    return [prob] * num_strategies

def fixed_patrol_policy(num_strategies: int, chosen_index: int = 0) -> List[float]:
    if num_strategies == 0:
        return []
    probs = [0.0] * num_strategies
    if 0 <= chosen_index < num_strategies:
        probs[chosen_index] = 1.0
    else:
        probs[0] = 1.0
    return probs

# New Step 5 logic
def get_patrol_policy(policy_type: str, strategies: List[Any], stackelberg_probs: List[float], fixed_id: str = None) -> Dict[str, Any]:
    if policy_type not in ["fixed", "uniform_random", "game_theoretic"]:
        raise ValueError(f"Invalid policy type: {policy_type}")
        
    num_strats = len(strategies)
    if num_strats == 0:
        return {
            "strategy_type": policy_type,
            "probabilities": {}
        }
        
    strategy_ids = [f"S{i+1}" for i in range(num_strats)]
    
    if policy_type == "fixed":
        if fixed_id is None or fixed_id not in strategy_ids:
            fixed_id = strategy_ids[0]
            
        probs = {s_id: 0.0 for s_id in strategy_ids}
        probs[fixed_id] = 1.0
        
        return {
            "strategy_type": "fixed",
            "selected_strategy": fixed_id,
            "probabilities": probs
        }
        
    elif policy_type == "uniform_random":
        prob = 1.0 / num_strats
        probs = {s_id: prob for s_id in strategy_ids}
        return {
            "strategy_type": "uniform_random",
            "probabilities": probs
        }
        
    elif policy_type == "game_theoretic":
        probs = {}
        for i, s_id in enumerate(strategy_ids):
            p = float(stackelberg_probs[i]) if i < len(stackelberg_probs) else 0.0
            probs[s_id] = max(0.0, p)
            
        # Enforce sum to 1.0 (with normalization just to handle floating precision issues)
        total = sum(probs.values())
        if total > 0:
            probs = {k: v/total for k, v in probs.items()}
        else:
            probs = {s_id: 1.0 / num_strats for s_id in strategy_ids}
            
        return {
            "strategy_type": "game_theoretic",
            "probabilities": probs
        }

def sample_patrol_strategy(policy: Dict[str, Any]) -> str:
    probs_dict = policy.get("probabilities", {})
    if not probs_dict:
        raise ValueError("Policy contains no probabilities or empty strategy list.")
        
    keys = list(probs_dict.keys())
    probs = [probs_dict[k] for k in keys]
    
    # Validations requested in requirements
    total = sum(probs)
    if abs(total - 1.0) > 1e-4:
        raise ValueError(f"Probabilities must sum to 1.0, got {total}")
    for p in probs:
        if p < 0:
            raise ValueError("Probabilities cannot be negative")
            
    # Safely fix tiny floating point errors for np.random.choice
    if total != 1.0:
        probs = [p/total for p in probs]
        
    chosen = np.random.choice(keys, p=probs)
    return str(chosen)
