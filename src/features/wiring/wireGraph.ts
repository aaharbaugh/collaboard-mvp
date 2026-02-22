import type { BoardObject, Wire } from '../../types/board';

/**
 * Trace upstream from targetId via wires, return topologically-sorted
 * execution order (roots first, target last).
 *
 * Includes any **runnable node** — objects with output pills, a prompt
 * template, or an API config. Plain data stickies (no pills, no template,
 * no API) are skipped since they don't need running.
 *
 * Handles transitive dependencies through non-runnable intermediaries:
 * if A (runnable) → X (plain) → B (runnable), A is ordered before B.
 */
export function getExecutionChain(
  targetId: string,
  objects: Record<string, BoardObject>,
  wires: Record<string, Wire>,
): string[] {
  const wireList = Object.values(wires);

  /** A node is runnable if it can produce output when executed. */
  const isRunnableNode = (id: string): boolean => {
    const obj = objects[id];
    if (!obj) return false;
    if (obj.apiConfig) return true;
    if (obj.promptTemplate) return true;
    const pills = obj.pills ?? [];
    return pills.some((p) => p.direction === 'out');
  };

  // Build adjacency for ALL nodes (not just runnable ones)
  // upstreamOf[id] = set of object IDs that feed INTO id via a wire
  const upstreamOf = new Map<string, Set<string>>();
  for (const w of wireList) {
    if (!upstreamOf.has(w.toObjectId)) upstreamOf.set(w.toObjectId, new Set());
    upstreamOf.get(w.toObjectId)!.add(w.fromObjectId);
  }

  // 1. BFS upstream from target — collect ALL reachable nodes
  const visited = new Set<string>();
  const queue: string[] = [targetId];
  const runnableNodes = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if (isRunnableNode(current)) {
      runnableNodes.add(current);
    }

    // Walk upstream
    for (const upstream of upstreamOf.get(current) ?? []) {
      if (!visited.has(upstream)) {
        queue.push(upstream);
      }
    }
  }

  console.log('[wireGraph] target:', targetId);
  console.log('[wireGraph] runnable nodes found:', [...runnableNodes]);

  if (runnableNodes.size === 0) return [];

  // 2. Build TRANSITIVE dependency edges between runnable nodes.
  //    For each runnable node, BFS upstream through ALL nodes (including
  //    non-runnable) to find other runnable nodes it depends on.
  const dependsOn = new Map<string, Set<string>>(); // id → set of runnable IDs it depends on
  for (const id of runnableNodes) {
    dependsOn.set(id, new Set());
  }

  for (const id of runnableNodes) {
    // BFS upstream from this runnable node to find other runnable nodes
    const seen = new Set<string>();
    const bfsQueue: string[] = [];

    // Seed with direct upstream neighbors
    for (const upstream of upstreamOf.get(id) ?? []) {
      bfsQueue.push(upstream);
    }

    while (bfsQueue.length > 0) {
      const cur = bfsQueue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);

      if (runnableNodes.has(cur)) {
        // Found an upstream runnable node — this is a dependency
        dependsOn.get(id)!.add(cur);
        // Don't traverse further past this runnable node (its own
        // dependencies will be handled when we process it)
        continue;
      }

      // Non-runnable intermediary — keep traversing upstream through it
      for (const upstream of upstreamOf.get(cur) ?? []) {
        if (!seen.has(upstream)) {
          bfsQueue.push(upstream);
        }
      }
    }
  }

  // 3. Topological sort (Kahn's algorithm) using transitive dependencies
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of runnableNodes) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const [id, deps] of dependsOn) {
    for (const dep of deps) {
      adj.get(dep)!.push(id);  // dep must run before id
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
    }
  }

  // Start with roots (in-degree 0 = no upstream runnable dependencies)
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
