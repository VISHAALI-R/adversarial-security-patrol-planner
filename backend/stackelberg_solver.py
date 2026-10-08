import numpy as np
from scipy.optimize import linprog
from backend.graph_model import CampusGraph
from typing import List, Dict, Tuple, Optional

# Margin by which the intended target must beat every alternative. An exact SSE leaves the
# attacker indifferent, so any rounding error could flip the best response; a tiny strict
# margin keeps the solution stable downstream (simulation recomputes coverage from p).
BEST_RESPONSE_MARGIN = 1e-6


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


def _solve_for_target(C: np.ndarray, star_idx: int, a_r, a_p, d_r, d_p, margin: float) -> Optional[np.ndarray]:
    """
    One LP of the multiple-LPs method: maximise defender utility subject to target
    `star_idx` being the attacker's best response. Returns p, or None if infeasible.

    With c = C @ p and U_a(t) = a_r[t] - c_t * (a_r[t] - a_p[t]):
        U_a(star) >= U_a(t) + margin
    <=> c_star*(a_r*-a_p*) - c_t*(a_r_t-a_p_t) <= a_r* - a_r_t - margin
    and U_d(star) = d_p* + c_star*(d_r* - d_p*), so we minimise -c_star*(d_r* - d_p*).
    """
    num_targets, num_strategies = C.shape
    obj = -C[star_idx, :] * (d_r[star_idx] - d_p[star_idx])

    others = [t for t in range(num_targets) if t != star_idx]
    A_ub = np.array([
        C[star_idx, :] * (a_r[star_idx] - a_p[star_idx]) - C[t, :] * (a_r[t] - a_p[t])
        for t in others
    ]).reshape(len(others), num_strategies)
    b_ub = np.array([a_r[star_idx] - a_r[t] - margin for t in others])

    res = linprog(
        c=obj,
        A_ub=A_ub if others else None,
        b_ub=b_ub if others else None,
        A_eq=np.ones((1, num_strategies)),
        b_eq=np.array([1.0]),
        bounds=[(0, 1)] * num_strategies,
        method='highs',
    )
    return res.x if res.success else None


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

    a_r = np.array([graph.get_node_data(t).get('attacker_reward', 0) for t in targets], dtype=float)
    a_p = np.array([graph.get_node_data(t).get('attacker_penalty', 0) for t in targets], dtype=float)
    d_r = np.array([graph.get_node_data(t).get('defender_reward', 0) for t in targets], dtype=float)
    d_p = np.array([graph.get_node_data(t).get('defender_penalty', 0) for t in targets], dtype=float)

    best = None  # (defender_utility, p, star_idx)
    # Prefer the strict-margin solution; fall back to the exact (tie-breaking) one only if
    # no target admits a strict best response.
    for margin in (BEST_RESPONSE_MARGIN, 0.0):
        for star_idx in range(num_targets):
            p = _solve_for_target(C, star_idx, a_r, a_p, d_r, d_p, margin)
            if p is None:
                continue
            c = C @ p
            u_d = c[star_idx] * d_r[star_idx] + (1 - c[star_idx]) * d_p[star_idx]
            if best is None or u_d > best[0]:
                best = (u_d, p, star_idx)
        if best is not None:
            break

    if best is None:
        # Fallback to uniform (should not happen in a standard SSG)
        p = np.ones(num_strategies) / num_strategies
        c = C @ p
        u_a = c * a_p + (1 - c) * a_r
        star_idx = int(np.argmax(u_a))
        best = (c[star_idx] * d_r[star_idx] + (1 - c[star_idx]) * d_p[star_idx], p, star_idx)

    u_d, p, star_idx = best
    # Clean solver noise only. Do NOT round coarsely: rounding perturbs the tight best-response
    # constraints and can flip the attacker onto a different target.
    p = np.where(p < 1e-12, 0.0, p)
    p = p / p.sum()

    c = C @ p
    u_d = float(c[star_idx] * d_r[star_idx] + (1 - c[star_idx]) * d_p[star_idx])
    u_a = float(c[star_idx] * a_p[star_idx] + (1 - c[star_idx]) * a_r[star_idx])
    coverage_dict = {targets[i]: float(c[i]) for i in range(num_targets)}

    return p.tolist(), coverage_dict, targets[star_idx], u_d, u_a
