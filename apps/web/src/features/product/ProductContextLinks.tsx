import { Link } from 'react-router-dom';
import {
  getProductCommerceLinks,
  getProductFactLinks,
} from '@/features/help/content/helpContentRegistry';
import { useLocalisation } from '@/i18n/LocaleContext';
import { productMessages } from '@shop/localisation/messages/product';

interface ProductContextLinksProps {
  packagingQuantity?: string | null;
}

export function ProductContextLinks({ packagingQuantity }: ProductContextLinksProps) {
  const { activeCountry, translate } = useLocalisation();
  const productFactLinks = getProductFactLinks(activeCountry);
  const productCommerceLinks = getProductCommerceLinks(activeCountry);
  const factLinks = [
    productFactLinks.powderSafety,
    productFactLinks.storage,
    ...(packagingQuantity?.trim() ? [productFactLinks.packSizes] : []),
  ];
  const commerceLinks = Object.values(productCommerceLinks);

  return (
    <section
      aria-labelledby="product-context-links-heading"
      className="rounded-2xl border bg-surface-raised p-6 sm:p-8"
    >
      <h2 id="product-context-links-heading" className="text-2xl font-semibold tracking-tight">
        {translate(productMessages, 'product.productInformation')}
      </h2>
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="font-semibold">{translate(productMessages, 'product.productHelp')}</h3>
          <ul className="mt-3 grid gap-2">
            {factLinks.map((link) => (
              <li key={link.path}>
                <Link to={link.path} className="section-link">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">{translate(productMessages, 'product.demoCommerce')}</h3>
          <ul className="mt-3 grid gap-2">
            {commerceLinks.map((link) => (
              <li key={link.path}>
                <Link to={link.path} className="section-link">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
