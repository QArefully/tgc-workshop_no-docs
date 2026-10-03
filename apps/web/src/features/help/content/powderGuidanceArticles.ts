import { defineHelpArticle } from './helpContentTypes';

export const powderSafetyArticle = defineHelpArticle({
  id: 'powder-safety',
  group: 'help',
  slug: 'powder-safety',
  path: '/help/powder-safety',
  title: 'Powder safety',
  summary:
    'QArefully Powder Co. is a local demo. Read each displayed product label before deciding how to use that fictional catalog item.',
  blocks: [
    {
      kind: 'paragraph',
      id: 'demo-catalog',
      text: 'This fictional powder catalog is provided for local QA and demo use. Its category names, product descriptions, and bag artwork are not safety guidance or product specifications.',
    },
    {
      kind: 'notice',
      id: 'product-label-authority',
      heading: 'Use the displayed product warning',
      paragraphs: [
        {
          id: 'product-label-authority-warning',
          text: 'A warning shown on an individual product is the authority for that displayed item. This general page does not replace, reinterpret, or extend a product-specific warning.',
        },
        {
          id: 'product-label-authority-consumption',
          text: 'If a product displays “Not for consumption”, follow that displayed warning. Do not infer a different use from its category, name, image, or this help article.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'demo-boundary',
      heading: 'What this page can tell you',
      paragraphs: [
        {
          id: 'demo-boundary-labels',
          text: 'It explains the boundary of this demo: product information is fictional, and displayed item labels remain specific to their own product cards and pages.',
        },
        {
          id: 'demo-boundary-claims',
          text: 'It does not make medical, certification, performance, or universal handling claims for any powder shown here.',
        },
      ],
    },
  ],
} as const);

export const storageArticle = defineHelpArticle({
  id: 'storage',
  group: 'help',
  slug: 'storage',
  path: '/help/storage',
  title: 'Storage',
  summary:
    'This local demo does not publish universal storage specifications. Refer to any displayed facts for the specific fictional product you are viewing.',
  blocks: [
    {
      kind: 'paragraph',
      id: 'general-guidance',
      text: 'Storage details in this help center are deliberately general. The demo does not establish storage requirements for every fictional powder in the catalog.',
    },
    {
      kind: 'notice',
      id: 'item-facts-authority',
      heading: 'Check the individual product display',
      paragraphs: [
        {
          id: 'item-facts-authority-reference',
          text: 'When an item display includes product-specific facts or warnings, treat that displayed information as the relevant reference for that item.',
        },
        {
          id: 'item-facts-authority-boundary',
          text: 'Do not use this page to fill in omitted storage details, to transfer one product’s displayed facts to another, or to infer an unlisted specification.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'demo-boundary',
      heading: 'Demo information only',
      paragraphs: [
        {
          id: 'demo-boundary-information',
          text: 'Catalog content is fictional and intended for local QA and educational demonstration. It is not a substitute for product-specific instructions or specifications.',
        },
      ],
    },
  ],
} as const);
