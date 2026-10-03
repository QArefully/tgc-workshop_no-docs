import { Link } from 'react-router-dom';
import { useLocalisation } from '@/i18n/LocaleContext';
import { helpPolicyMessages } from '@shop/localisation/messages/helpPolicy';
import type { HelpArticle } from './content/helpContentTypes';
import { HelpContentBlocks } from './HelpContentBlocks';

export interface HelpIndexLink {
  readonly path: '/help';
  readonly label: string;
}

interface HelpArticleLayoutProps {
  readonly article: HelpArticle;
  readonly helpIndexLink: HelpIndexLink;
}

/** Shared semantic frame for help and policy articles. */
export function HelpArticleLayout({ article, helpIndexLink }: HelpArticleLayoutProps) {
  const { translate } = useLocalisation();
  const titleId = `${article.id}-title`;

  return (
    <article aria-labelledby={titleId} className="mx-auto max-w-3xl space-y-8 pb-12">
      <header className="space-y-3">
        <p className="section-eyebrow">
          {translate(
            helpPolicyMessages,
            article.group === 'help' ? 'help.shell.groupHelp' : 'help.shell.groupPolicy',
          )}
        </p>
        <h1 id={titleId} className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {article.title}
        </h1>
        <p className="max-w-2xl leading-7 text-muted-foreground">{article.summary}</p>
      </header>

      <section aria-label={translate(helpPolicyMessages, 'help.shell.articleContent')}>
        <HelpContentBlocks blocks={article.blocks} />
      </section>

      <nav aria-label={translate(helpPolicyMessages, 'help.shell.navigation')}>
        <Link to={helpIndexLink.path} className="section-link">
          {translate(helpPolicyMessages, 'help.shell.backTo', { label: helpIndexLink.label })}
        </Link>
      </nav>
    </article>
  );
}
