import fs from "node:fs";

const env = fs.readFileSync(new URL("../../grub-backoffice/.env.local", import.meta.url), "utf8");

const serviceRoleKey = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim();
const supabaseUrl = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim();

if (!serviceRoleKey || !supabaseUrl) {
  console.error("Missing Supabase URL or service role key in grub-backoffice/.env.local");
  process.exit(1);
}

const sources = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const targetSources = sources.length ? sources : ["joinnus", "tikpe"];

function buildInFilter(values) {
  return `in.(${values.map((value) => encodeURIComponent(value)).join(",")})`;
}

async function rest(path, init = {}, schema) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...init.headers,
  };

  if (schema) {
    headers["Accept-Profile"] = schema;
    headers["Content-Profile"] = schema;
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${init.method ?? "GET"} ${path} failed: HTTP ${res.status} ${text}`);
  }

  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

async function main() {
  const events = await rest(`events?select=id,source&source=${buildInFilter(targetSources)}&limit=5000`);
  const runs = await rest(
    `sync_runs?select=id,source_filters&source_filters=ov.{${targetSources.join(",")}}&limit=5000`,
    {},
    "ingestion",
  );

  const eventsBySource = {};
  for (const event of events ?? []) {
    eventsBySource[event.source] = (eventsBySource[event.source] ?? 0) + 1;
  }

  console.log(JSON.stringify({
    targetSources,
    eventsFound: events?.length ?? 0,
    eventsBySource,
    syncRunsFound: runs?.length ?? 0,
  }, null, 2));

  if (events?.length) {
    await rest(`events?source=${buildInFilter(targetSources)}`, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal",
      },
    });
  }

  if (runs?.length) {
    const runIds = runs.map((run) => run.id);
    await rest(`sync_runs?id=${buildInFilter(runIds)}`, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal",
      },
    }, "ingestion");
  }

  const remainingEvents = await rest(`events?select=id,source&source=${buildInFilter(targetSources)}&limit=10`);
  const remainingRuns = await rest(
    `sync_runs?select=id&source_filters=ov.{${targetSources.join(",")}}&limit=10`,
    {},
    "ingestion",
  );

  console.log(JSON.stringify({
    deletedEvents: events?.length ?? 0,
    deletedRuns: runs?.length ?? 0,
    remainingEvents: remainingEvents?.length ?? 0,
    remainingRuns: remainingRuns?.length ?? 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
