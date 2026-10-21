/**
 * English → Indonesian for Pipeline Dashboard v8 (Control Tower v8, 21 Oct 2026): cashback, project contacts,
 * budget expenses, barter, the year filter, document types, and All Pipelines (BoD / One Above All). Keys must
 * be unique across all id-*.ts files (i18n.test.mjs).
 */
export const ID_PIPELINE_V8: Record<string, string> = {
  // Cashback
  "Cashback": "Cashback",
  "No cashback. Add who receives a cashback from this deal and how much.": "Belum ada cashback. Tambahkan siapa yang menerima cashback dari deal ini dan berapa.",
  "No cashback recorded.": "Belum ada cashback yang dicatat.",
  "Cashback recipients": "Penerima cashback",
  "Recipient {n}": "Penerima {n}",
  "Recipient name": "Nama penerima",
  "Cashback {n} amount": "Nominal cashback {n}",
  "Delete cashback {n}": "Hapus cashback {n}",
  "Add recipient": "Tambah penerima",
  "Total cashback": "Total cashback",

  // Project contacts
  "Project contacts": "Kontak project",
  "Project contact": "Kontak project",
  "No contacts yet. Add the client, vendor, broker or finance people for this project.": "Belum ada kontak. Tambahkan orang klien, vendor, broker atau finance untuk project ini.",
  "No contacts recorded.": "Belum ada kontak yang dicatat.",
  "Contact {n} role": "Peran kontak {n}",
  "Contact {n} name": "Nama kontak {n}",
  "Contact {n} phone": "Telepon kontak {n}",
  "Delete contact {n}": "Hapus kontak {n}",
  "Client": "Klien",
  "Broker": "Broker",
  "PM (client side)": "PM (pihak klien)",
  "Other contact": "Lainnya",

  // Budget expenses
  "Budget expenses": "Budget Expenses",
  "Strategist": "Strategist",
  "No budget yet. Add categories (venue, talent, production) and book real costs against them.": "Belum ada budget. Tambahkan kategori (venue, talent, produksi) lalu catat real cost ke kategori itu.",
  "No budget recorded.": "Belum ada budget yang dicatat.",
  "Budget categories": "Kategori budget",
  "Budget category": "Kategori budget",
  "Budget category {n}": "Kategori budget {n}",
  "e.g. Venue": "mis. Venue",
  "Budget {n} amount": "Nominal budget {n}",
  "Delete budget category {n}": "Hapus kategori budget {n}",
  "Used {amount}": "Terpakai {amount}",
  "Over by {amount}": "Lebih {amount}",
  "Remaining {amount}": "Sisa {amount}",
  "Total budget": "Total budget",
  "Book each real cost line against a category below. Budget does not change the margin.": "Catat tiap baris real cost ke salah satu kategori di bawah. Budget tidak mengubah margin.",
  "Cost {n} budget category": "Kategori budget biaya {n}",
  "No budget category": "Tanpa kategori budget",
  "Untitled category": "Kategori tanpa nama",
  "Deleted category": "Kategori terhapus",

  // Barter
  "Barter value": "Nilai barter",
  "Barter compensation form": "Bentuk kompensasi barter",
  "e.g. 2 TV ad slots": "mis. 2 slot iklan TV",

  // Document types
  "Quotation": "Penawaran",

  // History (a cashback / contact / budget row)
  "added": "menambahkan",
  "deleted": "menghapus",
  "restored": "memulihkan",
  "Item": "Baris",
  "Vendor": "Vendor",
  "Add contact": "Tambah kontak",
  "Add category": "Tambah kategori",
  "{n} deal": "{n} deal",

  // Year filter
  "Filter by year": "Filter tahun",
  "All years": "Semua tahun",

  // All Pipelines
  "All Pipelines": "Semua Pipeline",
  "All Pipelines is for BoD and One Above All": "Semua Pipeline hanya untuk BoD dan One Above All",
  "Open your company's pipeline board from Projects.": "Buka pipeline perusahaan kamu dari Projects.",
  "No deals in any pipeline yet": "Belum ada deal di pipeline mana pun",
  "Deals are added inside each company's pipeline board. They show here together.": "Deal ditambahkan di pipeline masing-masing perusahaan, lalu tampil bersama di sini.",
  "Filter by company": "Filter perusahaan",
  "Show all companies?": "Tampilkan semua perusahaan?",
  "Presentation mode is on. All Pipelines shows the deals of every company's board on this screen. Amounts stay hidden.": "Mode Presentasi aktif. Semua Pipeline menampilkan deal dari board setiap perusahaan di layar ini. Nominal tetap disembunyikan.",
  "Show all companies": "Tampilkan semua perusahaan",
  "Switch pipeline board": "Ganti board pipeline",
  "Pipeline boards": "Board pipeline",
  "{n} board · combined": "{n} board · gabungan",
  "{n} boards · combined": "{n} board · gabungan",
  "Every company's pipeline board, combined. Read-only: open a deal to change it in its own board.": "Pipeline semua perusahaan, digabung. Hanya baca: buka deal untuk mengubahnya di board-nya sendiri.",

  // Audit restore
  "Restore payment term": "Pulihkan termin pembayaran",
  "Restore item": "Pulihkan baris",
  "It goes back on its deal, and the receivable is counted with it again.": "Termin kembali ke deal-nya, dan piutang dihitung lagi bersamanya.",
  "It goes back on its deal. A budget category comes back with the cost lines booked against it.": "Baris kembali ke deal-nya. Kategori budget kembali bersama baris biaya yang dicatat ke kategori itu.",
};
