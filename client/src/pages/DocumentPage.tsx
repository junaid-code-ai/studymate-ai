import { useEffect, useRef } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, BrainCircuit, CheckCircle2, FileText, Loader2, LogOut, Sparkles } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Streamdown } from "streamdown";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentPage() {
  const { user, logout } = useAuth();
  const [, params] = useRoute<{ id: string }>("/app/:id");
  const [, setLocation] = useLocation();
  const id = Number(params?.id);
  const processStarted = useRef(false);
  const utils = trpc.useUtils();
  const documentQuery = trpc.documents.get.useQuery({ id }, {
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: (query) => query.state.data?.processingStatus === "processing" ? 3000 : false,
  });
  const processMutation = trpc.documents.process.useMutation({
    onSuccess: (processed) => {
      utils.documents.get.setData({ id }, processed);
      if (processed.processingStatus === "failed") toast.error("Processing could not finish", { description: processed.processingError || "Try again with a smaller text-based PDF." });
    },
    onError: (error) => toast.error("Processing could not finish", { description: error.message }),
  });
  const mcqMutation = trpc.documents.generateMcqs.useMutation({
    onSuccess: async () => {
      await utils.documents.get.invalidate({ id });
      toast.success("Practice set generated", { description: "Five questions are ready when you are." });
    },
    onError: (error) => toast.error("MCQs couldn’t be generated", { description: error.message }),
  });

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) setLocation("/");
  }, [id, setLocation]);

  const document = documentQuery.data;
  const questions = document?.mcqs ?? [];
  const isReady = document?.processingStatus === "ready";
  const isProcessing = document?.processingStatus === "uploaded" || document?.processingStatus === "processing";

  useEffect(() => {
    if ((document?.processingStatus === "uploaded" || document?.processingStatus === "processing") && !processStarted.current) {
      processStarted.current = true;
      processMutation.mutate({ id });
    }
  }, [document?.processingStatus, id, processMutation]);

  useEffect(() => {
    if (!isProcessing || processMutation.isPending) return;
    const retryTimer = setInterval(() => {
      if (!processMutation.isPending) processMutation.mutate({ id });
    }, 20_000);
    return () => clearInterval(retryTimer);
  }, [id, isProcessing, processMutation.isPending]);

  return (
    <div className="min-h-screen bg-[#f8faf5] text-[#17382f]">
      <header className="border-b border-[#e3eadb] bg-[#f8faf5]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-4"><Link href="/" className="grid size-9 place-items-center rounded-xl border border-[#dfe8d5] bg-white text-[#587968] transition hover:border-[#b8cc9d] hover:text-[#17382f]" aria-label="Back to library"><ArrowLeft className="size-4" /></Link><Link href="/" className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#1d473d] text-[#d9ed9b]"><Sparkles className="size-4" /></span><span className="hidden font-display text-lg font-bold tracking-[-0.04em] sm:inline">StudyMate <span className="text-[#6c9850]">AI</span></span></Link></div>
          <div className="flex items-center gap-3"><span className="hidden text-sm text-[#6d8176] sm:inline">{user?.email || "Your study desk"}</span><Button variant="ghost" size="sm" className="rounded-xl text-[#577066] hover:bg-[#edf2e8] hover:text-[#17382f]" onClick={() => void logout()}><LogOut className="mr-2 size-4" /> Log out</Button></div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-20 pt-8 sm:px-8 sm:pt-12">
        {documentQuery.isLoading ? <div className="space-y-4"><div className="h-12 w-2/3 animate-pulse rounded-xl bg-[#edf2e8]" /><div className="h-80 animate-pulse rounded-[28px] bg-[#edf2e8]" /></div> : documentQuery.error ? <div className="mx-auto max-w-xl rounded-[28px] border border-[#f3d7cf] bg-[#fff8f5] p-7 text-center text-[#9e5f4e]"><AlertCircle className="mx-auto size-7" /><h1 className="mt-4 font-display text-2xl font-bold">This study document isn’t available</h1><p className="mt-2 text-sm leading-6">It may have been removed, or it may belong to another account.</p><Link href="/" className="mt-6 inline-flex rounded-xl bg-[#1d473d] px-4 py-2.5 text-sm font-semibold text-white">Back to library</Link></div> : document ? <>
          <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0"><div className="mb-4 flex items-center gap-2"><Badge className="rounded-full border-0 bg-[#e6f0c7] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#547345]">Study guide</Badge><span className="text-xs text-[#8a9b8f]">{formatSize(document.fileSize)}</span></div><h1 className="max-w-3xl truncate font-display text-3xl font-bold tracking-[-0.06em] sm:text-5xl">{document.fileName}</h1><p className="mt-3 text-sm text-[#7c8f84]">{isReady ? "Your summary is grounded in the text we could read from this PDF." : isProcessing ? "The PDF is stored safely. Text extraction and summary generation are running separately." : "Processing failed, but the uploaded PDF is still saved."}</p></div><Button disabled={!isReady || mcqMutation.isPending} className="w-full shrink-0 rounded-xl bg-[#1d473d] text-white hover:bg-[#275a4e] sm:w-auto" onClick={() => mcqMutation.mutate({ id })}>{mcqMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <BrainCircuit className="mr-2 size-4" />}{questions.length ? "Regenerate MCQs" : "Generate MCQs"}</Button></div>

          {!isReady ? <section className={`rounded-[28px] border p-7 ${isProcessing ? "border-[#dbe5c6] bg-[#f0f6dc]" : "border-[#f3d7cf] bg-[#fff8f5]"}`}><div className="flex items-start gap-4"><div className={`grid size-11 shrink-0 place-items-center rounded-2xl ${isProcessing ? "bg-[#1d473d] text-[#d9ed9b]" : "bg-[#f7ece6] text-[#bb7154]"}`}>{isProcessing ? <Loader2 className="size-5 animate-spin" /> : <AlertCircle className="size-5" />}</div><div><h2 className="font-display text-xl font-bold">{isProcessing ? "Building your study guide…" : "This PDF needs another try"}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#60796b]">{isProcessing ? "Large files are handled in bounded stages so a slow AI request does not interrupt your library or authentication." : document.processingError || "The document was saved, but processing did not complete."}</p>{!isProcessing && <Button variant="outline" className="mt-5 rounded-xl border-[#cbb3a8] bg-white text-[#8f5948] hover:bg-[#fffaf7]" onClick={() => { processStarted.current = true; processMutation.mutate({ id }); }}>Try processing again</Button>}</div></div></section> : <>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <article className="rounded-[28px] border border-[#e3eadb] bg-white p-6 shadow-[0_12px_32px_rgba(31,72,52,0.05)] sm:p-9"><div className="mb-7 flex items-center gap-3 border-b border-[#edf1e9] pb-5"><div className="grid size-10 place-items-center rounded-xl bg-[#eef5dc] text-[#6a9551]"><FileText className="size-4" /></div><div><h2 className="font-display text-xl font-bold">Summary</h2><p className="text-xs text-[#8a9b8f]">A simpler way back into the material</p></div></div><div className="prose prose-slate max-w-none text-[15px] leading-7 prose-headings:font-display prose-headings:tracking-[-0.04em] prose-headings:text-[#17382f] prose-p:text-[#5d7568] prose-li:text-[#5d7568] prose-strong:text-[#294e41]"><Streamdown>{document.summary || "No summary is available yet."}</Streamdown></div></article>
              <aside className="rounded-[28px] border border-[#dbe5c6] bg-[#f0f6dc] p-6"><div className="flex items-start gap-3"><div className="grid size-10 place-items-center rounded-xl bg-[#1d473d] text-[#d9ed9b]"><BrainCircuit className="size-4" /></div><div><h2 className="font-display text-xl font-bold text-[#17382f]">Practice set</h2><p className="mt-1 text-sm leading-6 text-[#64806b]">Retrieval practice helps you find what you know before the exam does.</p></div></div>{questions.length === 0 ? <div className="mt-8 rounded-2xl border border-dashed border-[#c2d3a3] bg-white/60 p-5 text-center"><p className="text-sm font-semibold text-[#46644d]">Five grounded questions are one click away.</p><Button variant="outline" className="mt-4 w-full rounded-xl border-[#a9bf8c] bg-white text-[#315844] hover:bg-[#f8fbf1]" disabled={mcqMutation.isPending} onClick={() => mcqMutation.mutate({ id })}>{mcqMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <BrainCircuit className="mr-2 size-4" />}Generate now</Button></div> : <div className="mt-7 space-y-3">{questions.map((question, index) => <a key={`${question.question}-${index}`} href={`#question-${index + 1}`} className="flex items-center justify-between rounded-xl bg-white/70 px-4 py-3 text-sm font-semibold text-[#46644d] transition hover:bg-white"><span>Question {index + 1}</span><span className="text-[#8eaa70]">→</span></a>)}</div>}<div className="mt-7 flex items-center gap-2 text-xs font-semibold text-[#6d8a70]"><CheckCircle2 className="size-3.5" /> Material-grounded only</div></aside>
            </div>

            {questions.length > 0 && <section className="mt-10"><div className="mb-5 flex items-end justify-between"><div><Badge className="mb-3 rounded-full border-0 bg-[#f7ece6] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#a76852]">Test yourself</Badge><h2 className="font-display text-3xl font-bold tracking-[-0.05em]">Quick practice</h2></div><span className="hidden text-sm text-[#8a9b8f] sm:inline">{questions.length} questions</span></div><div className="space-y-4">{questions.map((question, index) => <article id={`question-${index + 1}`} key={`${question.question}-${index}`} className="rounded-[24px] border border-[#e3eadb] bg-white p-6 shadow-[0_8px_24px_rgba(31,72,52,0.04)] sm:p-7"><div className="flex gap-4"><span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#1d473d] text-sm font-bold text-[#d9ed9b]">{index + 1}</span><div className="min-w-0 flex-1"><h3 className="font-display text-lg font-bold leading-7 text-[#23483c]">{question.question}</h3><div className="mt-5 grid gap-2 sm:grid-cols-2">{question.options.map((option, optionIndex) => <div key={option} className={`rounded-xl border px-4 py-3 text-sm leading-6 ${optionIndex === question.correctAnswer ? "border-[#c8dda2] bg-[#f0f6dc] font-semibold text-[#355d43]" : "border-[#edf1e9] bg-[#fbfcfa] text-[#61786c]"}`}><span className="mr-2 text-xs font-bold text-[#91aa7b]">{String.fromCharCode(65 + optionIndex)}.</span>{option}</div>)}</div><div className="mt-5 rounded-xl border-l-4 border-[#b8d84a] bg-[#f8faf5] px-4 py-3 text-sm leading-6 text-[#60796b]"><span className="font-bold text-[#365c43]">Answer: {String.fromCharCode(65 + question.correctAnswer)}</span><span className="mx-2 text-[#c2cec6]">·</span>{question.explanation}</div></div></div></article>)}</div></section>}
          </>}
        </> : null}
      </main>
    </div>
  );
}
