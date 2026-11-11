import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export default function FaqSection({ pathway, heading = "Common Questions" }: { pathway: string; heading?: string }) {
  const [items, setItems] = useState<FaqItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/faqs/${pathway}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (alive) { setItems(Array.isArray(data) ? data : []); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [pathway]);

  if (!loaded || items.length === 0) return null;

  return (
    <section className="bg-card py-20">
      <div className="container max-w-3xl mx-auto px-4">
        <div className="text-center mb-10">
          <span className="inline-block text-xs tracking-widest uppercase text-notice font-semibold mb-3">
            FAQ
          </span>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground">
            {heading}
          </h2>
        </div>
        <Accordion type="single" collapsible className="space-y-3">
          {items.map((item) => (
            <AccordionItem
              key={item.id}
              value={item.id}
              className="border border-border rounded-2xl px-5 bg-muted"
            >
              <AccordionTrigger className="text-left font-semibold text-foreground py-4 hover:no-underline">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed pb-4">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
