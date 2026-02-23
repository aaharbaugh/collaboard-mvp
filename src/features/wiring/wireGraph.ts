import type { BoardObject, Wire } from '../../types/board';

/** A node is runnable if it can produce output when executed. */
function isRunnableNode(id: string, objects: Record<string, BoardObject>): boolean {
  const obj = objects[id];
  if (!obj) return false;
  if (obj.apiConfig) return true;
  if (obj.promptTemplate) return true;
  if (obj.accumulatorConfig) return true;
  const pills = obj.pills ?? [];
  return pills.some((p) => p.direction === 'out');
}

/**
 * Build upstream adjacency map and transitive dependency graph for runnable nodes.
 * Shared logic between getExecutionChain and getExecutionLevels.
 */
function buildDependencyGraph(
  targetId: string,
  objects: Record<string, BoardObject>,
  wires: Record<string, Wire>,
): {
  runnableNodes: Set<string>;
  dependsOn: Map<string, Set<string>>;
  inDegree: Map<string, number>;
  adj: Map<string, string[]>;
} {
  const wireList = Object.values(wires);

  // Build adjacency for ALL nodes (not just runnable ones)
  const upstreamOf = new Map<string, Set<string>>();
  for (const w of wireList) {
    if (!upstreamOf.has(w.toObjectId)) upstreamOf.set(w.toObjectId, new Set());
    upstreamOf.get(w.toObjectId)!.add(w.fromObjectId);
  }

  // BFS upstream from target — collect ALL reachable nodes
  const visited = new Set<string>();
  const queue: string[] = [targetId];
  const runnableNodes = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if (isRunnableNode(current, objects)) {
      runnableNodes.add(current);
    }

    for (const upstream of upstreamOf.get(current) ?? []) {
      if (!visited.has(upstream)) {
        queue.push(upstream);
      }
    }
  }

  // Build TRANSITIVE dependency edges between runnable nodes
  const dependsOn = new Map<string, Set<string>>();
  for (const id of runnableNodes) {
    dependsOn.set(id, new Set());
  }

  for (const id of runnableNodes) {
    const seen = new Set<string>();
    const bfsQueue: string[] = [];

    for (const upstream of upstreamOf.get(id) ?? []) {
      bfsQueue.push(upstream);
    }

    while (bfsQueue.length > 0) {
      const cur = bfsQueue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);

      if (runnableNodes.has(cur)) {
        dependsOn.get(id)!.add(cur);
        continue;
      }

      for (const upstream of upstreamOf.get(cur) ?? []) {
        if (!seen.has(upstream)) {
          bfsQueue.push(upstream);
        }
      }
    }
  }

  // Topological sort setup
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of runnableNodes) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const [id, deps] of dependsOn) {
    for (const dep of deps) {
      adj.get(dep)!.push(id);
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
    }
  }

  return { runnableNodes, dependsOn, inDegree, adj };
}

/**
 * Trace upstream from targetId via wires, return topologically-sorted
 * execution order (roots first, target last).
 *
 * Includes any **runnable node** — objects with output pills, a prompt
 * template, an API config, or an accumulator config. Plain data stickies
 * are skipped since they don't need running.
 *
 * Handles transitive dependencies through non-runnable intermediaries:
 * if A (runnable) → X (plain) → B (runnable), A is ordered before B.
 */
export function getExecutionChain(
  targetId: string,
  objects: Record<string, BoardObject>,
  wires: Record<string, Wire>,
): string[] {
  const { runnableNodes, inDegree, adj } = buildDependencyGraph(targetId, objects, wires);

  console.log('[wireGraph] target:', targetId);
  console.log('[wireGraph] runnable nodes found:', [...runnableNodes]);

  if (runnableNodes.size === 0) return [];

  // Kahn's algorithm — flat topological sort
  const sorted: string[] = [];
  const topoQueue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) topoQueue.push(id);
  }

  while (topoQueue.length > 0) {
    const node = topoQueue.shift()!;
    sorted.push(node);
    for (const neighbor of adj.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) topoQueue.push(neighbor);
    }
  }

  console.log('[wireGraph] execution chain:', sorted.map((id) => {
    const obj = objects[id];
    return `${id.slice(0, 8)}… (${obj?.text?.slice(0, 20) ?? obj?.apiConfig?.apiId ?? '?'})`;
  }));

  return sorted;
}

/**
 * Compute execution levels — nodes at the same depth can run in parallel.
 * Returns string[][] where each inner array is a set of nodes safe to run concurrently.
 */
export function getExecutionLevels(
  targetId: string,
  objects: Record<string, BoardObject>,
  wires: Record<string, Wire>,
): string[][] {
  const { runnableNodes, inDegree, adj } = buildDependencyGraph(targetId, objects, wires);

  if (runnableNodes.size === 0) return [];

  // Modified Kahn's: process all zero-in-degree nodes at once per level
  const levels: string[][] = [];
  // Clone inDegree since buildDependencyGraph returns mutable map
  const deg = new Map(inDegree);
  let currentLevel: string[] = [];

  for (const [id, d] of deg) {
    if (d === 0) currentLevel.push(id);
  }

  while (currentLevel.length > 0) {
    levels.push(currentLevel);
    const nextLevel: string[] = [];
    for (const node of currentLevel) {
      for (const neighbor of adj.get(node) ?? []) {
        const newDeg = (deg.get(neighbor) ?? 1) - 1;
        deg.set(neighbor, newDeg);
        if (newDeg === 0) nextLevel.push(neighbor);
      }
    }
    currentLevel = nextLevel;
  }

  console.log('[wireGraph] execution levels:', levels.map((lvl, i) =>
    `L${i}: [${lvl.map((id) => objects[id]?.text?.slice(0, 15) ?? objects[id]?.apiConfig?.apiId ?? id.slice(0, 8)).join(', ')}]`
  ));

  return levels;
}
