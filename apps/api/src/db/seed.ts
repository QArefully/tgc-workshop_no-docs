import { CATALOG_PRODUCTS, CURATED_BUNDLES, validateCatalog } from '@shop/catalog';
import { LEGACY_DATA_COUNTRY } from '@shop/contracts';
import type Database from 'better-sqlite3';
import { catalogProductSpecifications } from '../features/catalog/catalogSpecifications.js';
import { seedOrderScenarios } from './orderSeedScenarios.js';
import { seedReviewScenarios } from './reviewSeedScenarios.js';
import { seedCompanyAccounts } from './companyAccountsSeed.js';
import { seedTradeCredit } from './tradeCreditSeed.js';
import { seedSavedLists } from './savedListSeed.js';
import { seedAsyncScenarios } from './seedAsyncScenarios.js';
import { seedBackInStock } from './backInStockSeed.js';
import { assertProfilesMatchCatalog } from '../features/countryProfile/countryProfileService.js';

const USERS = [
  {
    id: 1,
    email: 'alice@example.com',
    display_name: 'Alice',
    role: 'customer',
    country: LEGACY_DATA_COUNTRY,
  },
  {
    id: 2,
    email: 'bob@example.com',
    display_name: 'Bob',
    role: 'customer',
    country: LEGACY_DATA_COUNTRY,
  },
  {
    id: 3,
    email: 'admin@example.com',
    display_name: 'Admin',
    role: 'admin',
    country: LEGACY_DATA_COUNTRY,
  },
  {
    id: 4,
    email: 'acme@example.com',
    display_name: 'Acme Owner',
    role: 'customer',
    country: LEGACY_DATA_COUNTRY,
  },
  {
    id: 5,
    email: 'buyer@example.com',
    display_name: 'Acme Buyer',
    role: 'customer',
    country: LEGACY_DATA_COUNTRY,
  },
  {
    id: 6,
    email: 'approver@example.com',
    display_name: 'Acme Approver',
    role: 'customer',
    country: LEGACY_DATA_COUNTRY,
  },
] as const;

const ADMIN_SUSPENDED_USER = {
  id: 4,
  email: 'suspended@example.com',
  display_name: 'Suspended Demo',
  role: 'customer',
  country: LEGACY_DATA_COUNTRY,
  suspended_at: '2026-07-28T12:00:00.000Z',
  suspension_reason: 'Seeded administration fixture',
} as const;

const DE_ALICE = {
  email: 'alice@example.com',
  display_name: 'Alice',
  role: 'customer',
  country: 'DE',
} as const;

const DE_ALICE_PASSWORD = 'PasswordDE!1';

/**
 * Credentials for the fixed demo identities. The salt and derived key are checked in so ordinary
 * seeding does not spend CPU deriving the same values over and over. These values retain the
 * historical `salt.hexHash` format and are still verified by the production password verifier.
 */
const SEEDED_PASSWORD_HASHES = Object.freeze({
  'alice@example.com|UK|Password123!':
    '0cbb5ca947f000eb56198953f60edf764a6200608c2c7bbbb6ca9e38ad136e29.71a4b78c9640cafeb16526e9bc812cbc09649552e1c721d1fb2ce1cefd3b385e75ff2ea8466271a871c888c78308ed7360b3069abe5612bd8d675ead8e155e1a',
  'bob@example.com|UK|Password123!':
    '6a02550322ef64c2c79f70a909764463d7209d0fbac9160d405fd4fad533a9a4.ba07f2052ee4410451dd41a3d16f605214d5be829a97d5ea4f2ff9addc1b8a50652e8d0222a37c96066b734da21f09632462976b858942df11e9429addf60d43',
  'admin@example.com|UK|Password123!':
    'd4b87683b4822d71f21b15874015a9e4cb5d1e682a235fa2dccfba00acba71f1.90e0b461dab51b243d650ad0e44fb422ebd43d82bc8b2cf0ff12375aeebf2e1c0dc58c74a5312d5b7f193577ce62664ad8e1a6b3f4b45b3645a0a23652cbe917',
  'acme@example.com|UK|Password123!':
    '15a113eba3c9931d36da830042d2513af1fb2b154ae5974264db75163549a0ae.7f4e004554d6e52e5c7a533c4a7a105c274c8e4df16788e186386647dc1c15b9d99f022787000955729dfd9d962d779ffee440b81ca33cb08f3ae0658631d3d2',
  'buyer@example.com|UK|Password123!':
    '15d4e780b89c02818e285bfe5b1f3be6668260e563313af7eb838a3825ffad72.758b37cba756d5561263abcfc75b0694ad9114b079e1f20232d72399320256c3864a59fd9e7deb4c38cfd7518e8e8dc7d926de3060b6363d9d32c9a3dffc2310',
  'approver@example.com|UK|Password123!':
    '603495e10249036696aaf09c44a71dacbec7e07289aa8dd5f5d4f0e26baeaf5d.93a216342256e10e56a0a438019dc6ddc5a48cb884a1ef04c7f9e907344af9e44484893ce77e7461ac779eba1421dc86c399281da0140ec5d0dda048596b3806',
  'alice@example.com|DE|PasswordDE!1':
    'b2a85508aa431e39826b69a446132617a03fd84559f88af1b828ac90f48624f7.6a5b2002b13397ddb23fa3e514aea3e5fa69bc2ecb3df3c7c06b4520c98d23f87adb1d70452d56af94853c8e87792afc327a0858b1bd1ab27900a894a13c417b',
  'suspended@example.com|UK|Password123!':
    '9c5e9fcfb896fc61dea4dffc03b0c87034a64813c099c3205a0e002cfaf319dc.3ba9212246f7cf8a7735830423e80dfe82744db8e575ead4c7688c6ef4834e9d1450f011625f3e761f69704a1b708a1e6176a96dddf8e01696f596372dcb4269',
} as const);

