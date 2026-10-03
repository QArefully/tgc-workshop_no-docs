import { Link } from 'react-router-dom';
import {
  getArticlesForGroup,
  materializeHelpIndexLink,
} from '@/features/help/content/helpContentRegistry';
import { useLocalisation } from '@/i18n/LocaleContext';
import { webMessages } from '@shop/localisation/messages/webShell';

const footerGroups = [{ group: 'help' }, { group: 'policy' }] as const;

/** Global discovery links for local demo help and policy content. */
export function Footer() {
  const { activeCountry, translate } = useLocalisation();
  const groupHeading = (group: (typeof footerGroups)[number]['group']) =>
    translate(webMessages, group === 'help' ? 'shell.help' : 'shell.policies');

  return (
    <footer className="border-t border-border bg-surface-raised/60">
      <div className="content-shell py-8 sm:py-10">
        <nav aria-label={translate(webMessages, 'shell.helpAndPolicies')} className="space-y-6">
          <p className="text-sm leading-6 text-muted-foreground">
            {translate(webMessages, 'shell.footerDescription')}
          </p>
          <div className="grid gap-6 sm:grid-cols-2">
            {footerGroups.map(({ group }) => {
              const headingId = `footer-${group}-heading`;
              const links =
                group === 'help'
                  ? [
                      materializeHelpIndexLink(activeCountry),
                      ...getArticlesForGroup(group, activeCountry),
                    ]
                  : getArticlesForGroup(group, activeCountry);

              return (
                <section key={group} aria-labelledby={headingId}>
                  <h2 id={headingId} className="text-sm font-semibold text-foreground">
                    {groupHeading(group)}
                  </h2>
                  <ul className="mt-3 space-y-2">
                    {links.map((link) => (
                      <li key={link.path}>
                        <Link
                          to={link.path}
                          className="section-link text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          {'label' in link ? link.label : link.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </nav>
      </div>
    </footer>
  );
}
