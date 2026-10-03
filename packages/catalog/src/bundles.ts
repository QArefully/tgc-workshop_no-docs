export type CatalogBundleComponent = Readonly<{
  variantSku: string;
  quantity: number;
  sortOrder: number;
}>;

export type CatalogBundle = Readonly<{
  id: number;
  key: string;
  name: string;
  description: string;
  imageSetId: string;
  discountPercent: number;
  sortOrder: number;
  components: readonly CatalogBundleComponent[];
}>;

export const CURATED_BUNDLES = [
  {
    id: 1,
    key: 'protein-starter-pack',
    name: 'Protein Starter Pack',
    description:
      'Whey protein isolate, creatine monohydrate, and electrolyte blend for a complete training support kit.',
    imageSetId: 'bundle-protein-starter-pack',
    discountPercent: 10,
    sortOrder: 1,
    components: [
      { variantSku: 'SPN-0008-001', quantity: 4, sortOrder: 1 },
      { variantSku: 'SPN-0009-001', quantity: 4, sortOrder: 2 },
      { variantSku: 'SPN-0013-001', quantity: 4, sortOrder: 3 },
    ],
  },
  {
    id: 2,
    key: 'baking-essentials',
    name: 'Baking Essentials',
    description:
      'All-purpose flour, cocoa powder, baking powder, and vanilla milkshake powder for your baking pantry.',
    imageSetId: 'bundle-baking-essentials',
    discountPercent: 10,
    sortOrder: 2,
    components: [
      { variantSku: 'BKP-0001-001', quantity: 4, sortOrder: 1 },
      { variantSku: 'BKP-0003-001', quantity: 4, sortOrder: 2 },
      { variantSku: 'BKP-1016-001', quantity: 4, sortOrder: 3 },
      { variantSku: 'DRK-1035-001', quantity: 4, sortOrder: 4 },
    ],
  },
  {
    id: 3,
    key: 'garden-care-kit',
    name: 'Garden Care Kit',
    description:
      'All-purpose fertilizer, bone meal for roots, and epsom salt for magnesium-hungry plants.',
    imageSetId: 'bundle-garden-care-kit',
    discountPercent: 10,
    sortOrder: 3,
    components: [
      { variantSku: 'GDN-0027-001', quantity: 4, sortOrder: 1 },
      { variantSku: 'GDN-0028-001', quantity: 4, sortOrder: 2 },
      { variantSku: 'GDN-0031-001', quantity: 4, sortOrder: 3 },
    ],
  },
  {
    id: 4,
    key: 'cleaning-supplies-bundle',
    name: 'Cleaning Supplies Bundle',
    description:
      'All-purpose cleaner, glass cleaner, and scouring powder for a complete household cleaning kit.',
    imageSetId: 'bundle-cleaning-supplies-bundle',
    discountPercent: 10,
    sortOrder: 4,
    components: [
      { variantSku: 'HCL-0022-001', quantity: 4, sortOrder: 1 },
      { variantSku: 'HCL-0026-001', quantity: 4, sortOrder: 2 },
      { variantSku: 'HCL-0043-001', quantity: 4, sortOrder: 3 },
    ],
  },
  {
    id: 5,
    key: 'casting-workshop-kit',
    name: 'Casting Workshop Kit',
    description:
      'Plaster of Paris, titanium white and ultramarine blue pigments for casting and colouring projects.',
    imageSetId: 'bundle-casting-workshop-kit',
    discountPercent: 10,
    sortOrder: 5,
    components: [
      { variantSku: 'TCM-0034-001', quantity: 4, sortOrder: 1 },
      { variantSku: 'TCM-0036-001', quantity: 4, sortOrder: 2 },
      { variantSku: 'TCM-0038-001', quantity: 4, sortOrder: 3 },
    ],
  },
  {
    id: 6,
    key: 'drinks-sampler',
    name: 'Drinks Sampler',
    description:
      'Matcha, chai latte mix, and hot chocolate mix for a trio of warming drink options.',
    imageSetId: 'bundle-drinks-sampler',
    discountPercent: 10,
    sortOrder: 6,
    components: [
      { variantSku: 'DRK-0014-001', quantity: 4, sortOrder: 1 },
      { variantSku: 'DRK-0018-001', quantity: 4, sortOrder: 2 },
      { variantSku: 'DRK-0016-001', quantity: 4, sortOrder: 3 },
    ],
  },
] as const satisfies readonly CatalogBundle[];
