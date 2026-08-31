import { Metadata } from "next"
import Link from "next/link"

// Public on purpose, same reason as /privacy: App Store Connect requires a Support URL that opens
// WITHOUT signing in. middleware.ts only guards "/" and "/dashboard", so this route is public as-is.
// nginx also needs a location for it — the Phaethon SPA answers every other path with index.html.

export const metadata: Metadata = {
  title: "Bantuan | NEXUS",
  description: "Cara mendapatkan akses, mengatasi masalah umum, dan menghubungi tim NEXUS.",
}

const CONTACT_EMAIL = "account@znetworks.id"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-border pb-4 last:border-b-0 last:pb-0">
      <p className="text-sm font-semibold text-foreground">{q}</p>
      <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  )
}

export default function SupportPage() {
  return (
    <main className="min-h-[100svh] bg-background px-6 py-16">
      <article className="mx-auto flex max-w-2xl flex-col gap-10">
        <header className="flex flex-col gap-3 border-b border-border pb-8">
          <Link href="/" className="text-xs font-medium uppercase tracking-widest text-primary">
            NEXUS by Z Networks
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Bantuan</h1>
          <p className="text-sm text-muted-foreground">
            NEXUS adalah aplikasi kerja internal Z Networks — absensi, tugas dan proyek, pengajuan
            formulir, serta obrolan tim.
          </p>
        </header>

        <Section title="Belum punya akses?">
          <p>
            Akun NEXUS dibuat oleh admin workspace, tidak ada pendaftaran mandiri. Kalau kamu
            karyawan Z Networks dan belum bisa masuk, hubungi admin workspace atau alamat di bawah
            dengan menyebutkan nama lengkap dan divisimu.
          </p>
        </Section>

        <Section title="Masalah yang sering ditemui">
          <div className="flex flex-col gap-4">
            <Faq q="Tidak bisa masuk padahal kata sandinya benar">
              Kata sandi bisa saja sudah diganti admin. Minta admin workspace menyetel ulang; tidak
              ada pemulihan kata sandi mandiri di aplikasi.
            </Faq>
            <Faq q="Absen ditolak karena di luar area kantor">
              Absensi memverifikasi lokasi terhadap area kantor terdaftar. Pastikan izin lokasi
              aktif (Pengaturan → Privasi &amp; Keamanan → Layanan Lokasi → NEXUS → Saat Menggunakan
              Aplikasi) dan GPS menyala. Kalau kamu memang bekerja di luar kantor, ajukan lewat menu
              pengajuan agar disetujui atasan.
            </Faq>
            <Faq q="Notifikasi tidak masuk">
              Buka Pengaturan iOS → Notifikasi → NEXUS, pastikan Izinkan Notifikasi menyala. Kalau
              masih tidak masuk, keluar lalu masuk lagi di aplikasi supaya perangkat didaftarkan
              ulang.
            </Faq>
            <Faq q="Foto tidak terkirim di obrolan">
              Ukuran maksimum satu gambar adalah 8 MB dan hanya format gambar yang diterima. Kalau
              gagal berulang, periksa koneksi lalu coba lagi.
            </Faq>
          </div>
        </Section>

        <Section title="Menghubungi kami">
          <p>
            Pertanyaan, laporan masalah, atau permintaan penghapusan data:{" "}
            <a className="font-medium text-primary underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </p>
          <p>Kami membalas pada hari kerja, biasanya dalam 1&ndash;2 hari.</p>
          <p>
            Kebijakan privasi:{" "}
            <Link className="font-medium text-primary underline underline-offset-2" href="/privacy">
              nexus.znetworks.id/privacy
            </Link>
          </p>
        </Section>
      </article>
    </main>
  )
}
