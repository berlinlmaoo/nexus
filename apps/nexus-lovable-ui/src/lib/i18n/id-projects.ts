/**
 * English → Indonesian for project types, per-project tabs and the Finance toggle (owner, 9 Oct 2026).
 * Keys must be unique across all id-*.ts files (i18n.test.mjs). "Board", "Spreadsheet", "Timeline",
 * "Chat", "Finance" and the four type names stay as they are in both languages, so they have no entry.
 */
export const ID_PROJECTS: Record<string, string> = {
  // The project's tab bar and Project settings → Tabs
  "Overview": "Ringkasan",
  "List": "Daftar",
  "Table": "Tabel",
  "Sprints": "Sprint",
  "Automations": "Otomasi",
  "Pages": "Halaman",
  "Forms": "Formulir",
  "Finance Dashboard": "Dashboard Finance",
  "Tabs": "Tab",
  "Choose the tabs this project shows. Turning a tab off only hides it: nothing in it is deleted, and turning it back on brings everything back.": "Pilih tab yang tampil di project ini. Mematikan tab cuma menyembunyikannya: isinya tidak dihapus, dan begitu dinyalakan lagi semuanya kembali.",
  "Board or List stays on": "Board atau Daftar tetap nyala",
  "Only managers and above can change the tabs.": "Hanya manager ke atas yang bisa mengubah tab.",
  // Project settings → Customize project: the Finance switch next to P&L
  "Monthly OPEX and revenue for this project, by year. Off until BoD turns it on, like P&L. Turning it off only hides the tab — the numbers stay.": "OPEX dan revenue bulanan project ini, per tahun. Mati sampai BoD menyalakannya, sama seperti P&L. Mematikannya cuma menyembunyikan tab — angkanya tetap ada.",
  // New project: the type picker
  "What is this project for?": "Project ini untuk apa?",
  "Coming soon": "Segera hadir",
  "Change type": "Ganti tipe",
  "Board, list, calendar and timeline for work with owners and due dates.": "Board, daftar, kalender, dan timeline untuk pekerjaan yang punya PIC dan tenggat.",
  "Revenue, OPEX and profit, month by month.": "Revenue, OPEX, dan profit per bulan.",
  "Plan and schedule content across your channels.": "Rencanakan dan jadwalkan konten di semua channel.",
  "Follow every deal from first contact to paid.": "Pantau tiap deal dari kontak pertama sampai lunas.",
  // Refusals from /api/projects, by code
  "Board or List has to stay on — at least one way to see the tasks.": "Board atau Daftar harus tetap nyala — minimal satu cara untuk melihat task.",
  "That tab can't be changed here. Refresh the page and try again.": "Tab itu tidak bisa diubah di sini. Muat ulang halaman lalu coba lagi.",
  "Only BoD and above can turn Finance on or off.": "Hanya BoD ke atas yang bisa menyalakan atau mematikan Finance.",
  "That project type is coming soon. For now you can create a Task Project or a Pipeline Dashboard.": "Tipe project itu segera hadir. Untuk sekarang kamu bisa membuat Task Project atau Pipeline Dashboard.",
  // Mission Control: projects are called projects (owner, 9 Oct 2026 — "kok masih new mission?").
  // The page names "Mission Control" and "My Mission" stay.
  "New project": "Proyek baru",
  "Search projects, owners, lanes…": "Cari proyek, PIC, lane…",
  "{shown}/{n} projects visible": "{shown}/{n} proyek terlihat",
  "All projects": "Semua proyek",
  "Create a new project": "Buat proyek baru",
  "Project name": "Nama proyek",
  "What's the project, who owns it, and what should move first?": "Proyek apa, siapa PIC-nya, dan apa yang harus jalan duluan?",
  "Creating project…": "Membuat proyek…",
  "Create project + open board": "Buat proyek + buka board",
  "Click any project card to enter its live board.": "Klik kartu proyek mana pun untuk masuk ke board-nya.",
  "No project matches that": "Tidak ada proyek yang cocok",
  "Try another project name, owner or lane — or clear the search to see every project you're part of.": "Coba nama proyek, PIC, atau lane lain — atau hapus pencarian untuk melihat semua proyek yang kamu ikuti.",
};
