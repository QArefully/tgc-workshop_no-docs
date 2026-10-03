import { useParams } from 'react-router-dom';
import { NotFoundPage } from '@/features/notFound/NotFoundPage';
import { useLocalisation } from '@/i18n/LocaleContext';
import type { HelpContentGroup } from './content/helpContentTypes';
import { getHelpArticle, materializeHelpIndexLink } from './content/helpContentRegistry';
import { HelpArticleLayout } from './HelpArticleLayout';

interface HelpArticlePageProps {
  readonly group: HelpContentGroup;
}

/** Resolves an article only within its route group, preserving unknown-slug 404s. */
export function HelpArticlePage({ group }: HelpArticlePageProps) {
  const { slug } = useParams<{ slug: string }>();
  const { activeCountry } = useLocalisation();
  const article = slug
    ? group === 'help'
      ? getHelpArticle('help', slug, activeCountry)
      : getHelpArticle('policy', slug, activeCountry)
    : undefined;

  if (!article) {
    return <NotFoundPage />;
  }

  return (
    <HelpArticleLayout article={article} helpIndexLink={materializeHelpIndexLink(activeCountry)} />
  );
}
