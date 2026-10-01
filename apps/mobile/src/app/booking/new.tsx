import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Button, Card, Chips, ErrorText, Field, Screen, T } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useLookups, useVenues } from '../../lib/hooks';

/** Capture a lead in under a minute, e.g. while on the phone with the client. */
export default function NewEnquiry() {
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const { data: venues } = useVenues();
  const [f, setF] = useState({
    name: '', client: '', phone: '', email: '', event_date: '', pax: '', event_type: null as string | null,
    source: null as string | null, venue_id: null as string | null, status: 'INQ' as 'INQ' | 'TEN', description: '',
  });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const dateOk = !f.event_date || /^\d{4}-\d{2}-\d{2}$/.test(f.event_date);

  const save = useMutation({
    mutationFn: () => api<{ id: string }>('/bookings', {
      body: {
        name: f.name.trim() || `${f.client.trim()} enquiry`,
        status: f.status,
        contact: f.client.trim() ? { name: f.client.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null } : undefined,
        event_date: f.event_date || null,
        pax: f.pax ? Number(f.pax) : null,
        event_type: f.event_type, source: f.source, venue_id: f.venue_id,
        description: f.description.trim() || null,
      },
    }),
    onSuccess: (b) => {
      qc.invalidateQueries();
      router.replace(`/booking/${b.id}`);
    },
  });
  const conflictMsg = save.error instanceof ApiError && save.error.status === 409 ? 'That room is already booked on that date.' : null;

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Card style={{ gap: 12 }}>
            <Field label="Client name" value={f.client} onChangeText={set('client')} placeholder="e.g. Latifa" />
            <Field label="Phone" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="e.g. 66230001" />
            <Field label="Email (optional)" value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
          </Card>
          <Card style={{ gap: 12 }}>
            <Field label="What is it?" value={f.name} onChangeText={set('name')} placeholder="e.g. Wedding, 250 guests (optional)" />
            <Chips<string> label="Event type" value={f.event_type} onChange={set('event_type')}
              options={(lookups?.event_type ?? []).filter((l) => l.is_active).map((l) => [l.code, l.label])} />
            <Field label="Event date (YYYY-MM-DD)" value={f.event_date} onChangeText={set('event_date')} placeholder="2026-12-24"
              keyboardType="numbers-and-punctuation" autoCorrect={false} />
            {!dateOk && <T small style={{ color: '#d03b3b' }}>Use the format 2026-12-24</T>}
            <Field label="Guests" value={f.pax} onChangeText={(v) => set('pax')(v.replace(/[^\d]/g, ''))} keyboardType="number-pad" />
            <Chips<string> label="Venue" value={f.venue_id} onChange={set('venue_id')}
              options={(venues ?? []).filter((v) => v.is_active).map((v) => [v.id, v.name])} />
            <Chips<string> label="Source" value={f.source} onChange={set('source')}
              options={(lookups?.source ?? []).filter((l) => l.is_active).map((l) => [l.code, l.label])} />
            <Chips<'INQ' | 'TEN'> label="Stage" value={f.status} onChange={set('status')} options={[['INQ', 'Inquiry'], ['TEN', 'Tentative hold']]} />
            <Field label="Notes" value={f.description} onChangeText={set('description')} multiline placeholder="What did the client ask for?" />
          </Card>
          {conflictMsg ? <ErrorText error={new Error(conflictMsg)} /> : <ErrorText error={save.error} />}
          <Button title="Save enquiry" kind="primary" icon="checkmark" busy={save.isPending}
            disabled={!dateOk || (!f.client.trim() && !f.name.trim())} onPress={() => save.mutate()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
