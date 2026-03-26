import { handleOptions, jsonResponse } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type VerificationStatus =
  | "requested"
  | "code_sent"
  | "verify_requested"
  | "verified"
  | "failed"
  | "expired"
  | "rate_limited"
  | "blocked";

type VerificationAction = "create" | "update" | "success" | "failure";

const E164_RE = /^\+[1-9]\d{7,14}$/;
const VALID_STATUSES = new Set<VerificationStatus>([
  "requested",
  "code_sent",
  "verify_requested",
  "verified",
  "failed",
  "expired",
  "rate_limited",
  "blocked",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toStatus(value: unknown): VerificationStatus | null {
  if (typeof value !== "string") return null;
  return VALID_STATUSES.has(value as VerificationStatus)
    ? value as VerificationStatus
    : null;
}

function toMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function parseIp(req: Request): string | null {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  return realIp || null;
}

function parseUserAgent(req: Request): string | null {
  return req.headers.get("user-agent")?.trim()
    || req.headers.get("x-client-info")?.trim()
    || null;
}

function maskPhone(phone: string): string {
  if (phone.length <= 6) return phone;
  return `${phone.slice(0, 3)}***${phone.slice(-3)}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!isRecord(parsed)) {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    body = parsed;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const action = toText(body.action) as VerificationAction | null;
  const attemptId = toText(body.attempt_id);
  const phoneE164 = toText(body.phone_e164);
  const purpose = toText(body.purpose);
  const provider = toText(body.provider) ?? "clerk";
  const channel = toText(body.channel) ?? "sms";
  const status = toStatus(body.status);
  const clerkUserId = toText(body.clerk_user_id);
  const errorCode = toText(body.error_code);
  const errorMessage = toText(body.error_message);
  const clerkRequestId = toText(body.clerk_request_id);
  const metadata = toMetadata(body.metadata);

  if (!action || !["create", "update", "success", "failure"].includes(action)) {
    return jsonResponse({ error: "Invalid action" }, 400);
  }

  if (!phoneE164 || !E164_RE.test(phoneE164)) {
    return jsonResponse(
      { error: "phone_e164 must be a valid E.164 phone number" },
      400,
    );
  }

  if (!purpose) {
    return jsonResponse({ error: "purpose is required" }, 400);
  }

  const service = createServiceClient();

  try {
    if (action === "create") {
      if (!status) {
        return jsonResponse({ error: "status is required for create" }, 400);
      }

      const { data: latestAttempt, error: latestError } = await service
        .from("auth_verification_attempts")
        .select("attempt_sequence")
        .eq("phone_e164", phoneE164)
        .eq("purpose", purpose)
        .order("attempt_sequence", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) {
        console.error("[auth-verification-audit] latest attempt lookup failed", latestError);
        return jsonResponse({ error: "Failed to resolve attempt sequence" }, 500);
      }

      const attemptSequence =
        typeof latestAttempt?.attempt_sequence === "number"
          ? latestAttempt.attempt_sequence + 1
          : 1;

      const { data: inserted, error: insertError } = await service
        .from("auth_verification_attempts")
        .insert({
          phone_e164: phoneE164,
          provider,
          channel,
          purpose,
          status,
          attempt_sequence: attemptSequence,
          clerk_user_id: clerkUserId,
          error_code: errorCode,
          error_message: errorMessage,
          clerk_request_id: clerkRequestId,
          ip: parseIp(req),
          user_agent: parseUserAgent(req),
          metadata,
        })
        .select("id, attempt_sequence, status, created_at")
        .single();

      if (insertError) {
        console.error("[auth-verification-audit] insert failed", {
          phone: maskPhone(phoneE164),
          purpose,
          message: insertError.message,
        });
        return jsonResponse({ error: "Failed to create verification attempt" }, 500);
      }

      return jsonResponse({ attempt: inserted }, 201);
    }

    if (!attemptId) {
      return jsonResponse({ error: "attempt_id is required" }, 400);
    }

    if (action === "success") {
      const { data: updated, error: updateError } = await service
        .from("auth_verification_attempts")
        .update({
          status: "verified",
          clerk_user_id: clerkUserId,
          clerk_request_id: clerkRequestId,
          error_code: null,
          error_message: null,
          metadata,
          verified_at: new Date().toISOString(),
        })
        .eq("id", attemptId)
        .eq("phone_e164", phoneE164)
        .eq("purpose", purpose)
        .select("id, status, verified_at, updated_at")
        .single();

      if (updateError) {
        console.error("[auth-verification-audit] success update failed", {
          attemptId,
          phone: maskPhone(phoneE164),
          purpose,
          message: updateError.message,
        });
        return jsonResponse({ error: "Failed to mark verification success" }, 500);
      }

      return jsonResponse({ attempt: updated });
    }

    if (!status) {
      return jsonResponse({ error: "status is required" }, 400);
    }

    const payload: Record<string, unknown> = {
      status,
      clerk_user_id: clerkUserId,
      clerk_request_id: clerkRequestId,
      metadata,
    };

    if (action === "failure") {
      payload.error_code = errorCode;
      payload.error_message = errorMessage;
    }

    const { data: updated, error: updateError } = await service
      .from("auth_verification_attempts")
      .update(payload)
      .eq("id", attemptId)
      .eq("phone_e164", phoneE164)
      .eq("purpose", purpose)
      .select("id, status, error_code, error_message, updated_at")
      .single();

    if (updateError) {
      console.error("[auth-verification-audit] status update failed", {
        attemptId,
        phone: maskPhone(phoneE164),
        purpose,
        status,
        message: updateError.message,
      });
      return jsonResponse({ error: "Failed to update verification attempt" }, 500);
    }

    return jsonResponse({ attempt: updated });
  } catch (err) {
    console.error("[auth-verification-audit] unexpected", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
