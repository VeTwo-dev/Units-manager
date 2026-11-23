/**
 * dependency-graph.ts
 * -----------------------------------------------------------------------
 * Single responsibility: DEPENDENCY GRAPHS + scientific pipelines
 * (Phase 24.8–24.12) over validated Formulas.
 *
 * Model:
 * - Each Formula with an `outputName` produces a named value; every other
 *   free variable it reads is a dependency. Dependencies resolve to either
 *   another formula's output (edge) or a caller-supplied input (root).
 * - Evaluation order is a deterministic topological sort (Kahn's algorithm
 *   with alphabetical tie-breaks). Cycles fail with CyclicDependencyError
 *   carrying the cycle path — never silent infinite recursion.
 * - Incremental recomputation: node results memoize per run-context; when
 *   inputs change, only downstream nodes recompute (dirty propagation).
 *   The simple single-formula path (compileFormula/evaluateFormula) pays
 *   nothing for this — graphs are opt-in.
 * - Pipelines are staged views over the same graph: inputs → intermediates
 *   → outputs with validation status and diagnostics.
 *
 * Determinism: frozen definitions, sorted structures, no hidden global
 * mutable state (per-graph memo maps only). Concurrency-safe by construction
 * (each evaluate() call owns its memo; compiled formulas are immutable).
 * -----------------------------------------------------------------------
 */
import { Quantity } from "./quantity.js";
import { Measurement } from "./measurement.js";
import {
  compileFormula,
  deserializeFormula,
  serializeFormula,
  type CompiledFormula,
  type DefineFormulaOptions,
  type EvaluateFormulaOptions,
  type Formula,
  type FormulaBindings,
} from "./formula.js";
import { collectVariables } from "./expression.js";
import { CyclicDependencyError, ExpressionLimitError, FormulaError } from "./errors/index.js";

export interface DependencyGraphLimits {
  /** Maximum formulas in one graph (default 256). */
  readonly maxGraphNodes?: number;
  /** Maximum dependencies per formula (default 64). */
  readonly maxDependencies?: number;
  /** Maximum total evaluation steps across one run (default: unbounded). */
  readonly maxEvaluationSteps?: number;
}

export interface DependencyGraphOptions {
  readonly limits?: DependencyGraphLimits;
  readonly evaluateOptions?: EvaluateFormulaOptions;
}

const DEFAULT_MAX_GRAPH_NODES = 256;
const DEFAULT_MAX_DEPENDENCIES = 64;

function resolveGraphLimits(limits?: DependencyGraphLimits): {
  maxGraphNodes: number;
  maxDependencies: number;
  maxEvaluationSteps?: number;
} {
  const maxGraphNodes = limits?.maxGraphNodes ?? DEFAULT_MAX_GRAPH_NODES;
  const maxDependencies = limits?.maxDependencies ?? DEFAULT_MAX_DEPENDENCIES;
  if (!Number.isInteger(maxGraphNodes) || maxGraphNodes < 1) {
    throw new ExpressionLimitError("maxGraphNodes must be a positive integer.");
  }
  if (!Number.isInteger(maxDependencies) || maxDependencies < 1) {
    throw new ExpressionLimitError("maxDependencies must be a positive integer.");
  }
  if (
    limits?.maxEvaluationSteps !== undefined &&
    (!Number.isInteger(limits.maxEvaluationSteps) || limits.maxEvaluationSteps < 1)
  ) {
    throw new ExpressionLimitError("maxEvaluationSteps must be a positive integer.");
  }
  return { maxGraphNodes, maxDependencies, maxEvaluationSteps: limits?.maxEvaluationSteps };
}

export interface GraphRunResult {
  /** Values produced by formulas, keyed by outputName. */
  readonly outputs: Readonly<Record<string, Quantity | Measurement>>;
  /** Every computed value including formula outputs (same map, sorted keys). */
  readonly intermediates: Readonly<Record<string, Quantity | Measurement>>;
  /** Root input bindings consumed by this run (enables recomputation). */
  readonly roots: Readonly<Record<string, Quantity | number | Measurement>>;
  /** Deterministic evaluation order (formula ids). */
  readonly order: readonly string[];
  /** Caller-supplied roots actually consumed. */
  readonly consumedInputs: readonly string[];
}

export interface GraphDiagnostics {
  readonly formulaIds: readonly string[];
  readonly order: readonly string[];
  readonly requiredInputs: readonly string[];
  readonly outputNames: readonly string[];
  readonly edgeCount: number;
}

/**
 * A bound, validated dependency graph. Construct via
 * createDependencyGraph(formulas, options); instances are immutable and
 * reusable across runs (each run owns its memo).
 */
