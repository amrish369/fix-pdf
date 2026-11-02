import { createServerFn } from "@tanstack/react-start";

/** Text-only Groq call for whole-page commands ("change all 2025 to 2026"). Key stays on the server. */
export const groqPageCommand = createServerFn({ method: "POST" })
  .inputValidator((d: { prompt: string }) => {
    if (typeof d?.prompt !== "string" || d.prompt.length > 60_000) throw new Error("Invalid prompt");
    return d;
  })
  .handler(async ({ data }) => {
    const key = process.env["GROQ_API_KEY"];
    if (!key) return { ok: false as const, error: "Server par GROQ_API_KEY set nahi hai" };
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: data.prompt }],
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string }; choices?: { message?: { content?: string } }[] };
    if (!r.ok) {
      console.error("Groq page error", r.status, j?.error?.message);
      return { ok: false as const, error: `Groq: ${r.status === 429 ? "limit khatam, thodi der baad try karein" : (j?.error?.message ?? r.status)}` };
    }
    return { ok: true as const, text: j.choices?.[0]?.message?.content ?? "" };
  });
