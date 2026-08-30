/**
 * Shared UI primitives.
 *
 * Everything here previously lived inside a single screen, which meant no other
 * screen could use it. The result was that each screen reinvented cards, rows
 * and sheets with slightly different padding, radius and colour - the app read
 * as "almost consistent", values close to each other but never the same.
 *
 * The rule these enforce: a screen composes primitives, it does not define
 * them. If a screen needs a new shape, it belongs here.
 */
export { NavRow, InfoRow, TappableRow, StatItem } from "./Rows";
export type { NavRowProps, InfoRowProps, TappableRowProps, StatItemProps } from "./Rows";

export { SectionCard } from "./SectionCard";
export type { SectionCardProps } from "./SectionCard";

export { ModalSheet } from "./ModalSheet";
export type { ModalSheetProps } from "./ModalSheet";

export { OptionPicker } from "./OptionPicker";
export type { Option, OptionPickerProps } from "./OptionPicker";

export { OptionCard, PremiumBadge } from "./OptionCard";
export type { OptionCardProps } from "./OptionCard";