export class DependencyGraph {
  private readonly formulas: Readonly<Record<string, CompiledFormula>>;
  private readonly order: readonly string[];
  private readonly outputToFormula: Readonly<Record<string, string>>;
  private readonly requiredInputs: readonly string[];
  /** Variable/output name → consumer formula ids (roots AND outputs). */
  private readonly consumers: Readonly<Record<string, readonly string[]>>;
  /** Formula id → output name it produces. */
  private readonly formulaOutput: Readonly<Record<string, string>>;
  /** Formula → formula edge count (root consumptions excluded). */
  private readonly edgeCount: number;
  private readonly maxEvaluationSteps?: number;
  private readonly evaluateOptions?: EvaluateFormulaOptions;

  /** Internal: construct via createDependencyGraph (validates before building). */
  constructor(
    formulas: Readonly<Record<string, CompiledFormula>>,
    order: readonly string[],
    outputToFormula: Readonly<Record<string, string>>,
    requiredInputs: readonly string[],
    consumers: Readonly<Record<string, readonly string[]>>,
    formulaOutput: Readonly<Record<string, string>>,
    edgeCount: number,
    maxEvaluationSteps: number | undefined,
    evaluateOptions: EvaluateFormulaOptions | undefined,
  ) {
    this.formulas = formulas;
    this.order = order;
    this.outputToFormula = outputToFormula;
    this.requiredInputs = requiredInputs;
    this.consumers = consumers;
    this.formulaOutput = formulaOutput;
    this.edgeCount = edgeCount;
    this.maxEvaluationSteps = maxEvaluationSteps;
    this.evaluateOptions = evaluateOptions;
    Object.freeze(this);
  }

  /** Deterministic evaluation order (formula ids). */
  evaluationOrder(): readonly string[] {
    return this.order;
  }

  diagnostics(): GraphDiagnostics {
    return {
      formulaIds: Object.freeze(Object.keys(this.formulas).sort()),
      order: this.order,
      requiredInputs: this.requiredInputs,
      outputNames: Object.freeze(Object.keys(this.outputToFormula).sort()),
      edgeCount: this.edgeCount,
    };
  }

