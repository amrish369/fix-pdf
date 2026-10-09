import { createServerFn } from "@tanstack/react-start";

export const groqMatch = createServerFn({ method: "POST" })
  .inputValidator((d: { img: string; prompt: string }) => {
    if (typeof d?.img !== "string" || !d.img.startsWith("data:image/png;base64,") || d.img.length > 4_000_000) throw new Error("Invalid image");
    if (typeof d.prompt !== "string" || d.prompt.length > 4000) throw new Error("Invalid prompt");
    return d;
  })
  .handler(async ({ data }) => {
    const key = process.env["GROQ_API_KEY"];
    if (!key) return { ok: false as const, error: "Server par GROQ_API_KEY set nahi hai" };
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: [{ type: "text", text: data.prompt }, { type: "image_url", image_url: { url: data.img } }] }],
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string }; choices?: { message?: { content?: string } }[] };
    if (!r.ok) {
      console.error("Groq error", r.status, j?.error?.message);
      return { ok: false as const, error: `Groq: ${r.status === 429 ? "limit khatam, thodi der baad try karein" : (j?.error?.message ?? r.status)}` };
    }
    return { ok: true as const, text: j.choices?.[0]?.message?.content ?? "" };
  });
