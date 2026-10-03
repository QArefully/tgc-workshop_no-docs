import { defineMessages, type CountryMessageSet } from './defineMessages.js';

/**
 * Buyer-facing copy for discovery surfaces. Product names, categories, SKU labels, and
 * specification values come from the catalogue and stay verbatim; only shop-owned UI copy lives
 * here.
 */
const text = (
  UK: string,
  DE: string,
  overrides: Partial<Record<'US' | 'CN' | 'PL' | 'ES' | 'FR', string>> = {},
): CountryMessageSet => ({
  UK,
  US: overrides.US ?? UK,
  CN: overrides.CN ?? UK,
  PL: overrides.PL ?? UK,
  ES: overrides.ES ?? UK,
  DE,
  FR: overrides.FR ?? UK,
});

const plural = (
  UK: { one: string; other: string },
  DE: { one: string; other: string },
  overrides: Partial<
    Record<'US' | 'CN' | 'PL' | 'ES' | 'FR', { one?: string; other: string }>
  > = {},
): CountryMessageSet => ({
  UK,
  US: overrides.US ?? UK,
  CN: overrides.CN ?? { other: UK.other },
  PL: overrides.PL ?? UK,
  ES: overrides.ES ?? UK,
  DE,
  FR: overrides.FR ?? UK,
});

