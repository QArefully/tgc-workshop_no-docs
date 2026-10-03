import type { FaqEntry } from './content/helpContentTypes';

interface FaqListProps {
  readonly id: string;
  readonly heading: string;
  readonly entries: readonly FaqEntry[];
}

/** Native disclosure list for a typed FAQ block. */
export function FaqList({ id, heading, entries }: FaqListProps) {
  const headingId = `${id}-heading`;

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <h2 id={headingId} className="text-xl font-semibold tracking-tight sm:text-2xl">
        {heading}
      </h2>
      <div className="space-y-3">
        {entries.map((entry) => (
          <details
            key={entry.id}
            className="rounded-lg border border-border bg-surface-raised px-4 py-1.5"
          >
            <summary className="cursor-pointer rounded-md py-2 font-semibold transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              {entry.question}
            </summary>
            <div className="space-y-3 border-t border-border py-3 text-sm leading-6 text-muted-foreground">
              {entry.answerParagraphs.map((paragraph) => (
                <p key={paragraph.id}>{paragraph.text}</p>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
