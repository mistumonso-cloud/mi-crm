/**
 * linear-client.ts — Cliente GraphQL minimal para Linear
 *
 * Uso:
 *   import { LinearMinClient } from "./linear-client";
 *   const client = new LinearMinClient({ apiKey: process.env.LINEAR_API_KEY! });
 *   const issues = await client.query(`{ viewer { id name } }`);
 *
 * Por qué este cliente y no @linear/sdk:
 * - Cero dependencias salvo node fetch (Node 18+)
 * - Control directo sobre headers de rate limit
 * - Fácil de auditar y modificar
 * - Útil para scripts simples y para entender qué pasa por debajo
 *
 * Para apps grandes, prefiere @linear/sdk (más completo, typed).
 */

interface LinearClientOptions {
  apiKey?: string;
  accessToken?: string;
  endpoint?: string;
  timeoutMs?: number;
}

interface RateLimitInfo {
  requestsLimit: number;
  requestsRemaining: number;
  requestsReset: number;
  complexityLimit: number;
  complexityRemaining: number;
  complexityReset: number;
  lastComplexity: number;
}

export class LinearMinClient {
  private endpoint: string;
  private headers: Record<string, string>;
  private timeoutMs: number;
  public lastRateLimit: RateLimitInfo | null = null;

  constructor(opts: LinearClientOptions) {
    if (!opts.apiKey && !opts.accessToken) {
      throw new Error("LinearMinClient: provide apiKey or accessToken");
    }

    this.endpoint = opts.endpoint || "https://api.linear.app/graphql";
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.headers = {
      "Content-Type": "application/json",
    };

    if (opts.apiKey) {
      // Personal API keys NO usan "Bearer" — peculiaridad de Linear
      this.headers["Authorization"] = opts.apiKey;
    } else if (opts.accessToken) {
      this.headers["Authorization"] = `Bearer ${opts.accessToken}`;
    }
  }

  /**
   * Ejecuta una query/mutation GraphQL.
   * Lanza error si la respuesta contiene errors[].
   */
  async query<T = any>(
    query: string,
    variables?: Record<string, any>
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    // Capturar headers de rate limit incluso en errores
    this.captureRateLimit(response.headers);

    const json = await response.json();

    if (json.errors) {
      const err = new LinearGraphQLError(json.errors, response.status);
      throw err;
    }

    return json.data;
  }

  /**
   * Ejecuta query con retry automático en caso de RATELIMITED.
   * Backoff: respeta retryAfter si lo da Linear, si no exponential.
   */
  async queryWithRetry<T = any>(
    query: string,
    variables?: Record<string, any>,
    options: { maxRetries?: number; baseDelayMs?: number } = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 5;
    const baseDelayMs = options.baseDelayMs ?? 1000;

    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.query<T>(query, variables);
      } catch (err: any) {
        lastError = err;

        const isRateLimit =
          err instanceof LinearGraphQLError &&
          err.errors[0]?.extensions?.code === "RATELIMITED";

        if (!isRateLimit || attempt === maxRetries - 1) {
          throw err;
        }

        const retryAfterSeconds =
          err.errors[0]?.extensions?.retryAfter ?? null;
        const delayMs = retryAfterSeconds
          ? retryAfterSeconds * 1000
          : baseDelayMs * Math.pow(2, attempt);

        console.warn(
          `[linear-client] Rate limited. Retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`
        );

        await sleep(delayMs);
      }
    }

    throw lastError;
  }

  /**
   * Pagina automáticamente sobre cualquier connection.
   * El callback recibe cada página; debes pasar la query con $after $first.
   */
  async paginate<NodeType = any>(
    query: string,
    variables: Record<string, any>,
    extractConnection: (data: any) => {
      nodes: NodeType[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    },
    options: { batchSize?: number; maxPages?: number; onPage?: (nodes: NodeType[]) => void } = {}
  ): Promise<NodeType[]> {
    const batchSize = options.batchSize ?? 50;
    const maxPages = options.maxPages ?? 1000;
    const all: NodeType[] = [];
    let after: string | null = null;
    let pageNum = 0;

    while (true) {
      pageNum++;
      if (pageNum > maxPages) {
        throw new Error(`paginate: hit maxPages ${maxPages}`);
      }

      const data = await this.queryWithRetry(query, {
        ...variables,
        first: batchSize,
        after,
      });

      const conn = extractConnection(data);
      all.push(...conn.nodes);

      if (options.onPage) options.onPage(conn.nodes);

      if (!conn.pageInfo.hasNextPage) break;
      after = conn.pageInfo.endCursor;

      // Throttle ligero entre páginas
      await sleep(100);
    }

    return all;
  }

  private captureRateLimit(headers: Headers): void {
    const get = (k: string) => {
      const v = headers.get(k);
      return v ? parseInt(v, 10) : 0;
    };

    this.lastRateLimit = {
      requestsLimit: get("X-RateLimit-Requests-Limit"),
      requestsRemaining: get("X-RateLimit-Requests-Remaining"),
      requestsReset: get("X-RateLimit-Requests-Reset"),
      complexityLimit: get("X-RateLimit-Complexity-Limit"),
      complexityRemaining: get("X-RateLimit-Complexity-Remaining"),
      complexityReset: get("X-RateLimit-Complexity-Reset"),
      lastComplexity: get("X-Complexity"),
    };
  }
}