export const discoveryMessages = defineMessages({
  // Catalog page and controls.
  'catalog.eyebrow': text('The materials catalogue', 'Der Materialkatalog'),
  'catalog.title': text('All materials', 'Alle Materialien'),
  'catalog.searchTitle': text(
    'Material search results: {query}',
    'Suchergebnisse für Materialien: {query}',
  ),
  'catalog.description': text(
    'All materials are clearly labelled for bulk and pallet order.',
    'Alle Materialien sind für Groß- und Palettenbestellungen klar gekennzeichnet.',
  ),
  'catalog.materialCount': plural(
    { one: '{displayCount} material', other: '{displayCount} materials' },
    { one: '{displayCount} Material', other: '{displayCount} Materialien' },
  ),
  'catalog.noMaterials': text(
    'No materials match those filters',
    'Keine Materialien entsprechen diesen Filtern',
  ),
  'catalog.noMaterialsDescription': text(
    'Try another material, category, or return to the full catalogue.',
    'Versuchen Sie ein anderes Material oder eine Kategorie, oder öffnen Sie den vollständigen Katalog.',
  ),
  'catalog.browseAll': text('Browse all materials', 'Alle Materialien ansehen'),
  'catalog.showing': text(
    'Showing {start}–{end} of {total}',
    '{start}–{end} von {total} angezeigt',
  ),
  'catalog.updating': text('Updating results…', 'Ergebnisse werden aktualisiert…'),
  'catalog.pagination': text('Catalog pagination', 'Katalogseiten'),
  'catalog.previous': text('Previous', 'Zurück'),
  'catalog.next': text('Next', 'Weiter'),
  'catalog.pageOf': text('Page {page} of {totalPages}', 'Seite {page} von {totalPages}'),
  'catalog.perPage': text('Per page', 'Pro Seite'),
  'catalog.searchLabel': text('Search materials', 'Materialien suchen'),
  'catalog.searchPlaceholder': text(
    'Search protein, campfire, water…',
    'Protein, Grillbedarf, Wasser suchen…',
  ),
  'catalog.sort': text('Sort', 'Sortieren'),
  'catalog.sort.newest': text('Newest', 'Neueste'),
  'catalog.sort.oldest': text('Oldest', 'Älteste'),
  'catalog.sort.nameAsc': text('Name: A to Z', 'Name: A bis Z'),
  'catalog.sort.priceAsc': text('Price: Low to High', 'Preis: aufsteigend'),
  'catalog.sort.priceDesc': text('Price: High to Low', 'Preis: absteigend'),
  'catalog.sort.bestselling': text('Best Selling', 'Bestseller'),
  'catalog.filters': text('Filters', 'Filter'),
  'catalog.filtersAria': text('Catalog filters', 'Katalogfilter'),
  'catalog.clearAll': text('Clear all', 'Alle löschen'),
  'catalog.materialType': text('Material type', 'Materialtyp'),
  'catalog.allMaterials': text('All materials', 'Alle Materialien'),
  'catalog.offers': text('Offers', 'Angebote'),
  'catalog.onSale': text('On sale now', 'Jetzt im Angebot'),
  'catalog.price': text('Price', 'Preis'),
  'catalog.minimumCents': text('Minimum (cents)', 'Minimum (Cent)'),
  'catalog.maximumCents': text('Maximum (cents)', 'Maximum (Cent)'),
  'catalog.dateAdded': text('Date added', 'Hinzugefügt am'),
  'catalog.from': text('From', 'Von'),
  'catalog.to': text('To', 'Bis'),
  'catalog.availability': text('Availability', 'Verfügbarkeit'),
  'catalog.allAvailability': text('All availability', 'Alle Verfügbarkeiten'),
  'catalog.inStock': text('In stock', 'Auf Lager'),
  'catalog.backorder': text('Backorder available', 'Nachbestellung möglich'),
  'catalog.outOfStock': text('Out of stock', 'Nicht auf Lager'),
  'catalog.tags': text('Tags', 'Tags'),
  'catalog.loadingMoreFilters': text('Loading more filters…', 'Weitere Filter werden geladen…'),
  'catalog.moreFiltersUnavailable': text(
    'More filters are unavailable.',
    'Weitere Filter sind nicht verfügbar.',
  ),
  'catalog.any': text('Any {label}', 'Beliebig: {label}'),
  'catalog.activeFilters': text('Active filters', 'Aktive Filter'),
  'catalog.searchFilter': text('Search: {query}', 'Suche: {query}'),
  'catalog.typeFilter': text('Type: {category}', 'Typ: {category}'),
  'catalog.minimumFilter': text('Minimum price: {value} cents', 'Mindestpreis: {value} Cent'),
  'catalog.maximumFilter': text('Maximum price: {value} cents', 'Höchstpreis: {value} Cent'),
  'catalog.addedFromFilter': text('Added from: {date}', 'Hinzugefügt ab: {date}'),
  'catalog.addedToFilter': text('Added to: {date}', 'Hinzugefügt bis: {date}'),
  'catalog.tagFilter': text('Tag: {tag}', 'Tag: {tag}'),
  'catalog.specificationFilter': text(
    'Specification: {specification}',
    'Spezifikation: {specification}',
  ),
  'catalog.removeFilter': text('Remove {label} filter', 'Filter „{label}“ entfernen'),
  'catalog.loadingMaterials': text('Loading materials', 'Materialien werden geladen'),
  'catalog.retryCart': text('Retry cart', 'Warenkorb erneut versuchen'),

  // Product cards and shared product-grid controls.
  'product.material': text('Material', 'Material'),
  'product.pack': text('Pack: {pack}', 'Packung: {pack}'),
  'product.from': text('From {price}', 'Ab {price}'),
  'product.options': plural(
    { one: '{displayCount} option', other: '{displayCount} options' },
    { one: '{displayCount} Option', other: '{displayCount} Optionen' },
  ),
  'product.clearance': text('Clearance', 'Ausverkauf'),
  'product.sale': text('Sale', 'Angebot'),
  'product.bestseller': text('Bestseller', 'Bestseller'),
  'product.food': text('Food', 'Lebensmittel'),
  'product.notForConsumption': text('Not for consumption', 'Nicht zum Verzehr geeignet'),
  'product.caution': text('Caution', 'Vorsicht'),
  'product.backorderAvailable': text('Available to backorder', 'Nachbestellung möglich'),
  'product.onlyLeft': plural(
    { one: 'Only {displayCount} left', other: 'Only {displayCount} left' },
    { one: 'Nur noch {displayCount} verfügbar', other: 'Nur noch {displayCount} verfügbar' },
  ),
  'product.cartUnavailable': text('Cart unavailable', 'Warenkorb nicht verfügbar'),
  'product.adding': text('Adding...', 'Wird hinzugefügt…'),
  'product.addToOrder': text('Add to order', 'Zur Bestellung hinzufügen'),
  'product.unavailable': text('Unavailable', 'Nicht verfügbar'),
  'product.outOfStock': text('Out of stock', 'Nicht auf Lager'),
  'product.addError': text(
    'Could not add this item. Try again.',
    'Artikel konnte nicht hinzugefügt werden. Versuchen Sie es erneut.',
  ),
  'product.compare': text('Compare', 'Vergleichen'),
  'product.compareProduct': text('Compare product', 'Material vergleichen'),
  'product.compareNamed': text('Compare {name}', '{name} vergleichen'),
  'product.selectedForComparison': text('Selected for comparison', 'Für Vergleich ausgewählt'),
  'product.vessel.kraftSack': text('stitched kraft sack', 'genähter Kraftsack'),
  'product.vessel.wovenSack': text('woven sack', 'Gewebesack'),
  'product.vessel.keg': text('keg', 'Fass'),
  'product.vessel.foodBag': text('bag', 'Beutel'),
  'product.packagingUnavailable': text('PACKAGING UNAVAILABLE', 'VERPACKUNG NICHT VERFÜGBAR'),

  // Bundles and home bundle promotion.
  'bundle.eyebrow': text('Curated bundles', 'Zusammengestellte Pakete'),
  'bundle.title': text('Bundle sets', 'Paketsets'),
  'bundle.description': text(
    'Fixed selections of materials, with current prices and availability shown here.',
    'Feste Materialauswahlen mit aktuellen Preisen und Verfügbarkeit.',
  ),
  'bundle.tryAgain': text('Try again', 'Erneut versuchen'),
  'bundle.empty': text(
    'No bundles are available right now.',
    'Derzeit sind keine Pakete verfügbar.',
  ),
  'bundle.components': text('{name} components', 'Bestandteile von {name}'),
  'bundle.sku': text('SKU: {sku}', 'SKU: {sku}'),
  'bundle.adding': text('Adding…', 'Wird hinzugefügt…'),
  'bundle.add': text('Add bundle', 'Paket hinzufügen'),
  'bundle.unavailable': text(
    'This bundle is currently unavailable.',
    'Dieses Paket ist derzeit nicht verfügbar.',
  ),
  'bundle.cartNotReady': text('Cart is not ready yet.', 'Der Warenkorb ist noch nicht bereit.'),
  'bundle.loadError': text('Failed to load bundles', 'Pakete konnten nicht geladen werden'),
  'bundle.addingToCart': text('Adding {name} to cart', '{name} wird zum Warenkorb hinzugefügt'),
  'bundle.bannerLabel': text(
    'Bundle sets: browse curated bundles',
    'Paketsets: zusammengestellte Pakete ansehen',
  ),
  'bundle.bannerEyebrow': text('Curated bundles', 'Zusammengestellte Pakete'),
  'bundle.bannerTitle': text(
    'Order a whole set, save 10%.',
    'Bestellen Sie ein ganzes Set und sparen Sie 10 %.',
  ),
  'bundle.bannerDescription': text(
    'Ready-made material sets for common jobs — every line priced, stocked and added to your cart in one click.',
    'Fertige Materialsets für häufige Aufgaben – jede Position bepreist, vorrätig und mit einem Klick im Warenkorb.',
  ),
  'bundle.bannerBrowse': text('Browse bundles', 'Pakete ansehen'),
  'bundle.bannerMaterials': plural(
    { one: '{displayCount} material', other: '{displayCount} materials' },
    { one: '{displayCount} Material', other: '{displayCount} Materialien' },
  ),
  'bundle.stack.baking': text('Baking Essentials', 'Back-Grundausstattung'),
  'bundle.stack.garden': text('Garden Care Kit', 'Gartenpflege-Set'),
  'bundle.stack.cleaning': text('Cleaning Supplies Bundle', 'Reinigungsmittel-Paket'),

  // Home discovery banners and calls to action.
  'home.heroLabel': text(
    'QArefully Materials Exchange / Supply desk',
    'QArefully Materials Exchange / Versorgung',
  ),
  'home.heroTitle': text(
    'Materials supply with operational clarity.',
    'Materialversorgung mit operativer Klarheit.',
  ),
  'home.heroDescription': text(
    'Source materials across food, performance, home and trade with clear specifications, practical pack formats and dependable availability data.',
    'Beschaffen Sie Materialien für Lebensmittel, Leistung, Haushalt und Gewerbe mit klaren Spezifikationen, praktischen Packformaten und verlässlichen Verfügbarkeitsdaten.',
  ),
  'home.heroOverview': text(
    'Materials exchange supply overview',
    'Versorgungsübersicht des Materialhandels',
  ),
  'home.browseMaterials': text('Browse materials', 'Materialien ansehen'),
  'home.promoEyebrow': text('Bag-count promotion', 'Sackaktion'),
  'home.promoTitle': text('Save 10% when you bag five.', '10 % sparen bei fünf Säcken.'),
  'home.promoDescription': text(
    'Use code SAVE10 on five or more bags. Simulated checkout; very real maths.',
    'Verwenden Sie den Code SAVE10 für fünf oder mehr Säcke. Simulierter Checkout, echte Berechnung.',
  ),
  'home.promoCta': text('Shop the offer', 'Angebot ansehen'),
  'home.customLabel': text('Custom Blend', 'Individuelle Mischung'),
  'home.customAria': text(
    'Custom Blend: configure your blend',
    'Individuelle Mischung: Mischung konfigurieren',
  ),
  'home.customTitle': text(
    'Build material to your spec.',
    'Material nach Ihrer Spezifikation erstellen.',
  ),
  'home.customDescription': text(
    'Start with a proven base lot, then define an exact made-to-order blend for your next run.',
    'Beginnen Sie mit einer bewährten Basischarge und definieren Sie dann eine maßgefertigte Mischung für Ihren nächsten Lauf.',
  ),
  'home.customCta': text('Configure your blend', 'Mischung konfigurieren'),
  'home.categoryLoading': text('Loading categories', 'Kategorien werden geladen'),
  'home.browseCatalog': text('Browse the catalog', 'Katalog ansehen'),
  'home.noProducts': text(
    'No products are available in this collection yet.',
    'In dieser Sammlung sind noch keine Materialien verfügbar.',
  ),
  'home.bundleSetsAria': text(
    'Bundle sets: browse curated bundles',
    'Paketsets: zusammengestellte Pakete ansehen',
  ),

  // Comparison surfaces.
  'comparison.eyebrow': text('Side by side', 'Direktvergleich'),
  'comparison.title': text('Compare materials', 'Materialien vergleichen'),
  'comparison.description': text(
    'Compare price, availability, and ingredient facts in one place.',
    'Vergleichen Sie Preis, Verfügbarkeit und Produktdaten an einem Ort.',
  ),
  'comparison.loading': text('Loading comparison…', 'Vergleich wird geladen…'),
  'comparison.loadError': text(
    'Unable to load comparison',
    'Vergleich konnte nicht geladen werden',
  ),
  'comparison.tryAgain': text('Try again', 'Erneut versuchen'),
  'comparison.invalidTitle': text(
    'That comparison link is invalid',
    'Dieser Vergleichslink ist ungültig',
  ),
  'comparison.invalidDetail': text(
    'Choose two to four distinct products to compare.',
    'Wählen Sie zwei bis vier verschiedene Materialien zum Vergleichen.',
  ),
  'comparison.missingTitle': text(
    'Choose products to compare',
    'Materialien zum Vergleichen auswählen',
  ),
  'comparison.missingDetail': text(
    'Open a comparison link with two to four product IDs, or browse the catalogue.',
    'Öffnen Sie einen Vergleichslink mit zwei bis vier IDs oder durchsuchen Sie den Katalog.',
  ),
  'comparison.unavailableTitle': text(
    'Some products are unavailable for comparison',
    'Einige Materialien sind für den Vergleich nicht verfügbar',
  ),
  'comparison.inactive': text(
    'Product {id} is no longer active.',
    'Material {id} ist nicht mehr aktiv.',
  ),
  'comparison.missing': text(
    'Product {id} is not available.',
    'Material {id} ist nicht verfügbar.',
  ),
  'comparison.notEnoughTitle': text(
    'Not enough active products to compare',
    'Nicht genügend aktive Materialien zum Vergleichen',
  ),
  'comparison.notEnoughDetail': text(
    'Try a link with at least two currently available materials.',
    'Versuchen Sie einen Link mit mindestens zwei verfügbaren Materialien.',
  ),
  'comparison.browse': text('Browse materials', 'Materialien ansehen'),
  'comparison.tableCaption': text(
    'Product specifications comparison',
    'Vergleich der Materialspezifikationen',
  ),
  'comparison.specification': text('Specification', 'Spezifikation'),
  'comparison.price': text('Price', 'Preis'),
  'comparison.category': text('Category', 'Kategorie'),
  'comparison.availability': text('Availability', 'Verfügbarkeit'),
  'comparison.classification': text('Classification', 'Klassifizierung'),
  'comparison.available': text('Available', 'Verfügbar'),
  'comparison.backorder': text('Backorder', 'Nachbestellung'),
  'comparison.outOfStock': text('Out of stock', 'Nicht auf Lager'),
  'comparison.notSpecified': text('Not specified', 'Nicht angegeben'),
  'comparison.remove': text('Remove {name}', '{name} entfernen'),
  'comparison.trayLabel': text('Comparison tray', 'Vergleichsleiste'),
  'comparison.selected': plural(
    {
      one: '{displayCount} product selected for comparison',
      other: '{displayCount} products selected for comparison',
    },
    {
      one: '{displayCount} Material für Vergleich ausgewählt',
      other: '{displayCount} Materialien für Vergleich ausgewählt',
    },
  ),
  'comparison.compareSelected': text('Compare selected', 'Auswahl vergleichen'),
  'comparison.clearSelection': text('Clear selection', 'Auswahl löschen'),
  'comparison.capacity': text(
    'You can compare up to 4 products.',
    'Sie können bis zu 4 Materialien vergleichen.',
  ),
});

export const DISCOVERY_MESSAGES = discoveryMessages;
export type DiscoveryMessageKey = keyof typeof discoveryMessages;
