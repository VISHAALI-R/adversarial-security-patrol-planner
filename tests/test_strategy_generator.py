import pytest
from backend.models import CampusGraphModel, NodeModel, EdgeModel
from backend.graph_model import CampusGraph
from backend.strategy_generator import generate_feasible_strategies
from backend.main import DEFAULT_CAMPUS

@pytest.fixture
def sample_graph():
    return CampusGraph(CampusGraphModel(**DEFAULT_CAMPUS))

def test_valid_connected_route(sample_graph):
    # 1. A valid connected route is generated
    strats = generate_feasible_strategies(sample_graph, shift_duration=10, max_checkpoints=3)
    assert len(strats) > 0
    # verify at least one route matches standard edges e.g. Gate -> Corridor -> Lab
    has_gate_corridor = False
    for s in strats:
        if s["route_ids"][:2] == ["gate", "corridor"] or s["route_ids"][:2] == ["corridor", "gate"]:
            has_gate_corridor = True
            break
    assert has_gate_corridor

def test_shift_duration_enforced(sample_graph):
    # 2. No route exceeds the shift duration
    shift_duration = 5
    strats = generate_feasible_strategies(sample_graph, shift_duration=shift_duration, max_checkpoints=5)
    for s in strats:
        assert s["total_travel_time"] <= shift_duration

def test_no_invalid_edge_used(sample_graph):
    # 3. No invalid edge is used
    strats = generate_feasible_strategies(sample_graph, shift_duration=30, max_checkpoints=5)
    valid_edges = set()
    for edge in DEFAULT_CAMPUS["edges"]:
        valid_edges.add((edge["source"], edge["destination"]))
        valid_edges.add((edge["destination"], edge["source"]))
        
    for s in strats:
        route = s["route_ids"]
        for i in range(len(route) - 1):
            assert (route[i], route[i+1]) in valid_edges

def test_travel_time_calculation(sample_graph):
    # 4. Travel time is calculated correctly
    # Gate -> Corridor = 2
    # Corridor -> Lab = 3
    # Total = 5
    strats = generate_feasible_strategies(sample_graph, shift_duration=30, max_checkpoints=5)
    for s in strats:
        if s["route_ids"] == ["gate", "corridor", "lab"]:
            assert s["total_travel_time"] == 5.0

def test_no_duplicate_strategies(sample_graph):
    # 5. Duplicate strategies are not returned
    strats = generate_feasible_strategies(sample_graph, shift_duration=30, max_checkpoints=4)
    route_tuples = [tuple(s["route_ids"]) for s in strats]
    assert len(route_tuples) == len(set(route_tuples))

def test_shift_duration_changes_set(sample_graph):
    # 6. Changing shift duration changes the feasible strategy set
    strats_short = generate_feasible_strategies(sample_graph, shift_duration=4, max_checkpoints=5)
    strats_long = generate_feasible_strategies(sample_graph, shift_duration=10, max_checkpoints=5)
    assert len(strats_short) < len(strats_long)

def test_max_checkpoints_changes_set(sample_graph):
    # 7. Changing maximum checkpoints changes the feasible strategy set
    strats_few = generate_feasible_strategies(sample_graph, shift_duration=30, max_checkpoints=2)
    strats_many = generate_feasible_strategies(sample_graph, shift_duration=30, max_checkpoints=4)
    assert len(strats_few) < len(strats_many)

def test_empty_graph_handled_safely():
    # 8. Empty/invalid graphs are handled safely
    empty_graph_model = CampusGraphModel(nodes=[], edges=[])
    empty_graph = CampusGraph(empty_graph_model)
    strats = generate_feasible_strategies(empty_graph, shift_duration=30, max_checkpoints=5)
    assert len(strats) == 0
