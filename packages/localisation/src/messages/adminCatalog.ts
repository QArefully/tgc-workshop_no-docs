import type { Country } from '@shop/contracts/country';
import { apiErrors } from './apiErrors.js';
import { defineMessages, type CountryMessageSet } from './defineMessages.js';
import { translateUnchecked, type MessageParams } from '../translate.js';

/** Shop-authored copy for product, lot, and promotion administration. */
const text = (
  UK: string,
  DE: string,
  overrides: Readonly<Partial<Record<'US', string>> & Record<'CN' | 'PL' | 'ES' | 'FR', string>>,
): CountryMessageSet => ({
  UK,
  US: overrides.US ?? UK,
  CN: overrides.CN,
  PL: overrides.PL,
  ES: overrides.ES,
  DE,
  FR: overrides.FR,
});

export const adminCatalogMessages = defineMessages({
  // Shared controls and request states.
  'adminCatalog.save': text('Save', 'Speichern', {
    CN: '保存',
    PL: 'Zapisz',
    ES: 'Guardar',
    FR: 'Enregistrer',
  }),
  'adminCatalog.saving': text('Saving…', 'Wird gespeichert…', {
    CN: '正在保存…',
    PL: 'Zapisywanie…',
    ES: 'Guardando…',
    FR: 'Enregistrement…',
  }),
  'adminCatalog.cancel': text('Cancel', 'Abbrechen', {
    CN: '取消',
    PL: 'Anuluj',
    ES: 'Cancelar',
    FR: 'Annuler',
  }),
  'adminCatalog.confirmRetire': text('Confirm retire', 'Ausmustern bestätigen', {
    CN: '确认退役',
    PL: 'Potwierdź wycofanie',
    ES: 'Confirmar retirada',
    FR: 'Confirmer le retrait',
  }),
  'adminCatalog.confirmRetirement': text(
    'Confirm retirement of this lot.',
    'Bestätigen Sie die Ausmusterung dieser Charge.',
    {
      CN: '确认退役此批次。',
      PL: 'Potwierdź wycofanie tej partii.',
      ES: 'Confirma la retirada de este lote.',
      FR: 'Confirmez le retrait de ce lot.',
    },
  ),
  'adminCatalog.requestFailed': text('Request failed.', 'Anfrage fehlgeschlagen.', {
    CN: '请求失败。',
    PL: 'Żądanie nie powiodło się.',
    ES: 'La solicitud ha fallado.',
    FR: 'Échec de la requête.',
  }),
  'adminCatalog.clearanceDatesRequired': text(
    'Clearance start and end dates are required.',
    'Start- und Enddatum des Abverkaufs sind erforderlich.',
    {
      CN: '需要填写清仓开始和结束日期。',
      PL: 'Wymagane są daty rozpoczęcia i zakończenia wyprzedaży.',
      ES: 'Se requieren las fechas de inicio y fin de liquidación.',
      FR: 'Les dates de début et de fin du déstockage sont obligatoires.',
    },
  ),

  // Product catalogue administration.
  'adminCatalog.products.heading': text('Products', 'Produkte', {
    CN: '产品',
    PL: 'Produkty',
    ES: 'Productos',
    FR: 'Produits',
  }),
  'adminCatalog.products.description': text(
    'Create, edit, and retire catalogue products.',
    'Katalogprodukte erstellen, bearbeiten und ausmustern.',
    {
      CN: '创建、编辑并退役目录产品。',
      PL: 'Twórz, edytuj i wycofuj produkty katalogowe.',
      ES: 'Crea, edita y retira productos del catálogo.',
      FR: 'Créez, modifiez et retirez des produits du catalogue.',
    },
  ),
  'adminCatalog.products.includeRetired': text('Include retired', 'Ausgemusterte einschließen', {
    CN: '包括已退役',
    PL: 'Uwzględnij wycofane',
    ES: 'Incluir retirados',
    FR: 'Inclure les produits retirés',
  }),
  'adminCatalog.products.new': text('New product', 'Neues Produkt', {
    CN: '新建产品',
    PL: 'Nowy produkt',
    ES: 'Nuevo producto',
    FR: 'Nouveau produit',
  }),
  'adminCatalog.products.edit': text('Edit {name}', '{name} bearbeiten', {
    CN: '编辑 {name}',
    PL: 'Edytuj {name}',
    ES: 'Editar {name}',
    FR: 'Modifier {name}',
  }),
  'adminCatalog.products.name': text('Name', 'Name', {
    CN: '名称',
    PL: 'Nazwa',
    ES: 'Nombre',
    FR: 'Nom',
  }),
  'adminCatalog.products.descriptionLabel': text('Description', 'Beschreibung', {
    CN: '描述',
    PL: 'Opis',
    ES: 'Descripción',
    FR: 'Description',
  }),
  'adminCatalog.products.pricePence': text('Price (GBP pence)', 'Preis (GBP-Pence)', {
    CN: '价格（GBP 便士）',
    PL: 'Cena (pensy GBP)',
    ES: 'Precio (peniques GBP)',
    FR: 'Prix (pence GBP)',
  }),
  'adminCatalog.products.stock': text('Stock', 'Bestand', {
    CN: '库存',
    PL: 'Stan magazynowy',
    ES: 'Existencias',
    FR: 'Stock',
  }),
  'adminCatalog.products.slug': text('Slug', 'Slug', {
    CN: 'Slug',
    PL: 'Slug',
    ES: 'Slug',
    FR: 'Slug',
  }),
  'adminCatalog.products.category': text('Category', 'Kategorie', {
    CN: '类别',
    PL: 'Kategoria',
    ES: 'Categoría',
    FR: 'Catégorie',
  }),
  'adminCatalog.products.classification': text('Classification', 'Klassifizierung', {
    CN: '分类',
    PL: 'Klasyfikacja',
    ES: 'Clasificación',
    FR: 'Classification',
  }),
  'adminCatalog.products.mixingGroup': text('Mixing group', 'Mischgruppe', {
    CN: '混合组',
    PL: 'Grupa mieszania',
    ES: 'Grupo de mezcla',
    FR: 'Groupe de mélange',
  }),
  'adminCatalog.products.none': text('None', 'Keine', {
    CN: '无',
    PL: 'Brak',
    ES: 'Ninguno',
    FR: 'Aucun',
  }),
  'adminCatalog.products.active': text('Active', 'Aktiv', {
    CN: '启用',
    PL: 'Aktywny',
    ES: 'Activo',
    FR: 'Actif',
  }),
  'adminCatalog.products.retired': text('Retired', 'Ausgemustert', {
    CN: '已退役',
    PL: 'Wycofany',
    ES: 'Retirado',
    FR: 'Retiré',
  }),
  'adminCatalog.products.empty': text('No products found.', 'Keine Produkte gefunden.', {
    CN: '未找到产品。',
    PL: 'Nie znaleziono produktów.',
    ES: 'No se encontraron productos.',
    FR: 'Aucun produit trouvé.',
  }),
  'adminCatalog.products.save': text('Save product', 'Produkt speichern', {
    CN: '保存产品',
    PL: 'Zapisz produkt',
    ES: 'Guardar producto',
    FR: 'Enregistrer le produit',
  }),
  'adminCatalog.products.retire': text('Retire product', 'Produkt ausmustern', {
    CN: '退役产品',
    PL: 'Wycofaj produkt',
    ES: 'Retirar producto',
    FR: 'Retirer le produit',
  }),
  'adminCatalog.products.retiringNotice': text(
    'Retiring hides this product. Confirm to continue.',
    'Das Ausmustern blendet dieses Produkt aus. Bestätigen Sie, um fortzufahren.',
    {
      CN: '退役会隐藏此产品。确认继续。',
      PL: 'Wycofanie ukryje ten produkt. Potwierdź, aby kontynuować.',
      ES: 'Retirar oculta este producto. Confirma para continuar.',
      FR: 'Le retrait masquera ce produit. Confirmez pour continuer.',
    },
  ),

  // Variant/lot administration.
  'adminCatalog.lots.heading': text('Variants and lots', 'Varianten und Chargen', {
    CN: '变体和批次',
    PL: 'Warianty i partie',
    ES: 'Variantes y lotes',
    FR: 'Variantes et lots',
  }),
  'adminCatalog.lots.description': text(
    'Manage purchasable lots and their clearance schedules.',
    'Kaufbare Chargen und ihre Abverkaufszeiträume verwalten.',
    {
      CN: '管理可购买批次及其清仓计划。',
      PL: 'Zarządzaj dostępnymi partiami i harmonogramami wyprzedaży.',
      ES: 'Gestiona los lotes comprables y sus periodos de liquidación.',
      FR: 'Gérez les lots achetables et leurs périodes de déstockage.',
    },
  ),
  'adminCatalog.lots.productId': text('Product ID', 'Produkt-ID', {
    CN: '产品 ID',
    PL: 'Identyfikator produktu',
    ES: 'ID del producto',
    FR: 'ID produit',
  }),
  'adminCatalog.lots.new': text('New lot', 'Neue Charge', {
    CN: '新建批次',
    PL: 'Nowa partia',
    ES: 'Nuevo lote',
    FR: 'Nouveau lot',
  }),
  'adminCatalog.lots.edit': text('Edit {name}', '{name} bearbeiten', {
    CN: '编辑 {name}',
    PL: 'Edytuj {name}',
    ES: 'Editar {name}',
    FR: 'Modifier {name}',
  }),
  'adminCatalog.lots.empty': text('No lots found.', 'Keine Chargen gefunden.', {
    CN: '未找到批次。',
    PL: 'Nie znaleziono partii.',
    ES: 'No se encontraron lotes.',
    FR: 'Aucun lot trouvé.',
  }),
  'adminCatalog.lots.sku': text('SKU', 'SKU', { CN: 'SKU', PL: 'SKU', ES: 'SKU', FR: 'SKU' }),
  'adminCatalog.lots.label': text('Label', 'Bezeichnung', {
    CN: '标签',
    PL: 'Etykieta',
    ES: 'Etiqueta',
    FR: 'Libellé',
  }),
  'adminCatalog.lots.lotLabelAria': text('Lot label', 'Chargenbezeichnung', {
    CN: '批次标签',
    PL: 'Etykieta partii',
    ES: 'Etiqueta del lote',
    FR: 'Libellé du lot',
  }),
  'adminCatalog.lots.weightGrams': text('Weight (g)', 'Gewicht (g)', {
    CN: '重量（g）',
    PL: 'Masa (g)',
    ES: 'Peso (g)',
    FR: 'Poids (g)',
  }),
  'adminCatalog.lots.pricePence': text('Price (GBP pence)', 'Preis (GBP-Pence)', {
    CN: '价格（GBP 便士）',
    PL: 'Cena (pensy GBP)',
    ES: 'Precio (peniques GBP)',
    FR: 'Prix (pence GBP)',
  }),
  'adminCatalog.lots.stock': text('Stock', 'Bestand', {
    CN: '库存',
    PL: 'Stan magazynowy',
    ES: 'Existencias',
    FR: 'Stock',
  }),
  'adminCatalog.lots.moqSacks': text('MOQ sacks', 'Mindestmenge Säcke', {
    CN: '最低袋数',
    PL: 'Minimalna liczba worków',
    ES: 'Sacos mínimos',
    FR: 'Sacs minimum',
  }),
  'adminCatalog.lots.sortOrder': text('Sort order', 'Sortierreihenfolge', {
    CN: '排序顺序',
    PL: 'Kolejność sortowania',
    ES: 'Orden de clasificación',
    FR: 'Ordre de tri',
  }),
  'adminCatalog.lots.backorderable': text('Backorderable', 'Nachbestellbar', {
    CN: '可延期订购',
    PL: 'Dostępne w zamówieniu oczekującym',
    ES: 'Disponible para pedido pendiente',
    FR: 'Disponible en reliquat',
  }),
  'adminCatalog.lots.backorderLeadDays': text('Backorder lead days', 'Nachbestellfrist (Tage)', {
    CN: '延期交付天数',
    PL: 'Dni oczekiwania na dostawę',
    ES: 'Días de preparación del pedido pendiente',
    FR: 'Délai de réapprovisionnement (jours)',
  }),
  'adminCatalog.lots.deliveryClass': text('Delivery class', 'Lieferklasse', {
    CN: '配送类别',
    PL: 'Klasa dostawy',
    ES: 'Clase de entrega',
    FR: 'Classe de livraison',
  }),
  'adminCatalog.lots.freight': text('Freight', 'Fracht', {
    CN: '货运',
    PL: 'Transport',
    ES: 'Carga',
    FR: 'Fret',
  }),
  'adminCatalog.lots.parcel': text('Parcel', 'Paket', {
    CN: '包裹',
    PL: 'Przesyłka paczkowa',
    ES: 'Paquete',
    FR: 'Colis',
  }),
  'adminCatalog.lots.save': text('Save lot', 'Charge speichern', {
    CN: '保存批次',
    PL: 'Zapisz partię',
    ES: 'Guardar lote',
    FR: 'Enregistrer le lot',
  }),
  'adminCatalog.lots.clearance': text('Clearance', 'Abverkauf', {
    CN: '清仓',
    PL: 'Wyprzedaż',
    ES: 'Liquidación',
    FR: 'Déstockage',
  }),
  'adminCatalog.lots.enableClearance': text('Enable clearance', 'Abverkauf aktivieren', {
    CN: '启用清仓',
    PL: 'Włącz wyprzedaż',
    ES: 'Activar liquidación',
    FR: 'Activer le déstockage',
  }),
  'adminCatalog.lots.clearancePricePence': text(
    'Clearance price (GBP pence)',
    'Abverkaufspreis (GBP-Pence)',
    {
      CN: '清仓价格（GBP 便士）',
      PL: 'Cena wyprzedaży (pensy GBP)',
      ES: 'Precio de liquidación (peniques GBP)',
      FR: 'Prix de déstockage (pence GBP)',
    },
  ),
  'adminCatalog.lots.startsAt': text('Starts at', 'Beginnt am', {
    CN: '开始时间',
    PL: 'Początek',
    ES: 'Inicio',
    FR: 'Début',
  }),
  'adminCatalog.lots.endsAt': text('Ends at', 'Endet am', {
    CN: '结束时间',
    PL: 'Koniec',
    ES: 'Fin',
    FR: 'Fin',
  }),
  'adminCatalog.lots.saveClearance': text('Save clearance', 'Abverkauf speichern', {
    CN: '保存清仓设置',
    PL: 'Zapisz wyprzedaż',
    ES: 'Guardar liquidación',
    FR: 'Enregistrer le déstockage',
  }),
  'adminCatalog.lots.retire': text('Retire lot', 'Charge ausmustern', {
    CN: '退役批次',
    PL: 'Wycofaj partię',
    ES: 'Retirar lote',
    FR: 'Retirer le lot',
  }),

  // Promotion administration.
  'adminCatalog.promos.heading': text('Promotions', 'Aktionen', {
    CN: '促销',
    PL: 'Promocje',
    ES: 'Promociones',
    FR: 'Promotions',
  }),
  'adminCatalog.promos.description': text(
    'Create and maintain trade promotion codes.',
    'Handelsaktionscodes erstellen und pflegen.',
    {
      CN: '创建并维护贸易促销代码。',
      PL: 'Twórz i utrzymuj kody promocji handlowych.',
      ES: 'Crea y gestiona códigos promocionales para comercios.',
      FR: 'Créez et gérez les codes promotionnels professionnels.',
    },
  ),
  'adminCatalog.promos.new': text('New promotion', 'Neue Aktion', {
    CN: '新建促销',
    PL: 'Nowa promocja',
    ES: 'Nueva promoción',
    FR: 'Nouvelle promotion',
  }),
  'adminCatalog.promos.edit': text('Edit {code}', '{code} bearbeiten', {
    CN: '编辑 {code}',
    PL: 'Edytuj {code}',
    ES: 'Editar {code}',
    FR: 'Modifier {code}',
  }),
  'adminCatalog.promos.empty': text('No promotions found.', 'Keine Aktionen gefunden.', {
    CN: '未找到促销。',
    PL: 'Nie znaleziono promocji.',
    ES: 'No se encontraron promociones.',
    FR: 'Aucune promotion trouvée.',
  }),
  'adminCatalog.promos.active': text('Active', 'Aktiv', {
    CN: '生效',
    PL: 'Aktywna',
    ES: 'Activa',
    FR: 'Active',
  }),
  'adminCatalog.promos.inactive': text('Inactive', 'Inaktiv', {
    CN: '未生效',
    PL: 'Nieaktywna',
    ES: 'Inactiva',
    FR: 'Inactive',
  }),
  'adminCatalog.promos.code': text('Code', 'Code', {
    CN: '代码',
    PL: 'Kod',
    ES: 'Código',
    FR: 'Code',
  }),
  'adminCatalog.promos.kind': text('Kind', 'Art', {
    CN: '类型',
    PL: 'Rodzaj',
    ES: 'Tipo',
    FR: 'Type',
  }),
  'adminCatalog.promos.percentage': text('Percentage', 'Prozentual', {
    CN: '百分比',
    PL: 'Procent',
    ES: 'Porcentaje',
    FR: 'Pourcentage',
  }),
  'adminCatalog.promos.fixedAmount': text('Fixed amount', 'Fester Betrag', {
    CN: '固定金额',
    PL: 'Stała kwota',
    ES: 'Importe fijo',
    FR: 'Montant fixe',
  }),
  'adminCatalog.promos.discountPercent': text('Discount percent', 'Rabatt in Prozent', {
    CN: '折扣百分比',
    PL: 'Procent rabatu',
    ES: 'Porcentaje de descuento',
    FR: 'Pourcentage de remise',
  }),
  'adminCatalog.promos.minimumItems': text('Minimum items', 'Mindestanzahl Artikel', {
    CN: '最少商品数',
    PL: 'Minimalna liczba produktów',
    ES: 'Artículos mínimos',
    FR: "Nombre minimal d'articles",
  }),
  'adminCatalog.promos.fixedAmountPence': text(
    'Fixed amount (GBP pence)',
    'Fester Betrag (GBP-Pence)',
    {
      CN: '固定金额（GBP 便士）',
      PL: 'Stała kwota (pensy GBP)',
      ES: 'Importe fijo (peniques GBP)',
      FR: 'Montant fixe (pence GBP)',
    },
  ),
  'adminCatalog.promos.minimumSubtotalPence': text(
    'Minimum subtotal (GBP pence)',
    'Mindestzwischensumme (GBP-Pence)',
    {
      CN: '最低小计（GBP 便士）',
      PL: 'Minimalna suma częściowa (pensy GBP)',
      ES: 'Subtotal mínimo (peniques GBP)',
      FR: 'Sous-total minimum (pence GBP)',
    },
  ),
  'adminCatalog.promos.categoryScope': text('Category scope', 'Kategorieumfang', {
    CN: '类别范围',
    PL: 'Zakres kategorii',
    ES: 'Ámbito de categoría',
    FR: 'Périmètre de catégorie',
  }),
  'adminCatalog.promos.allCategories': text('All categories', 'Alle Kategorien', {
    CN: '所有类别',
    PL: 'Wszystkie kategorie',
    ES: 'Todas las categorías',
    FR: 'Toutes les catégories',
  }),
  'adminCatalog.promos.countryTargeting': text('Country targeting', 'Länderzielgruppe', {
    CN: '国家/地区定向',
    PL: 'Kierowanie na kraje',
    ES: 'Segmentación por país',
    FR: 'Ciblage par pays',
  }),
  'adminCatalog.promos.countryTargetingHint': text(
    'Leave empty to apply to all countries.',
    'Leer lassen, um alle Länder einzuschließen.',
    {
      CN: '留空以应用于所有国家/地区。',
      PL: 'Pozostaw puste, aby zastosować do wszystkich krajów.',
      ES: 'Deja vacío para aplicar a todos los países.',
      FR: 'Laissez vide pour appliquer à tous les pays.',
    },
  ),
  'adminCatalog.promos.startsAt': text('Starts at', 'Beginnt am', {
    CN: '开始时间',
    PL: 'Początek',
    ES: 'Inicio',
    FR: 'Début',
  }),
  'adminCatalog.promos.endsAt': text('Ends at', 'Endet am', {
    CN: '结束时间',
    PL: 'Koniec',
    ES: 'Fin',
    FR: 'Fin',
  }),
  'adminCatalog.promos.maximumRedemptions': text('Maximum redemptions', 'Maximale Einlösungen', {
    CN: '最大兑换次数',
    PL: 'Maksymalna liczba realizacji',
    ES: 'Canjes máximos',
    FR: "Nombre maximal d'utilisations",
  }),
  'adminCatalog.promos.perUserLimit': text('Per-user limit', 'Limit pro Benutzer', {
    CN: '每位用户限制',
    PL: 'Limit na użytkownika',
    ES: 'Límite por usuario',
    FR: 'Limite par utilisateur',
  }),
  'adminCatalog.promos.save': text('Save promotion', 'Aktion speichern', {
    CN: '保存促销',
    PL: 'Zapisz promocję',
    ES: 'Guardar promoción',
    FR: 'Enregistrer la promotion',
  }),
  'adminCatalog.promos.deactivateQuestion': text(
    'Deactivate this promotion?',
    'Diese Aktion deaktivieren?',
    {
      CN: '停用此促销？',
      PL: 'Dezaktywować tę promocję?',
      ES: '¿Desactivar esta promoción?',
      FR: 'Désactiver cette promotion ?',
    },
  ),
  'adminCatalog.promos.confirmDeactivate': text('Confirm deactivate', 'Deaktivierung bestätigen', {
    CN: '确认停用',
    PL: 'Potwierdź dezaktywację',
    ES: 'Confirmar desactivación',
    FR: 'Confirmer la désactivation',
  }),
  'adminCatalog.promos.deactivate': text('Deactivate promotion', 'Aktion deaktivieren', {
    CN: '停用促销',
    PL: 'Dezaktywuj promocję',
    ES: 'Desactivar promoción',
    FR: 'Désactiver la promotion',
  }),
});

