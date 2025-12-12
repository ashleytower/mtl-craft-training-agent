import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { Link } from "wouter";
import { useState, useRef } from "react";
import { useReactToPrint } from "react-to-print";
import { Checkbox } from "@/components/ui/checkbox";

type Cocktail = {
  id: string;
  name: string;
  nom: string;
  descriptionEN: string;
  descriptionFR: string;
  glassware: string;
  funFacts: string;
};

export default function Menus() {
  const { data: cocktails, isLoading, error } = trpc.cocktails.getAll.useQuery();
  const [selectedCocktails, setSelectedCocktails] = useState<string[]>([]);
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: "Cocktail Menu",
  });

  const toggleCocktail = (id: string) => {
    setSelectedCocktails((prev) =>
      prev.includes(id)
        ? prev.filter((c) => c !== id)
        : [...prev, id]
    );
  };

  const selectedData = cocktails?.filter((c) => selectedCocktails.includes(c.id));

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10 print:hidden">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-semibold text-neutral-900">Menu Management</h1>
          </div>
          <Button onClick={() => handlePrint()} disabled={selectedCocktails.length === 0}>
            <Printer className="w-4 h-4 mr-2" />
            Print Menu ({selectedCocktails.length})
          </Button>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
          </div>
        ) : error ? (
          <div className="text-center text-red-500 py-12">
            Failed to load cocktails. Please try again later.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 print:hidden">
            {cocktails?.map((cocktail) => (
              <Card key={cocktail.id} className="p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-lg">{cocktail.name}</h3>
                  <Checkbox
                    checked={selectedCocktails.includes(cocktail.id)}
                    onCheckedChange={() => toggleCocktail(cocktail.id)}
                  />
                </div>
                <p className="text-sm text-neutral-600 line-clamp-3">{cocktail.descriptionEN}</p>
              </Card>
            ))}
          </div>
        )}

        {/* Printable Section */}
        <div className="hidden print:block print:p-8" ref={printRef}>
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold mb-4">Cocktail Menu</h1>
            <p className="text-neutral-500">Le Fou Fou</p>
          </div>

          <div className="grid grid-cols-1 gap-8">
            {selectedData?.map((cocktail) => (
              <div key={cocktail.id} className="border-b border-neutral-200 pb-6 break-inside-avoid">
                <div className="flex justify-between items-baseline mb-2">
                  <h2 className="text-2xl font-bold">{cocktail.name}</h2>
                  <span className="text-sm text-neutral-500">{cocktail.glassware}</span>
                </div>
                <p className="text-neutral-700 mb-2">{cocktail.descriptionEN}</p>
                {cocktail.funFacts && (
                  <p className="text-sm text-neutral-500 italic">Did you know? {cocktail.funFacts}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
