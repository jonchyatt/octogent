/**
 * todoNeeds — parse dependency annotations from todo item text.
 *
 * Syntax (Jarvis M0.02 Phase 10.8.3):
 *
 *   [ ] Build the API wrapper         → no deps, independent
 *   [ ] Wire the UI (needs: api)      → depends on the 'api' item
 *   [ ] Write tests (needs: api, ui)  → depends on both
 *
 * The `needs:` annotation can appear anywhere in the item text. It's stripped
 * out of the cleanText for display; the extracted list is used by the swarm
 * coordinator to sequence worker dispatch.
 *
 * Worker IDs in the needs list are matched against todo item indices OR against
 * the worker terminal id tail (e.g. `needs: 2` or `needs: swarm-2`). The DAG
 * validator rejects cycles and unknown references.
 */

export interface ParsedTodoNeeds {
  /** Text with the `(needs: ...)` annotation removed, trimmed. */
  cleanText: string;
  /** Parsed dependency references (lowercased, trimmed). Empty = no deps. */
  needs: string[];
}

/**
 * Regex matches `(needs: a, b, c)` or `(needs:a,b,c)` — parens required to
 * keep the syntax unambiguous next to normal prose that might contain "needs".
 */
const NEEDS_PATTERN = /\(\s*needs\s*:\s*([^)]*)\)/i;

export function parseTodoNeeds(text: string): ParsedTodoNeeds {
  const match = text.match(NEEDS_PATTERN);
  if (!match) {
    return { cleanText: text.trim(), needs: [] };
  }

  const idsRaw = match[1] ?? "";
  const needs = idsRaw
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);

  const cleanText = (text.slice(0, match.index) + text.slice(match.index! + match[0].length))
    .replace(/\s{2,}/g, " ")
    .trim();

  return { cleanText, needs };
}

export interface TodoNeedsNode {
  /** Canonical id — either a todo index (as string) or a tail like "swarm-2". */
  id: string;
  /** Raw parsed needs list (before resolution). */
  needs: string[];
}

/**
 * Detect a cycle in the dependency graph. Returns the offending id path if
 * found, or null if the graph is acyclic. Used by the swarm coordinator to
 * reject unspawnnable configurations before attempting dispatch.
 */
export function detectCycle(nodes: TodoNeedsNode[]): string[] | null {
  const graph = new Map<string, string[]>();
  for (const n of nodes) graph.set(n.id, n.needs);

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    const c = color.get(id) ?? WHITE;
    if (c === GRAY) {
      // Found a cycle — return path from first gray ancestor to here.
      const idx = path.indexOf(id);
      return idx >= 0 ? [...path.slice(idx), id] : [id];
    }
    if (c === BLACK) return null;
    color.set(id, GRAY);
    path.push(id);
    for (const dep of graph.get(id) ?? []) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    path.pop();
    color.set(id, BLACK);
    return null;
  };

  for (const n of nodes) {
    const cycle = visit(n.id);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Validate that every `needs:` reference in the graph points to a known node.
 * Returns the list of unresolved references (empty = all good).
 */
export function findUnresolvedNeeds(nodes: TodoNeedsNode[]): { from: string; missing: string }[] {
  const ids = new Set(nodes.map((n) => n.id));
  const unresolved: { from: string; missing: string }[] = [];
  for (const n of nodes) {
    for (const dep of n.needs) {
      if (!ids.has(dep)) unresolved.push({ from: n.id, missing: dep });
    }
  }
  return unresolved;
}

/**
 * Compute a valid execution order via topological sort. Returns the ids in an
 * order that honors all dependencies (dependencies first, dependents later).
 *
 * Throws if the graph has a cycle (caller should detect cycles first for
 * nicer error reporting).
 */
export function topologicalOrder(nodes: TodoNeedsNode[]): string[] {
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const n of nodes) {
    incoming.set(n.id, new Set());
    outgoing.set(n.id, new Set());
  }
  for (const n of nodes) {
    for (const dep of n.needs) {
      if (!incoming.has(dep)) continue; // unresolved; handled elsewhere
      incoming.get(n.id)!.add(dep);
      outgoing.get(dep)!.add(n.id);
    }
  }

  const ready: string[] = [];
  for (const [id, deps] of incoming) if (deps.size === 0) ready.push(id);
  ready.sort(); // deterministic ordering

  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const consumer of outgoing.get(id) ?? []) {
      const incoming_ = incoming.get(consumer)!;
      incoming_.delete(id);
      if (incoming_.size === 0) {
        ready.push(consumer);
        ready.sort();
      }
    }
  }

  if (order.length !== nodes.length) {
    throw new Error("topologicalOrder: graph has a cycle — call detectCycle() first");
  }
  return order;
}
