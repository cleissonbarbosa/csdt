/**
 * A comparison as plain text on the clipboard, to paste into a review of the
 * incident. The text is written when it is asked for and says where its
 * figures come from, since away from the page nothing else does.
 */
import { Copy } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { t } from '@/i18n';
import { useNotices } from '@/stores/notices';

export function CopyText({ text, testId }: { text: () => string; testId: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      useNotices.getState().push('info', t('Summary copied as text.'));
    } catch {
      useNotices.getState().push('error', t('The summary could not be copied.'));
    }
  };
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Copy size={12} aria-hidden />}
      onClick={() => void copy()}
      data-testid={testId}
      title={t('Copy this comparison as plain text')}
    >
      {t('Copy')}
    </Button>
  );
}
