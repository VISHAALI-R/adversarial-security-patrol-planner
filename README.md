# Adversarial Game-Theoretic Security Patrol Planner

## 1. Problem Statement
Fixed security patrol schedules are predictable. An intelligent intruder can observe patrol patterns and choose a time and location where the probability of detection is lowest. This project models this adversarial environment using a Stackelberg Security Game to compute optimal randomized patrol strategies that maximize expected security utility while respecting operational constraints.

## 2. Motivation
In physical security (e.g., campus patrols), limited resources mean not all targets can be protected simultaneously. Instead of relying on predictable deterministic schedules or entirely random guessing, Game Theory provides a mathematical foundation for resource allocation against adaptive adversaries.

## 3. Objectives
- Represent a campus map as a graph where nodes are targets and edges represent patrol paths.
- Generate valid, feasible patrol schedules based on time constraints.
- Model the interaction between security patrols and intruders using Stackelberg Games.
- Compute the optimal randomized strategy using Linear Programming.
- Compare the game-theoretic strategy against baseline strategies (Fixed and Uniform Random) through simulation.
- Evaluate strategies against both perfectly Rational and Bounded-Rational (quantal response) attackers.

## 4. System Architecture
- **Frontend**: A vanilla JavaScript single-page application dashboard to visualize the campus map, configure parameters, and display simulation results.
- **Backend**: A FastAPI Python application providing endpoints for graph modeling, strategy generation, game solving, and simulation.

## 5. AI Techniques Used
- **State Representation**: NetworkX graph to encode spatial relationships, target values, and travel times.
- **Graph Search & Constraints**: Depth-First Search (DFS) with backtracking to find all feasible patrol paths within the shift duration constraint.
- **Adversarial Reasoning**: Stackelberg Game theory formulation to anticipate attacker responses.
- **Mathematical Optimization**: Linear Programming (SciPy) to solve for Strong Stackelberg Equilibrium (SSE).
- **Probabilistic Models**: Quantal response (Softmax) model for bounded-rational attackers.

## 6. Stackelberg Game Explanation
In a Stackelberg Security Game:
- **Defender (Leader)**: The security patrol commits to a mixed strategy (a probability distribution over feasible patrol paths).
- **Attacker (Follower)**: The intruder observes this mixed strategy and chooses a target that maximizes their expected utility.
- **Strong Stackelberg Equilibrium (SSE)**: We assume the attacker breaks ties in favor of the defender. The defender chooses the mixed strategy that maximizes their payoff given the attacker's best response.

## 7. Linear Programming Formulation
We formulate the problem as finding a mixed strategy vector `p` (probabilities over routes) that maximizes defender utility. Typically, this is formulated using the Multiple Linear Programs (Multiple LPs) approach (e.g., DOBSS), where one LP is solved for each possible target assuming it is the attacker's best response. The global solution is the one that yields the highest defender utility among all valid LPs.

## 8. Attacker Models
- **Rational Attacker**: Perfectly calculates the expected utility of attacking each target based on the defender's coverage probabilities and selects the absolute best target.
- **Bounded-Rational Attacker**: Uses a softmax function over expected utilities to probabilistically choose targets, parameterized by $\lambda$. A high $\lambda$ approaches perfect rationality, while a low $\lambda$ approaches random choice.

## 9. Baselines
- **Fixed Schedule**: A deterministic schedule where the same route is repeatedly chosen, making it highly predictable (0 entropy).
- **Uniform Random**: Assigns equal probability to all feasible routes. This maximizes unpredictability (entropy) but ignores the varying values/importance of different targets.

## 10. Simulation Methodology
The system runs `N` simulation rounds. In each round:
1. A patrol route is sampled from the active strategy's probability distribution.
2. The attacker selects a target based on their model.
3. If the attacker's target is on the patrol route, the attack is detected (Defender wins). Otherwise, the attack succeeds (Attacker wins).
4. Utilities are recorded for both parties.

## 11. Performance Metrics
- **Detection Probability**: Detected Attacks / Total Attacks
- **Attack Success Rate**: Successful Attacks / Total Attacks
- **Defender Utility**: Expected/Average payoff for the defender
- **Attacker Utility**: Expected/Average payoff for the attacker
- **Unpredictability**: Shannon entropy of the patrol strategy distribution $H = -\sum p_i \log(p_i)$

## 12. Installation Instructions
1. Clone this repository.
2. Install backend dependencies: `pip install -r backend/requirements.txt`
3. The frontend is vanilla HTML/JS/CSS, no installation required.

## 13. How to Run
1. Navigate to the `backend/` directory.
2. Start the API server: `uvicorn main:app --reload`
3. Open `frontend/index.html` in your web browser.

## 14. Example Input
- **Nodes**: Main Gate (value 9), Admin (value 6), Server Room (value 10)
- **Edges**: Gate-Admin (2 mins), Admin-Server (3 mins)
- **Shift Duration**: 5 minutes

## 15. Example Output
A probability distribution over valid paths, e.g.:
- Gate -> Admin: 40%
- Admin -> Server: 60%
Simulation results showing lower attacker success rate compared to uniform random strategies.

## 18. Statistical Fairness & Performance Evaluation Methodology
To ensure an objective and statistically fair evaluation of patrol policies:

1. **Identical Simulation Environment**: Every policy comparison operates on the exact same campus graph topology, node rewards/penalties, edge travel times, and attacker rationality parameters ($\lambda$).
2. **Equal Sample Sizes**: Each experiment runs an identical number of simulation rounds ($N$) across all policies (Fixed, Uniform Random, and Game-Theoretic).
3. **Controlled Randomness**: Random seeds are synchronized across policy comparisons within each independent experiment run to eliminate random variance bias.
4. **Binomial Confidence Intervals**: Detection probabilities report 95% Wilson score confidence intervals:
   $$\text{CI}_{95\%} = \frac{\hat{p} + \frac{z^2}{2n} \pm z \sqrt{\frac{\hat{p}(1-\hat{p})}{n} + \frac{z^2}{4n^2}}}{1 + \frac{z^2}{n}}$$
5. **Policy Unpredictability**: Unpredictability is quantified via normalized Shannon entropy ($H / \ln N$). It serves as a proxy for patrol unpredictability across the strategy distribution.
6. **No Special Bias**: Game-Theoretic strategies receive no preferential treatment or simulation shortcuts. Performance conclusions are derived purely from empirical experimental data.

