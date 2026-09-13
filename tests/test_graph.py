import pytest
from backend.models import CampusGraphModel, NodeModel, EdgeModel
from backend.graph_model import CampusGraph

def test_graph_creation():
    nodes = [
        NodeModel(id="1", name="A", target_value=10),
        NodeModel(id="2", name="B", target_value=5)
    ]
    edges = [
        EdgeModel(source="1", destination="2", travel_time=2.0)
    ]
    model = CampusGraphModel(nodes=nodes, edges=edges)
    graph = CampusGraph(model)
    
    assert len(graph.get_nodes()) == 2
    assert graph.get_travel_time("1", "2") == 2.0
    assert graph.get_travel_time("1", "3") == float('inf')
    
def test_path_time():
    nodes = [NodeModel(id=str(i), name=str(i)) for i in range(1, 4)]
    edges = [
        EdgeModel(source="1", destination="2", travel_time=2.0),
        EdgeModel(source="2", destination="3", travel_time=3.0)
    ]
    graph = CampusGraph(CampusGraphModel(nodes=nodes, edges=edges))
    
    assert graph.calculate_path_time(["1", "2"]) == 2.0
    assert graph.calculate_path_time(["1", "2", "3"]) == 5.0
    assert graph.calculate_path_time(["1", "3"]) == float('inf')

def test_is_valid_path():
    nodes = [NodeModel(id=str(i), name=str(i)) for i in range(1, 4)]
    edges = [
        EdgeModel(source="1", destination="2", travel_time=2.0),
        EdgeModel(source="2", destination="3", travel_time=3.0)
    ]
    graph = CampusGraph(CampusGraphModel(nodes=nodes, edges=edges))
    
    assert graph.is_valid_path(["1", "2", "3"]) is True
    assert graph.is_valid_path(["1", "3"]) is False
    assert graph.is_valid_path([]) is False