const ADMIN_DEACTIVATED_PROMO = {
  code: 'ADMINOFF',
  discount_percent: 10,
  min_item_count: 0,
  active: 0,
  kind: 'percent',
  amount_cents: null,
  min_subtotal_cents: null,
  start_at: null,
  end_at: null,
  max_redemptions: null,
  redemption_count: 0,
  per_user_limit: null,
} as const;

const ADMIN_FEATURE_FLAG = {
  key: 'admin.example_flag',
  description: 'Seeded local administration fixture.',
  enabled: 0,
} as const;

const PROMOS = [
  {
    code: 'SAVE10',
    discount_percent: 10,
    min_item_count: 5,
    active: 1,
    kind: 'percent',
    amount_cents: null,
    min_subtotal_cents: null,
    start_at: null,
    end_at: null,
    max_redemptions: null,
    redemption_count: 0,
    per_user_limit: null,
  },
  {
    code: 'SAVE20',
    discount_percent: 20,
    min_item_count: 0,
    active: 1,
    kind: 'percent',
    amount_cents: null,
    min_subtotal_cents: 10000,
    start_at: null,
    end_at: null,
    max_redemptions: null,
    redemption_count: 0,
    per_user_limit: null,
  },
  {
    code: 'WELCOME5',
    discount_percent: 0,
    min_item_count: 0,
    active: 1,
    kind: 'fixed',
    amount_cents: 500,
    min_subtotal_cents: null,
    start_at: null,
    end_at: null,
    max_redemptions: null,
    redemption_count: 0,
    per_user_limit: 1,
  },
  {
    code: 'VIP15',
    discount_percent: 15,
    min_item_count: 0,
    active: 1,
    kind: 'percent',
    amount_cents: null,
    min_subtotal_cents: null,
    start_at: null,
    end_at: null,
    max_redemptions: null,
    redemption_count: 0,
    per_user_limit: null,
  },
  {
    code: 'EXPIRED10',
    discount_percent: 10,
    min_item_count: 3,
    active: 1,
    kind: 'percent',
    amount_cents: null,
    min_subtotal_cents: null,
    start_at: null,
    end_at: '2025-01-01T00:00:00.000Z',
    max_redemptions: null,
    redemption_count: 0,
    per_user_limit: null,
  },
  {
    code: 'SOON10',
    discount_percent: 10,
    min_item_count: 3,
    active: 1,
    kind: 'percent',
    amount_cents: null,
    min_subtotal_cents: null,
    start_at: '2099-01-01T00:00:00.000Z',
    end_at: null,
    max_redemptions: null,
    redemption_count: 0,
    per_user_limit: null,
  },
  {
    code: 'LIMITED5',
    discount_percent: 5,
    min_item_count: 0,
    active: 1,
    kind: 'percent',
    amount_cents: null,
    min_subtotal_cents: null,
    start_at: null,
    end_at: null,
    max_redemptions: 0,
    redemption_count: 0,
    per_user_limit: null,
  },
] as const;

