// Public, read-only proxy for Yahoo Finance's unofficial chart endpoint.
// This function does not write to Supabase and never exposes private API keys.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=30",
};

let cachedAt = 0;
let cachedBars: Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}> = [];

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  // The endpoint serves public market data only. Keep the symbol fixed to avoid
  // turning this function into an unrestricted proxy.
  const now = Date.now();
  if (cachedBars.length && now - cachedAt < 60_000) {
    return json({ symbol: "8271.TW", interval: "5m", source: "Yahoo Finance (unofficial)", bars: cachedBars },
      200, { "X-Data-Cache": "HIT" });
  }

  try {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/8271.TW?range=5d&interval=5m&includePrePost=false";
    const upstream = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; virtual-stock/1.0)",
      },
    });

    if (!upstream.ok) {
      throw new Error("Yahoo Finance returned HTTP " + upstream.status);
    }

    const payload = await upstream.json();
    const result = payload?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp)) {
      const message = payload?.chart?.error?.description || "No intraday data returned for 8271.TW";
      throw new Error(message);
    }

    const quote = result.indicators?.quote?.[0];
    if (!quote) throw new Error("Yahoo Finance response has no OHLC values");

    const bars = result.timestamp.map((time: number, i: number) => ({
      time,
      open: quote.open?.[i],
      high: quote.high?.[i],
      low: quote.low?.[i],
      close: quote.close?.[i],
      volume: quote.volume?.[i] ?? 0,
    })).filter((bar: any) =>
      Number.isFinite(bar.time) &&
      Number.isFinite(bar.open) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close) &&
      bar.high >= Math.max(bar.open, bar.close) &&
      bar.low <= Math.min(bar.open, bar.close) &&
      bar.high >= bar.low
    ).sort((a: any, b: any) => a.time - b.time);

    if (!bars.length) throw new Error("No valid OHLC bars returned");

    cachedBars = bars.slice(-300);
    cachedAt = now;

    return json({ symbol: "8271.TW", interval: "5m", source: "Yahoo Finance (unofficial)", bars: cachedBars },
      200, { "X-Data-Cache": "MISS" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Keep a previous response available during temporary upstream errors.
    if (cachedBars.length) {
      return json({
        symbol: "8271.TW",
        interval: "5m",
        source: "Yahoo Finance (unofficial; stale cache)",
        warning: message,
        bars: cachedBars,
      }, 200, { "X-Data-Cache": "STALE" });
    }
    console.error("market-data proxy failed:", message);
    return json({ error: "Unable to retrieve 5-minute market data", detail: message }, 502);
  }
});
