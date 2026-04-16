import { z } from "zod";
import { Manifest } from "./manifest.js";

export const ManifestResponse = z.object({
  manifest: Manifest,
  etag: z.string(),
});

export const SecretsRequest = z.object({
  keys: z.array(z.string()),
});

export const SecretsResponse = z.object({
  secrets: z.record(z.string()),
});

export const SecretSetRequest = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export const HealthResponse = z.object({
  status: z.literal("ok"),
  version: z.string(),
});

export type ManifestResponse = z.infer<typeof ManifestResponse>;
export type SecretsRequest = z.infer<typeof SecretsRequest>;
export type SecretsResponse = z.infer<typeof SecretsResponse>;
export type SecretSetRequest = z.infer<typeof SecretSetRequest>;