export type AdminCatalogMessageKey = keyof typeof adminCatalogMessages;
export const ADMIN_CATALOG_MESSAGES = adminCatalogMessages;

/** Preserve the existing `datetime-local` ISO write contract while centralising input display. */
export function adminDateTimeInputValue(value: string | null | undefined): string {
  return value ? value.slice(0, 16) : '';
}

function messageParams(meta: unknown): MessageParams {
  if (meta === null || typeof meta !== 'object') return {};
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
      params[key] = value;
    }
  }
  return params;
}

/** Localize coded API errors; uncoded, network, and contract failures use safe feature copy. */
export function localizeAdminError(
  error: unknown,
  country: Country,
  fallback: AdminCatalogMessageKey = 'adminCatalog.requestFailed',
): string {
  if (error !== null && typeof error === 'object') {
    const candidate = (error as { code?: unknown }).code;
    if (typeof candidate === 'string' && candidate in apiErrors) {
      try {
        return translateUnchecked(
          apiErrors,
          country,
          candidate,
          messageParams((error as { meta?: unknown }).meta),
        );
      } catch {
        // Fall through to feature-safe fallback when metadata is stale or incomplete.
      }
    }
    // ApiError, ApiContractError, network, and arbitrary object errors never expose server prose.
    return translateUnchecked(adminCatalogMessages, country, fallback);
  }
  return translateUnchecked(adminCatalogMessages, country, fallback);
}

export type AdminCatalogMessages = typeof adminCatalogMessages;
