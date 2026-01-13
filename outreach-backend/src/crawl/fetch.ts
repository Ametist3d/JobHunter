import { fetch } from "undici";

/**
 * Lightweight URL probe used for canonicalization (redirect + protocol resolution).
 * NOTE: we do NOT require HTML here — any HTTP response (even 401/403) proves the host is real.
 */
export async function probeUrl(
  url: string,
  timeoutMs = 6000
): Promise<{
  ok: boolean;
  status?: number;
  finalUrl?: string;
  error?: string;
}> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ThreedexOutreachBot/1.0; +https://threedex.ai)",
        Accept: "*/*",
      },
    });

    // Don't download large bodies; we only need status + final URL after redirects.
    try {
      // undici Response has a readable stream body with cancel()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (res as any)?.body?.cancel?.();
    } catch {
      // ignore
    }

    clearTimeout(t);
    return { ok: true, status: res.status, finalUrl: res.url };
  } catch (e: any) {
    clearTimeout(t);
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function fetchHtml(
  url: string,
  timeoutMs = 12000
): Promise<{
  ok: boolean;
  status?: number;
  html?: string;
  finalUrl?: string;
  error?: string;
}> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ThreedexOutreachBot/1.0; +https://threedex.ai)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
      clearTimeout(t);
      return { ok: false, status: res.status, error: `Not HTML: ${ct}` };
    }

    const html = await res.text();
    clearTimeout(t);
    return { ok: res.ok, status: res.status, html, finalUrl: res.url };
  } catch (e: any) {
    clearTimeout(t);
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function fetchHtmlPlaywright(
  url: string,
  timeoutMs = 20000
): Promise<{
  ok: boolean;
  status?: number;
  html?: string;
  finalUrl?: string;
  error?: string;
}> {
  let browser: any;

  try {
    // dynamic import to avoid hard dependency at compile time
    const pw: any = await import("playwright");
    browser = await pw.chromium.launch({ headless: true });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    const resp = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: timeoutMs,
    });

    // some sites load footer after scroll
    await page.evaluate(async () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 3; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(350);
      }
      window.scrollTo(0, 0);
    });

    const html = await page.content();
    const finalUrl = page.url();

    await page.close();
    await context.close();
    await browser.close();

    return {
      ok: true,
      status: resp?.status(),
      html,
      finalUrl,
    };
  } catch (e: any) {
    try {
      if (browser) await browser.close();
    } catch {
      // ignore
    }

    const msg = e?.message || String(e);
    const missing =
      msg.toLowerCase().includes("cannot find module 'playwright'") ||
      msg.toLowerCase().includes("failed to resolve module") ||
      (msg.toLowerCase().includes("playwright") &&
        msg.toLowerCase().includes("not found"));

    return {
      ok: false,
      error: missing
        ? `Playwright not installed. Install it: npm i -D playwright && npx playwright install chromium. Original: ${msg}`
        : msg,
    };
  }
}