const SCOPED_PROMOS = [
  {
    code: 'GARDEN10',
    discount_percent: 10,
    min_item_count: 0,
    active: 1,
    kind: 'percent',
    amount_cents: null,
    min_subtotal_cents: null,
    start_at: null,
    end_at: null,
    max_redemptions: null,
    redemption_count: 0,
    per_user_limit: null,
    category_scope: 'Garden & Outdoors',
  },
  {
    code: 'CLEANFIVE',
    discount_percent: 0,
    min_item_count: 0,
    active: 1,
    kind: 'fixed',
    amount_cents: 500,
    min_subtotal_cents: null,
    start_at: null,
    end_at: null,
    max_redemptions: null,
    redemption_count: 0,
    per_user_limit: null,
    category_scope: 'Household & Cleaning',
  },
] as const;

const COUNTRY_TARGETED_PROMO = {
  code: 'LOC-UK-DE-10',
  discount_percent: 10,
  min_item_count: 0,
  active: 1,
  kind: 'percent',
  amount_cents: null,
  min_subtotal_cents: null,
  start_at: null,
  end_at: null,
  max_redemptions: null,
  redemption_count: 0,
  per_user_limit: null,
  countries: ['UK', 'DE'] as const,
} as const;

/** Fixed clock makes active, expired, and future clearance fixtures deterministic on every reset. */
const PRICING_PROMOTIONS_SEED_CLOCK = '2026-07-28T12:00:00.000Z';

const atPricingPromotionsSeedOffset = (days: number): string => {
  const instant = new Date(PRICING_PROMOTIONS_SEED_CLOCK);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString();
};

const CLEARANCE_BY_SKU: Readonly<
  Record<string, { priceCents: number; startsAt: string; endsAt: string }>
> = {
  // Active at the seed clock: Lawn Feed is a current clearance lot.
  'GDN-1043-001': {
    priceCents: 24_000,
    startsAt: atPricingPromotionsSeedOffset(-7),
    endsAt: atPricingPromotionsSeedOffset(7),
  },
  // Expired at the seed clock: Carpet Cleaner preserves an historical clearance fixture.
  'HCL-1038-001': {
    priceCents: 7_200,
    startsAt: atPricingPromotionsSeedOffset(-21),
    endsAt: atPricingPromotionsSeedOffset(-1),
  },
  // Future at the seed clock: Rapid-Set Cement exercises upcoming-clearance presentation.
  'TCM-1049-001': {
    priceCents: 12_000,
    startsAt: atPricingPromotionsSeedOffset(1),
    endsAt: atPricingPromotionsSeedOffset(14),
  },
};

/**
 * Canonical trade delivery sites. Ids are fixed so a reset produces byte-identical rows and course
 * material can name a site by id. Exactly one row per user carries `is_default = 1`, which is what
 * the `delivery_sites_user_default_idx` partial unique index enforces.
 *
 * Timestamps are literal ISO instants rather than the column `datetime('now')` default so repeat
 * seeds and resets stay deterministic.
 */
const SEED_DELIVERY_SITES = [
  {
    id: 1,
    user_email: 'alice@example.com',
    label: 'Bakery yard',
    contact_name: 'Alice Fournier',
    contact_phone: '+44 20 7946 0011',
    address_line1: 'Unit 4, Mill Lane Trade Park',
    address_line2: 'Goods entrance B',
    address_city: 'Manchester',
    address_region: 'Greater Manchester',
    address_postcode: 'M15 4QL',
    address_country_code: 'GB',
    is_default: 1,
  },
  {
    id: 2,
    user_email: 'alice@example.com',
    label: 'Depot annexe',
    contact_name: 'Alice Fournier',
    contact_phone: '+44 20 7946 0012',
    address_line1: '18 Quarry Road',
    address_line2: null,
    address_city: 'Salford',
    address_region: 'Greater Manchester',
    address_postcode: 'M5 3TT',
    address_country_code: 'GB',
    is_default: 0,
  },
  {
    id: 3,
    user_email: 'bob@example.com',
    label: 'Store loading bay',
    contact_name: 'Bob Ashby',
    contact_phone: '+44 117 496 0033',
    address_line1: '2 Harbour Way',
    address_line2: 'Rear service road',
    address_city: 'Bristol',
    address_region: null,
    address_postcode: 'BS1 6TP',
    address_country_code: 'GB',
    is_default: 1,
  },
  {
    id: 4,
    user_email: 'bob@example.com',
    label: 'Warehouse north',
    contact_name: 'Bob Ashby',
    contact_phone: null,
    address_line1: '77 Kilnside Estate',
    address_line2: null,
    address_city: 'Gloucester',
    address_region: 'Gloucestershire',
    address_postcode: 'GL1 2AB',
    address_country_code: 'GB',
    is_default: 0,
  },
  {
    id: 5,
    user_email: 'admin@example.com',
    label: 'Head office dock',
    contact_name: 'Ops Desk',
    contact_phone: '+44 20 7946 0099',
    address_line1: '1 Exchange Square',
    address_line2: null,
    address_city: 'London',
    address_region: null,
    address_postcode: 'EC2A 2BB',
    address_country_code: 'GB',
    is_default: 1,
  },
] as const;

