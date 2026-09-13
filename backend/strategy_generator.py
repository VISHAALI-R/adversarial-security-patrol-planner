from backend.graph_model import CampusGraph
from typing import List, Set, Dict

def generate_feasible_strategies(
    graph: CampusGraph, 
    shift_duration: float, 
    max_checkpoints: int = 5,
    max_strategies: int = 1000
) -> List[Dict]:
    """
    Generates feasible patrol strategies (routes) within the given shift duration.
    A strategy is a valid path in the graph where total travel time <= shift_duration
    and length <= max_checkpoints.
    """
    strategies = set()
    nodes = graph.get_nodes()
    
    def dfs(current_path: List[str], current_time: float):
        if len(strategies) >= max_strategies:
            return
            
        current_node = current_path[-1]
        
        if len(current_path) < max_checkpoints:
            for neighbor in graph.graph.neighbors(current_node):
                travel_time = graph.get_travel_time(current_node, neighbor)
                if travel_time < 0:
                    continue
                if current_time + travel_time <= shift_duration:
                    # simple paths to prevent duplicates/cycles
                    if neighbor not in current_path:
                        dfs(current_path + [neighbor], current_time + travel_time)
                    
        strategies.add(tuple(current_path))

    for start_node in nodes:
        dfs([start_node], 0.0)
        if len(strategies) >= max_strategies:
            break

    results = []
    for idx, path_tuple in enumerate(sorted(list(strategies)), start=1):
        path = list(path_tuple)
        route_names = [graph.get_node_data(n)["name"] for n in path]
        total_time = graph.calculate_path_time(path)
        
        # Covered targets (unique names)
        covered = list(set(route_names))
        
        results.append({
            "strategy_id": idx,
            "route": route_names,
            "route_ids": path, # useful for later steps
            "total_travel_time": total_time,
            "covered_targets": covered
        })
        
    return results
