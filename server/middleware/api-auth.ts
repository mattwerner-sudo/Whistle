import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { apiKeys } from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

export interface AuthenticatedRequest extends Request {
  apiKeyId?: number;
  apiKeyLabel?: string;
  apiKeyScopes?: string[];
  apiKeyUserId?: number;
}

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export async function validateApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  // Accept the key in any of: Authorization: Bearer …, X-API-Key header, or ?api_key= query param
  const authHeader = req.headers.authorization;
  const headerKey = typeof req.headers["x-api-key"] === "string" ? (req.headers["x-api-key"] as string) : undefined;
  const queryKey = typeof req.query.api_key === "string" ? (req.query.api_key as string) : undefined;

  let key: string | undefined;
  if (authHeader?.startsWith("Bearer ")) key = authHeader.split(" ")[1];
  else if (headerKey) key = headerKey;
  else if (queryKey) key = queryKey;

  if (!key) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing API key. Provide 'Authorization: Bearer sk_live_…', 'X-API-Key' header, or ?api_key= query param.",
    });
  }

  if (key.length < 10) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid API key format",
    });
  }

  try {
    const hashedKey = hashApiKey(key);

    const [apiKeyRecord] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.hashedKey, hashedKey))
      .limit(1);

    if (!apiKeyRecord) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid API key",
      });
    }

    if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "API key has expired",
      });
    }

    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, apiKeyRecord.id));

    req.apiKeyId = apiKeyRecord.id;
    req.apiKeyLabel = apiKeyRecord.label || undefined;
    req.apiKeyScopes = apiKeyRecord.scopes || [];
    req.apiKeyUserId = apiKeyRecord.userId ?? undefined;

    next();
  } catch (error) {
    console.error("API key validation error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to validate API key",
    });
  }
}

export function requireScopes(...requiredScopes: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userScopes = req.apiKeyScopes || [];

    if (userScopes.includes("*")) {
      return next();
    }

    const hasAllScopes = requiredScopes.every((scope) =>
      userScopes.includes(scope)
    );

    if (!hasAllScopes) {
      return res.status(403).json({
        error: "Forbidden",
        message: `Missing required scopes: ${requiredScopes.join(", ")}`,
      });
    }

    next();
  };
}

export function generateApiKey(): { key: string; prefix: string; hashedKey: string } {
  const randomBytes = crypto.randomBytes(32).toString("hex");
  const key = `sk_live_${randomBytes}`;
  const prefix = key.substring(0, 16) + "...";
  const hashedKey = hashApiKey(key);

  return { key, prefix, hashedKey };
}