  /**
   * Evaluate every formula. Bindings provide root inputs (plain values may
   * also satisfy intermediate names? No — intermediates come from formulas;
   * providing one explicitly is an error unless it is a required input).
   * Dimensional/binding validation reuses the formula layer per node.
   */
  evaluate(inputs: FormulaBindings = {}): GraphRunResult {
    if (inputs === null || typeof inputs !== "object" || Array.isArray(inputs)) {
      throw new FormulaError("<graph>", "inputs must be an object");
    }
    const values = new Map<string, Quantity | Measurement>();
    const roots = new Map<string, Quantity | number | Measurement>();
    const consumed = new Set<string>();
    let steps = 0;
    const provided = inputs as Record<string, Quantity | number | Measurement>;

    for (const id of this.order) {
      if (this.maxEvaluationSteps !== undefined && ++steps > this.maxEvaluationSteps) {
        throw new ExpressionLimitError(
          `Graph evaluation exceeds maxEvaluationSteps ${this.maxEvaluationSteps}.`,
        );
      }
      const compiled = this.formulas[id]!;
      const bindings: Record<string, Quantity | number | Measurement> = {};
      for (const name of compiled.variables) {
        if (values.has(name)) {
          bindings[name] = values.get(name)!;
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(provided, name)) {
          bindings[name] = provided[name]!;
          consumed.add(name);
          if (this.requiredInputs.includes(name)) roots.set(name, provided[name]!);
          continue;
        }
        const decl = compiled.definition.inputs[name];
        if (decl?.default !== undefined) {
          bindings[name] = decl.default;
          continue;
        }
        throw new FormulaError(id, `missing dependency "${name}" (no producer, input, or default)`);
      }
      const result = compiled.evaluate(bindings, this.evaluateOptions);
      if (isTrace(result)) {
        throw new FormulaError(id, "trace mode is not supported inside graph evaluation");
      }
      const outputName = compiled.definition.outputName ?? id;
      values.set(outputName, result);
    }
    // Anything provided but never consumed, and not a declared root, is a mistake.
    for (const name of Object.keys(provided)) {
      if (!consumed.has(name) && !this.requiredInputs.includes(name)) {
        throw new FormulaError(
          "<graph>",
          `unexpected input "${name}" (not consumed by any formula)`,
        );
      }
    }
    const sorted = [...values.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const record = Object.freeze(Object.fromEntries(sorted));
    const sortedRoots = [...roots.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return {
      outputs: record,
      intermediates: record,
      roots: Object.freeze(Object.fromEntries(sortedRoots)),
      order: this.order,
      consumedInputs: Object.freeze([...consumed].sort()),
    };
  }

  /**
   * Incremental recomputation: `previous` is a prior GraphRunResult (or its
   * intermediates map); only formulas downstream of `changed` inputs
   * recompute. Returns a fresh result; `previous` is never mutated.
   * Unrelated branches reuse prior values bit-for-bit (same object refs).
   */
  reevaluate(
    previous: Readonly<Record<string, Quantity | Measurement>> | GraphRunResult,
    changed: FormulaBindings,
  ): GraphRunResult {
    const prior: Readonly<Record<string, Quantity | Measurement>> =
      "intermediates" in (previous as object)
        ? (previous as GraphRunResult).intermediates
        : (previous as Readonly<Record<string, Quantity | Measurement>>);
    const priorRoots: Readonly<Record<string, Quantity | number | Measurement>> =
      "roots" in (previous as object) ? ((previous as GraphRunResult).roots ?? {}) : {};
    if (changed === null || typeof changed !== "object" || Array.isArray(changed)) {
      throw new FormulaError("<graph>", "changed inputs must be an object");
    }
    // Dirty set: changed names + everything downstream of them. The
    // consumer index covers both root inputs and formula outputs, so a
    // changed root correctly dirties its direct consumers.
    const dirty = new Set<string>();
    const visitDownstream = (name: string): void => {
      for (const formulaId of this.consumers[name] ?? []) {
        if (dirty.has(formulaId)) continue;
        dirty.add(formulaId);
        visitDownstream(this.formulaOutput[formulaId]!);
      }
    };
    for (const name of Object.keys(changed)) {
      if (!this.requiredInputs.includes(name) && !(name in prior)) {
        throw new FormulaError("<graph>", `unknown recomputation input "${name}"`);
      }
      // A changed root dirties its consumer formulas; a changed output-name
      // is treated as an override root (must equal a produced output).
      visitDownstream(name);
      const producer = this.outputToFormula[name];
      if (producer !== undefined) dirty.add(producer);
    }
    const values = new Map<string, Quantity | Measurement>(Object.entries(prior));
    for (const name of Object.keys(changed)) {
      if (this.requiredInputs.includes(name)) continue; // consumed below via bindings
      values.set(name, toResultValue(name, (changed as Record<string, unknown>)[name]));
    }
    let steps = 0;
    const consumed = new Set<string>();
    for (const id of this.order) {
      if (!dirty.has(id)) continue;
      if (this.maxEvaluationSteps !== undefined && ++steps > this.maxEvaluationSteps) {
        throw new ExpressionLimitError(
          `Graph evaluation exceeds maxEvaluationSteps ${this.maxEvaluationSteps}.`,
        );
      }
      const compiled = this.formulas[id]!;
      const bindings: Record<string, Quantity | number | Measurement> = {};
      for (const name of compiled.variables) {
        if (Object.prototype.hasOwnProperty.call(changed, name)) {
          bindings[name] = (changed as Record<string, Quantity | number | Measurement>)[name]!;
          consumed.add(name);
          continue;
        }
        if (values.has(name)) {
          bindings[name] = values.get(name)!;
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(priorRoots, name)) {
          bindings[name] = priorRoots[name]!;
          continue;
        }
        const decl = compiled.definition.inputs[name];
        if (decl?.default !== undefined) {
          bindings[name] = decl.default;
          continue;
        }
        throw new FormulaError(id, `missing dependency "${name}" during recomputation`);
      }
      const result = compiled.evaluate(bindings, this.evaluateOptions);
      if (isTrace(result)) {
        throw new FormulaError(id, "trace mode is not supported inside graph evaluation");
      }
      values.set(compiled.definition.outputName ?? id, result);
    }
    const sorted = [...values.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const record = Object.freeze(Object.fromEntries(sorted));
    // Carry roots forward (updated with any changed roots) for chained recomputation.
    const mergedRoots: Record<string, Quantity | number | Measurement> = {
      ...(priorRoots as Record<string, Quantity | number | Measurement>),
    };
    for (const name of Object.keys(changed)) {
      if (this.requiredInputs.includes(name)) {
        mergedRoots[name] = (changed as Record<string, Quantity | number | Measurement>)[name]!;
      }
    }
    return {
      outputs: record,
      intermediates: record,
      roots: Object.freeze(mergedRoots),
      order: this.order,
      consumedInputs: Object.freeze([...consumed].sort()),
    };
  }

  /** Serialize the graph structure (formula definitions serialize individually). */
  serialize(): {
    readonly version: 1;
    readonly type: "dependency-graph";
    readonly formulas: readonly unknown[];
  } {
    return Object.freeze({
      version: 1 as const,
      type: "dependency-graph" as const,
      formulas: Object.freeze(
        this.order.map((id) => serializeFormula(this.formulas[id]!.definition)),
      ),
    });
  }
}

function isTrace(value: unknown): value is { result: Quantity; steps: unknown } {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).result instanceof Quantity &&
    Array.isArray((value as Record<string, unknown>).steps)
  );
}

function toResultValue(name: string, value: unknown): Quantity | Measurement {
  if (value instanceof Quantity || value instanceof Measurement) return value;
  throw new FormulaError("<graph>", `override "${name}" must be a Quantity or Measurement`);
}

/**
 * Build and validate a dependency graph from formulas. Every formula needs
 * an outputName; every free variable must resolve to another formula's
 * output or remain a required caller input. Cycles and missing producers
 * fail here — before any numeric evaluation.
 */
export function createDependencyGraph(
  formulas: readonly Formula[],
  options: DependencyGraphOptions = {},
): DependencyGraph {
  if (!Array.isArray(formulas) || formulas.length === 0) {
    throw new FormulaError("<graph>", "a dependency graph needs at least one formula");
  }
  const { maxGraphNodes, maxDependencies, maxEvaluationSteps } = resolveGraphLimits(options.limits);
  if (formulas.length > maxGraphNodes) {
    throw new ExpressionLimitError(`Dependency graph exceeds maxGraphNodes ${maxGraphNodes}.`);
  }
  const byId = new Map<string, Formula>();
  const outputToFormula = new Map<string, string>();
  for (const formula of formulas) {
    if (byId.has(formula.id)) {
      throw new FormulaError("<graph>", `duplicate formula id "${formula.id}"`);
    }
    byId.set(formula.id, formula);
    const output = formula.outputName ?? formula.id;
    if (outputToFormula.has(output)) {
      throw new FormulaError("<graph>", `duplicate output name "${output}"`);
    }
    outputToFormula.set(output, formula.id);
  }
  // Edges: formula id → sorted producer formula ids it depends on.
  const dependencies = new Map<string, readonly string[]>();
  const requiredInputs = new Set<string>();
  for (const formula of formulas) {
    const vars = [...collectVariables(formula.expression)];
    if (vars.length > maxDependencies) {
      throw new ExpressionLimitError(
        `Formula "${formula.id}" exceeds maxDependencies ${maxDependencies}.`,
      );
    }
    const producers = new Set<string>();
    for (const name of vars) {
      const producer = outputToFormula.get(name);
      if (producer !== undefined && producer !== formula.id) {
        producers.add(producer);
      } else if (producer === formula.id) {
        throw new CyclicDependencyError([formula.id, formula.id]);
      } else {
        requiredInputs.add(name);
      }
    }
    dependencies.set(formula.id, Object.freeze([...producers].sort()));
  }
  // Deterministic Kahn topological sort (alphabetical tie-break).
  const order = topoSort([...byId.keys()].sort(), dependencies);
  // Consumer index for invalidation: every free variable (root input OR
  // formula output) maps to the formulas reading it. Formula id → output
  // map supports downstream traversal. Edge count covers producer edges.
  const consumers = new Map<string, string[]>();
  const formulaOutput: Record<string, string> = {};
  let edgeCount = 0;
  for (const formula of formulas) {
    const output = formula.outputName ?? formula.id;
    formulaOutput[formula.id] = output;
    for (const name of collectVariables(formula.expression)) {
      const list = consumers.get(name) ?? [];
      list.push(formula.id);
      consumers.set(name, list);
    }
  }
  for (const producers of dependencies.values()) edgeCount += producers.length;
  const frozenConsumers: Record<string, readonly string[]> = {};
  for (const [name, list] of consumers) {
    frozenConsumers[name] = Object.freeze([...list].sort());
  }
  const compiled: Record<string, ReturnType<typeof compileFormula>> = {};
  for (const formula of formulas) {
    compiled[formula.id] = compileFormula(formula, options.evaluateOptions);
  }
  return new DependencyGraph(
    Object.freeze(compiled) as Readonly<Record<string, CompiledFormula>>,
    Object.freeze(order),
    Object.freeze(Object.fromEntries(outputToFormula)) as Readonly<Record<string, string>>,
    Object.freeze([...requiredInputs].sort()),
    Object.freeze(frozenConsumers),
    Object.freeze(formulaOutput),
    edgeCount,
    maxEvaluationSteps,
    options.evaluateOptions,
  ) as DependencyGraph;
}

function topoSort(
  ids: readonly string[],
  dependencies: Readonly<Map<string, readonly string[]>>,
): readonly string[] {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of ids) {
    indegree.set(id, 0);
    dependents.set(id, []);
  }
  for (const [id, producers] of dependencies) {
    indegree.set(id, producers.length);
    for (const producer of producers) {
      dependents.get(producer)!.push(id);
    }
  }
  const ready = ids.filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id)!) {
      indegree.set(dependent, indegree.get(dependent)! - 1);
      if (indegree.get(dependent) === 0) {
        // Keep alphabetical determinism with a simple insertion.
        const index = ready.findIndex((candidate) => candidate > dependent);
        if (index === -1) ready.push(dependent);
        else ready.splice(index, 0, dependent);
      }
    }
  }
  if (order.length !== ids.length) {
    const remaining = ids.filter((id) => !order.includes(id)).sort();
    throw new CyclicDependencyError(findCycle(remaining[0]!, dependencies));
  }
  return Object.freeze(order);
}

