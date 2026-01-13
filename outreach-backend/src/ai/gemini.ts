import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY missing");

export const ai = new GoogleGenAI({ apiKey });

// Default model for plain text generation (not discovery).
// Discovery uses GEMINI_SEARCH_MODEL in discover.ts.
export const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export async function generateText(prompt: string) {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  return res.text ?? "";
}
