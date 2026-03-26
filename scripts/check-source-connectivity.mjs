import fs from "node:fs";

const env = fs.readFileSync(new URL("../../grub-backoffice/.env.local", import.meta.url), "utf8");

const anonKey = env.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m)?.[1]?.trim();
const serviceRoleKey = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim();
const supabaseUrl = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim();

if (!anonKey || !serviceRoleKey || !supabaseUrl) {
  console.error("Missing Supabase credentials in grub-backoffice/.env.local");
  process.exit(1);
}

const checks = [
  {
    name: "api-public-events",
    url: `${supabaseUrl}/functions/v1/api-public-events?limit=1`,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  },
  {
    name: "api-public-feed-home",
    url: `${supabaseUrl}/functions/v1/api-public-feed-home`,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  },
  {
    name: "sync-joinnus",
    url: `${supabaseUrl}/functions/v1/sync-joinnus`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ countryCode: "PE" }),
  },
  {
    name: "sync-tikpe",
    url: `${supabaseUrl}/functions/v1/sync-tikpe`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ countryCode: "PE" }),
  },
];

async function runCheck(check) {
  const startedAt = Date.now();
  const res = await fetch(check.url, {
    method: check.method ?? "GET",
    headers: check.headers,
    body: check.body,
  });
  const durationMs = Date.now() - startedAt;
  const text = await res.text().catch(() => "");

  return {
    name: check.name,
    ok: res.ok,
    status: res.status,
    durationMs,
    bodyPreview: text.slice(0, 240),
  };
}

const results = [];
for (const check of checks) {
  try {
    results.push(await runCheck(check));
  } catch (error) {
    results.push({
      name: check.name,
      ok: false,
      status: 0,
      durationMs: 0,
      bodyPreview: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
