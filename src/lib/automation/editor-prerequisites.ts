export type AutomationPrerequisiteCode =
  | 'projection'
  | 'credential'
  | 'auto-generate'
  | 'auto-confirm'
  | 'rules';

export type AutomationPrerequisiteInput = {
  projectionAvailable: boolean;
  credentialConfigured: boolean;
  autoGeneratePrMessage: boolean;
  autoConfirmPrCreation: boolean;
  generationRuleCount: number;
};

/**
 * Mirrors upstream `autoCreatePrerequisites()`: automation toggles stay
 * disabled until the server credential, both AI message switches and at least
 * one generation rule are present. Kept pure so the UI can explain each gap
 * without guessing.
 */
export function automationPrerequisiteCodes(input: AutomationPrerequisiteInput): AutomationPrerequisiteCode[] {
  const missing: AutomationPrerequisiteCode[] = [];
  if (!input.projectionAvailable) missing.push('projection');
  if (!input.credentialConfigured) missing.push('credential');
  if (!input.autoGeneratePrMessage) missing.push('auto-generate');
  if (!input.autoConfirmPrCreation) missing.push('auto-confirm');
  if (input.generationRuleCount <= 0) missing.push('rules');
  return missing;
}
