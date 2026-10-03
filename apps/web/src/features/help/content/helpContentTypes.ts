/** Renderer-neutral static content contract for Help and policy pages. */

export type HelpContentGroup = 'help' | 'policy';

export type HelpArticlePath<
  Group extends HelpContentGroup,
  Slug extends string = string,
> = Group extends 'help' ? `/help/${Slug}` : `/policies/${Slug}`;

export type HelpArticleId =
  | 'faq'
  | 'shipping'
  | 'returns'
  | 'powder-safety'
  | 'storage'
  | 'pack-sizes'
  | 'custom-blend'
  | 'privacy'
  | 'terms';

export const faqEntryIds = [
  'shop-purpose',
  'payments',
  'shipping',
  'account-data',
  'cart',
] as const;

export type FaqEntryId = (typeof faqEntryIds)[number];

export interface ContentParagraph {
  readonly id: string;
  readonly text: string;
}

export interface ContentListItem {
  readonly id: string;
  readonly text: string;
}

export interface FaqEntry {
  readonly id: FaqEntryId;
  readonly question: string;
  readonly answerParagraphs: readonly ContentParagraph[];
}

export interface ParagraphBlock {
  readonly kind: 'paragraph';
  readonly id: string;
  readonly text: string;
}

export interface SectionBlock {
  readonly kind: 'section';
  readonly id: string;
  readonly heading: string;
  readonly paragraphs: readonly ContentParagraph[];
}

export interface ListBlock {
  readonly kind: 'list';
  readonly id: string;
  readonly heading: string;
  readonly items: readonly ContentListItem[];
}

export interface NoticeBlock {
  readonly kind: 'notice';
  readonly id: string;
  readonly heading: string;
  readonly paragraphs: readonly ContentParagraph[];
}

export interface FaqBlock {
  readonly kind: 'faq';
  readonly id: string;
  readonly heading: string;
  readonly entries: readonly FaqEntry[];
}

export type HelpContentBlock = ParagraphBlock | SectionBlock | ListBlock | NoticeBlock | FaqBlock;

export type HelpArticle<
  Group extends HelpContentGroup = HelpContentGroup,
  Slug extends string = string,
> = Group extends HelpContentGroup
  ? {
      readonly id: HelpArticleId;
      readonly group: Group;
      readonly slug: Slug;
      readonly path: HelpArticlePath<Group, Slug>;
      readonly title: string;
      readonly summary: string;
      readonly blocks: readonly HelpContentBlock[];
    }
  : never;

export function defineHelpArticle<const Group extends HelpContentGroup, const Slug extends string>(
  article: HelpArticle<Group, Slug>,
): HelpArticle<Group, Slug> {
  return article;
}
