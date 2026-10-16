# 5-minute market data integration

This branch replaces the random OHLC generator in `stock.js` with a read-only market-data proxy and batches completed candle snapshots into the existing `stock_data` row.

## Important data-source note

The included proxy uses Yahoo Finance's **unofficial** chart endpoint for symbol `8271.TW`, interval `5m`, range `5d`. It may be delayed, incomplete, rate-limited, or discontinued without notice. It is not an exchange-authorized real-time feed. If this is used beyond a personal/demo project, replace the upstream URL/parser with a licensed provider's documented API and confirm its terms.

## Deploy the Supabase Edge Function

From a local clone of this repository, make sure the Supabase CLI is installed and the project is linked to the existing Supabase project:

```sh
supabase login
supabase link --project-ref jofmnltiasuvzozauwor
supabase functions deploy market-data --no-verify-jwt
```

The function is deliberately public because it only returns public market data and performs no database writes. It fixes the ticker in code, implements CORS, and keeps a short per-instance cache. Do not add a service-role key to the frontend. If you need stronger abuse protection, restrict allowed origins and add rate limiting at the gateway.

## How the frontend works

- Fetches the latest 5-minute bars from `/functions/v1/market-data` once per minute.
- Does not generate random prices when the provider is unavailable.
- Uses `setData()` only for initial load and `update()` for later bars.
- Uses the existing `stock_data` row as a fallback cache when the market-data function is unavailable.
- Buffers newly completed candles and writes the completed history to `stock_data` after 5 new candles have completed. The in-progress latest candle is not persisted as completed history.
- The existing authentication, wallet, trading panel, and `articles.js` code remain separate and unchanged.

## Test checklist

1. Deploy the function, then open this URL in a browser:
   `https://jofmnltiasuvzozauwor.supabase.co/functions/v1/market-data`
   It should return JSON with `symbol`, `interval: "5m"`, `source`, and a non-empty `bars` array. If it returns an error, check Supabase Dashboard → Edge Functions → Logs and the upstream provider response.
2. Open the GitHub Pages stock page and DevTools → Network. Confirm requests to `market-data` are approximately once per minute, not once per animation frame.
3. In the response, check each bar has numeric `time/open/high/low/close`, and `high >= max(open, close)`, `low <= min(open, close)`.
4. Leave the page open long enough for new 5-minute bars to complete. The frontend should only write to `stock_data` after five newly completed bars accumulate; inspect Supabase logs to verify fewer writes.
5. Confirm the newest bar stays at the right side and updates without the chart repeatedly resetting.
6. Test login/logout, wallet loading, simulated buy/sell, and article reading/posting. These code paths are intentionally preserved, but verify your Supabase RLS policies still permit the operations.
7. Temporarily block the Edge Function request in DevTools. The page should show a warning and use the stored `stock_data.history` if available, rather than inventing prices.

## Database permissions

The current frontend still updates `stock_data` using the publishable key, as the original code did. This requires an appropriate RLS policy. Do not add a broad write policy just to make the chart save work: public clients should not be able to overwrite arbitrary rows. For a production app, move candle persistence into a separately validated Edge Function or database RPC and grant only the required access.
