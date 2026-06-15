import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent as CardBody } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  Download,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderPlus,
  Folder,
  Home,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { celebrate } from "@/components/Celebration";
import { nexusApi, type NexusProjectFile } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

function fmtSize(bytes: number) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtWhen(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const IMG = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "heic", "avif"];
const VID = ["mp4", "mov", "avi", "mkv", "webm", "m4v"];
const AUD = ["mp3", "wav", "ogg", "flac", "aac", "m4a"];
const ARC = ["zip", "rar", "7z", "tar", "gz"];
const SHEET = ["xls", "xlsx", "csv", "numbers"];
const DOC = ["doc", "docx", "pdf", "txt", "md", "rtf", "pages"];

function fileVisual(type: string) {
  const t = type.toLowerCase();
  if (IMG.includes(t)) return { Icon: ImageIcon, tone: "text-violet-500 bg-violet-500/10" };
  if (VID.includes(t)) return { Icon: FileVideo, tone: "text-rose-500 bg-rose-500/10" };
  if (AUD.includes(t)) return { Icon: FileAudio, tone: "text-amber-500 bg-amber-500/10" };
  if (ARC.includes(t)) return { Icon: FileArchive, tone: "text-orange-500 bg-orange-500/10" };
  if (SHEET.includes(t)) return { Icon: FileSpreadsheet, tone: "text-emerald-500 bg-emerald-500/10" };
  if (DOC.includes(t)) return { Icon: FileText, tone: "text-sky-500 bg-sky-500/10" };
  return { Icon: FileIcon, tone: "text-muted-foreground bg-muted" };
}

export function ProjectFiles({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [path, setPath] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const key = ["project-files", projectId, path];
  const list = useQuery({
    queryKey: key,
    queryFn: () => nexusApi.projectFiles(projectId, path),
    staleTime: 30_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["project-files", projectId] });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) await nexusApi.uploadProjectFile(projectId, f, path);
    },
    onSuccess: (_d, files) => { refresh(); celebrate(`${files.length} file diunggah 📦`); },
  });

  const mkdir = useMutation({
    mutationFn: (name: string) => nexusApi.createProjectFolder(projectId, name, path),
    onSuccess: () => { refresh(); celebrate("Folder dibuat 📁"); },
  });

  const remove = useMutation({
    mutationFn: (rel: string) => nexusApi.deleteProjectFile(projectId, rel),
    onSuccess: refresh,
  });

  const segments = path ? path.split("/") : [];
  const goTo = (i: number) => setPath(segments.slice(0, i + 1).join("/"));

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) upload.mutate(files);
    e.target.value = "";
  };

  const newFolder = () => {
    const name = window.prompt("Nama folder baru:");
    if (name?.trim()) mkdir.mutate(name.trim());
  };

  const onDelete = (f: NexusProjectFile) => {
    if (window.confirm(`Hapus "${f.name}"${f.isdir ? " beserta isinya" : ""}?`)) remove.mutate(f.relPath);
  };

  const files = list.data?.files ?? [];
  const folders = files.filter((f) => f.isdir);
  const docs = files.filter((f) => !f.isdir);
  const busy = upload.isPending || mkdir.isPending;

  return (
    <div
      className="space-y-4"
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => {
        e.preventDefault();
        const dropped = Array.from(e.dataTransfer.files ?? []);
        if (dropped.length) upload.mutate(dropped);
      }}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 text-sm font-semibold text-muted-foreground">
          <button onClick={() => setPath("")} className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 transition hover:bg-accent hover:text-foreground", !path && "text-foreground")}>
            <Home className="h-3.5 w-3.5" /> Files
          </button>
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1 truncate">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
              <button onClick={() => goTo(i)} className={cn("truncate rounded-lg px-2 py-1 transition hover:bg-accent hover:text-foreground", i === segments.length - 1 && "text-foreground")}>{seg}</button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={newFolder} isDisabled={busy}><FolderPlus className="h-4 w-4" />New folder</Button>
          <Button size="sm" variant="primary" onClick={() => inputRef.current?.click()} isDisabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Upload</Button>
          <input ref={inputRef} type="file" multiple hidden onChange={onPickFiles} />
        </div>
      </div>

      {upload.isError && <p className="text-sm font-semibold text-destructive">Gagal upload: {(upload.error as Error)?.message}</p>}
      {list.isError && <p className="text-sm font-semibold text-destructive">Gagal memuat file: {(list.error as Error)?.message}. Pastikan storage NAS sudah terhubung.</p>}

      {list.isLoading ? (
        <div className="grid place-items-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : files.length === 0 ? (
        <Card className="border border-dashed border-border bg-card shadow-soft">
          <CardBody className="flex flex-col items-center gap-3 p-12 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Folder className="h-7 w-7" /></div>
            <div className="text-lg font-black">Folder kosong</div>
            <p className="max-w-sm text-sm text-muted-foreground">Drag &amp; drop file ke sini, atau klik Upload untuk menyimpan file project di NAS.</p>
            <Button size="sm" variant="primary" onClick={() => inputRef.current?.click()} isDisabled={busy}><Upload className="h-4 w-4" />Upload file</Button>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-5">
          {folders.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">Folders</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                <AnimatePresence initial={false}>
                  {folders.map((f) => (
                    <motion.button
                      key={f.relPath}
                      layout
                      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                      onClick={() => setPath(f.relPath)}
                      className="group relative flex items-center gap-2.5 rounded-2xl border border-border bg-card p-3 text-left shadow-soft transition hover:border-primary/40 hover:shadow-pop"
                    >
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-500"><Folder className="h-5 w-5" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">{f.name}</div>
                        <div className="text-xs text-muted-foreground">{fmtWhen(f.modified)}</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); onDelete(f); }} className="absolute right-2 top-2 hidden rounded-lg p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive group-hover:block" aria-label="Hapus folder"><Trash2 className="h-3.5 w-3.5" /></button>
                    </motion.button>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {docs.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">Files</p>
              <Card className="overflow-hidden border border-border bg-card shadow-soft">
                <AnimatePresence initial={false}>
                  {docs.map((f) => {
                    const { Icon, tone } = fileVisual(f.type);
                    return (
                      <motion.div
                        key={f.relPath}
                        layout
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="group flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0 hover:bg-accent/50"
                      >
                        <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone)}><Icon className="h-5 w-5" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold">{f.name}</div>
                          <div className="text-xs text-muted-foreground">{fmtSize(f.size)} · {fmtWhen(f.modified)}</div>
                        </div>
                        <a
                          href={nexusApi.projectFileDownloadUrl(projectId, f.relPath)}
                          className="rounded-lg p-2 text-muted-foreground opacity-0 transition hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
                          aria-label="Download"
                        ><Download className="h-4 w-4" /></a>
                        <button onClick={() => onDelete(f)} className="rounded-lg p-2 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100" aria-label="Hapus"><Trash2 className="h-4 w-4" /></button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
