import { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  LogOut,
  Plus,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function UploadCard({ onUpload }: { onUpload: (file: File) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState<"idle" | "reading" | "uploading">("idle");

  const upload = async (file: File) => {
    setUploadState("reading");
    try {
      await onUpload(file);
    } finally {
      setUploadState("idle");
    }
  };

  const chooseFile = (file?: File) => {
    if (file) void upload(file);
  };

  return (
    <div
      className={`relative overflow-hidden rounded-[28px] border border-[#dbe5c6] bg-[#f0f6dc] p-5 transition-colors sm:p-6 ${isDragging ? "border-[#5d8d4b] bg-[#e6f0c7]" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        chooseFile(event.dataTransfer.files?.[0]);
      }}
    >
      <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-[#d9ed9b] opacity-70" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#1d473d] text-[#d9ed9b] shadow-[0_10px_20px_rgba(29,71,61,0.15)]">
            {uploadState === "idle" ? <UploadCloud className="size-6" /> : <Loader2 className="size-6 animate-spin" />}
          </div>
          <div>
            <p className="font-semibold text-[#17382f]">{uploadState === "idle" ? "Add a PDF to your study desk" : uploadState === "reading" ? "Reading your PDF…" : "Building your study guide…"}</p>
            <p className="mt-1 max-w-md text-sm leading-6 text-[#5f766b]">Upload notes, a textbook chapter, or a handout. We’ll turn it into a focused summary and practice set.</p>
          </div>
        </div>
        <div className="shrink-0">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
          <Button
            type="button"
            disabled={uploadState !== "idle"}
            className="w-full rounded-xl bg-[#b8d84a] px-5 font-semibold text-[#17382f] shadow-none hover:bg-[#a9cb3d] sm:w-auto"
            onClick={() => inputRef.current?.click()}
          >
            <Plus className="mr-2 size-4" />
            Upload PDF
          </Button>
        </div>
      </div>
      <p className="relative mt-4 text-xs font-medium uppercase tracking-[0.16em] text-[#78906b]">PDF only · up to 50 MB · text-based PDFs in V1</p>
    </div>
  );
}

export default function Workspace() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const documentsQuery = trpc.documents.list.useQuery();
  const uploadMutation = trpc.documents.upload.useMutation({
    onSuccess: async (document) => {
      await utils.documents.list.invalidate();
      toast.success("Study guide ready", { description: `${document.fileName} is ready to explore.` });
      setLocation(`/app/${document.id}`);
    },
    onError: (error) => toast.error("Upload didn’t finish", { description: error.message }),
  });

  const handleUpload = async (file: File) => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please choose a PDF file");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error("That PDF exceeds the 50 MB limit", { description: "Choose a smaller file to continue." });
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("The file could not be read."));
      reader.readAsDataURL(file);
    }).catch((error) => {
      toast.error("The file could not be read", { description: error.message });
      return "";
    });
    if (!dataUrl) return;

    await uploadMutation.mutateAsync({
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      sizeBytes: file.size,
      dataBase64: dataUrl.split(",")[1] ?? "",
    });
  };

  const firstName = user?.name?.split(" ")[0] || "there";
  const documents = documentsQuery.data ?? [];

  return (
    <div className="min-h-screen bg-[#f8faf5] text-[#17382f]">
      <header className="border-b border-[#e3eadb] bg-[#f8faf5]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="StudyMate AI home">
            <span className="grid size-9 place-items-center rounded-xl bg-[#1d473d] text-[#d9ed9b]"><Sparkles className="size-4" /></span>
            <span className="font-display text-lg font-bold tracking-[-0.04em]">StudyMate <span className="text-[#6c9850]">AI</span></span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-[#6d8176] sm:inline">{user?.email || "Your study desk"}</span>
            <Button variant="ghost" size="sm" className="rounded-xl text-[#577066] hover:bg-[#edf2e8] hover:text-[#17382f]" onClick={() => void logout()}>
              <LogOut className="mr-2 size-4" /> Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        <section className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge className="mb-4 rounded-full border-0 bg-[#e6f0c7] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#547345]">Your study desk</Badge>
            <h1 className="font-display text-4xl font-bold tracking-[-0.06em] text-[#17382f] sm:text-5xl">Good to see you, {firstName}.</h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-[#6d8176]">Pick up where you left off, or add a new piece of study material to make your next session count.</p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-[#e3eadb] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(31,72,52,0.05)]">
            <div className="grid size-9 place-items-center rounded-xl bg-[#eef5dc] text-[#6a9551]"><BookOpen className="size-4" /></div>
            <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8a9b8f]">Library</p><p className="font-display text-lg font-bold text-[#17382f]">{documents.length} {documents.length === 1 ? "document" : "documents"}</p></div>
          </div>
        </section>

        <UploadCard onUpload={handleUpload} />

        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <div><h2 className="font-display text-2xl font-bold tracking-[-0.04em]">Recent study material</h2><p className="mt-1 text-sm text-[#7c8f84]">Your summaries and practice sets, all in one place.</p></div>
            <span className="hidden items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[#8b9b90] sm:flex"><Clock3 className="size-3.5" /> Latest first</span>
          </div>

          {documentsQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2"><div className="h-32 animate-pulse rounded-2xl bg-[#edf2e8]" /><div className="h-32 animate-pulse rounded-2xl bg-[#edf2e8]" /></div>
          ) : documentsQuery.error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-[#f3d7cf] bg-[#fff8f5] p-5 text-sm text-[#9e5f4e]"><AlertCircle className="mt-0.5 size-5 shrink-0" /><div><p className="font-semibold">Your library couldn’t load.</p><p className="mt-1">Refresh the page and try again.</p></div></div>
          ) : documents.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-[#cbd9bb] bg-white px-6 py-12 text-center shadow-[0_10px_30px_rgba(31,72,52,0.04)]"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#f0f6dc] text-[#789d5a]"><FileText className="size-6" /></div><h3 className="mt-5 font-display text-xl font-bold">Your library is ready for its first PDF</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7c8f84]">Upload lecture notes or a chapter to see a grounded summary here.</p><Button className="mt-6 rounded-xl bg-[#1d473d] text-white hover:bg-[#275a4e]" onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}><UploadCloud className="mr-2 size-4" /> Add study material</Button></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {documents.map((document) => (
                <Link key={document.id} href={`/app/${document.id}`} className="group rounded-2xl border border-[#e3eadb] bg-white p-5 shadow-[0_8px_24px_rgba(31,72,52,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-[#b9cc9b] hover:shadow-[0_12px_30px_rgba(31,72,52,0.09)]">
                  <div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f7ece6] text-[#bb7154]"><FileText className="size-4" /></div><div className="min-w-0"><p className="truncate font-semibold text-[#23483c]">{document.fileName}</p><p className="mt-1 text-xs text-[#8a9b8f]">{formatSize(document.fileSize)} · {formatDate(document.createdAt)}</p></div></div><ArrowUpRight className="size-4 shrink-0 text-[#a3b0a7] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#5e8b4d]" /></div>
                  <div className="mt-5 flex items-center gap-2 text-xs font-semibold text-[#6e9070]"><CheckCircle2 className="size-3.5" /> Summary ready <span className="text-[#c3cec7]">·</span> {document.mcqs.length ? `${document.mcqs.length} MCQs ready` : "Practice set waiting"}</div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export function LandingAuthButton() {
  return <Button onClick={() => startLogin()} className="rounded-xl bg-[#b8d84a] font-semibold text-[#17382f] shadow-[0_8px_20px_rgba(184,216,74,0.22)] hover:bg-[#a9cb3d]"><Sparkles className="mr-2 size-4" /> Start studying</Button>;
}
