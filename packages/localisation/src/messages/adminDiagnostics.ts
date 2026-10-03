import type { Country } from '@shop/contracts/country';
import { defineMessages, type CountryMessageSet } from './defineMessages.js';
import { apiErrors } from './apiErrors.js';
import { translateUnchecked, type MessageParams } from '../translate.js';

/** Shop-authored copy for the admin shell and local diagnostics screens. */
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

export const adminDiagnosticsMessages = defineMessages({
  // Shared shell and navigation.
  'admin.shell.eyebrow': text('Administration', 'Administration', {
    CN: '管理',
    PL: 'Administracja',
    ES: 'Administración',
    FR: 'Administration',
  }),
  'admin.shell.heading': text('Operations console', 'Betriebskonsole', {
    CN: '运营控制台',
    PL: 'Konsola operacyjna',
    ES: 'Consola de operaciones',
    FR: 'Console des opérations',
  }),
  'admin.shell.standingCountry': text('Standing country: {country}', 'Aktuelles Land: {country}', {
    CN: '当前国家/地区：{country}',
    PL: 'Wybrane państwo: {country}',
    ES: 'País seleccionado: {country}',
    FR: 'Pays sélectionné : {country}',
  }),
  'admin.shell.globalSections': text(
    'Jobs, webhooks, and feature flags are global sections.',
    'Jobs, Webhooks und Feature-Flags sind globale Bereiche.',
    {
      CN: '作业、Webhook 和功能标志为全局区域。',
      PL: 'Zadania, webhooki i flagi funkcji są sekcjami globalnymi.',
      ES: 'Los trabajos, webhooks y flags de funciones son secciones globales.',
      FR: 'Les tâches, webhooks et indicateurs de fonctionnalité sont des sections globales.',
    },
  ),
  'admin.shell.navigationLabel': text('Administration', 'Administration', {
    CN: '管理',
    PL: 'Administracja',
    ES: 'Administración',
    FR: 'Administration',
  }),
  'admin.shell.global': text('global', 'global', {
    CN: '全局',
    PL: 'globalna',
    ES: 'global',
    FR: 'global',
  }),
  'admin.shell.overview': text('Overview', 'Übersicht', {
    CN: '概览',
    PL: 'Przegląd',
    ES: 'Resumen',
    FR: 'Vue d’ensemble',
  }),
  'admin.shell.products': text('Products', 'Produkte', {
    CN: '产品',
    PL: 'Produkty',
    ES: 'Productos',
    FR: 'Produits',
  }),
  'admin.shell.variants': text('Variants', 'Varianten', {
    CN: '变体',
    PL: 'Warianty',
    ES: 'Variantes',
    FR: 'Variantes',
  }),
  'admin.shell.promotions': text('Promotions', 'Aktionen', {
    CN: '促销',
    PL: 'Promocje',
    ES: 'Promociones',
    FR: 'Promotions',
  }),
  'admin.shell.users': text('Users', 'Benutzer', {
    CN: '用户',
    PL: 'Użytkownicy',
    ES: 'Usuarios',
    FR: 'Utilisateurs',
  }),
  'admin.shell.orders': text('Orders', 'Bestellungen', {
    CN: '订单',
    PL: 'Zamówienia',
    ES: 'Pedidos',
    FR: 'Commandes',
  }),
  'admin.shell.jobs': text('Jobs', 'Jobs', {
    CN: '作业',
    PL: 'Zadania',
    ES: 'Trabajos',
    FR: 'Tâches',
  }),
  'admin.shell.webhooks': text('Webhooks', 'Webhooks', {
    CN: 'Webhook',
    PL: 'Webhooki',
    ES: 'Webhooks',
    FR: 'Webhooks',
  }),
  'admin.shell.featureFlags': text('Feature flags', 'Feature-Flags', {
    CN: '功能标志',
    PL: 'Flagi funkcji',
    ES: 'Flags de funciones',
    FR: 'Indicateurs de fonctionnalité',
  }),
  'admin.shell.reviewModeration': text('Review moderation', 'Bewertungsmoderation', {
    CN: '评论审核',
    PL: 'Moderowanie opinii',
    ES: 'Moderación de reseñas',
    FR: 'Modération des avis',
  }),

  // Admin landing page.
  'admin.index.heading': text('Administration overview', 'Administrationsübersicht', {
    CN: '管理概览',
    PL: 'Przegląd administracji',
    ES: 'Resumen de administración',
    FR: 'Vue d’ensemble de l’administration',
  }),
  'admin.index.selectArea': text(
    'Select an operational area to continue.',
    'Wählen Sie einen Betriebsbereich aus.',
    {
      CN: '选择运营区域以继续。',
      PL: 'Wybierz obszar operacyjny, aby kontynuować.',
      ES: 'Selecciona un área operativa para continuar.',
      FR: 'Sélectionnez une zone opérationnelle pour continuer.',
    },
  ),
  'admin.index.productsTitle': text('Product catalogue', 'Produktkatalog', {
    CN: '产品目录',
    PL: 'Katalog produktów',
    ES: 'Catálogo de productos',
    FR: 'Catalogue produits',
  }),
  'admin.index.productsDescription': text(
    'Manage products and their purchasable variants.',
    'Produkte und kaufbare Varianten verwalten.',
    {
      CN: '管理产品及其可购买变体。',
      PL: 'Zarządzaj produktami i ich wariantami do zakupu.',
      ES: 'Gestiona productos y sus variantes comprables.',
      FR: 'Gérez les produits et leurs variantes achetables.',
    },
  ),
  'admin.index.variantsDescription': text(
    'Set stock, delivery details, and clearance pricing.',
    'Bestand, Lieferdetails und Abverkaufspreise festlegen.',
    {
      CN: '设置库存、配送详情和清仓价格。',
      PL: 'Ustaw zapasy, szczegóły dostawy i ceny wyprzedaży.',
      ES: 'Configura stock, detalles de entrega y precios de liquidación.',
      FR: 'Définissez le stock, la livraison et les prix de liquidation.',
    },
  ),
  'admin.index.promotionsDescription': text(
    'Create and maintain trade promotion codes.',
    'Handelsaktionscodes erstellen und pflegen.',
    {
      CN: '创建和维护贸易促销代码。',
      PL: 'Twórz i utrzymuj kody promocji handlowych.',
      ES: 'Crea y mantén códigos de promociones comerciales.',
      FR: 'Créez et gérez les codes de promotion commerciale.',
    },
  ),
  'admin.index.usersDescription': text(
    'Manage customer access, profile details, and roles.',
    'Kundenzugriff, Profildetails und Rollen verwalten.',
    {
      CN: '管理客户访问、资料详情和角色。',
      PL: 'Zarządzaj dostępem klientów, profilami i rolami.',
      ES: 'Gestiona el acceso de clientes, perfiles y roles.',
      FR: 'Gérez les accès clients, profils et rôles.',
    },
  ),
  'admin.index.ordersDescription': text(
    'Review orders and issue simulated refunds.',
    'Bestellungen prüfen und simulierte Erstattungen ausstellen.',
    {
      CN: '查看订单并发放模拟退款。',
      PL: 'Przeglądaj zamówienia i wystawiaj symulowane zwroty.',
      ES: 'Revisa pedidos y emite reembolsos simulados.',
      FR: 'Consultez les commandes et émettez des remboursements simulés.',
    },
  ),
  'admin.index.jobsDescription': text(
    'Inspect and drain local asynchronous work.',
    'Lokale asynchrone Arbeit prüfen und ausführen.',
    {
      CN: '检查并清理本地异步任务。',
      PL: 'Sprawdzaj i opróżniaj lokalne zadania asynchroniczne.',
      ES: 'Inspecciona y ejecuta trabajos asíncronos locales.',
      FR: 'Inspectez et exécutez les tâches asynchrones locales.',
    },
  ),
  'admin.index.webhooksDescription': text(
    'Inspect simulated payment processor deliveries.',
    'Simulierte Lieferungen des Zahlungsdienstes prüfen.',
    {
      CN: '检查模拟支付处理器投递。',
      PL: 'Sprawdzaj dostawy z symulowanego procesora płatności.',
      ES: 'Inspecciona entregas simuladas del procesador de pagos.',
      FR: 'Inspectez les livraisons simulées du processeur de paiement.',
    },
  ),
  'admin.index.featureFlagsDescription': text(
    'Control local rollout flags for the application.',
    'Lokale Rollout-Flags für die Anwendung steuern.',
    {
      CN: '控制应用的本地发布标志。',
      PL: 'Steruj lokalnymi flagami wdrożenia aplikacji.',
      ES: 'Controla los flags de despliegue local de la aplicación.',
      FR: 'Contrôlez les indicateurs de déploiement local de l’application.',
    },
  ),
  'admin.index.reviewModerationDescription': text(
    'Review reported and hidden customer reviews.',
    'Gemeldete und ausgeblendete Kundenbewertungen prüfen.',
    {
      CN: '审核被举报和隐藏的客户评论。',
      PL: 'Przeglądaj zgłoszone i ukryte opinie klientów.',
      ES: 'Revisa reseñas de clientes denunciadas y ocultas.',
      FR: 'Examinez les avis clients signalés et masqués.',
    },
  ),
  'admin.shell.creditAccounts': text('Credit accounts', 'Kreditkonten', {
    CN: '信用账户',
    PL: 'Konta kredytowe',
    ES: 'Cuentas de crédito',
    FR: 'Comptes de crédit',
  }),
  'admin.shell.invoices': text('Invoices', 'Rechnungen', {
    CN: '发票',
    PL: 'Faktury',
    ES: 'Facturas',
    FR: 'Factures',
  }),
  'admin.index.creditTitle': text('Company credit', 'Firmenkredit', {
    CN: '公司信用',
    PL: 'Kredyt firmy',
    ES: 'Crédito de empresa',
    FR: 'Crédit d’entreprise',
  }),
  'admin.index.creditDescription': text(
    'Manage company credit limits and account state.',
    'Firmenkreditlimits und Kontostatus verwalten.',
    {
      CN: '管理公司信用额度上限和账户状态。',
      PL: 'Zarządzaj limitami kredytowymi i stanem kont firm.',
      ES: 'Gestiona los límites de crédito y el estado de las cuentas de empresa.',
      FR: 'Gérez les limites de crédit et l’état des comptes d’entreprise.',
    },
  ),
  'admin.index.invoicesTitle': text(
    'Trade-credit invoices',
    'Rechnungen aus dem Kauf auf Rechnung',
    {
      CN: '贸易赊账发票',
      PL: 'Faktury kredytu kupieckiego',
      ES: 'Facturas de crédito comercial',
      FR: 'Factures de crédit commercial',
    },
  ),
  'admin.index.invoicesDescription': text(
    'Review invoices and record full GBP settlements.',
    'Rechnungen prüfen und vollständige GBP-Abrechnungen erfassen.',
    {
      CN: '查看发票并记录 GBP 全额结算。',
      PL: 'Przeglądaj faktury i zapisuj pełne rozliczenia w GBP.',
      ES: 'Revisa facturas y registra liquidaciones completas en GBP.',
      FR: 'Consultez les factures et enregistrez les règlements complets en GBP.',
    },
  ),

  // Shared diagnostics controls and statuses. Values in selects remain raw contract values.
  'admin.common.requestFailed': text('Request failed.', 'Anfrage fehlgeschlagen.', {
    CN: '请求失败。',
    PL: 'Żądanie nie powiodło się.',
    ES: 'La solicitud ha fallado.',
    FR: 'La requête a échoué.',
  }),
  'admin.common.all': text('All', 'Alle', { CN: '全部', PL: 'Wszystkie', ES: 'Todos', FR: 'Tous' }),
  'admin.common.previous': text('Previous', 'Zurück', {
    CN: '上一页',
    PL: 'Poprzednia',
    ES: 'Anterior',
    FR: 'Précédent',
  }),
  'admin.common.next': text('Next', 'Weiter', {
    CN: '下一页',
    PL: 'Następna',
    ES: 'Siguiente',
    FR: 'Suivant',
  }),
  'admin.common.page': text('Page {page} of {totalPages}', 'Seite {page} von {totalPages}', {
    CN: '第 {page} 页，共 {totalPages} 页',
    PL: 'Strona {page} z {totalPages}',
    ES: 'Página {page} de {totalPages}',
    FR: 'Page {page} sur {totalPages}',
  }),
  'admin.common.viewDetail': text('View detail', 'Details anzeigen', {
    CN: '查看详情',
    PL: 'Wyświetl szczegóły',
    ES: 'Ver detalles',
    FR: 'Voir les détails',
  }),
  'admin.common.administration': text('Administration', 'Administration', {
    CN: '管理',
    PL: 'Administracja',
    ES: 'Administración',
    FR: 'Administration',
  }),
  'admin.common.identifierRequired': text(
    '{resource} identifier is required',
    'Die Kennung für {resource} ist erforderlich',
    {
      CN: '需要 {resource} 标识符',
      PL: 'Wymagany jest identyfikator: {resource}',
      ES: 'Se necesita el identificador de {resource}',
      FR: 'L’identifiant {resource} est requis',
    },
  ),
  'admin.common.unavailable': text('{resource} is unavailable', '{resource} ist nicht verfügbar', {
    CN: '{resource} 不可用',
    PL: '{resource} jest niedostępne',
    ES: '{resource} no está disponible',
    FR: '{resource} est indisponible',
  }),

  // Job queue.
  'admin.jobs.heading': text('Job queue', 'Job-Warteschlange', {
    CN: '作业队列',
    PL: 'Kolejka zadań',
    ES: 'Cola de trabajos',
    FR: 'File des tâches',
  }),
  'admin.jobs.description': text(
    'Inspect and operate local asynchronous work.',
    'Lokale asynchrone Arbeit prüfen und ausführen.',
    {
      CN: '检查并运行本地异步任务。',
      PL: 'Sprawdzaj i obsługuj lokalne zadania asynchroniczne.',
      ES: 'Inspecciona y opera trabajos asíncronos locales.',
      FR: 'Inspectez et exécutez les tâches asynchrones locales.',
    },
  ),
  'admin.jobs.statusLabel': text('Status', 'Status', {
    CN: '状态',
    PL: 'Status',
    ES: 'Estado',
    FR: 'Statut',
  }),
  'admin.jobs.kindLabel': text('Kind', 'Typ', { CN: '类型', PL: 'Rodzaj', ES: 'Tipo', FR: 'Type' }),
  'admin.jobs.status.pending': text('Pending', 'Ausstehend', {
    CN: '待处理',
    PL: 'Oczekujące',
    ES: 'Pendiente',
    FR: 'En attente',
  }),
  'admin.jobs.status.running': text('Running', 'Läuft', {
    CN: '运行中',
    PL: 'W toku',
    ES: 'En ejecución',
    FR: 'En cours',
  }),
  'admin.jobs.status.succeeded': text('Succeeded', 'Erfolgreich', {
    CN: '成功',
    PL: 'Powodzenie',
    ES: 'Correcto',
    FR: 'Réussi',
  }),
  'admin.jobs.status.failed': text('Failed', 'Fehlgeschlagen', {
    CN: '失败',
    PL: 'Niepowodzenie',
    ES: 'Fallido',
    FR: 'Échec',
  }),
  'admin.jobs.status.dead': text('Dead', 'Beendet', {
    CN: '终止',
    PL: 'Zatrzymane',
    ES: 'Detenido',
    FR: 'Arrêté',
  }),
  'admin.jobs.outcome.succeeded': text('Succeeded', 'Erfolgreich', {
    CN: '成功',
    PL: 'Sukces',
    ES: 'Correcto',
    FR: 'Réussi',
  }),
  'admin.jobs.outcome.failed': text('Failed', 'Fehlgeschlagen', {
    CN: '失败',
    PL: 'Niepowodzenie',
    ES: 'Fallido',
    FR: 'Échec',
  }),
  'admin.jobs.outcome.abandoned': text('Abandoned', 'Aufgegeben', {
    CN: '已放弃',
    PL: 'Porzucone',
    ES: 'Abandonado',
    FR: 'Abandonné',
  }),
  'admin.jobs.drain': text('Drain due jobs', 'Fällige Jobs ausführen', {
    CN: '运行到期作业',
    PL: 'Opróżnij zaległe zadania',
    ES: 'Ejecutar trabajos pendientes',
    FR: 'Exécuter les tâches dues',
  }),
  'admin.jobs.draining': text('Draining…', 'Wird ausgeführt…', {
    CN: '正在运行…',
    PL: 'Opróżnianie…',
    ES: 'Ejecutando…',
    FR: 'Exécution…',
  }),
  'admin.jobs.empty': text(
    'No jobs match these filters.',
    'Keine Jobs entsprechen diesen Filtern.',
    {
      CN: '没有符合这些筛选条件的作业。',
      PL: 'Brak zadań pasujących do filtrów.',
      ES: 'Ningún trabajo coincide con estos filtros.',
      FR: 'Aucune tâche ne correspond à ces filtres.',
    },
  ),
  'admin.jobs.attempts': text(
    '{attempts}/{maxAttempts} attempts',
    '{attempts}/{maxAttempts} Versuche',
    {
      CN: '{attempts}/{maxAttempts} 次尝试',
      PL: '{attempts}/{maxAttempts} prób',
      ES: '{attempts}/{maxAttempts} intentos',
      FR: '{attempts}/{maxAttempts} tentatives',
    },
  ),
  'admin.jobs.drainSummary': text(
    'Processed {processed}; succeeded {succeeded}; failed {failed}.',
    'Verarbeitet: {processed}; erfolgreich: {succeeded}; fehlgeschlagen: {failed}.',
    {
      CN: '已处理 {processed}；成功 {succeeded}；失败 {failed}。',
      PL: 'Przetworzono {processed}; sukcesy: {succeeded}; błędy: {failed}.',
      ES: 'Procesados {processed}; correctos {succeeded}; fallidos {failed}.',
      FR: 'Traité : {processed} ; réussies : {succeeded} ; échouées : {failed}.',
    },
  ),
  'admin.jobs.queuePages': text('Job queue pages', 'Seiten der Job-Warteschlange', {
    CN: '作业队列页',
    PL: 'Strony kolejki zadań',
    ES: 'Páginas de la cola de trabajos',
    FR: 'Pages de la file des tâches',
  }),
  'admin.jobs.loadError': text('Unable to load jobs.', 'Jobs konnten nicht geladen werden.', {
    CN: '无法加载作业。',
    PL: 'Nie można załadować zadań.',
    ES: 'No se pueden cargar los trabajos.',
    FR: 'Impossible de charger les tâches.',
  }),
  'admin.jobs.drainError': text('Unable to drain jobs.', 'Jobs konnten nicht ausgeführt werden.', {
    CN: '无法运行作业。',
    PL: 'Nie można opróżnić zadań.',
    ES: 'No se pueden ejecutar los trabajos.',
    FR: 'Impossible d’exécuter les tâches.',
  }),
  'admin.jobs.queueUnavailable': text(
    'Job queue is unavailable',
    'Job-Warteschlange ist nicht verfügbar',
    {
      CN: '作业队列不可用',
      PL: 'Kolejka zadań jest niedostępna',
      ES: 'La cola de trabajos no está disponible',
      FR: 'La file des tâches est indisponible',
    },
  ),
  'admin.jobs.detailHeading': text('Job #{id}', 'Job #{id}', {
    CN: '作业 #{id}',
    PL: 'Zadanie #{id}',
    ES: 'Trabajo #{id}',
    FR: 'Tâche n°{id}',
  }),
  'admin.jobs.summary': text('{kind} · {status}', '{kind} · {status}', {
    CN: '{kind} · {status}',
    PL: '{kind} · {status}',
    ES: '{kind} · {status}',
    FR: '{kind} · {status}',
  }),
  'admin.jobs.queueDetails': text('Queue details', 'Warteschlangendetails', {
    CN: '队列详情',
    PL: 'Szczegóły kolejki',
    ES: 'Detalles de la cola',
    FR: 'Détails de la file',
  }),
  'admin.jobs.attemptsLabel': text(
    'Attempts: {attempts} of {maxAttempts}',
    'Versuche: {attempts} von {maxAttempts}',
    {
      CN: '尝试次数：{attempts}/{maxAttempts}',
      PL: 'Próby: {attempts} z {maxAttempts}',
      ES: 'Intentos: {attempts} de {maxAttempts}',
      FR: 'Tentatives : {attempts} sur {maxAttempts}',
    },
  ),
  'admin.jobs.scheduled': text('Scheduled: {value}', 'Geplant: {value}', {
    CN: '计划时间：{value}',
    PL: 'Zaplanowano: {value}',
    ES: 'Programado: {value}',
    FR: 'Planifié : {value}',
  }),
  'admin.jobs.lastError': text('Last error: {value}', 'Letzter Fehler: {value}', {
    CN: '上次错误：{value}',
    PL: 'Ostatni błąd: {value}',
    ES: 'Último error: {value}',
    FR: 'Dernière erreur : {value}',
  }),
  'admin.jobs.retryDead': text('Retry dead job', 'Toten Job erneut versuchen', {
    CN: '重试死亡作业',
    PL: 'Ponów martwe zadanie',
    ES: 'Reintentar trabajo detenido',
    FR: 'Réessayer la tâche arrêtée',
  }),
  'admin.jobs.retrying': text('Retrying…', 'Wird erneut versucht…', {
    CN: '正在重试…',
    PL: 'Ponawianie…',
    ES: 'Reintentando…',
    FR: 'Nouvelle tentative…',
  }),
  'admin.jobs.retryNotice': text('Job queued for retry.', 'Job wurde erneut eingereiht.', {
    CN: '作业已加入重试队列。',
    PL: 'Zadanie dodano do ponowienia.',
    ES: 'Trabajo en cola para reintento.',
    FR: 'Tâche mise en file pour nouvelle tentative.',
  }),
  'admin.jobs.detailLoadError': text(
    'Unable to load job detail.',
    'Jobdetails konnten nicht geladen werden.',
    {
      CN: '无法加载作业详情。',
      PL: 'Nie można załadować szczegółów zadania.',
      ES: 'No se pueden cargar los detalles del trabajo.',
      FR: 'Impossible de charger les détails de la tâche.',
    },
  ),
  'admin.jobs.retryError': text(
    'Unable to retry this job.',
    'Job konnte nicht erneut versucht werden.',
    {
      CN: '无法重试此作业。',
      PL: 'Nie można ponowić tego zadania.',
      ES: 'No se puede reintentar este trabajo.',
      FR: 'Impossible de réessayer cette tâche.',
    },
  ),
  'admin.jobs.identifierResource': text('Job', 'Job', {
    CN: '作业',
    PL: 'zadania',
    ES: 'trabajo',
    FR: 'tâche',
  }),
  'admin.jobs.unavailableResource': text('Job', 'Job', {
    CN: '作业',
    PL: 'zadanie',
    ES: 'trabajo',
    FR: 'tâche',
  }),
  'admin.jobs.attemptLedger': text('Attempt ledger', 'Versuchsprotokoll', {
    CN: '尝试记录',
    PL: 'Rejestr prób',
    ES: 'Registro de intentos',
    FR: 'Journal des tentatives',
  }),
  'admin.jobs.noAttempts': text('No attempts recorded.', 'Keine Versuche aufgezeichnet.', {
    CN: '没有记录尝试。',
    PL: 'Brak zarejestrowanych prób.',
    ES: 'No hay intentos registrados.',
    FR: 'Aucune tentative enregistrée.',
  }),
  'admin.jobs.attemptSummary': text(
    'Attempt {attemptNumber}: {outcome}',
    'Versuch {attemptNumber}: {outcome}',
    {
      CN: '尝试 {attemptNumber}：{outcome}',
      PL: 'Próba {attemptNumber}: {outcome}',
      ES: 'Intento {attemptNumber}: {outcome}',
      FR: 'Tentative {attemptNumber} : {outcome}',
    },
  ),
  'admin.jobs.startedFinished': text(
    'Started {started}; finished {finished}',
    'Gestartet {started}; beendet {finished}',
    {
      CN: '开始 {started}；结束 {finished}',
      PL: 'Rozpoczęto {started}; zakończono {finished}',
      ES: 'Iniciado {started}; finalizado {finished}',
      FR: 'Début {started} ; fin {finished}',
    },
  ),
  'admin.jobs.inProgress': text('in progress', 'in Bearbeitung', {
    CN: '进行中',
    PL: 'w toku',
    ES: 'en curso',
    FR: 'en cours',
  }),

  // Webhook inspector.
  'admin.webhooks.heading': text('Captured webhooks', 'Erfasste Webhooks', {
    CN: '已捕获 Webhook',
    PL: 'Przechwycone webhooki',
    ES: 'Webhooks capturados',
    FR: 'Webhooks capturés',
  }),
  'admin.webhooks.description': text(
    'Inspect simulated payment processor deliveries.',
    'Simulierte Lieferungen des Zahlungsdienstes prüfen.',
    {
      CN: '检查模拟支付处理器投递。',
      PL: 'Sprawdzaj dostawy z symulowanego procesora płatności.',
      ES: 'Inspecciona entregas simuladas del procesador de pagos.',
      FR: 'Inspectez les livraisons simulées du processeur de paiement.',
    },
  ),
  'admin.webhooks.statusLabel': text('Status', 'Status', {
    CN: '状态',
    PL: 'Status',
    ES: 'Estado',
    FR: 'Statut',
  }),
  'admin.webhooks.status.captured': text('Captured', 'Erfasst', {
    CN: '已捕获',
    PL: 'Przechwycony',
    ES: 'Capturado',
    FR: 'Capturé',
  }),
  'admin.webhooks.status.processed': text('Processed', 'Verarbeitet', {
    CN: '已处理',
    PL: 'Przetworzony',
    ES: 'Procesado',
    FR: 'Traité',
  }),
  'admin.webhooks.status.ignored_stale': text('Ignored (stale)', 'Ignoriert (veraltet)', {
    CN: '已忽略（过期）',
    PL: 'Pominięty (nieaktualny)',
    ES: 'Ignorado (obsoleto)',
    FR: 'Ignoré (obsolète)',
  }),
  'admin.webhooks.status.rejected': text('Rejected', 'Abgelehnt', {
    CN: '已拒绝',
    PL: 'Odrzucony',
    ES: 'Rechazado',
    FR: 'Rejeté',
  }),
  'admin.webhooks.empty': text(
    'No webhooks match this filter.',
    'Keine Webhooks entsprechen diesem Filter.',
    {
      CN: '没有符合此筛选条件的 Webhook。',
      PL: 'Brak webhooków pasujących do filtra.',
      ES: 'Ningún webhook coincide con este filtro.',
      FR: 'Aucun webhook ne correspond à ce filtre.',
    },
  ),
  'admin.webhooks.pages': text('Webhook pages', 'Webhook-Seiten', {
    CN: 'Webhook 页',
    PL: 'Strony webhooków',
    ES: 'Páginas de webhooks',
    FR: 'Pages de webhooks',
  }),
  'admin.webhooks.loadError': text(
    'Unable to load webhooks.',
    'Webhooks konnten nicht geladen werden.',
    {
      CN: '无法加载 Webhook。',
      PL: 'Nie można załadować webhooków.',
      ES: 'No se pueden cargar los webhooks.',
      FR: 'Impossible de charger les webhooks.',
    },
  ),
  'admin.webhooks.unavailable': text(
    'Webhook inspector is unavailable',
    'Webhook-Inspektor ist nicht verfügbar',
    {
      CN: 'Webhook 检查器不可用',
      PL: 'Inspektor webhooków jest niedostępny',
      ES: 'El inspector de webhooks no está disponible',
      FR: 'L’inspecteur de webhooks est indisponible',
    },
  ),
  'admin.webhooks.detailLoadError': text(
    'Unable to load webhook detail.',
    'Webhookdetails konnten nicht geladen werden.',
    {
      CN: '无法加载 Webhook 详情。',
      PL: 'Nie można załadować szczegółów webhooka.',
      ES: 'No se pueden cargar los detalles del webhook.',
      FR: 'Impossible de charger les détails du webhook.',
    },
  ),
  'admin.webhooks.identifierResource': text('Webhook', 'Webhook', {
    CN: 'Webhook',
    PL: 'webhooka',
    ES: 'webhook',
    FR: 'webhook',
  }),
  'admin.webhooks.unavailableResource': text('Webhook', 'Webhook', {
    CN: 'Webhook',
    PL: 'webhook',
    ES: 'webhook',
    FR: 'webhook',
  }),
  'admin.webhooks.detailHeading': text('Webhook #{id}', 'Webhook #{id}', {
    CN: 'Webhook #{id}',
    PL: 'Webhook #{id}',
    ES: 'Webhook #{id}',
    FR: 'Webhook n°{id}',
  }),
  'admin.webhooks.summary': text('{eventType} · {status}', '{eventType} · {status}', {
    CN: '{eventType} · {status}',
    PL: '{eventType} · {status}',
    ES: '{eventType} · {status}',
    FR: '{eventType} · {status}',
  }),
  'admin.webhooks.deliveryDetails': text('Delivery details', 'Zustelldetails', {
    CN: '投递详情',
    PL: 'Szczegóły dostawy',
    ES: 'Detalles de entrega',
    FR: 'Détails de livraison',
  }),
  'admin.webhooks.eventId': text('Event ID: {value}', 'Ereignis-ID: {value}', {
    CN: '事件 ID：{value}',
    PL: 'Identyfikator zdarzenia: {value}',
    ES: 'ID del evento: {value}',
    FR: 'ID de l’événement : {value}',
  }),
  'admin.webhooks.received': text('Received: {value}', 'Empfangen: {value}', {
    CN: '接收时间：{value}',
    PL: 'Odebrano: {value}',
    ES: 'Recibido: {value}',
    FR: 'Reçu : {value}',
  }),
  'admin.webhooks.processed': text('Processed: {value}', 'Verarbeitet: {value}', {
    CN: '处理时间：{value}',
    PL: 'Przetworzono: {value}',
    ES: 'Procesado: {value}',
    FR: 'Traité : {value}',
  }),
  'admin.webhooks.capturedPayload': text('Captured payload', 'Erfasste Nutzlast', {
    CN: '捕获的负载',
    PL: 'Przechwycony payload',
    ES: 'Payload capturado',
    FR: 'Payload capturé',
  }),

  // Feature flag controls. Keys and descriptions are operator data and stay verbatim.
  'admin.flags.heading': text('Feature flags', 'Feature-Flags', {
    CN: '功能标志',
    PL: 'Flagi funkcji',
    ES: 'Flags de funciones',
    FR: 'Indicateurs de fonctionnalité',
  }),
  'admin.flags.flagKey': text('Flag key', 'Flag-Schlüssel', {
    CN: '标志键',
    PL: 'Klucz flagi',
    ES: 'Clave del flag',
    FR: 'Clé de l’indicateur',
  }),
  'admin.flags.description': text('Description', 'Beschreibung', {
    CN: '描述',
    PL: 'Opis',
    ES: 'Descripción',
    FR: 'Description',
  }),
  'admin.flags.enabled': text('Enabled', 'Aktiviert', {
    CN: '已启用',
    PL: 'Włączone',
    ES: 'Activado',
    FR: 'Activé',
  }),
  'admin.flags.create': text('Create flag', 'Flag erstellen', {
    CN: '创建标志',
    PL: 'Utwórz flagę',
    ES: 'Crear flag',
    FR: 'Créer un indicateur',
  }),
  'admin.flags.save': text('Save', 'Speichern', {
    CN: '保存',
    PL: 'Zapisz',
    ES: 'Guardar',
    FR: 'Enregistrer',
  }),
  'admin.flags.delete': text('Delete', 'Löschen', {
    CN: '删除',
    PL: 'Usuń',
    ES: 'Eliminar',
    FR: 'Supprimer',
  }),
  'admin.flags.keyPlaceholder': text('Flag key', 'Flag-Schlüssel', {
    CN: '标志键',
    PL: 'Klucz flagi',
    ES: 'Clave del flag',
    FR: 'Clé de l’indicateur',
  }),
  'admin.flags.descriptionPlaceholder': text('Description', 'Beschreibung', {
    CN: '描述',
    PL: 'Opis',
    ES: 'Descripción',
    FR: 'Description',
  }),
  'admin.flags.empty': text('No feature flags configured.', 'Keine Feature-Flags konfiguriert.', {
    CN: '未配置功能标志。',
    PL: 'Brak skonfigurowanych flag funkcji.',
    ES: 'No hay flags de funciones configurados.',
    FR: 'Aucun indicateur de fonctionnalité configuré.',
  }),
  'admin.flags.enable': text('Enable {key}', '{key} aktivieren', {
    CN: '启用 {key}',
    PL: 'Włącz {key}',
    ES: 'Activar {key}',
    FR: 'Activer {key}',
  }),
  'admin.flags.descriptionFor': text('Description for {key}', 'Beschreibung für {key}', {
    CN: '{key} 的描述',
    PL: 'Opis dla {key}',
    ES: 'Descripción de {key}',
    FR: 'Description de {key}',
  }),
  'admin.flags.loadError': text(
    'Unable to load feature flags.',
    'Feature-Flags konnten nicht geladen werden.',
    {
      CN: '无法加载功能标志。',
      PL: 'Nie można załadować flag funkcji.',
      ES: 'No se pueden cargar los flags de funciones.',
      FR: 'Impossible de charger les indicateurs de fonctionnalité.',
    },
  ),
  'admin.flags.createError': text(
    'Unable to create feature flag.',
    'Feature-Flag konnte nicht erstellt werden.',
    {
      CN: '无法创建功能标志。',
      PL: 'Nie można utworzyć flagi funkcji.',
      ES: 'No se puede crear el flag de función.',
      FR: 'Impossible de créer l’indicateur de fonctionnalité.',
    },
  ),
  'admin.flags.updateError': text(
    'Unable to update feature flag.',
    'Feature-Flag konnte nicht aktualisiert werden.',
    {
      CN: '无法更新功能标志。',
      PL: 'Nie można zaktualizować flagi funkcji.',
      ES: 'No se puede actualizar el flag de función.',
      FR: 'Impossible de mettre à jour l’indicateur de fonctionnalité.',
    },
  ),
  'admin.flags.deleteError': text(
    'Unable to delete feature flag.',
    'Feature-Flag konnte nicht gelöscht werden.',
    {
      CN: '无法删除功能标志。',
      PL: 'Nie można usunąć flagi funkcji.',
      ES: 'No se puede eliminar el flag de función.',
      FR: 'Impossible de supprimer l’indicateur de fonctionnalité.',
    },
  ),
});

export type AdminDiagnosticsMessageKey = keyof typeof adminDiagnosticsMessages;
export type AdminDiagnosticsMessages = typeof adminDiagnosticsMessages;
export const ADMIN_DIAGNOSTICS_MESSAGES = adminDiagnosticsMessages;

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

/** Translate coded API failures; collapse uncoded transport failures to safe feature copy. */
export function localizeAdminDiagnosticsError(
  error: unknown,
  country: Country,
  fallback: AdminDiagnosticsMessageKey = 'admin.common.requestFailed',
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
        // Fall through to the feature-safe fallback when metadata is incomplete.
      }
    }
    // ApiError instances expose status/response; never forward server prose for this branch.
    if ('status' in error && 'response' in error) {
      return translateUnchecked(adminDiagnosticsMessages, country, fallback);
    }
  }
  // Uncoded/network failures may contain transport or implementation details. Keep those out of
  // shop UI; raw technical text belongs only in dedicated payload/error blocks.
  return translateUnchecked(adminDiagnosticsMessages, country, fallback);
}

/** Compatibility alias matching other admin message bundles. */
export const localizeAdminError = localizeAdminDiagnosticsError;
