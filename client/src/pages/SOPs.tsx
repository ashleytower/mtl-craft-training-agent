import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { Streamdown } from "streamdown";
import { useLanguage } from "@/contexts/LanguageContext";

export default function SOPs() {
  const { data, isLoading, error } = trpc.sops.get.useQuery();
  const { t: translate } = useLanguage();

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-semibold text-neutral-900">SOP & Training Guide</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
          </div>
        ) : error ? (
          <div className="text-center text-red-500 py-12">
            Failed to load SOPs. Please try again later.
          </div>
        ) : (
          <Card className="p-8 max-w-4xl mx-auto bg-white border-neutral-200">
            <Streamdown className="prose prose-neutral max-w-none prose-headings:font-bold prose-h1:text-3xl prose-h2:text-2xl prose-p:text-neutral-600 prose-li:text-neutral-600">
              {data?.content || ""}
            </Streamdown>
          </Card>
        )}
      </main>
    </div>
  );
}
