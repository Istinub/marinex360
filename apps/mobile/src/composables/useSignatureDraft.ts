import { Preferences } from '@capacitor/preferences';

export interface SignatureDraft {
  jobOrderId: string;
  signerName: string;
  technicianId: string;
  signerPhone: string;
  signerEmail: string;
  imageLocalPath: string;
  imageDataUrl: string;
  updatedAt: string;
}

function draftKey(jobOrderId: string): string {
  return `marinex360.signature-draft.${jobOrderId}`;
}

export async function loadSignatureDraft(jobOrderId: string): Promise<SignatureDraft | null> {
  const stored = await Preferences.get({ key: draftKey(jobOrderId) });
  if (!stored.value) return null;

  try {
    const parsed = JSON.parse(stored.value) as Partial<SignatureDraft>;
    if (
      parsed.jobOrderId !== jobOrderId ||
      typeof parsed.signerName !== 'string' ||
      typeof parsed.technicianId !== 'string' ||
      typeof parsed.signerPhone !== 'string' ||
      typeof parsed.signerEmail !== 'string' ||
      typeof parsed.imageLocalPath !== 'string' ||
      typeof parsed.imageDataUrl !== 'string' ||
      typeof parsed.updatedAt !== 'string'
    ) {
      return null;
    }
    return parsed as SignatureDraft;
  } catch {
    return null;
  }
}

export async function saveSignatureDraft(input: Omit<SignatureDraft, 'updatedAt'>): Promise<SignatureDraft> {
  const draft: SignatureDraft = {
    ...input,
    updatedAt: new Date().toISOString(),
  };
  await Preferences.set({ key: draftKey(input.jobOrderId), value: JSON.stringify(draft) });
  return draft;
}

export async function clearSignatureDraft(jobOrderId: string): Promise<void> {
  await Preferences.remove({ key: draftKey(jobOrderId) });
}
