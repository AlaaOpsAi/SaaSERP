import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { api, type Activity } from '../lib/api';
import { useColors } from '../lib/theme';
import { t } from '../i18n';
import { Button, ErrorText, Field, T } from './ui';

/** Meetings and site visits need their outcome: it feeds the manager's daily activity report. */
export const NEEDS_OUTCOME = ['meeting', 'site_visit'];

/** Bottom sheet asking for the outcome before an activity is marked done. */
export function OutcomeSheet({ activity, onClose }: { activity: Activity | null; onClose: () => void }) {
  const c = useColors();
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState('');
  const required = activity ? NEEDS_OUTCOME.includes(activity.type) : false;
  const save = useMutation({
    mutationFn: () => api(`/activities/${activity!.id}/complete`, { body: { outcome: outcome.trim() || null } }),
    onSuccess: () => { qc.invalidateQueries(); setOutcome(''); onClose(); },
  });
  return (
    <Modal visible={Boolean(activity)} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t('Cancel')} />
        <View style={{ backgroundColor: c.surface, padding: 16, gap: 12, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderColor: c.border, borderWidth: 1 }}>
          <T bold>{t('Complete: {subject}', { subject: activity?.subject ?? '' })}</T>
          <Field label={required ? t('Meeting outcome (required)') : t('Outcome / client feedback (optional)')} multiline autoFocus
            value={outcome} onChangeText={setOutcome} placeholder={required ? t('e.g. Liked the ballroom, sending a quote on Sunday') : ''} />
          {required && <T small muted>{t('The outcome appears on the daily activity report for your manager.')}</T>}
          <ErrorText error={save.error} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title={t('Cancel')} onPress={onClose} style={{ flex: 1 }} />
            <Button title={t('Mark done')} kind="primary" busy={save.isPending} disabled={required && !outcome.trim()}
              onPress={() => save.mutate()} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
