/**
 * Compatibility exports for older internal imports. Production routes render
 * the configuration workspace directly; this module intentionally contains no
 * second Modal shell or close-button entry point.
 */
export { HistoryBackfillContent } from "./configuration/RuleHistoryWorkspace";
export type {
  HistoryBackfillContentProps,
  RuleHistoryModalOptions
} from "./configuration/ruleHistoryTypes";
export {
  ProductRenameContent,
  ProductRenameModal,
  type ProductRenameGroup,
  type ProductRenameModalOptions
} from "./ProductRenameModal";
export {
  CounterpartyRenameContent,
  CounterpartyRenameModal,
  type CounterpartyRenameGroup,
  type CounterpartyRenameModalOptions
} from "./CounterpartyRenameModal";
export { RuleCreationModal, type RuleCreationModalOptions } from "./RuleCreationModal";
