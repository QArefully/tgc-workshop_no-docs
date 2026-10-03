import { useMemo, useState } from 'react';
import type { CustomBlendOption } from '@shop/contracts/custom-blends';
import { PackagingArtwork } from '@/components/packaging/PackagingArtwork';
import { resolveCatalogPackagingPalette } from '@/components/packaging/catalogPackagingPalettes';
import { resolvePackagingSpec } from '@/components/packaging/packagingSpec';
import { useLocalisation } from '@/i18n/LocaleContext';
import { customBlendMessages } from '@shop/localisation/messages/customBlend';

export function IngredientPicker({
  options,
  selectedVariantIds,
  isLimitReached,
  onToggle,
}: {
  options: readonly CustomBlendOption[];
  selectedVariantIds: readonly number[];
  isLimitReached: boolean;
  onToggle: (variantId: number) => void;
}) {
  const { translate, formatCount } = useLocalisation();
  const [query, setQuery] = useState('');
  const groupedOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options
      .filter((option) => !needle || option.productName.toLowerCase().includes(needle))
      .reduce<Map<string, CustomBlendOption[]>>((groups, option) => {
        const group = groups.get(option.category) ?? [];
        group.push(option);
        groups.set(option.category, group);
        return groups;
      }, new Map());
  }, [options, query]);
  const hasMatches = groupedOptions.size > 0;
  return (
    <fieldset
      className="grid gap-3 border-none p-0"
      aria-describedby="custom-blend-selection-count"
    >
      <legend className="text-xl font-semibold">
        {translate(customBlendMessages, 'customBlend.ingredientsStep')}
      </legend>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1 text-sm">
          {translate(customBlendMessages, 'customBlend.searchIngredients')}
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="rounded-md border px-3 py-1.5"
          />
        </label>
        <p id="custom-blend-selection-count" className="text-sm text-muted-foreground">
          {translate(customBlendMessages, 'customBlend.selectionCount', {
            count: selectedVariantIds.length,
            countLabel: formatCount(selectedVariantIds.length),
            remainingLabel: formatCount(Math.max(0, 4 - selectedVariantIds.length)),
          })}
        </p>
      </div>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate(customBlendMessages, 'customBlend.noCompatibleIngredients')}
        </p>
      ) : !hasMatches ? (
        <p className="text-sm text-muted-foreground" role="status">
          {translate(customBlendMessages, 'customBlend.noIngredientsMatch', {
            query: query.trim(),
          })}
        </p>
      ) : (
        <div className="grid gap-5">
          {[...groupedOptions].map(([category, categoryOptions]) => (
            <section
              key={category}
              aria-label={translate(customBlendMessages, 'customBlend.categoryIngredients', {
                category,
              })}
              className="grid gap-2"
            >
              <h3 className="text-sm font-medium text-muted-foreground">{category}</h3>
              <ul className="grid gap-3 sm:grid-cols-2">
                {categoryOptions.map((option) => {
                  const selected = selectedVariantIds.includes(option.variant.variantId);
                  const checkboxId = `custom-blend-ingredient-${option.variant.variantId}`;
                  // Inventory is advisory here: the API deliberately returns compatible lots even
                  // when their stock count is zero. Only an inactive server-provided variant or the
                  // local selection limit makes a tile ineligible for interaction.
                  const unavailableReason = !option.variant.active
                    ? translate(customBlendMessages, 'customBlend.ingredientUnavailable')
                    : null;
                  const limitReason =
                    isLimitReached && !selected
                      ? translate(customBlendMessages, 'customBlend.ingredientLimit')
                      : null;
                  const reason = unavailableReason ?? limitReason;
                  // An inactive variant must never be removable, even if it was selected
                  // before it became inactive. A selected tile at the local limit remains
                  // interactive so the customer can remove it.
                  const disabled =
                    unavailableReason !== null || (!selected && limitReason !== null);
                  const palette = resolveCatalogPackagingPalette({
                    id: option.productId,
                    category: option.category,
                  });
                  return (
                    <li key={option.variant.variantId} className="custom-blend-tile rounded-xl p-3">
                      <label
                        htmlFor={checkboxId}
                        className={`grid grid-cols-[3.5rem_1fr] gap-3 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                      >
                        <PackagingArtwork
                          name={option.productName}
                          spec={resolvePackagingSpec({
                            product: {
                              id: option.productId,
                              name: option.productName,
                              category: option.category,
                              consumptionClassification: option.consumptionClassification,
                              categoryFacts: option.categoryFacts,
                              mixingGroup: option.mixingGroup,
                            },
                            variant: option.variant,
                          })}
                          mark="CB"
                          consumptionLabel={option.consumptionClassification}
                          ariaLabel=""
                          className="h-14 w-14"
                        />
                        <span className="grid gap-1">
                          <input
                            id={checkboxId}
                            aria-label={option.productName}
                            type="checkbox"
                            checked={selected}
                            disabled={disabled}
                            aria-describedby={reason ? `${checkboxId}-reason` : undefined}
                            onChange={() => {
                              if (!disabled) onToggle(option.variant.variantId);
                            }}
                          />
                          <span className="flex items-center gap-2 text-sm font-medium">
                            <i
                              aria-hidden="true"
                              className="h-3 w-3 rounded-full"
                              style={{
                                backgroundColor:
                                  palette?.pigment ?? deterministicPigment(option.productId),
                              }}
                            />
                            {option.productName}
                          </span>
                          {option.variant.stockCount === 0 && (
                            <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {translate(customBlendMessages, 'customBlend.outOfStock')}
                            </span>
                          )}
                          {reason && (
                            <span
                              id={`${checkboxId}-reason`}
                              className="text-xs text-muted-foreground"
                            >
                              {reason}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function deterministicPigment(value: string): string {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 35% 62%)`;
}