function findCycle(
  start: string,
  dependencies: Readonly<Map<string, readonly string[]>>,
): readonly string[] {
  // Deterministic DFS from the smallest unprocessed node.
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): string[] | undefined => {
    if (path.includes(id)) return [...path.slice(path.indexOf(id)), id];
    if (visited.has(id)) return undefined;
    visited.add(id);
    path.push(id);
    for (const producer of dependencies.get(id) ?? []) {
      const cycle = visit(producer);
      if (cycle) return cycle;
    }
    path.pop();
    return undefined;
  };
  return Object.freeze(visit(start) ?? [start, start]);
}

/** Deserialize a graph serialized via DependencyGraph.serialize(). */
export function deserializeDependencyGraph(
  data: unknown,
  options: DependencyGraphOptions & DefineFormulaOptions = {},
): DependencyGraph {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new FormulaError("<graph>", "malformed serialized dependency graph");
  }
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1 || obj.type !== "dependency-graph" || !Array.isArray(obj.formulas)) {
    throw new FormulaError(
      "<graph>",
      "malformed serialized dependency graph (version/type/formulas)",
    );
  }
  if (obj.formulas.length === 0) {
    throw new FormulaError("<graph>", "serialized dependency graph has no formulas");
  }
  if ((obj.formulas as unknown[]).length > (options.limits?.maxGraphNodes ?? 256)) {
    throw new ExpressionLimitError("Serialized dependency graph exceeds maxGraphNodes.");
  }
  const formulas = (obj.formulas as unknown[]).map((entry) => deserializeFormula(entry, options));
  return createDependencyGraph(formulas, options);
}

