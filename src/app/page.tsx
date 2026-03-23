"use client"

import { useState, useEffect } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { BookOpen, FileUp, Link as LinkIcon, Type, GripVertical, Trash2, Download } from "lucide-react"

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
    <div ref={setNodeRef} style={style} className="bg-muted px-4 py-3 rounded-md flex justify-between items-center mb-2 shadow-sm border border-border">
      <div className="flex items-center gap-3 overflow-hidden">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground">
          <GripVertical className="h-5 w-5" />
        </button>
        <span className="truncate font-medium">{chapter.title}</span>
      </div>
      <Button variant="ghost" size="icon" onClick={() => onDelete(id)}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

export default function Home() {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [urlInput, setUrlInput] = useState("")
  const [textTitle, setTextTitle] = useState("")
  const [textContent, setTextContent] = useState("")
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
      } catch (e) {}
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

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Left Panel - Inputs */}
        <section className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2 mb-2">
              <BookOpen className="h-8 w-8 text-purple-500" />
              EPUBify
            </h1>
            <p className="text-muted-foreground">Add sources to build your EPUB.</p>
          </div>
          
          <Tabs defaultValue="file" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="file"><FileUp className="w-4 h-4 mr-2"/> File</TabsTrigger>
              <TabsTrigger value="url"><LinkIcon className="w-4 h-4 mr-2"/> URL</TabsTrigger>
              <TabsTrigger value="text"><Type className="w-4 h-4 mr-2"/> Text</TabsTrigger>
            </TabsList>
            
            <TabsContent value="file">
              <Card>
                <CardHeader>
                  <CardTitle>Upload Documents</CardTitle>
                  <CardDescription>PDF or DOCX files supported.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:bg-muted/50 transition-colors relative">
                    <input 
                      type="file" 
                      multiple 
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      onChange={handleFileUpload}
                      disabled={isExtracting}
                    />
                    <FileUp className="mx-auto h-8 w-8 text-muted-foreground mb-4" />
                    <p className="font-medium">Click or drag files here</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {isExtracting ? "Extracting..." : "Supports PDF, DOCX"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="url">
              <Card>
                <CardHeader>
                  <CardTitle>Extract from URL</CardTitle>
                  <CardDescription>Paste an article URL to fetch its content.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Input 
                    placeholder="https://example.com/article" 
                    value={urlInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrlInput(e.target.value)}
                    disabled={isExtracting}
                  />
                  <Button 
                    className="w-full" 
                    onClick={handleUrlExtract}
                    disabled={isExtracting || !urlInput}
                  >
                    {isExtracting ? "Fetching..." : "Extract Article"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="text">
              <Card>
                <CardHeader>
                  <CardTitle>Add Text / Markdown</CardTitle>
                  <CardDescription>Write or paste your own content.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Input 
                    placeholder="Chapter Title" 
                    value={textTitle}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTextTitle(e.target.value)}
                  />
                  <Textarea 
                    placeholder="Write your content here..." 
                    rows={8}
                    value={textContent}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTextContent(e.target.value)}
                  />
                  <Button 
                    className="w-full"
                    onClick={handleAddText}
                    disabled={!textContent}
                  >
                    Add Chapter
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>
        </section>

        {/* Right Panel - Preview & Setup */}
        <section className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Book Settings</CardTitle>
                <CardDescription>Configure your EPUB metadata.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Book Title</Label>
                  <Input 
                    value={metadata.title} 
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMetadata({...metadata, title: e.target.value})} 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Author</Label>
                  <Input 
                    value={metadata.author} 
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMetadata({...metadata, author: e.target.value})} 
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Chapters Preview</CardTitle>
                <CardDescription>Drag to reorder. Total: {chapters.length} chapters.</CardDescription>
              </CardHeader>
              <CardContent>
                {chapters.length === 0 ? (
                  <div className="text-center p-8 text-muted-foreground border border-dashed rounded-lg">
                    No chapters added yet. Use the left panel to import content.
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
              <CardFooter>
                <Button 
                  className="w-full h-12 text-md transition-all hover:scale-[1.02]" 
                  onClick={handleDownloadEpub}
                  disabled={chapters.length === 0 || isGenerating}
                >
                  <Download className="mr-2 h-5 w-5" />
                  {isGenerating ? "Generating EPUB..." : "Generate & Download EPUB"}
                </Button>
              </CardFooter>
            </Card>
        </section>

      </div>
    </div>
  )
}
