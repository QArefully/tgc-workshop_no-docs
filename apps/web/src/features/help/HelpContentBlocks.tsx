import type { HelpContentBlock } from './content/helpContentTypes';
import { FaqList } from './FaqList';

interface HelpContentBlocksProps {
  readonly blocks: readonly HelpContentBlock[];
}

function assertNever(block: never): never {
  throw new Error(`Unknown help content block: ${JSON.stringify(block)}`);
}

/** Renders each supported static content block with semantic HTML. */
export function HelpContentBlocks({ blocks }: HelpContentBlocksProps) {
  return (
    <div className="space-y-8">
      {blocks.map((block) => {
        switch (block.kind) {
          case 'paragraph':
            return (
              <p key={block.id} className="leading-7 text-muted-foreground">
                {block.text}
              </p>
            );
          case 'section': {
            const headingId = `${block.id}-heading`;

            return (
              <section key={block.id} aria-labelledby={headingId} className="space-y-3">
                <h2 id={headingId} className="text-xl font-semibold tracking-tight sm:text-2xl">
                  {block.heading}
                </h2>
                <div className="space-y-3 leading-7 text-muted-foreground">
                  {block.paragraphs.map((paragraph) => (
                    <p key={paragraph.id}>{paragraph.text}</p>
                  ))}
                </div>
              </section>
            );
          }
          case 'list': {
            const headingId = `${block.id}-heading`;

            return (
              <section key={block.id} aria-labelledby={headingId} className="space-y-3">
                <h2 id={headingId} className="text-xl font-semibold tracking-tight sm:text-2xl">
                  {block.heading}
                </h2>
                <ul className="list-disc space-y-2 pl-5 leading-7 text-muted-foreground">
                  {block.items.map((item) => (
                    <li key={item.id}>{item.text}</li>
                  ))}
                </ul>
              </section>
            );
          }
          case 'notice': {
            const headingId = `${block.id}-heading`;

            return (
              <aside
                key={block.id}
                aria-labelledby={headingId}
                role="note"
                className="space-y-3 rounded-lg border border-primary/30 bg-surface-soft p-5"
              >
                <h2 id={headingId} className="text-xl font-semibold tracking-tight sm:text-2xl">
                  {block.heading}
                </h2>
                <div className="space-y-3 leading-7 text-muted-foreground">
                  {block.paragraphs.map((paragraph) => (
                    <p key={paragraph.id}>{paragraph.text}</p>
                  ))}
                </div>
              </aside>
            );
          }
          case 'faq':
            return (
              <FaqList
                key={block.id}
                id={block.id}
                heading={block.heading}
                entries={block.entries}
              />
            );
          default:
            return assertNever(block);
        }
      })}
    </div>
  );
}