export class LinearGraphQLError extends Error {
  public errors: any[];
  public statusCode: number;

  constructor(errors: any[], statusCode: number) {
    const msg = errors[0]?.extensions?.userPresentableMessage ||
                errors[0]?.message ||
                "Linear GraphQL error";
    super(msg);
    this.name = "LinearGraphQLError";
    this.errors = errors;
    this.statusCode = statusCode;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ====================================================================
// Helpers de uso común
// ====================================================================

export const ME_QUERY = `
  query Me {
    viewer { id name email displayName }
  }
`;

export const TEAMS_QUERY = `
  query Teams {
    teams(first: 20) {
      nodes { id name key cyclesEnabled cycleDuration }
    }
  }
`;

export const ISSUE_BY_ID_QUERY = `
  query Issue($id: String!) {
    issue(id: $id) {
      id identifier title description priority estimate
      state { name type }
      assignee { displayName email }
      project { name }
      cycle { number }
      labels { nodes { id name } }
      url branchName
    }
  }
`;

export const ISSUES_PAGE_QUERY = `
  query IssuesPage($filter: IssueFilter, $first: Int, $after: String) {
    issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
      nodes {
        id identifier title priority estimate
        state { name type }
        assignee { displayName }
        labels { nodes { name } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// ====================================================================
// Ejemplo de uso
// ====================================================================

if (require.main === module) {
  (async () => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error("Set LINEAR_API_KEY env var");
      process.exit(1);
    }

    const client = new LinearMinClient({ apiKey });

    // 1. Quién soy
    const me = await client.query(ME_QUERY);
    console.log("Logged in as:", me.viewer.email);

    // 2. Listar teams
    const teams = await client.query(TEAMS_QUERY);
    console.log("Teams:", teams.teams.nodes.map((t: any) => `${t.name} (${t.key})`));

    // 3. Paginar todas las issues de un team
    const teamKey = process.env.LINEAR_TEAM_KEY || "ENG";
    const team = teams.teams.nodes.find((t: any) => t.key === teamKey);
    if (team) {
      const allIssues = await client.paginate(
        ISSUES_PAGE_QUERY,
        {
          filter: {
            team: { id: { eq: team.id } },
            state: { type: { in: ["unstarted", "started"] } },
          },
        },
        (data) => data.issues,
        {
          onPage: (nodes) =>
            console.log(`Got page of ${nodes.length} issues`),
        }
      );
      console.log(`Total active issues in ${teamKey}: ${allIssues.length}`);
    }

    // 4. Mostrar info de rate limit
    console.log("Rate limit:", client.lastRateLimit);
  })().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
