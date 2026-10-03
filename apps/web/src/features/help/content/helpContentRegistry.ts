import { faqArticle } from './faqArticle';
import {
  type FaqBlock,
  type HelpArticle,
  type HelpContentBlock,
  type HelpContentGroup,
} from './helpContentTypes';
import { policyArticles as authoredPolicyArticles } from './policyArticles';
import { storageArticle } from './powderGuidanceArticles';
import {
  shippingArticle,
  returnsArticle,
  packSizesArticle,
  safetyArticle,
  customBlendArticle,
  BLENDING_FEE_CENTS,
} from './serviceArticles';
import type { Country } from '@shop/contracts/country';
import { countryProfile } from '@shop/contracts/country-profiles';
import { formatDisplayMoney, translateUnchecked } from '@shop/localisation';
import { helpPolicyMessages } from '@shop/localisation/messages/helpPolicy';

type ContentLink = Readonly<{
  label: string;
  path: string;
}>;

function toContentLink(article: Pick<HelpArticle, 'title' | 'path'>): ContentLink {
  return { label: article.title, path: article.path };
}

export const helpIndexLink = {
  label: 'Help center',
  path: '/help',
} as const;

export const helpArticles = [
  faqArticle,
  shippingArticle,
  returnsArticle,
  packSizesArticle,
  customBlendArticle,
  safetyArticle,
  storageArticle,
] as const satisfies readonly HelpArticle<'help'>[];

export const policyArticles = authoredPolicyArticles;

export const helpContentRegistry = [
  ...helpArticles,
  ...policyArticles,
] as const satisfies readonly HelpArticle[];

/** Product-detail links derive labels and routes from canonical help and policy articles. */
export const productFactLinks = {
  powderSafety: toContentLink(safetyArticle),
  storage: toContentLink(storageArticle),
  packSizes: toContentLink(packSizesArticle),
} as const;

export const productCommerceLinks = {
  shipping: toContentLink(shippingArticle),
  returns: toContentLink(returnsArticle),
  privacy: toContentLink(authoredPolicyArticles[0]),
  terms: toContentLink(authoredPolicyArticles[1]),
} as const;

const articleIds = new Set(helpContentRegistry.map((article) => article.id));

function messageKey(articleId: string, id: string, field: 'text' | 'heading' | 'question') {
  return `help.${articleId}.${id}.${field}`;
}

function translateContent(
  country: Country,
  articleId: string,
  id: string,
  field: 'text' | 'heading' | 'question',
): string {
  const key = messageKey(articleId, id, field);
  const params: Readonly<Record<string, string | number | bigint>> | undefined =
    articleId === 'custom-blend' && id === 'custom-blend-pricing-fee' && field === 'text'
      ? { blendFee: formatDisplayMoney(BLENDING_FEE_CENTS, countryProfile(country)) }
      : undefined;
  return translateUnchecked(helpPolicyMessages, country, key, params);
}

function materializeBlock(
  country: Country,
  articleId: string,
  block: HelpContentBlock,
): HelpContentBlock {
  switch (block.kind) {
    case 'paragraph':
      return {
        ...block,
        text: translateContent(country, articleId, block.id, 'text'),
      };
    case 'section':
    case 'notice':
      return {
        ...block,
        heading: translateContent(country, articleId, block.id, 'heading'),
        paragraphs: block.paragraphs.map((paragraph) => ({
          ...paragraph,
          text: translateContent(country, articleId, paragraph.id, 'text'),
        })),
      };
    case 'list':
      return {
        ...block,
        heading: translateContent(country, articleId, block.id, 'heading'),
        items: block.items.map((item) => ({
          ...item,
          text: translateContent(country, articleId, item.id, 'text'),
        })),
      };
    case 'faq':
      return {
        ...block,
        heading: translateContent(country, articleId, block.id, 'heading'),
        entries: block.entries.map((entry) => ({
          ...entry,
          question: translateContent(country, articleId, entry.id, 'question'),
          answerParagraphs: entry.answerParagraphs.map((paragraph) => ({
            ...paragraph,
            text: translateContent(country, articleId, paragraph.id, 'text'),
          })),
        })),
      } satisfies FaqBlock;
    default:
      return block;
  }
}

/** Resolve one authored article to the active country's copy at render time. */
export function materializeHelpArticle(country: Country, article: HelpArticle): HelpArticle {
  if (!articleIds.has(article.id)) throw new Error(`Unknown help article id: ${article.id}`);
  return {
    ...article,
    title: translateUnchecked(helpPolicyMessages, country, `help.${article.id}.title`),
    summary: translateUnchecked(helpPolicyMessages, country, `help.${article.id}.summary`),
    blocks: article.blocks.map((block) => materializeBlock(country, article.id, block)),
  };
}

/** Materialize all help and policy articles without changing route identity or order. */
export function materializeHelpContent(country: Country): readonly HelpArticle[] {
  return helpContentRegistry.map((article) => materializeHelpArticle(country, article));
}

export function materializeHelpIndexLink(
  country: Country,
): Readonly<{ path: '/help'; label: string }> {
  return {
    path: helpIndexLink.path,
    label: translateUnchecked(helpPolicyMessages, country, 'help.shell.helpCenter'),
  };
}

export function getProductFactLinks(country: Country) {
  return {
    powderSafety: toContentLink(materializeHelpArticle(country, safetyArticle)),
    storage: toContentLink(materializeHelpArticle(country, storageArticle)),
    packSizes: toContentLink(materializeHelpArticle(country, packSizesArticle)),
  } as const;
}

export function getProductCommerceLinks(country: Country) {
  return {
    shipping: toContentLink(materializeHelpArticle(country, shippingArticle)),
    returns: toContentLink(materializeHelpArticle(country, returnsArticle)),
    privacy: toContentLink(materializeHelpArticle(country, authoredPolicyArticles[0])),
    terms: toContentLink(materializeHelpArticle(country, authoredPolicyArticles[1])),
  } as const;
}

export function getArticlesForGroup(group: 'help'): typeof helpArticles;
export function getArticlesForGroup(group: 'policy'): typeof policyArticles;
export function getArticlesForGroup(
  group: 'help',
  country: Country,
): readonly HelpArticle<'help'>[];
export function getArticlesForGroup(
  group: 'policy',
  country: Country,
): readonly HelpArticle<'policy'>[];
export function getArticlesForGroup(
  group: HelpContentGroup,
  country?: Country,
): readonly HelpArticle[];
export function getArticlesForGroup(group: HelpContentGroup): readonly HelpArticle[];
export function getArticlesForGroup(
  group: HelpContentGroup,
  country?: Country,
): readonly HelpArticle[] {
  const articles = group === 'help' ? helpArticles : policyArticles;
  return country === undefined
    ? articles
    : articles.map((article) => materializeHelpArticle(country, article));
}

export function getHelpArticle(group: 'help', slug: string): HelpArticle<'help'> | undefined;
export function getHelpArticle(group: 'policy', slug: string): HelpArticle<'policy'> | undefined;
export function getHelpArticle(
  group: 'help',
  slug: string,
  country: Country,
): HelpArticle<'help'> | undefined;
export function getHelpArticle(
  group: 'policy',
  slug: string,
  country: Country,
): HelpArticle<'policy'> | undefined;
export function getHelpArticle(group: HelpContentGroup, slug: string): HelpArticle | undefined;
export function getHelpArticle(
  group: HelpContentGroup,
  slug: string,
  country?: Country,
): HelpArticle | undefined {
  return getArticlesForGroup(group, country).find((article) => article.slug === slug);
}
