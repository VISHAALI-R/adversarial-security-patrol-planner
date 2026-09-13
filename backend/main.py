from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict

from backend.models import (
    CampusGraphModel, GameConfigModel, SimulationRequestModel, StrategyResponseModel, SolverResponseModel, 
    SimulationResultModel, GenerateStrategyRequestModel, GenerateStrategyResponseModel, 
    AttackerEvaluationRequestModel, AttackerEvaluationResponseModel, PolicySampleRequestModel,
    EngineSimulationRequestModel, EngineSimulationResultModel, EvaluationRunRequestModel, EvaluationCompareRequestModel
)
from backend.graph_model import CampusGraph
from backend.strategy_generator import generate_feasible_strategies
from backend.stackelberg_solver import solve_stackelberg_game
from backend.baselines import uniform_random_policy, fixed_patrol_policy
from backend.simulation import run_simulation
from backend.evaluation import evaluate_performance

app = FastAPI(title="Adversarial Game-Theoretic Security Patrol Planner")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
DEFAULT_CAMPUS = {
    "nodes": [
        {"id": "gate", "name": "Main Gate", "x": 300, "y": 50, "target_value": 9, "attacker_reward": 9, "defender_reward": 9, "attacker_penalty": -2, "defender_penalty": -9},
        {"id": "corridor", "name": "Corridor", "x": 300, "y": 150, "target_value": 2, "attacker_reward": 2, "defender_reward": 2, "attacker_penalty": 0, "defender_penalty": -2},
        {"id": "lab", "name": "Laboratory", "x": 150, "y": 250, "target_value": 8, "attacker_reward": 8, "defender_reward": 8, "attacker_penalty": -2, "defender_penalty": -8},
        {"id": "admin", "name": "Admin Office", "x": 450, "y": 250, "target_value": 6, "attacker_reward": 6, "defender_reward": 6, "attacker_penalty": -2, "defender_penalty": -6},
        {"id": "server", "name": "Server Room", "x": 150, "y": 350, "target_value": 10, "attacker_reward": 10, "defender_reward": 10, "attacker_penalty": -2, "defender_penalty": -10},
        {"id": "parking", "name": "Parking Area", "x": 450, "y": 350, "target_value": 4, "attacker_reward": 4, "defender_reward": 4, "attacker_penalty": -1, "defender_penalty": -4}
    ],
    "edges": [
        {"source": "gate", "destination": "corridor", "travel_time": 2},
        {"source": "corridor", "destination": "lab", "travel_time": 3},
        {"source": "corridor", "destination": "admin", "travel_time": 4},
        {"source": "lab", "destination": "server", "travel_time": 2},
        {"source": "admin", "destination": "parking", "travel_time": 3}
    ]
}

@app.get("/api/campus")
def get_campus():
    return DEFAULT_CAMPUS

@app.post("/api/campus")
def post_campus(graph: dict):
    # Simply returning the validated graph structure for now
    return graph

@app.post("/api/strategies/generate", response_model=GenerateStrategyResponseModel)
def generate_strategies(req: GenerateStrategyRequestModel):
    graph = CampusGraph(CampusGraphModel(**DEFAULT_CAMPUS))
    strategies = generate_feasible_strategies(
        graph=graph,
        shift_duration=req.shift_duration,
        max_checkpoints=req.max_checkpoints
    )
    return {
        "total_strategies": len(strategies),
        "strategies": strategies
    }

CURRENT_GAME_STATE = {
    "graph": None,
    "target_coverage": None,
    "strategies": [],
    "probabilities": []
}

@app.post("/api/stackelberg/solve", response_model=SolverResponseModel)
def solve_game(req: SimulationRequestModel):
    graph = CampusGraph(req.game_config.graph)
    probs, target_cov, attacker_best, u_d, u_a = solve_stackelberg_game(graph, req.strategies)
    
    # Save for Step 4 & 5
    CURRENT_GAME_STATE["graph"] = graph
    CURRENT_GAME_STATE["target_coverage"] = target_cov
    CURRENT_GAME_STATE["strategies"] = req.strategies
    CURRENT_GAME_STATE["probabilities"] = probs
    
    return {
        "probabilities": probs,
        "defender_utility": u_d,
        "attacker_utility": u_a,
        "attacker_best_response": attacker_best,
        "target_coverage": target_cov
    }

@app.post("/api/attacker/evaluate", response_model=AttackerEvaluationResponseModel)
def evaluate_attacker(req: AttackerEvaluationRequestModel):
    graph = CURRENT_GAME_STATE.get("graph")
    target_coverage = CURRENT_GAME_STATE.get("target_coverage")
    
    # If no state, fallback to default graph and 0 coverage
    if graph is None or target_coverage is None:
        graph = CampusGraph(CampusGraphModel(**DEFAULT_CAMPUS))
        target_coverage = {node.id: 0.0 for node in CampusGraphModel(**DEFAULT_CAMPUS).nodes}
        
    from backend.attacker import evaluate_rational_attacker, evaluate_bounded_rational_attacker
    
    if req.attacker_type == "rational":
        return evaluate_rational_attacker(graph, target_coverage)
    elif req.attacker_type == "bounded":
        # Enforce positive lambda
        lam = req.lambda_val if req.lambda_val is not None else 1.0
        if lam < 0:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Lambda cannot be negative")
        return evaluate_bounded_rational_attacker(graph, target_coverage, lam)

