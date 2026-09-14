/**
 * The product's destinations, in one place (ADR-0032).
 *
 * The shell renders this list twice — once in the sidebar, once in the bottom bar —
 * and a second hand-written copy is how a nav item ends up in one and not the other.
 *
 * Icons are inline paths rather than an icon font or a sprite: `font-src 'self'` rules
 * out the first, and a sprite is a second request for four shapes. They are drawn on a
 * 24-unit grid with `currentColor`, so they take the link's colour and its focus ring
 * without any extra wiring.
 */
export interface NavItem {
  readonly path: string;
  readonly label: string;
  /** What this destination is for — the sidebar shows it, the bottom bar does not. */
  readonly hint: string;
  /** SVG path data on a 24×24 grid, stroked with `currentColor`. */
  readonly icon: string;
}

/**
 * Primary destinations. Deliberately flat: five items do not need grouping, and
 * inventing categories for them is its own kind of clutter. Groups earn their place
 * when there is a second screenful.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  {
    path: '/dashboard',
    label: 'Dashboard',
    hint: 'How ready you are, and against what',
    icon: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z',
  },
  {
    path: '/discover',
    label: 'Discover',
    hint: 'Repositories that fit what you know',
    icon: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
  },
  {
    path: '/repositories',
    label: 'Repositories',
    hint: 'The ones you are following',
    icon: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v14H6.5A2.5 2.5 0 0 0 4 19.5v-14ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  },
  {
    path: '/profile',
    label: 'Profile',
    hint: 'Everything Rujoom knows about you',
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0',
  },
] as const;

/**
 * Settings sits apart from the primary list. It is where you go to change how the
 * product behaves, not a place the work happens — and on a phone it moves into the
 * "More" sheet rather than spending one of four bottom-bar slots.
 */
export const SETTINGS_NAV: NavItem = {
  path: '/settings',
  label: 'Settings',
  hint: 'Sign-in, AI, and what is stored on this device',
  icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-2-1.2L14.6 3h-4l-.4 2.6c-.7.3-1.4.7-2 1.2l-2.3-1-2 3.5 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1c.6.5 1.3 1 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z',
};
