export const dynamic = "force-dynamic"

import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { TaskStatus, TaskPriority } from '@/generated/prisma'

// There is no SYSTEM_PROMPT constant here any more. One existed for months and was never sent:
// it appeared exactly once in this file, its own declaration, so every rule written in it did
// nothing while looking authoritative. GIDEON's persona comes from the Hermes agent; the only
// thing NEXUS injects is the header built below, which IS sent — so a rule that must hold
// belongs there and nowhere else.

// MODEL_MAP, the Anthropic tool schemas and executeToolCall lived here: 248 lines that were never
// called once. Each appeared exactly twice in this file — its declaration and nothing else. They
// were the remains of a direct-to-Anthropic design abandoned when the Hermes path was wired, and
// they kept a dependency alive that nothing used. GIDEON's tools are Hermes's, served by
// /api/gideon/tools.

function buildGideonPrompt(history: { role: string; content: string }[], who: { name: string; email: string }): string {
  const recent = (history || []).filter((m) => m && typeof m.content === "string").slice(-8)
  const last = recent[recent.length - 1]?.content?.trim() || ""
  const name = who.name?.trim() || "anggota tim NEXUS"
  const header =
    `[IDENTITAS LAWAN BICARA — WAJIB DIPATUHI] Kamu (Gideon) lagi ngobrol di chatbox NEXUS dengan "${name}"` +
    `${who.email ? ` (${who.email})` : ""}, anggota tim NEXUS. Ini SESI TERPISAH khusus dia. Sapa & rujuk dia ` +
    `sebagai "${name}". JANGAN sekali-kali manggil/menganggap dia sebagai orang lain (operator, admin, atau ` +
    `nama apa pun dari memori sesi sebelumnya) — kalau kamu inget nama lain, ABAIKAN; sekarang kamu ngomong sama ${name}.\n\n` +
    // Ditanya "lo pake LLM apa?" jawabannya sempat bocor separuh — menyebut framework dan angka versi
    // model. Menyebut yang BUKAN dipakai sama bocornya, jadi keduanya dilarang sekalian.
    `[SOAL DIRIMU SENDIRI] Kamu GIDEON, titik. Jangan pernah menyebut model, provider, vendor, framework, ` +
    `atau tier yang kamu pakai — dan jangan menyebut yang TIDAK kamu pakai juga ("bukan Claude", "bukan GPT" ` +
    `sama saja membocorkan). Kalau ditanya kamu dibangun di atas apa: satu kalimat pendek bahwa itu internal ` +
    `dan tidak kamu bahas, lalu langsung balik ke pertanyaan aslinya. Jangan minta maaf, jangan kasih petunjuk, ` +
    `jangan menawarkan untuk memberitahu. Ditanya kedua kalinya, jawabannya kalimat yang sama — bukan yang lebih panjang.\n\n`
  if (recent.length <= 1) return `${header}Pesan dari ${name}: ${last}`
  const ctx = recent.slice(0, -1).map((m) => `${m.role === "user" ? name : "Gideon"}: ${m.content}`).join("\n")
  return `${header}Konteks percakapan:\n${ctx}\n\nPesan terbaru dari ${name}: ${last}`
}

// Gideon chat is now backed by the Hermes agent (gpt-5.5 + live NEXUS tools) via the host shim —
// the same assistant the team uses on WhatsApp. We keep the exact SSE contract the frontend expects.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const { messages, model, image } = (await req.json()) as {
    messages: { role: string; content: string }[]
    model?: string
    /** A data URL or bare base64. Optional. */
    image?: string
  }

  // The three GIDEON tiers. Which model each one is stays in the shim — this only has to refuse a
  // name it does not recognise, so a client cannot smuggle an arbitrary model id through.
  const TIERS = ['astra', 'luna', 'terra', 'experimental']
  const tier = TIERS.includes((model || '').toLowerCase()) ? (model as string).toLowerCase() : 'luna'
  const userId = session.user.id

  // Downscaled before it travels. A phone photo is several megabytes and a vision model gains
  // nothing past ~1568px, so sending the original would only make every request slower and the
  // shim's body limit a real constraint rather than a safety net.
  let imageBase64: string | null = null
  if (typeof image === 'string' && image.length > 32) {
    try {
      const raw = image.startsWith('data:') ? image.slice(image.indexOf(',') + 1) : image
      // Guard before decoding: a 12 MB base64 string is already generous for a photo.
      if (raw.length <= 12_000_000) {
        const shrunk = await sharp(Buffer.from(raw, 'base64'))
          .rotate() // honour EXIF, or a portrait photo reaches the model on its side
          .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer()
        imageBase64 = shrunk.toString('base64')
      }
    } catch (error) {
      // A picture that cannot be decoded must not take the whole question down with it.
      console.error('gideon image decode failed:', error)
    }
  }

  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const sendEvent = async (data: Record<string, unknown>) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  ;(async () => {
    try {
      const url = process.env.GIDEON_CHAT_URL
      if (!url) {
        await sendEvent({ type: 'error', content: 'Gideon belum tersambung ke gateway Hermes.' })
        return
      }
      const prompt = buildGideonPrompt(messages, { name: session.user?.name || '', email: session.user?.email || '' })
      if (!prompt) { await sendEvent({ type: 'error', content: 'Pesan kosong.' }); return }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-oracle-secret': process.env.ORACLE_LLM_SECRET || '' },
        // actorEmail → the shim sets it as NEXUS_GIDEON_ACTOR_EMAIL on the hermes spawn, so Gideon's
        // NEXUS tools act AS this logged-in user (role-scoped), not the fixed service identity.
        body: JSON.stringify({
          prompt,
          model: tier,
          user: session.user?.name || '',
          actorEmail: session.user?.email || session.user?.id || '',
          ...(imageBase64 ? { imageBase64, imageType: 'jpg' } : {}),
        }),
        signal: AbortSignal.timeout(150000), // Hermes agent + tool call can take ~30s+
      })
      if (!res.ok) { await sendEvent({ type: 'error', content: `Gideon error (${res.status}).` }); return }
      const data = (await res.json()) as { reply?: string }
      const reply = (data.reply || '').trim()
      await sendEvent({ type: 'text', content: reply || '(Gideon balas kosong — coba ulang.)' })

      // Persist the turn so the panel can restore it later (survives close/refresh/device switch).
      // Only completed turns are stored — a failed one would leave a question with no answer in the
      // history. createdAt is stamped explicitly so the question always sorts before the answer.
      if (reply) {
        const asked = [...(messages || [])].reverse().find((m) => m?.role === 'user')?.content?.trim() || ''
        const now = Date.now()
        try {
          await prisma.gideonMessage.createMany({
            data: [
              ...(asked ? [{ userId, role: 'user', content: asked, createdAt: new Date(now) }] : []),
              { userId, role: 'assistant', content: reply, createdAt: new Date(now + 1) },
            ],
          })
        } catch (persistError) {
          // History is a convenience — never fail a reply the user already received.
          console.error('GIDEON history persist error:', persistError)
        }
      }
    } catch (error) {
      console.error('GIDEON API error:', error)
      await sendEvent({ type: 'error', content: 'Gideon lagi gak bisa dihubungi. Coba lagi bentar ya.' })
    } finally {
      await sendEvent({ type: 'done' })
      await writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
