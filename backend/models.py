from pydantic import BaseModel, Field, ConfigDict
from typing import List, Dict, Optional

class NodeModel(BaseModel):
    id: str
    name: str
    x: float = 0.0
    y: float = 0.0
    target_value: float = Field(default=0.0, ge=0.0)
    attacker_reward: float = 0.0
    defender_reward: float = 0.0
    attacker_penalty: float = 0.0
    defender_penalty: float = 0.0

class EdgeModel(BaseModel):
    source: str
    destination: str
    travel_time: float = Field(default=1.0, ge=0.0)

class CampusGraphModel(BaseModel):
    nodes: List[NodeModel]
    edges: List[EdgeModel]

class GameConfigModel(BaseModel):
    patrol_units: int = Field(default=1, gt=0)
    shift_duration: float = Field(default=10.0, gt=0.0)
    graph: CampusGraphModel

class AttackerModelConfig(BaseModel):
    type: str = Field(default="rational") # "rational" or "bounded_rational"
    lambda_val: float = Field(default=1.0, ge=0.0)

class SimulationRequestModel(BaseModel):
    game_config: GameConfigModel
    num_simulations: int = Field(default=1000, gt=0)
    attacker_config: AttackerModelConfig
    strategy_probabilities: Dict[int, float] # Maps strategy index to probability
    strategies: List[List[str]] # List of strategies (each strategy is a list of node IDs)

class StrategyResponseModel(BaseModel):
    strategies: List[List[str]]
    travel_times: List[float]

class SolverResponseModel(BaseModel):
    probabilities: List[float]
    defender_utility: float
    attacker_utility: float
    attacker_best_response: Optional[str] = None
    target_coverage: Dict[str, float]

class SimulationResultModel(BaseModel):
    detection_probability: float
    attack_success_rate: float
    defender_utility: float
    attacker_utility: float
    unpredictability_entropy: float

class GenerateStrategyRequestModel(BaseModel):
    patrol_units: int = Field(default=1, gt=0)
    shift_duration: float = Field(default=30.0, gt=0.0)
    max_checkpoints: int = Field(default=5, gt=0)

class StrategyDetailModel(BaseModel):
    strategy_id: int
    route: List[str]
    total_travel_time: float
    covered_targets: List[str]

class GenerateStrategyResponseModel(BaseModel):
    total_strategies: int
    strategies: List[StrategyDetailModel]

class AttackerEvaluationRequestModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    attacker_type: str = Field(default="rational", pattern="^(rational|bounded)$")
    lambda_val: Optional[float] = Field(default=1.0, alias="lambda")

class AttackerEvaluationResponseModel(BaseModel):
    attacker_type: str
    lambda_val: Optional[float] = Field(default=None, alias="lambda")
    target_utilities: Optional[Dict[str, float]] = None
    expected_utilities: Optional[Dict[str, float]] = None
    target_probabilities: Optional[Dict[str, float]] = None
    best_response: Optional[str] = None
    best_response_utility: Optional[float] = None

class PolicySampleRequestModel(BaseModel):
    policy_type: str = Field(pattern="^(fixed|uniform_random|game_theoretic)$")
    fixed_id: Optional[str] = None

class SimulationLogEntryModel(BaseModel):
    round: int
    patrol_strategy: str
    patrol_route: List[str]
    attacker_type: str
    attacker_target: str
    target_coverage: bool
    detected: bool
    defender_utility: float
    attacker_utility: float

class EngineSimulationRequestModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    rounds: int = Field(default=1000, gt=0)
    patrol_policy: str = Field(default="game_theoretic")
    attacker_type: str = Field(default="rational")
    lambda_val: float = Field(default=1.0, alias="lambda")
    random_seed: Optional[int] = None

class EngineSimulationResultModel(BaseModel):
    status: str = "success"
    rounds: int
    detected_attacks: int
    successful_attacks: int
    detection_probability: float
    attack_success_rate: float
    average_defender_utility: float
    average_attacker_utility: float
    recent_log: List[SimulationLogEntryModel] = []

class EvaluationRunRequestModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    rounds: int = Field(default=1000, gt=0)
    experiments: int = Field(default=10, gt=0)
    attacker_type: str = Field(default="rational")
    lambda_val: float = Field(default=1.0, alias="lambda")
    random_seed: Optional[int] = Field(default=42)

class EvaluationCompareRequestModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    rounds: int = Field(default=1000, gt=0)
    experiments: int = Field(default=10, gt=0)
    lambda_val: float = Field(default=1.0, alias="lambda")
    random_seed: Optional[int] = Field(default=42)