// ---------------------------------------------------------------------------
// Pipelines: staged views over a dependency graph (24.12)
// ---------------------------------------------------------------------------

export interface PipelineRunResult extends GraphRunResult {
  /** Stage outputs in evaluation order: [{ formula, output, value }]. */
  readonly stages: readonly {
    readonly formula: string;
    readonly output: string;
    readonly value: Quantity | Measurement;
  }[];
  readonly validation: GraphDiagnostics;
}

/**
 * Build a scientific computation pipeline: an ordered list of stages with
 * inputs, outputs, intermediates, validation status and diagnostics per run.
 */
export function createPipeline(
  formulas: readonly Formula[],
  options: DependencyGraphOptions = {},
): {
  readonly graph: DependencyGraph;
  readonly stages: readonly string[];
  run(inputs?: FormulaBindings): PipelineRunResult;
  reevaluate(
    previous: Readonly<Record<string, Quantity | Measurement>> | GraphRunResult,
    changed: FormulaBindings,
  ): PipelineRunResult;
} {
  const graph = createDependencyGraph(formulas, options);
  const outputOf = new Map(formulas.map((f) => [f.id, f.outputName ?? f.id]));
  const wrap = (result: GraphRunResult): PipelineRunResult => {
    const stages = graph.evaluationOrder().map((id) => {
      const output = outputOf.get(id)!;
      return { formula: id, output, value: result.outputs[output]! };
    });
    return { ...result, stages: Object.freeze(stages), validation: graph.diagnostics() };
  };
  return {
    graph,
    stages: graph.evaluationOrder(),
    run: (inputs: FormulaBindings = {}) => wrap(graph.evaluate(inputs)),
    reevaluate: (
      previous: Readonly<Record<string, Quantity | Measurement>> | GraphRunResult,
      changed: FormulaBindings,
    ) => wrap(graph.reevaluate(previous, changed)),
  };
}