/** Canonical billing entities. Same id and default rules as `SEED_DELIVERY_SITES`. */
const SEED_BILLING_ENTITIES = [
  {
    id: 1,
    user_email: 'alice@example.com',
    legal_name: 'Fournier Bakeries Ltd',
    registration_number: '07421188',
    vat_number: 'GB194672301',
    address_line1: 'Unit 4, Mill Lane Trade Park',
    address_line2: null,
    address_city: 'Manchester',
    address_region: 'Greater Manchester',
    address_postcode: 'M15 4QL',
    address_country_code: 'GB',
    is_default: 1,
  },
  {
    id: 2,
    user_email: 'alice@example.com',
    legal_name: 'Fournier Contract Catering Ltd',
    registration_number: '09930741',
    vat_number: null,
    address_line1: '18 Quarry Road',
    address_line2: null,
    address_city: 'Salford',
    address_region: 'Greater Manchester',
    address_postcode: 'M5 3TT',
    address_country_code: 'GB',
    is_default: 0,
  },
  {
    id: 3,
    user_email: 'bob@example.com',
    legal_name: 'Ashby Convenience Stores Ltd',
    registration_number: '05128877',
    vat_number: 'GB288104553',
    address_line1: '2 Harbour Way',
    address_line2: null,
    address_city: 'Bristol',
    address_region: null,
    address_postcode: 'BS1 6TP',
    address_country_code: 'GB',
    is_default: 1,
  },
  {
    id: 4,
    user_email: 'admin@example.com',
    legal_name: 'QArefully Materials Exchange Ltd',
    registration_number: '11002233',
    vat_number: 'GB402118997',
    address_line1: '1 Exchange Square',
    address_line2: null,
    address_city: 'London',
    address_region: null,
    address_postcode: 'EC2A 2BB',
    address_country_code: 'GB',
    is_default: 1,
  },
] as const;

/** Fixed creation instant for every seeded trade-account row. */
const TRADE_ACCOUNT_SEED_INSTANT = '2026-07-01T09:00:00.000Z';

function seededPassword(email: string, country: string, password = 'Password123!'): string {
  const key = `${email}|${country}|${password}` as keyof typeof SEEDED_PASSWORD_HASHES;
  const stored = SEEDED_PASSWORD_HASHES[key];
  if (stored === undefined) {
    throw new Error(`Seed assertion failed: missing credential for ${email} (${country})`);
  }
  return stored;
}

const CANONICAL_PRODUCT_IDS = new Set(
  Array.from({ length: 50 }, (_, i) => i + 1).concat(
    Array.from({ length: 50 }, (_, i) => 1001 + i),
  ),
);

/**
 * Idempotently installs the canonical powder catalogue.
 *
 * Product IDs 1-50 and 1001-1050 are reserved canonical rows and are updated in place.
 * This preserves foreign-key references while leaving rows outside that range and
 * all user-created data untouched. Seed users and promos are
 * insert-only; resetDatabase is the explicit destructive clean-slate path.
 */
