import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  computeEnrichmentPatch,
  normalizeAiEventProposal,
} from "../../_shared/ai-event-enrichment.ts";

Deno.test("normalizeAiEventProposal limpia campos y coerciona confianza", () => {
  const proposal = normalizeAiEventProposal({
    summary: "Evento completo",
    confidence: 1.2,
    fields: {
      description: { value: "  Banda invitada y opening act.  ", confidence: 0.81 },
      lineup: { value: ["  Artist A ", "", "Artist B"], confidence: 0.8 },
      genres: { value: [" Indie Rock ", "rock"], confidence: 0.85 },
      price_min: { value: "129.90", confidence: 0.94 },
    },
  });

  assertEquals(proposal.confidence, 1);
  assertEquals(proposal.fields.description?.value, "Banda invitada y opening act.");
  assertEquals(proposal.fields.lineup?.value, ["Artist A", "Artist B"]);
  assertEquals(proposal.fields.genres?.value, ["Indie Rock", "rock"]);
  assertEquals(proposal.fields.price_min?.value, 129.9);
});

Deno.test("computeEnrichmentPatch aplica solo campos con confianza suficiente", () => {
  const patch = computeEnrichmentPatch(
    {
      id: "evt-1",
      name: "Festival",
      description: null,
      lineup: [],
      venue: "Arena",
      city: "Lima",
      country_code: "PE",
      source: "teleticket",
      ticket_url: "https://example.com",
      date: "2026-04-01T20:00:00-05:00",
      start_time: null,
      price_min: null,
      price_max: null,
      is_active: true,
      event_genres: [],
    },
    {
      summary: "Se pudo extraer data",
      confidence: 0.88,
      fields: {
        description: {
          value: "Concierto con invitados especiales, apertura a las 7pm y experiencia extendida para fans.",
          confidence: 0.82,
        },
        lineup: { value: ["Artist A", "Artist B"], confidence: 0.8 },
        genres: { value: ["rock", "indie"], confidence: 0.83 },
        price_min: { value: 140, confidence: 0.95 },
        price_max: { value: 260, confidence: 0.91 },
      },
    },
    [3, 7],
  );

  assertEquals(patch.appliedFields, ["description", "lineup", "price_min", "price_max", "genres"]);
  assertEquals(patch.eventPatch.price_min, 140);
  assertEquals(patch.eventPatch.price_max, 260);
  assertEquals(patch.genreIds, [3, 7]);
  assertEquals(patch.reviewRequired, false);
});

Deno.test("computeEnrichmentPatch marca review cuando la propuesta no supera umbral", () => {
  const patch = computeEnrichmentPatch(
    {
      id: "evt-2",
      name: "Show",
      description: null,
      lineup: [],
      venue: "Club",
      city: "Lima",
      country_code: "PE",
      source: "ticketmaster",
      ticket_url: "https://example.com/2",
      date: null,
      start_time: null,
      price_min: null,
      price_max: null,
      is_active: true,
      event_genres: [],
    },
    {
      summary: null,
      confidence: 0.6,
      fields: {
        description: { value: "Texto demasiado corto", confidence: 0.4 },
        lineup: { value: ["Artist A"], confidence: 0.5 },
        genres: { value: ["rock"], confidence: 0.4 },
      },
    },
    [2],
  );

  assertEquals(patch.appliedFields, []);
  assertEquals(patch.proposedFields, ["description", "lineup", "genres"]);
  assertEquals(patch.reviewRequired, true);
});
