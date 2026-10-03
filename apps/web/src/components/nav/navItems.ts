interface NavItem {
  key: string;
  label: string;
  /** Stable lookup key; `label` remains a compatibility/default value for non-React consumers. */
  messageKey?: string;
  icon: string;
  enabled: boolean;
  className?: string;
}

export const searchItem: NavItem = {
  key: 'search',
  label: 'Search',
  messageKey: 'shell.searchProducts',
  icon: 'Search',
  enabled: false,
};

export const accountItem: NavItem = {
  key: 'account',
  label: 'Account',
  messageKey: 'shell.account',
  icon: 'User',
  enabled: false,
};

export const savedListsItem: NavItem = {
  key: 'savedLists',
  label: 'Saved Lists',
  messageKey: 'shell.savedLists',
  icon: 'List',
  enabled: true,
};

export const bundlesItem: NavItem = {
  key: 'bundles',
  label: 'Bundles',
  messageKey: 'shell.bundles',
  icon: 'Package',
  enabled: true,
};

/**
 * Custom Blend owns the reserved iridescent nav treatment. `className` carries the frozen
 * `.custom-blend-nav-link` contract from `index.css`; `CategoryNav` is its single consumer.
 */
export const customBlendItem: NavItem = {
  key: 'customBlend',
  label: 'Custom Blend',
  messageKey: 'shell.customBlend',
  icon: 'Blend',
  enabled: true,
  className: 'custom-blend-nav-link',
};

export const navItems: Record<string, NavItem> = {
  search: searchItem,
  account: accountItem,
  savedLists: savedListsItem,
  bundles: bundlesItem,
  customBlend: customBlendItem,
};
