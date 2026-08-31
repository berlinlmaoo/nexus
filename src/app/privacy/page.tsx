import { Metadata } from "next"
import Link from "next/link"

// Public on purpose: middleware.ts only guards "/" and "/dashboard", and Apple requires a privacy
// policy reachable WITHOUT signing in — both for TestFlight external testing and App Store review.
// A reviewer who hits a login wall here treats the policy as missing.

export const metadata: Metadata = {
  title: "Kebijakan Privasi | NEXUS",
  description: "Data apa yang dikumpulkan NEXUS, untuk apa, dan siapa yang bisa melihatnya.",
}

// Ganti di satu tempat ini kalau alamatnya lain. Harus kotak surat yang benar-benar dibaca —
// reviewer Apple kadang mengetesnya.
const CONTACT_EMAIL = "privacy@znetworks.id"
const LAST_UPDATED = "31 Agustus 2026"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-[100svh] bg-background px-6 py-16">
      <article className="mx-auto flex max-w-2xl flex-col gap-10">
        <header className="flex flex-col gap-3 border-b border-border pb-8">
          <Link href="/" className="text-xs font-medium uppercase tracking-widest text-primary">
            NEXUS by Z Networks
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Kebijakan Privasi</h1>
          <p className="text-sm text-muted-foreground">Terakhir diperbarui {LAST_UPDATED}</p>
        </header>

        <Section title="Ringkasnya">
          <p>
            NEXUS adalah alat kerja internal Z Networks: absensi, tugas, proyek, pengajuan, dan
            obrolan tim. Akun dibuat oleh admin workspace — tidak ada pendaftaran mandiri. Semua
            data yang dikumpulkan dipakai untuk menjalankan aplikasi itu sendiri. Tidak ada
            pelacakan lintas aplikasi, tidak ada iklan, dan tidak ada data yang dijual.
          </p>
        </Section>

        <Section title="Data yang dikumpulkan">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <b className="text-foreground">Identitas kerja</b> — nama, alamat email, foto profil,
              dan pengenal pengguna. Diberikan oleh admin workspace saat akun dibuat.
            </li>
            <li>
              <b className="text-foreground">Lokasi presisi</b> — hanya saat kamu menekan absen
              masuk atau keluar, dan hanya ketika aplikasi terbuka. Dipakai untuk memastikan
              absensi dilakukan di dalam area kantor yang terdaftar. Aplikasi tidak melacak lokasi
              di latar belakang.
            </li>
            <li>
              <b className="text-foreground">Foto</b> — swafoto absensi, foto profil, lampiran pada
              obrolan dan tugas. Diambil dari kamera atau galeri, hanya atas tindakanmu.
            </li>
            <li>
              <b className="text-foreground">Konten yang kamu tulis</b> — pesan obrolan, komentar
              tugas, isi formulir pengajuan, dan catatan harian.
            </li>
            <li>
              <b className="text-foreground">Data perangkat untuk notifikasi</b> — token
              pemberitahuan dan pengenal perangkat, dipakai semata-mata untuk mengirim notifikasi
              ke perangkatmu.
            </li>
          </ul>
        </Section>

        <Section title="Siapa yang bisa melihat">
          <p>
            Rekan kerja di workspace yang sama, sesuai perannya. Absensi dan pengajuan terlihat oleh
            atasan dan tim terkait; pesan pribadi hanya terlihat oleh peserta percakapan;
            administrator workspace dapat melihat data operasional yang diperlukan untuk mengelola
            tim.
          </p>
          <p>
            Data disimpan di server milik Z Networks. Satu-satunya pihak ketiga yang menerima data
            adalah <b className="text-foreground">Apple Push Notification service</b>, yang meneruskan
            isi notifikasi ke perangkatmu. Tidak ada layanan analitik atau periklanan pihak ketiga.
          </p>
        </Section>

        <Section title="Penyimpanan dan penghapusan">
          <p>
            Data disimpan selama akunmu aktif dan selama masih diperlukan sebagai catatan kerja.
            Akun dibuat dan dihapus oleh admin workspace; untuk meminta penghapusan akun atau
            salinan datamu, hubungi admin workspace atau alamat di bawah.
          </p>
        </Section>

        <Section title="Izin yang diminta aplikasi">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li><b className="text-foreground">Lokasi saat digunakan</b> — verifikasi area absensi.</li>
            <li><b className="text-foreground">Kamera</b> — swafoto absensi dan foto pada obrolan.</li>
            <li><b className="text-foreground">Galeri foto</b> — memilih foto profil dan lampiran.</li>
            <li><b className="text-foreground">Notifikasi</b> — pengingat absensi, penugasan, dan pesan.</li>
          </ul>
          <p>Semuanya bisa dicabut kapan saja lewat Pengaturan iOS; fitur terkait akan berhenti bekerja.</p>
        </Section>

        <Section title="Kontak">
          <p>
            Pertanyaan mengenai kebijakan ini atau data pribadimu:{" "}
            <a className="font-medium text-primary underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </p>
        </Section>
      </article>
    </main>
  )
}