@app.get("/api/baselines")
def get_baselines(fixed_id: str = None):
    from backend.baselines import get_patrol_policy
    strategies = CURRENT_GAME_STATE.get("strategies", [])
    stack_probs = CURRENT_GAME_STATE.get("probabilities", [])
    
    return {
        "fixed": get_patrol_policy("fixed", strategies, stack_probs, fixed_id),
        "uniform_random": get_patrol_policy("uniform_random", strategies, stack_probs),
        "game_theoretic": get_patrol_policy("game_theoretic", strategies, stack_probs)
    }

@app.post("/api/policy/sample")
def sample_policy(req: PolicySampleRequestModel):
    from backend.baselines import get_patrol_policy, sample_patrol_strategy
    strategies = CURRENT_GAME_STATE.get("strategies", [])
    stack_probs = CURRENT_GAME_STATE.get("probabilities", [])
    
    policy = get_patrol_policy(req.policy_type, strategies, stack_probs, req.fixed_id)
    selected_strategy = sample_patrol_strategy(policy)
    
    return {
        "selected_strategy": selected_strategy
    }

@app.post("/api/simulation/run", response_model=EngineSimulationResultModel)
def run_sim(req: EngineSimulationRequestModel):
    graph = CURRENT_GAME_STATE.get("graph")
    strategies = CURRENT_GAME_STATE.get("strategies", [])
    stack_probs = CURRENT_GAME_STATE.get("probabilities", [])
    
    if graph is None or not strategies:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="No strategies generated yet.")
        
    from backend.simulation import run_engine_simulation
    return run_engine_simulation(
        graph=graph,
        strategies=strategies,
        stackelberg_probs=stack_probs,
        num_rounds=req.rounds,
        patrol_policy=req.patrol_policy,
        attacker_type=req.attacker_type,
        lambda_val=req.lambda_val,
        random_seed=req.random_seed
    )

def ensure_game_state():
    graph = CURRENT_GAME_STATE.get("graph")
    strategies = CURRENT_GAME_STATE.get("strategies", [])
    stack_probs = CURRENT_GAME_STATE.get("probabilities", [])
    
    if graph is None or not strategies:
        from backend.models import CampusGraphModel
        graph = CampusGraph(CampusGraphModel(**DEFAULT_CAMPUS))
        strategies_detail = generate_feasible_strategies(graph, shift_duration=30.0, max_checkpoints=5)
        strategies = [s.get("route_ids", s) if isinstance(s, dict) else s for s in strategies_detail]
        stack_probs, _, _, _, _ = solve_stackelberg_game(graph, strategies)
        CURRENT_GAME_STATE["graph"] = graph
        CURRENT_GAME_STATE["strategies"] = strategies
        CURRENT_GAME_STATE["probabilities"] = stack_probs
        
    return graph, strategies, stack_probs

@app.post("/api/simulation/compare")
def compare_simulations(req: EngineSimulationRequestModel):
    graph, strategies, stack_probs = ensure_game_state()
        
    from backend.simulation import run_engine_simulation
    
    results = {}
    for policy in ["fixed", "uniform_random", "game_theoretic"]:
        results[policy] = run_engine_simulation(
            graph=graph,
            strategies=strategies,
            stackelberg_probs=stack_probs,
            num_rounds=req.rounds,
            patrol_policy=policy,
            attacker_type=req.attacker_type,
            lambda_val=req.lambda_val,
            random_seed=req.random_seed
        )
        
    return results

@app.post("/api/evaluation/run")
def run_evaluation(req: EvaluationRunRequestModel):
    graph, strategies, stack_probs = ensure_game_state()
    from backend.evaluation import evaluate_policies
    
    return evaluate_policies(
        graph=graph,
        strategies=strategies,
        stackelberg_probs=stack_probs,
        rounds=req.rounds,
        experiments=req.experiments,
        attacker_type=req.attacker_type,
        lambda_val=req.lambda_val,
        random_seed=req.random_seed
    )

@app.post("/api/evaluation/compare")
def compare_evaluation(req: EvaluationCompareRequestModel):
    graph, strategies, stack_probs = ensure_game_state()
    from backend.evaluation import evaluate_all_attacker_models
    
    return evaluate_all_attacker_models(
        graph=graph,
        strategies=strategies,
        stackelberg_probs=stack_probs,
        rounds=req.rounds,
        experiments=req.experiments,
        lambda_val=req.lambda_val,
        random_seed=req.random_seed
    )

@app.get("/api/dashboard/summary")
def get_dashboard_summary():
    graph = CURRENT_GAME_STATE.get("graph")
    strategies = CURRENT_GAME_STATE.get("strategies", [])
    stack_probs = CURRENT_GAME_STATE.get("probabilities", [])
    
    campus_info = DEFAULT_CAMPUS
    has_state = (graph is not None and len(strategies) > 0)
    
    return {
        "status": "success",
        "has_generated_state": has_state,
        "campus": campus_info,
        "strategy_count": len(strategies),
        "probabilities": stack_probs,
        "target_coverage": CURRENT_GAME_STATE.get("target_coverage", {})
    }

@app.post("/api/dashboard/reset")
def reset_dashboard_state():
    CURRENT_GAME_STATE["graph"] = None
    CURRENT_GAME_STATE["target_coverage"] = None
    CURRENT_GAME_STATE["strategies"] = []
    CURRENT_GAME_STATE["probabilities"] = []
    return {
        "status": "success",
        "message": "Dashboard state reset successfully."
    }


