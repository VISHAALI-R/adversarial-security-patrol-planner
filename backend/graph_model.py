import networkx as nx
from backend.models import CampusGraphModel

class CampusGraph:
    def __init__(self, graph_data: CampusGraphModel):
        self.graph = nx.Graph()
        self.load_graph(graph_data)

    def load_graph(self, graph_data: CampusGraphModel):
        for node in graph_data.nodes:
            self.graph.add_node(
                node.id, 
                name=node.name,
                x=node.x,
                y=node.y,
                target_value=node.target_value,
                attacker_reward=node.attacker_reward,
                defender_reward=node.defender_reward,
                attacker_penalty=node.attacker_penalty,
                defender_penalty=node.defender_penalty
            )
        
        for edge in graph_data.edges:
            self.graph.add_edge(
                edge.source, 
                edge.destination, 
                travel_time=edge.travel_time
            )

    def get_node_data(self, node_id: str) -> dict:
        if node_id in self.graph.nodes:
            return dict(self.graph.nodes[node_id])
        return {"name": str(node_id), "id": str(node_id)}


    def get_nodes(self):
        return list(self.graph.nodes)

    def get_edges(self):
        return list(self.graph.edges(data=True))

    def get_travel_time(self, source: str, destination: str) -> float:
        if self.graph.has_edge(source, destination):
            return self.graph[source][destination]['travel_time']
        return float('inf')

    def calculate_path_time(self, path: list[str]) -> float:
        total_time = 0.0
        for i in range(len(path) - 1):
            time = self.get_travel_time(path[i], path[i+1])
            if time == float('inf'):
                return float('inf')
            total_time += time
        return total_time

    def is_valid_path(self, path: list[str]) -> bool:
        if not path:
            return False
        for i in range(len(path) - 1):
            if not self.graph.has_edge(path[i], path[i+1]):
                return False
        return True
