import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { useLocalisation } from '@/i18n/LocaleContext';
import { helpPolicyMessages } from '@shop/localisation/messages/helpPolicy';
import { getArticlesForGroup } from './content/helpContentRegistry';

const indexGroups = ['help', 'policy'] as const;

/** Registry-driven directory for local demo help and policy content. */
export function HelpIndexPage() {
  const { activeCountry, translate } = useLocalisation();
  const groups = useMemo(
    () =>
      indexGroups.map((group) => ({
        group,
        heading: translate(
          helpPolicyMessages,
          group === 'help' ? 'help.shell.helpTopics' : 'help.shell.policyTopics',
        ),
        description: translate(
          helpPolicyMessages,
          group === 'help' ? 'help.shell.helpDescription' : 'help.shell.policyDescription',
        ),
      })),
    [translate],
  );

  return (
    <section aria-labelledby="help-index-title" className="mx-auto max-w-3xl space-y-10 pb-12">
      <header className="space-y-3">
        <p className="section-eyebrow">QArefully Materials Exchange</p>
        <h1 id="help-index-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {translate(helpPolicyMessages, 'help.shell.helpCenter')}
        </h1>
        <p className="max-w-2xl leading-7 text-muted-foreground">
          {translate(helpPolicyMessages, 'help.shell.helpDescription')}
        </p>
      </header>

      {groups.map(({ group, heading, description }) => {
        const headingId = `${group}-topics-heading`;

        return (
          <section key={group} aria-labelledby={headingId} className="space-y-4">
            <div className="space-y-1">
              <h2 id={headingId} className="text-xl font-semibold tracking-tight sm:text-2xl">
                {heading}
              </h2>
              <p className="leading-7 text-muted-foreground">{description}</p>
            </div>
            <ul className="space-y-3">
              {getArticlesForGroup(group, activeCountry).map((article) => (
                <li key={article.id}>
                  <Link to={article.path} className="section-link text-base font-semibold">
                    {article.title}
                  </Link>
                  <p className="mt-1 leading-7 text-muted-foreground">{article.summary}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
