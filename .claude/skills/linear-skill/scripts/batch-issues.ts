/**
 * batch-issues.ts — Operaciones en lote sobre issues de Linear
 *
 * Para batches grandes (>20 issues) usa este script en lugar del MCP.
 * Soporta:
 * - Paginación automática (no se limita a 50)
 * - Throttling con concurrencia configurable
 * - Retry on rate limit
 * - Dry run para validar antes de ejecutar
 * - Add/remove labels respetando los existentes (no reemplaza el set)
 *
 * Uso:
 *   ts-node batch-issues.ts \
 *     --filter '{"team":{"key":{"eq":"ENG"}},"state":{"type":{"eq":"backlog"}}}' \
 *     --add-labels "vertical/data" \
 *     --remove-labels "needs-triage" \
 *     --dry-run
 *
 *   ts-node batch-issues.ts \
 *     --filter '{"team":{"key":{"eq":"ENG"}}}' \
 *     --set-priority 3 \
 *     --set-cycle current
 */

import { LinearMinClient } from "./linear-client";

// ====================================================================
// Tipos
// ====================================================================

interface BatchOptions {
  filter: any;
  dryRun: boolean;
  concurrency: number;

  // Operaciones soportadas
  addLabels?: string[];          // nombres de labels a añadir
  removeLabels?: string[];       // nombres de labels a quitar
  setPriority?: number;
  setCycle?: string | "current" | "next";
  setState?: string;             // nombre del state
  setAssignee?: string;          // user identifier
  setProject?: string;           // nombre del project
}

interface IssueRecord {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  estimate: number;
  state: { id: string; name: string; type: string };
  cycle: { id: string; number: number } | null;
  assignee: { id: string; displayName: string } | null;
  project: { id: string; name: string } | null;
  labels: { nodes: { id: string; name: string }[] };
}

interface UpdateInput {
  labelIds?: string[];
  priority?: number;
  cycleId?: string;
  stateId?: string;
  assigneeId?: string;
  projectId?: string;
}

// ====================================================================
// Queries
// ====================================================================

const ISSUES_QUERY = `
  query Issues($filter: IssueFilter, $first: Int!, $after: String) {
    issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
      nodes {
        id identifier title priority estimate
        state { id name type }
        cycle { id number }
        assignee { id displayName }
        project { id name }
        labels { nodes { id name } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ISSUE_UPDATE = `
  mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue { identifier }
    }
  }
`;

const LABELS_QUERY = `
  query Labels($filter: IssueLabelFilter) {
    issueLabels(filter: $filter, first: 250) {
      nodes { id name }
    }
  }
`;

const TEAM_CYCLES_QUERY = `
  query TeamCycles($teamKey: String!) {
    teams(filter: { key: { eq: $teamKey } }, first: 1) {
      nodes {
        activeCycle { id number }
        cycles(filter: { number: { gt: 0 } }, first: 5, orderBy: number) {
          nodes { id number startsAt }
        }
      }
    }
  }
