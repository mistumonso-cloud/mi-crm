/**
 * verify-webhook.ts — Verificación de webhooks de Linear
 *
 * Provee un middleware Express y una función standalone para verificar
 * la firma HMAC-SHA256 de webhooks de Linear, con anti-replay y
 * deduplicación por delivery ID.
 *
 * Uso (Express):
 *   import { linearWebhookMiddleware } from "./verify-webhook";
 *
 *   app.post(
 *     "/linear-webhook",
 *     express.raw({ type: "application/json" }),
 *     linearWebhookMiddleware(process.env.LINEAR_WEBHOOK_SECRET!),
 *     (req, res) => {
 *       const payload = (req as any).linearPayload;
 *       // procesar...
 *       res.status(200).end();
 *     }
 *   );
 *
 * Uso standalone:
 *   import { verifyLinearWebhook } from "./verify-webhook";
 *   const valid = verifyLinearWebhook(rawBody, signature, secret);
 */

import * as crypto from "crypto";

export interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: string;
  data: any;
  updatedFrom?: any;
  webhookTimestamp: number;
  webhookId: string;
  organizationId: string;
}

export interface VerifyOptions {
  /** Timestamp tolerance in seconds. Default 60. */
  toleranceSeconds?: number;
  /** Optional dedupe set for delivery IDs. Pass to prevent replay. */
  deliveryDeduper?: DeliveryDeduper;
}

/**
 * Verifica firma HMAC-SHA256 con timing-safe comparison.
 * Devuelve true si la firma es válida.
 */
export function verifyLinearSignature(
  rawBody: Buffer | string,
  signatureHeader: string,
  secret: string
): boolean {
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return false;
  }

  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // timing-safe — previene timing attacks
  const computedBuf = Buffer.from(computed);
  const providedBuf = Buffer.from(signatureHeader);

  if (computedBuf.length !== providedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(computedBuf, providedBuf);
}

/**
 * Valida que el timestamp del webhook sea reciente.
 */
export function isFreshTimestamp(
  webhookTimestampMs: number,
  toleranceSeconds: number = 60
): boolean {
  if (typeof webhookTimestampMs !== "number" || !isFinite(webhookTimestampMs)) {
    return false;
  }
  const nowMs = Date.now();
  const ageMs = Math.abs(nowMs - webhookTimestampMs);
  return ageMs < toleranceSeconds * 1000;
}

/**
 * Deduper para delivery IDs. Usar para evitar procesar el mismo webhook
 * dos veces (Linear puede reintentar).
 *
 * Implementación in-memory con expiración. Para multi-instance, reemplazar
 * con Redis o equivalente.
 */
export class DeliveryDeduper {
  private seen: Map<string, number> = new Map();
  private ttlMs: number;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
    // Cleanup periodic
    setInterval(() => this.cleanup(), 60 * 60 * 1000).unref?.();
  }

  /** Returns true if seen before; false if first time. Marks as seen. */
  checkAndMark(deliveryId: string): boolean {
    if (this.seen.has(deliveryId)) {
      return true;
    }
    this.seen.set(deliveryId, Date.now());
    return false;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(id);
    }
  }
}

/**
 * Verificación completa: firma + timestamp + dedupe.
 */
export function verifyLinearWebhook(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  options: VerifyOptions = {}
): {
  valid: boolean;
  reason?: string;
  payload?: LinearWebhookPayload;
} {
  const signature = pickHeader(headers, "linear-signature");
  if (!signature) {
    return { valid: false, reason: "missing Linear-Signature header" };
  }

  if (!verifyLinearSignature(rawBody, signature, secret)) {
    return { valid: false, reason: "invalid signature" };
  }

  let payload: LinearWebhookPayload;
  try {
    payload = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString());
  } catch (e) {
    return { valid: false, reason: "invalid JSON body" };
  }

  if (
    !isFreshTimestamp(
      payload.webhookTimestamp,
      options.toleranceSeconds ?? 60
    )
  ) {
    return { valid: false, reason: "stale timestamp" };
  }

  if (options.deliveryDeduper) {
    const deliveryId = pickHeader(headers, "linear-delivery");
    if (deliveryId && options.deliveryDeduper.checkAndMark(deliveryId)) {
      return { valid: false, reason: "duplicate delivery" };
    }
  }

  return { valid: true, payload };
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  // Express normaliza headers a lowercase
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) {
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

// ====================================================================
// Middleware Express
// ====================================================================

type ExpressLikeRequest = {
  headers: Record<string, string | string[] | undefined>;
  body: Buffer | string;
  [key: string]: any;
};

type ExpressLikeResponse = {
  status: (code: number) => any;
  end: (msg?: string) => any;
};

type NextFunction = (err?: Error) => void;

/**
 * Middleware Express que verifica el webhook y popula req.linearPayload.
 *
 * IMPORTANTE: Este middleware requiere que el body venga RAW (Buffer).
 * Configurar la ruta con `express.raw({ type: "application/json" })`
 * ANTES de este middleware.
 */
export function linearWebhookMiddleware(
  secret: string,
  options: VerifyOptions = {}
) {
  return (req: ExpressLikeRequest, res: ExpressLikeResponse, next: NextFunction) => {
    const result = verifyLinearWebhook(req.body, req.headers, secret, options);

    if (!result.valid) {
      console.warn("[linear-webhook] Rejected:", result.reason);
      return res.status(401).end(result.reason);
    }

    req.linearPayload = result.payload;
    next();
  };
}

// ====================================================================
// Ejemplo de servidor completo
// ====================================================================
/*
import express from "express";
import { linearWebhookMiddleware, DeliveryDeduper } from "./verify-webhook";

const app = express();
const deduper = new DeliveryDeduper();

app.post(
  "/linear-webhook",
  express.raw({ type: "application/json", limit: "5mb" }),
  linearWebhookMiddleware(process.env.LINEAR_WEBHOOK_SECRET!, {
    deliveryDeduper: deduper,
  }),
  async (req, res) => {
    const payload = (req as any).linearPayload;
    const eventType = req.header("Linear-Event");

    // Responder rápido (Linear da 5s)
    res.status(200).end();

    // Procesar async
    try {
      await handleLinearEvent(eventType, payload);
    } catch (err) {
      console.error("Error processing Linear event:", err);
    }
  }
);

async function handleLinearEvent(eventType: string, payload: any) {
  switch (eventType) {
    case "Issue":
      await handleIssueEvent(payload);
      break;
    case "Comment":
      await handleCommentEvent(payload);
      break;
    case "AgentSessionEvent":
      await handleAgentSessionEvent(payload);
      break;
    default:
      console.log(`Unhandled event type: ${eventType}`);
  }
}

app.listen(3000, () => {
  console.log("Linear webhook server listening on :3000");
});
*/
