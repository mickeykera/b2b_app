import { z } from "zod";

/** Shared zod schemas for auth-related request bodies. */

export const zEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

export const zPassword = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(1024)
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.");

export const zInviteRole = z.enum(["admin", "member"]).default("member");