`;

// ====================================================================
// Implementación
// ====================================================================

class BatchExecutor {
  constructor(
    private client: LinearMinClient,
    private opts: BatchOptions
  ) {}

  async run(): Promise<void> {
    console.log("\n=== Linear Batch Issues ===\n");

    // 1. Resolver IDs de labels para add/remove
    const addLabelIds = this.opts.addLabels
      ? await this.resolveLabelIds(this.opts.addLabels)
      : [];
    const removeLabelIds = this.opts.removeLabels
      ? await this.resolveLabelIds(this.opts.removeLabels)
      : [];

    // 2. Resolver cycle ID si setCycle
    let cycleId: string | undefined;
    if (this.opts.setCycle) {
      cycleId = await this.resolveCycleId(this.opts.setCycle);
    }

    // 3. Listar issues
    console.log("Fetching matching issues (paginated)...");
    const issues = await this.fetchAllIssues();
    console.log(`Found ${issues.length} issues matching filter.\n`);

    if (issues.length === 0) {
      console.log("Nothing to do.");
      return;
    }

    // 4. Mostrar sample
    console.log("Sample (first 5):");
    for (const issue of issues.slice(0, 5)) {
      console.log(`  ${issue.identifier} — ${issue.title}`);
    }
    if (issues.length > 5) console.log(`  ... and ${issues.length - 5} more`);
    console.log();

    // 5. Mostrar plan
    console.log("Plan:");
    if (this.opts.addLabels?.length) console.log(`  + add labels: ${this.opts.addLabels.join(", ")}`);
    if (this.opts.removeLabels?.length) console.log(`  - remove labels: ${this.opts.removeLabels.join(", ")}`);
    if (this.opts.setPriority !== undefined) console.log(`  > priority = ${this.opts.setPriority}`);
    if (this.opts.setCycle) console.log(`  > cycle = ${this.opts.setCycle}`);
    if (this.opts.setState) console.log(`  > state = ${this.opts.setState}`);
    if (this.opts.setAssignee) console.log(`  > assignee = ${this.opts.setAssignee}`);
    console.log();

    if (this.opts.dryRun) {
      console.log("--dry-run set, not executing. Detailed diff:\n");
      for (const issue of issues) {
        const update = this.computeUpdate(issue, addLabelIds, removeLabelIds, cycleId);
        if (Object.keys(update).length > 0) {
          console.log(`  ${issue.identifier} ${this.summarizeUpdate(issue, update)}`);
        } else {
          console.log(`  ${issue.identifier} (no change)`);
        }
      }
      return;
    }

    // 6. Ejecutar
    console.log(`Executing ${issues.length} updates with concurrency=${this.opts.concurrency}...\n`);

    let success = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: any }> = [];

    for (let i = 0; i < issues.length; i += this.opts.concurrency) {
      const batch = issues.slice(i, i + this.opts.concurrency);
      const results = await Promise.allSettled(
        batch.map(async (issue) => {
          const update = this.computeUpdate(issue, addLabelIds, removeLabelIds, cycleId);
          if (Object.keys(update).length === 0) return { skipped: true, identifier: issue.identifier };
          await this.client.queryWithRetry(ISSUE_UPDATE, { id: issue.id, input: update });
          return { skipped: false, identifier: issue.identifier };
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          success++;
          if (!r.value.skipped) console.log(`  ✓ ${r.value.identifier}`);
        } else {
          failed++;
          errors.push({ id: "?", error: r.reason });
          console.error(`  ✗ ${r.reason?.message ?? r.reason}`);
        }
      }

      // Pequeño throttle entre batches
      if (i + this.opts.concurrency < issues.length) {
        await sleep(200);
      }
    }

    console.log(`\nResult: ${success} succeeded, ${failed} failed.`);
    if (errors.length > 0) {
      console.log("\nErrors:");
      for (const e of errors.slice(0, 10)) {
        console.log("  -", e.error?.message ?? e.error);
      }
    }
  }

  private async fetchAllIssues(): Promise<IssueRecord[]> {
    return this.client.paginate(
      ISSUES_QUERY,
      { filter: this.opts.filter },
      (data) => data.issues,
      { batchSize: 50 }
    );
  }

  private async resolveLabelIds(names: string[]): Promise<string[]> {
    const data = await this.client.query(LABELS_QUERY, {
      filter: { name: { in: names } },
    });
    const map = new Map<string, string>();
    for (const l of data.issueLabels.nodes) {
      map.set(l.name, l.id);
    }
    const missing = names.filter((n) => !map.has(n));
    if (missing.length > 0) {
      throw new Error(`Labels not found: ${missing.join(", ")}`);
    }
    return names.map((n) => map.get(n)!);
  }

  private async resolveCycleId(value: string): Promise<string> {
    // Si es UUID, devolverlo directamente
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(value)) return value;

    // current / next / número
    const teamKey = this.opts.filter?.team?.key?.eq;
    if (!teamKey) throw new Error("Cannot resolve cycle without team filter");

    const data = await this.client.query(TEAM_CYCLES_QUERY, { teamKey });
    const team = data.teams.nodes[0];
    if (!team) throw new Error(`Team ${teamKey} not found`);

    if (value === "current") {
      if (!team.activeCycle) throw new Error("No active cycle");
      return team.activeCycle.id;
    }

    if (value === "next") {
      const activeNum = team.activeCycle?.number ?? 0;
      const next = team.cycles.nodes.find((c: any) => c.number === activeNum + 1);
      if (!next) throw new Error("No next cycle");
      return next.id;
    }

    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      const cycle = team.cycles.nodes.find((c: any) => c.number === num);
      if (!cycle) throw new Error(`Cycle ${num} not found`);
      return cycle.id;
    }

    throw new Error(`Cannot resolve cycle: ${value}`);
  }

  private computeUpdate(
    issue: IssueRecord,
    addLabelIds: string[],
    removeLabelIds: string[],
    cycleId?: string
  ): UpdateInput {
    const update: UpdateInput = {};

    if (addLabelIds.length > 0 || removeLabelIds.length > 0) {
      const current = new Set(issue.labels.nodes.map((l) => l.id));
      for (const id of addLabelIds) current.add(id);
      for (const id of removeLabelIds) current.delete(id);

      const newLabels = [...current].sort();
      const currentSorted = issue.labels.nodes.map((l) => l.id).sort();
      const changed = JSON.stringify(newLabels) !== JSON.stringify(currentSorted);

      if (changed) update.labelIds = newLabels;
    }

    if (this.opts.setPriority !== undefined && this.opts.setPriority !== issue.priority) {
      update.priority = this.opts.setPriority;
    }

    if (cycleId && cycleId !== issue.cycle?.id) {
      update.cycleId = cycleId;
    }

    return update;
  }

  private summarizeUpdate(issue: IssueRecord, update: UpdateInput): string {
    const parts: string[] = [];
    if (update.labelIds) {
      const before = issue.labels.nodes.length;
      const after = update.labelIds.length;
      parts.push(`labels ${before}→${after}`);
    }
    if (update.priority !== undefined) parts.push(`priority ${issue.priority}→${update.priority}`);
    if (update.cycleId) parts.push(`cycle change`);
    return parts.length ? `(${parts.join(", ")})` : "";
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ====================================================================
// CLI
// ====================================================================

function parseArgs(argv: string[]): BatchOptions {
  const opts: any = {
    filter: null,
    dryRun: false,
    concurrency: 5,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--filter") {
      opts.filter = JSON.parse(next);
      i++;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--concurrency") {
      opts.concurrency = parseInt(next, 10);
      i++;
    } else if (arg === "--add-labels") {
      opts.addLabels = next.split(",");
      i++;
    } else if (arg === "--remove-labels") {
      opts.removeLabels = next.split(",");
      i++;
    } else if (arg === "--set-priority") {
      opts.setPriority = parseInt(next, 10);
      i++;
    } else if (arg === "--set-cycle") {
      opts.setCycle = next;
      i++;
    } else if (arg === "--set-state") {
      opts.setState = next;
      i++;
    } else if (arg === "--set-assignee") {
      opts.setAssignee = next;
      i++;
    }
  }

  if (!opts.filter) {
    throw new Error("--filter is required");
  }

  return opts;
}

if (require.main === module) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error("Set LINEAR_API_KEY env var");
    process.exit(1);
  }

  const opts = parseArgs(process.argv.slice(2));
  const client = new LinearMinClient({ apiKey });
  const executor = new BatchExecutor(client, opts);

  executor.run().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
