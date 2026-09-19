import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../../config/env";

export interface AuthenticatedRequest extends Request {
  tenantId?: string;
  userId?: string;
  roles?: string[];
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // Allow health checks and public static UI assets without auth
  const urlPath = (req.originalUrl || req.path).split("?")[0];
  if (urlPath.startsWith("/healthz") || urlPath === "/" || urlPath.endsWith(".html") || urlPath.endsWith(".js") || urlPath.endsWith(".css")) {
    return next();
  }

  const authHeader = req.headers["authorization"];
  const apiKey = req.headers["x-api-key"] as string;

  // 1. Check Bearer JWT
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET) as any;
      req.tenantId = decoded.tenantId || decoded.sub;
      req.userId = decoded.userId || decoded.sub;
      req.roles = decoded.roles || ["user"];
      return next();
    } catch (err) {
      return res.status(401).json({
        type: "urn:hive:error:unauthorized",
        title: "Unauthorized",
        status: 401,
        detail: "Invalid or expired JWT bearer token."
      });
    }
  }

  // 2. Check X-API-Key
  if (apiKey) {
    // API keys in enterprise have format: uam_live_<tenantId>_<randomHex>
    const parts = apiKey.split("_");
    if (parts.length >= 3 && parts[0] === "uam") {
      req.tenantId = parts[2];
      req.userId = `service_${parts[2]}`;
      req.roles = ["api_service"];
      return next();
    }
  }

  // 3. Fallback for Local Dev Mode
  if (config.NODE_ENV !== "production") {
    req.tenantId = (req.headers["x-tenant-id"] as string) || "local_dev_tenant";
    req.userId = "dev_user_01";
    req.roles = ["admin"];
    return next();
  }

  return res.status(401).json({
    type: "urn:hive:error:unauthorized",
    title: "Authentication Required",
    status: 401,
    detail: "Missing Authorization header or X-API-Key."
  });
}
