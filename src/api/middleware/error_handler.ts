import { Request, Response, NextFunction } from "express";

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  errors?: any[];
}

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const status = err.status || err.statusCode || 500;
  const correlationId = (req.headers["x-request-id"] as string) || `err_${Date.now()}`;

  console.error(`[${correlationId}] Unhandled Error:`, err);

  const problem: ProblemDetails = {
    type: err.type || "urn:hive:error:internal-server-error",
    title: err.title || "Internal Server Error",
    status,
    detail: err.message || "An unexpected error occurred while processing your request.",
    instance: req.originalUrl
  };

  if (err.errors) {
    problem.errors = err.errors;
  }

  res.setHeader("Content-Type", "application/problem+json");
  res.status(status).json(problem);
}
