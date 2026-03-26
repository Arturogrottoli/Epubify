"use client"

import { useState, useEffect } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { BookOpen, FileUp, Link as LinkIcon, Type, GripVertical, Trash2, Download, Sparkles, Github } from "lucide-react"

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { generateEpub } from "@/lib/epub-generator"

export type Chapter = {
  id: string;
  title: string;
  content: string;
  sourceInfo?: string;
}

function SortableChapter({ id, chapter, onDelete }: { id: string, chapter: Chapter, onDelete: (id: string) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="group bg-muted/60 px-4 py-3 rounded-lg flex justify-between items-center mb-2 border border-border/60 hover:border-purple-500/40 hover:bg-muted transition-all duration-200">
      <div className="flex items-center gap-3 overflow-hidden">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-purple-400 transition-colors">
          <GripVertical className="h-5 w-5" />
        </button>
        <div className="overflow-hidden">
          <span className="truncate font-medium text-sm block">{chapter.title}</span>
          {chapter.sourceInfo && (
            <span className="text-xs text-muted-foreground truncate block">{chapter.sourceInfo}</span>
          )}
        </div>
      </div>
      <Button variant="ghost" size="icon" onClick={() => onDelete(id)} className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function Home() {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [urlInput, setUrlInput] = useState("")
  const [textTitle, setTextTitle] = useState("")
  const [textContent, setTextContent] = useState("")
  const [emailSubject, setEmailSubject] = useState("")
  const [emailContent, setEmailContent] = useState("")
  const [isExtracting, setIsExtracting] = useState(false)
  const [metadata, setMetadata] = useState({ title: "My Custom Book", author: "EPUBify User" })
  const [isGenerating, setIsGenerating] = useState(false)
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
    const saved = localStorage.getItem("epubify_chapters")
    if (saved) {
      try {
        setChapters(JSON.parse(saved))
      } catch {
        // ignore parse error
      }
    }
  }, [])

  useEffect(() => {
    if (isClient) {
      localStorage.setItem("epubify_chapters", JSON.stringify(chapters))
    }
  }, [chapters, isClient])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleUrlExtract = async () => {
    if (!urlInput) return;
    setIsExtracting(true);
    try {
      const res = await fetch("/api/extract/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setChapters(prev => [...prev, {
        id: crypto.randomUUID(),
        title: data.title,
        content: data.content,
        sourceInfo: urlInput
      }]);
      toast.success("URL extracted successfully!");
      setUrlInput("");
    } catch (err) {
      toast.error((err as Error).message || "Failed to extract URL");
    } finally {
      setIsExtracting(false);
    }
  }

  const handleEmailExtract = async () => {
    if (!emailContent && !emailSubject) return;
    setIsExtracting(true);
    try {
      const res = await fetch("/api/extract/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: emailSubject,
          html: emailContent,
          baseUrl: urlInput || window.location.origin,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setChapters(prev => [...prev, {
        id: crypto.randomUUID(),
        title: data.title,
        content: data.content,
        sourceInfo: `Email: ${emailSubject || 'No subject'}`
      }]);
      toast.success("Email contenido agregado!");
      setEmailSubject("");
      setEmailContent("");
    } catch (err) {
      toast.error((err as Error).message || "Failed to extract email content");
    } finally {
      setIsExtracting(false);
    }
  }

  const handleAddText = () => {
    if (!textContent) return;
    setChapters(prev => [...prev, {
      id: crypto.randomUUID(),
      title: textTitle || "Untitled Document",
      content: textContent,
      sourceInfo: "Manual Entry"
    }]);
    toast.success("Text chapter added!");
    setTextTitle("");
    setTextContent("");
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsExtracting(true);
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append("file", file);

        try {
            let res;
            if (file.type === "application/pdf") {
                res = await fetch("/api/extract/pdf", { method: "POST", body: formData });
            } else if (file.name.endsWith(".docx")) {
                res = await fetch("/api/extract/docx", { method: "POST", body: formData });
            } else {
                toast.error(`Unsupported file type: ${file.name}`);
                continue;
            }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            setChapters(prev => [...prev, {
                id: crypto.randomUUID(),
                title: file.name.replace(/\.[^/.]+$/, ""),
                content: data.text || data.html,
                sourceInfo: file.name
            }]);
            toast.success(`Extracted: ${file.name}`);
        } catch(err) {
            toast.error(`Failed to extract ${file.name}: ${(err as Error).message}`);
        }
    }
    setIsExtracting(false);
    e.target.value = "";
  }

  function handleDragEnd(event: DragEndEvent) {
    const {active, over} = event;
    if (over && active.id !== over.id) {
      setChapters((items) => {
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }

  function deleteChapter(id: string) {
    setChapters(prev => prev.filter(c => c.id !== id));
  }

  async function handleDownloadEpub() {
    if (chapters.length === 0) {
      toast.error("Add at least one chapter first!");
      return;
    }
    setIsGenerating(true);
    try {
      const blob = await generateEpub(metadata.title, metadata.author, chapters);
      const url = URL.createObjectURL(blob);
      const fileName = `${metadata.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.epub`;

      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("EPUB downloaded successfully!");
    } catch(err) {
      toast.error("Failed to generate EPUB: " + (err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  }

  const handleMergeChapters = () => {
    if (chapters.length <= 1) {
      toast('Need 2+ chapters to merge.', { variant: 'warning' });
      return;
    }

    const mergedHtml = chapters
      .map((ch, idx) => `
<section id="merged-chapter-${idx}">
  <h1>${ch.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h1>
  ${ch.content}
</section>`)
      .join('\n<hr />\n');

    setChapters([{ id: crypto.randomUUID(), title: 'Merged Document', content: mergedHtml, sourceInfo: 'Merged Chapters' }]);
    toast.success(`Merged ${chapters.length} chapters into one.`);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* subtle top gradient strip */}
      <div className="h-1 w-full bg-gradient-to-r from-purple-600 via-violet-500 to-indigo-500" />

      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-8">

          {/* Hero Header */}
          <div className="text-center space-y-3 py-6">
            <div className="inline-flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium px-3 py-1 rounded-full mb-2">
              <Sparkles className="h-3 w-3" />
              Free EPUB converter
            </div>
            <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight bg-gradient-to-br from-white via-purple-200 to-violet-400 bg-clip-text text-transparent">
              EPUBify
            </h1>
            <p className="text-muted-foreground text-lg max-w-md mx-auto">
              Turn PDFs, articles, emails and plain text into a clean EPUB — ready for your e-reader.
            </p>
          </div>

          {/* Two-column grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Left Panel - Inputs */}
            <section className="space-y-4">
              <Tabs defaultValue="file" className="w-full">
                <TabsList className="grid w-full grid-cols-4 h-11 bg-muted/40 border border-border/50 rounded-xl p-1">
                  <TabsTrigger value="file" className="rounded-lg text-xs font-medium gap-1.5 data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all">
                    <FileUp className="w-3.5 h-3.5"/> File
                  </TabsTrigger>
                  <TabsTrigger value="url" className="rounded-lg text-xs font-medium gap-1.5 data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all">
                    <LinkIcon className="w-3.5 h-3.5"/> URL
                  </TabsTrigger>
                  <TabsTrigger value="email" className="rounded-lg text-xs font-medium gap-1.5 data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all">
                    <BookOpen className="w-3.5 h-3.5"/> Email
                  </TabsTrigger>
                  <TabsTrigger value="text" className="rounded-lg text-xs font-medium gap-1.5 data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all">
                    <Type className="w-3.5 h-3.5"/> Text
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="file" className="mt-4 space-y-3">
                  <div>
                    <h3 className="text-base font-semibold">Upload Documents</h3>
                    <p className="text-sm text-muted-foreground">PDF or DOCX — one or many at once.</p>
                  </div>
                  <div className="relative border-2 border-dashed border-border/60 rounded-xl p-10 text-center hover:border-purple-500/60 hover:bg-purple-500/5 transition-all duration-200 group cursor-pointer">
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      onChange={handleFileUpload}
                      disabled={isExtracting}
                    />
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-14 w-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center group-hover:bg-purple-500/20 group-hover:scale-105 transition-all">
                        <FileUp className="h-6 w-6 text-purple-400" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">Click or drag files here</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {isExtracting ? "Extracting content..." : "PDF and DOCX supported"}
                        </p>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="url" className="mt-4 space-y-3">
                  <div>
                    <h3 className="text-base font-semibold">Extract from URL</h3>
                    <p className="text-sm text-muted-foreground">Paste an article link to fetch its content.</p>
                  </div>
                  <Input
                    placeholder="https://example.com/article"
                    value={urlInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrlInput(e.target.value)}
                    disabled={isExtracting}
                    onKeyDown={(e) => e.key === "Enter" && handleUrlExtract()}
                    className="border-border/60 focus-visible:ring-purple-500/30"
                  />
                  <Button
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={handleUrlExtract}
                    disabled={isExtracting || !urlInput}
                  >
                    {isExtracting ? "Fetching..." : "Extract Article"}
                  </Button>
                </TabsContent>

                <TabsContent value="email" className="mt-4 space-y-3">
                  <div>
                    <h3 className="text-base font-semibold">Extract from Email</h3>
                    <p className="text-sm text-muted-foreground">Paste the HTML or plain text of an email.</p>
                  </div>
                  <Input
                    placeholder="Email subject"
                    value={emailSubject}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmailSubject(e.target.value)}
                    disabled={isExtracting}
                    className="border-border/60 focus-visible:ring-purple-500/30"
                  />
                  <Textarea
                    placeholder="Paste email HTML or plain text here..."
                    value={emailContent}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEmailContent(e.target.value)}
                    rows={7}
                    disabled={isExtracting}
                    className="border-border/60 focus-visible:ring-purple-500/30 resize-none"
                  />
                  <Button
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={handleEmailExtract}
                    disabled={isExtracting || (!emailContent && !emailSubject)}
                  >
                    {isExtracting ? "Processing..." : "Add Email"}
                  </Button>
                </TabsContent>

                <TabsContent value="text" className="mt-4 space-y-3">
                  <div>
                    <h3 className="text-base font-semibold">Add Text</h3>
                    <p className="text-sm text-muted-foreground">Write or paste your own content.</p>
                  </div>
                  <Input
                    placeholder="Chapter title"
                    value={textTitle}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTextTitle(e.target.value)}
                    className="border-border/60 focus-visible:ring-purple-500/30"
                  />
                  <Textarea
                    placeholder="Write your content here..."
                    rows={7}
                    value={textContent}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTextContent(e.target.value)}
                    className="border-border/60 focus-visible:ring-purple-500/30 resize-none"
                  />
                  <Button
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={handleAddText}
                    disabled={!textContent}
                  >
                    Add Chapter
                  </Button>
                </TabsContent>
              </Tabs>
            </section>

            {/* Right Panel */}
            <section className="space-y-4">
              <Card className="border-border/50 overflow-hidden">
                <div className="h-0.5 w-full bg-gradient-to-r from-purple-600/60 to-violet-500/60" />
                <CardHeader className="pb-3 pt-4">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-md bg-purple-500/10 flex items-center justify-center">
                      <BookOpen className="h-4 w-4 text-purple-400" />
                    </div>
                    <div>
                      <CardTitle className="text-sm">Book Settings</CardTitle>
                      <CardDescription className="text-xs">Metadata that goes inside your EPUB.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Book title</Label>
                    <Input
                      value={metadata.title}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMetadata({...metadata, title: e.target.value})}
                      className="border-border/60 focus-visible:ring-purple-500/30"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Author</Label>
                    <Input
                      value={metadata.author}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMetadata({...metadata, author: e.target.value})}
                      className="border-border/60 focus-visible:ring-purple-500/30"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/50 overflow-hidden">
                <div className="h-0.5 w-full bg-gradient-to-r from-purple-600/60 to-violet-500/60" />
                <CardHeader className="pb-3 pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-md bg-purple-500/10 flex items-center justify-center">
                        <GripVertical className="h-4 w-4 text-purple-400" />
                      </div>
                      <div>
                        <CardTitle className="text-sm">Chapters</CardTitle>
                        <CardDescription className="text-xs">
                          {chapters.length === 0 ? "No chapters yet" : `${chapters.length} chapter${chapters.length !== 1 ? "s" : ""} — drag to reorder`}
                        </CardDescription>
                      </div>
                    </div>
                    {chapters.length > 0 && (
                      <span className="text-xs bg-purple-500/15 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded-full font-medium">
                        {chapters.length}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {chapters.length === 0 ? (
                    <div className="text-center py-10 px-4 text-muted-foreground border border-dashed border-border/60 rounded-xl space-y-2">
                      <BookOpen className="h-8 w-8 mx-auto opacity-30" />
                      <p className="text-sm">Your chapters will appear here.</p>
                      <p className="text-xs opacity-60">Use the panel on the left to import content.</p>
                    </div>
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={chapters.map(c => c.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {chapters.map(chapter => (
                          <SortableChapter
                            key={chapter.id}
                            id={chapter.id}
                            chapter={chapter}
                            onDelete={deleteChapter}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  )}
                </CardContent>
                <CardFooter className="flex flex-col gap-2 pt-2">
                  <Button
                    variant="outline"
                    className="w-full hover:border-purple-500/40 hover:text-purple-400 transition-colors"
                    onClick={handleMergeChapters}
                    disabled={chapters.length <= 1 || isGenerating}
                  >
                    Merge all into one chapter
                  </Button>
                  <Button
                    className="w-full h-12 text-sm font-semibold bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white shadow-lg shadow-purple-500/20 transition-all hover:scale-[1.01] hover:shadow-purple-500/30"
                    onClick={handleDownloadEpub}
                    disabled={chapters.length === 0 || isGenerating}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {isGenerating ? "Generating EPUB..." : "Generate & Download EPUB"}
                  </Button>
                </CardFooter>
              </Card>
            </section>

          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center border-t border-border/40">
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
          Built with <span className="text-red-400">♥</span> by{" "}
          <a
            href="https://github.com/Arturogrottoli"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-purple-400 hover:text-purple-300 transition-colors inline-flex items-center gap-1"
          >
            <Github className="h-3 w-3" />
            Arturo Grottoli
          </a>
        </p>
      </footer>
    </div>
  )
}
