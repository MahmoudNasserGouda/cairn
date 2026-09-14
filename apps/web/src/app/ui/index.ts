/**
 * The `cn-*` component library (ADR-0032, docs/design-system.md).
 *
 * It lives in `apps/web` rather than `libs/` on purpose: ADR-0005 keeps `libs/*`
 * framework-free, and the browser extension shares *engines*, not widgets.
 *
 * A page that needs a new visual primitive adds it here. A page that styles a `.panel`
 * of its own is how six divergent definitions of a card happened the first time.
 */
export { AvatarComponent } from './avatar.component';
export { ButtonComponent, type ButtonSize, type ButtonVariant } from './button.component';
export { CardComponent } from './card.component';
export { EmptyStateComponent } from './empty-state.component';
export { FieldComponent, FieldControlDirective } from './field.component';
export { ScoreBarComponent } from './score-bar.component';
export { SectionComponent } from './section.component';
export { SheetComponent } from './sheet.component';
export { TagComponent, type TagSource, type TagTone } from './tag.component';
export { TimelineComponent, yearRange, type TimelineEntry } from './timeline.component';

/**
 * Everything, for a component that composes several. Angular tree-shakes unused
 * standalone imports, so the convenience costs nothing in the bundle.
 */
import { AvatarComponent } from './avatar.component';
import { ButtonComponent } from './button.component';
import { CardComponent } from './card.component';
import { EmptyStateComponent } from './empty-state.component';
import { FieldComponent, FieldControlDirective } from './field.component';
import { ScoreBarComponent } from './score-bar.component';
import { SectionComponent } from './section.component';
import { SheetComponent } from './sheet.component';
import { TagComponent } from './tag.component';
import { TimelineComponent } from './timeline.component';

export const UI = [
  AvatarComponent,
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  FieldComponent,
  FieldControlDirective,
  ScoreBarComponent,
  SectionComponent,
  SheetComponent,
  TagComponent,
  TimelineComponent,
] as const;
