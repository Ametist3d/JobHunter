import { load } from "cheerio";
import { loadLexicon } from "../config/lexicon.js";

export type SiteContext = {
  language?: string; // e.g. "de", "en", "cs", ...
  title?: string;
  metaDescription?: string;
  h1?: string;
  h2: string[];
  navLinks: { text: string; href: string }[];
  textSnippet: string; // cleaned + truncated
};

function cleanText(s: string) {
  return s.replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim();
}

function truncate(s: string, maxChars: number) {
  return s.length <= maxChars ? s : s.slice(0, maxChars) + "…";
}

function normalizeLang(raw: string): string | undefined {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return undefined;
  // keep primary tag only: de-DE -> de
  const primary = s.split(/[-_]/)[0];
  if (!primary) return undefined;
  // allow common 2-letter codes + a few special cases
  if (/^[a-z]{2}$/.test(primary)) return primary;
  return undefined;
}

// small heuristic: score a few languages using stopwords
function guessLangFromText(text: string): string | undefined {
  const LEX = loadLexicon();
  
  const t = (" " + (text || "").toLowerCase().replace(/[^a-zäöüßąćęłńóśúźčďěňřšťůžáéíóúýàèìòùâêîôûç\s]/g, " ") + " ")
    .replace(/\s+/g, " ");

  if (t.trim().length < 200) return undefined;

  const score = (words: string[]) => words.reduce((acc, w) => acc + (t.includes(` ${w} `) ? 1 : 0), 0);

  const scores: Record<string, number> = {};
  
  // Use stopwords from lexicon
  for (const [lang, words] of Object.entries(LEX.language.stopwords)) {
    scores[lang] = score(words);
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = sorted[0] || [];
  const secondScore = sorted[1]?.[1] ?? 0;

  // require some confidence
  if (!best || bestScore < 3) return undefined;
  if (bestScore - secondScore < 1) return undefined;

  return best;
}

export function extractSiteContext(html: string, maxChars = 2500): SiteContext {
  const $ = load(html);

  // language from <html lang="...">
  const htmlLang = normalizeLang($("html").attr("lang") || "");

  // remove noisy elements
  $("script, style, noscript, svg, canvas, iframe").remove();

  const title = cleanText($("title").first().text() || "");
  const metaDescription = cleanText($('meta[name="description"]').attr("content") || "");
  const h1 = cleanText($("h1").first().text() || "");

  const h2: string[] = [];
  $("h2")
    .slice(0, 8)
    .each((_, el) => {
      const t = cleanText($(el).text());
      if (t) h2.push(t);
    });

  const navLinks: { text: string; href: string }[] = [];
  $("a")
    .slice(0, 120)
    .each((_, el) => {
      const text = cleanText($(el).text());
      const href = ($(el).attr("href") || "").trim();
      if (!href || href.startsWith("#")) return;
      if (!text) return;
      navLinks.push({ text: truncate(text, 40), href: truncate(href, 160) });
    });

  const bodyText = cleanText($("body").text() || "");
  const textSnippet = truncate(bodyText, maxChars);

  // guess from text if html lang missing
  const guessed = htmlLang || guessLangFromText(bodyText);

  return {
    language: guessed,
    title: title || undefined,
    metaDescription: metaDescription || undefined,
    h1: h1 || undefined,
    h2,
    navLinks: navLinks.slice(0, 30),
    textSnippet,
  };
}