export function seedDatabase(db: Database.Database): void {
  validateCatalog();

  const seed = db.transaction(() => {
    const upsertProduct = db.prepare(`
      INSERT INTO products
        (id, name, description, price_cents, category, backorderable, backorder_lead_days, image_set_id, slug, compare_at_price_cents, sales_count, active, created_at, consumption_classification, mixing_group, details_json)
      VALUES
        (@id, @name, @description, @price_cents, @category, @backorderable, @backorder_lead_days, @image_set_id, @slug, @compare_at_price_cents, @sales_count, @active, @created_at, @consumption_classification, @mixing_group, @details_json)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        price_cents = excluded.price_cents,
        category = excluded.category,
        backorderable = excluded.backorderable,
        backorder_lead_days = excluded.backorder_lead_days,
        image_set_id = excluded.image_set_id,
        slug = excluded.slug,
        compare_at_price_cents = excluded.compare_at_price_cents,
        sales_count = excluded.sales_count,
        active = excluded.active,
        created_at = excluded.created_at,
        consumption_classification = excluded.consumption_classification,
        mixing_group = excluded.mixing_group,
        details_json = excluded.details_json
    `);

    const upsertVariant = db.prepare(`
      INSERT INTO product_variants
        (product_id, sku, label, weight_grams, price_cents, compare_at_price_cents, clearance_price_cents, clearance_starts_at, clearance_ends_at, stock_count, backorderable, backorder_lead_days, delivery_class, active, sort_order, moq_sacks, created_at, updated_at)
      VALUES
        (@product_id, @sku, @label, @weight_grams, @price_cents, @compare_at_price_cents, @clearance_price_cents, @clearance_starts_at, @clearance_ends_at, @stock_count, @backorderable, @backorder_lead_days, @delivery_class, @active, @sort_order, @moq_sacks, @created_at, @updated_at)
      ON CONFLICT(sku) DO UPDATE SET
        product_id = excluded.product_id,
        sku = excluded.sku,
        label = excluded.label,
        weight_grams = excluded.weight_grams,
        price_cents = excluded.price_cents,
        compare_at_price_cents = excluded.compare_at_price_cents,
        clearance_price_cents = excluded.clearance_price_cents,
        clearance_starts_at = excluded.clearance_starts_at,
        clearance_ends_at = excluded.clearance_ends_at,
        stock_count = excluded.stock_count,
        backorderable = excluded.backorderable,
        backorder_lead_days = excluded.backorder_lead_days,
        delivery_class = excluded.delivery_class,
        active = excluded.active,
        sort_order = excluded.sort_order,
        moq_sacks = excluded.moq_sacks,
        updated_at = excluded.updated_at
    `);

    const upsertTag = db.prepare(`
      INSERT INTO catalog_tags (key, label)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET label = excluded.label
    `);

    const deleteCanonicalTags = db.prepare(
      `DELETE FROM product_tags WHERE product_id IN (${[...CANONICAL_PRODUCT_IDS].join(',')})`,
    );
    const deleteCanonicalSpecifications = db.prepare(
      `DELETE FROM product_specifications WHERE product_id IN (${[...CANONICAL_PRODUCT_IDS].join(',')})`,
    );
    const deactivateExtraVariants = db.prepare(`
      UPDATE product_variants SET active = 0, updated_at = @updated_at
      WHERE product_id = @product_id AND (sort_order > @max_sort_order OR sort_order < 1)
    `);
    const insertProductTag = db.prepare(
      'INSERT INTO product_tags (product_id, tag_key) VALUES (?, ?)',
    );
    const insertProductSpecification = db.prepare(`
      INSERT INTO product_specifications
        (product_id, specification_key, value_key, display_value, numeric_value)
      VALUES (?, ?, ?, ?, ?)
    `);

    const updateDefaultVariant = db.prepare(
      'UPDATE products SET default_variant_id = ? WHERE id = ?',
    );

    const upsertBundle = db.prepare(`
      INSERT INTO curated_bundles (id, key, name, description, active, sort_order)
      VALUES (@id, @key, @name, @description, @active, @sort_order)
      ON CONFLICT(id) DO UPDATE SET
        key = excluded.key,
        name = excluded.name,
        description = excluded.description,
        active = excluded.active,
        sort_order = excluded.sort_order
    `);
    const deleteBundleComponents = db.prepare(
      'DELETE FROM curated_bundle_components WHERE bundle_id = ?',
    );
    const insertBundleComponent = db.prepare(`
      INSERT INTO curated_bundle_components (bundle_id, variant_id, product_id, quantity, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);

    const variantBySku = db.prepare('SELECT id, product_id FROM product_variants WHERE sku = ?');
    const variantByProductAndSku = db.prepare(
      'SELECT id, product_id FROM product_variants WHERE product_id = ? AND sku = ?',
    );

    deleteCanonicalTags.run();
    deleteCanonicalSpecifications.run();

    const skuToVariant = new Map<string, { id: number; product_id: number }>();

    for (const product of CATALOG_PRODUCTS) {
      const defaultVariant =
        product.variants.find((v) => v.sortOrder === 1 && v.active) ?? product.variants[0];
      const createdAt = product.createdAt;
      const detailsJson = JSON.stringify(product.categoryFacts);

      upsertProduct.run({
        id: product.id,
        name: product.name,
        description: product.description,
        price_cents: defaultVariant?.priceCents ?? 0,
        category: product.category,
        backorderable: defaultVariant?.backorderable ? 1 : 0,
        backorder_lead_days: defaultVariant?.backorderable
          ? (defaultVariant.backorderLeadDays ?? null)
          : null,
        image_set_id: product.imageSetId,
        slug: product.slug,
        compare_at_price_cents: defaultVariant?.compareAtPriceCents ?? null,
        sales_count: 0,
        active: product.visibility === 'public' ? 1 : 0,
        created_at: createdAt,
        consumption_classification: product.consumptionClassification,
        mixing_group: product.mixingGroup ?? null,
        details_json: detailsJson,
      });

      for (const variant of product.variants) {
        const clearance = CLEARANCE_BY_SKU[variant.sku];
        upsertVariant.run({
          product_id: product.id,
          sku: variant.sku,
          label: variant.label,
          weight_grams: variant.weightGrams,
          price_cents: variant.priceCents,
          compare_at_price_cents: variant.compareAtPriceCents ?? null,
          clearance_price_cents: clearance?.priceCents ?? null,
          clearance_starts_at: clearance?.startsAt ?? null,
          clearance_ends_at: clearance?.endsAt ?? null,
          stock_count: variant.stockCount,
          backorderable: variant.backorderable ? 1 : 0,
          backorder_lead_days: variant.backorderable ? (variant.backorderLeadDays ?? null) : null,
          delivery_class: variant.deliveryClass,
          active: variant.active ? 1 : 0,
          sort_order: variant.sortOrder,
          moq_sacks: variant.moqSacks,
          created_at: createdAt,
          updated_at: createdAt,
        });
        const storedVariant = variantByProductAndSku.get(product.id, variant.sku) as
          { id: number; product_id: number } | undefined;
        if (!storedVariant) {
          throw new Error(
            `Seed assertion failed: missing canonical variant ${variant.sku} for product ${product.id}`,
          );
        }
        skuToVariant.set(variant.sku, storedVariant);
      }

      const defaultVariantId = defaultVariant
        ? skuToVariant.get(defaultVariant.sku)?.id
        : undefined;
      if (defaultVariantId) {
        updateDefaultVariant.run(defaultVariantId, product.id);
      }

      deactivateExtraVariants.run({
        product_id: product.id,
        max_sort_order: product.variants.length,
        updated_at: createdAt,
      });

      for (const tag of product.tags) {
        const normalizedKey = tag
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        const label = tag;
        upsertTag.run(normalizedKey, label);
        insertProductTag.run(product.id, normalizedKey);
      }

      for (const specification of catalogProductSpecifications(product)) {
        insertProductSpecification.run(
          product.id,
          specification.key,
          specification.valueKey,
          specification.displayValue,
          specification.numericValue,
        );
      }
    }

    assertProfilesMatchCatalog(db);

    for (const bundle of CURATED_BUNDLES) {
      upsertBundle.run({
        id: bundle.id,
        key: bundle.key,
        name: bundle.name,
        description: bundle.description,
        active: 1,
        sort_order: bundle.sortOrder,
      });
      deleteBundleComponents.run(bundle.id);
      for (const component of bundle.components) {
        const v = variantBySku.get(component.variantSku) as
          { id: number; product_id: number } | undefined;
        if (v) {
          insertBundleComponent.run(
            bundle.id,
            v.id,
            v.product_id,
            component.quantity,
            component.sortOrder,
          );
        }
      }
    }

    const insertPromo = db.prepare(`
      INSERT OR IGNORE INTO promo_codes
        (code, discount_percent, min_item_count, active, kind, amount_cents, min_subtotal_cents, start_at, end_at, max_redemptions, redemption_count, per_user_limit)
      VALUES
        (@code, @discount_percent, @min_item_count, @active, @kind, @amount_cents, @min_subtotal_cents, @start_at, @end_at, @max_redemptions, @redemption_count, @per_user_limit)
    `);
    for (const promo of PROMOS) insertPromo.run(promo);

    insertPromo.run(COUNTRY_TARGETED_PROMO);
    const targetedPromoId = db
      .prepare('SELECT id FROM promo_codes WHERE code = ?')
      .pluck()
      .get(COUNTRY_TARGETED_PROMO.code) as number | undefined;
    if (targetedPromoId === undefined) {
      throw new Error(`Seed assertion failed: missing ${COUNTRY_TARGETED_PROMO.code} promo`);
    }
    const insertPromoCountry = db.prepare(
      'INSERT OR IGNORE INTO promo_code_countries (promo_code_id, country) VALUES (?, ?)',
    );
    for (const country of COUNTRY_TARGETED_PROMO.countries) {
      insertPromoCountry.run(targetedPromoId, country);
    }

    const insertScopedPromo = db.prepare(`
      INSERT OR IGNORE INTO promo_codes
        (code, discount_percent, min_item_count, active, kind, amount_cents, min_subtotal_cents, start_at, end_at, max_redemptions, redemption_count, per_user_limit, category_scope)
      VALUES
        (@code, @discount_percent, @min_item_count, @active, @kind, @amount_cents, @min_subtotal_cents, @start_at, @end_at, @max_redemptions, @redemption_count, @per_user_limit, @category_scope)
    `);
    for (const promo of SCOPED_PROMOS) insertScopedPromo.run(promo);

    const upsertAdminPromo = db.prepare(`
      INSERT INTO promo_codes
        (code, discount_percent, min_item_count, active, kind, amount_cents, min_subtotal_cents, start_at, end_at, max_redemptions, redemption_count, per_user_limit)
      VALUES
        (@code, @discount_percent, @min_item_count, @active, @kind, @amount_cents, @min_subtotal_cents, @start_at, @end_at, @max_redemptions, @redemption_count, @per_user_limit)
      ON CONFLICT(code) DO UPDATE SET
        discount_percent = excluded.discount_percent,
        min_item_count = excluded.min_item_count,
        active = excluded.active,
        kind = excluded.kind,
        amount_cents = excluded.amount_cents,
        min_subtotal_cents = excluded.min_subtotal_cents,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        max_redemptions = excluded.max_redemptions,
        redemption_count = excluded.redemption_count,
        per_user_limit = excluded.per_user_limit
    `);
    upsertAdminPromo.run(ADMIN_DEACTIVATED_PROMO);

    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (id, email, display_name, password_hash, password_salt, role, country)
      VALUES (@id, @email, @display_name, @password_hash, @password_salt, @role, @country)
    `);
    for (const user of USERS) {
      insertUser.run({
        ...user,
        password_hash: seededPassword(user.email, user.country),
        password_salt: '',
      });
    }

    // Alice country fixtures — separate accounts, distinct passwords, independent carts.
    // The primary key is left to AUTOINCREMENT: pinning it collided with whatever row already
    // occupied that id on a database seeded before this branch, and `INSERT OR IGNORE` then
    // silently dropped the fixture. Idempotency keys on the `UNIQUE (email, country)` constraint
    // from migration 032 instead, which is the fixture's real identity. Nothing may assume a
    // fixed id for this row — resolve it by (email, country).
    db.prepare(
      `
      INSERT OR IGNORE INTO users (email, display_name, password_hash, password_salt, role, country)
      VALUES (@email, @display_name, @password_hash, @password_salt, @role, @country)
    `,
    ).run({
      ...DE_ALICE,
      password_hash: seededPassword(DE_ALICE.email, DE_ALICE.country, DE_ALICE_PASSWORD),
      password_salt: '',
    });
    const aliceCountryCarts = [
      { id: '00000000-0000-4000-8000-aa0000000001', country: 'UK' },
      { id: '00000000-0000-4000-8000-de0000000001', country: 'DE' },
    ] as const;
    const insertAliceCart = db.prepare(
      `
      INSERT OR IGNORE INTO carts (id, created_at, updated_at, country)
      VALUES (?, '2026-07-01T09:00:00.000Z', '2026-07-01T09:00:00.000Z', ?)
    `,
    );
    for (const cart of aliceCountryCarts) insertAliceCart.run(cart.id, cart.country);

    seedCompanyAccounts(db);
    seedTradeCredit(db);

    const upsertSuspendedUser = db.prepare(`
      INSERT INTO users
        (email, country, display_name, password_hash, password_salt, role, suspended_at, suspension_reason, suspended_by_user_id)
      VALUES
        (@email, @country, @display_name, @password_hash, @password_salt, @role, @suspended_at, @suspension_reason, @suspended_by_user_id)
      ON CONFLICT(email, country) DO UPDATE SET
        display_name = excluded.display_name,
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        role = excluded.role,
        suspended_at = excluded.suspended_at,
        suspension_reason = excluded.suspension_reason,
        suspended_by_user_id = excluded.suspended_by_user_id
    `);
    upsertSuspendedUser.run({
      ...ADMIN_SUSPENDED_USER,
      password_hash: seededPassword(ADMIN_SUSPENDED_USER.email, ADMIN_SUSPENDED_USER.country),
      password_salt: '',
      suspended_by_user_id: null,
    });

    const upsertFeatureFlag = db.prepare(`
      INSERT INTO feature_flags (key, description, enabled, updated_at, updated_by_user_id)
      VALUES (@key, @description, @enabled, '2026-07-28T12:00:00.000Z', ?)
      ON CONFLICT(key) DO UPDATE SET
        description = excluded.description,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at,
        updated_by_user_id = excluded.updated_by_user_id
    `);
    upsertFeatureFlag.run(ADMIN_FEATURE_FLAG, null);

    // Trade-account records are insert-only on a fixed id, so a buyer who renames, retires, or
    // re-points the default of a seeded row keeps that change across later `npm run seed` calls.
    // `resetDatabase` clears `users`, and both tables cascade from it, so reset restores these rows.
    const userIdByEmail = db
      .prepare('SELECT id FROM users WHERE email = ? AND country = ?')
      .pluck();

    const insertDeliverySite = db.prepare(`
      INSERT OR IGNORE INTO delivery_sites
        (id, user_id, label, contact_name, contact_phone,
         address_line1, address_line2, address_city, address_region, address_postcode,
         address_country_code, is_default, active, created_at, updated_at)
      VALUES
        (@id, @user_id, @label, @contact_name, @contact_phone,
         @address_line1, @address_line2, @address_city, @address_region, @address_postcode,
         @address_country_code, @is_default, 1, @created_at, @updated_at)
    `);
    for (const site of SEED_DELIVERY_SITES) {
      const userId = userIdByEmail.get(site.user_email, LEGACY_DATA_COUNTRY) as number | undefined;
      if (userId === undefined) continue;
      insertDeliverySite.run({
        id: site.id,
        user_id: userId,
        label: site.label,
        contact_name: site.contact_name,
        contact_phone: site.contact_phone,
        address_line1: site.address_line1,
        address_line2: site.address_line2,
        address_city: site.address_city,
        address_region: site.address_region,
        address_postcode: site.address_postcode,
        address_country_code: site.address_country_code,
        is_default: site.is_default,
        created_at: TRADE_ACCOUNT_SEED_INSTANT,
        updated_at: TRADE_ACCOUNT_SEED_INSTANT,
      });
    }

    const insertBillingEntity = db.prepare(`
      INSERT OR IGNORE INTO billing_entities
        (id, user_id, legal_name, registration_number, vat_number,
         address_line1, address_line2, address_city, address_region, address_postcode,
         address_country_code, is_default, active, created_at, updated_at)
      VALUES
        (@id, @user_id, @legal_name, @registration_number, @vat_number,
         @address_line1, @address_line2, @address_city, @address_region, @address_postcode,
         @address_country_code, @is_default, 1, @created_at, @updated_at)
    `);
    for (const entity of SEED_BILLING_ENTITIES) {
      const userId = userIdByEmail.get(entity.user_email, LEGACY_DATA_COUNTRY) as
        number | undefined;
      if (userId === undefined) continue;
      insertBillingEntity.run({
        id: entity.id,
        user_id: userId,
        legal_name: entity.legal_name,
        registration_number: entity.registration_number,
        vat_number: entity.vat_number,
        address_line1: entity.address_line1,
        address_line2: entity.address_line2,
        address_city: entity.address_city,
        address_region: entity.address_region,
        address_postcode: entity.address_postcode,
        address_country_code: entity.address_country_code,
        is_default: entity.is_default,
        created_at: TRADE_ACCOUNT_SEED_INSTANT,
        updated_at: TRADE_ACCOUNT_SEED_INSTANT,
      });
    }

    const canonicalCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM products WHERE id IN (${[...CANONICAL_PRODUCT_IDS].join(',')})`,
        )
        .get() as { count: number }
    ).count;
    if (canonicalCount < CATALOG_PRODUCTS.length) {
      throw new Error(
        `Seed assertion failed: expected at least ${CATALOG_PRODUCTS.length} canonical powder products, got ${canonicalCount}`,
      );
    }

    const canonicalBundleCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM curated_bundles
           WHERE id IN (${CURATED_BUNDLES.map(() => '?').join(', ')})`,
        )
        .get(...CURATED_BUNDLES.map((bundle) => bundle.id)) as { count: number }
    ).count;
    if (canonicalBundleCount !== CURATED_BUNDLES.length) {
      throw new Error(
        `Seed assertion failed: expected ${CURATED_BUNDLES.length} canonical curated bundles, got ${canonicalBundleCount}`,
      );
    }

    seedOrderScenarios(db);
    seedSavedLists(db);
    seedAsyncScenarios(db);
    seedBackInStock(db);
    seedReviewScenarios(db);
  });

  seed();
}
