import { describe, expect, it } from 'vitest';
import { automationPrerequisiteCodes } from './editor-prerequisites';

const ready = {
  projectionAvailable: true,
  credentialConfigured: true,
  autoGeneratePrMessage: true,
  autoConfirmPrCreation: true,
  generationRuleCount: 1,
};

describe('automationPrerequisiteCodes', () => {
  it('returns no codes when all four upstream prerequisites are present', () => {
    expect(automationPrerequisiteCodes(ready)).toEqual([]);
  });

  it('names every missing prerequisite independently', () => {
    expect(automationPrerequisiteCodes({
      projectionAvailable: false,
      credentialConfigured: false,
      autoGeneratePrMessage: false,
      autoConfirmPrCreation: false,
      generationRuleCount: 0,
    })).toEqual(['projection', 'credential', 'auto-generate', 'auto-confirm', 'rules']);
  });

  it('treats one missing generation rule as blocking even when AI is configured', () => {
    expect(automationPrerequisiteCodes({ ...ready, generationRuleCount: 0 })).toEqual(['rules']);
  });
});
