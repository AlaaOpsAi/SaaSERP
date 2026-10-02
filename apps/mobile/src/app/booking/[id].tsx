import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { ActivityRow } from '../../components/rows';
import {
  Button, Card, Chips, Empty, ErrorText, Field, H1, H2, Loading, Notice, Screen, StatusBadge, T, type IconName,
} from '../../components/ui';
import { api, type BookingDetail, type Status } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { addDays, date, dateTime, money, pct, STATUS_LABEL, time, today, TRANSITIONS, zonedIso } from '../../lib/format';
import { useLabel, useLookups } from '../../lib/hooks';
import { useColors } from '../../lib/theme';
import { lookupLabel, mirrored, t } from '../../i18n';

const ACTION_LABEL: Partial<Record<Status, string>> = {
  TEN: 'Tentative', DEF: 'Confirm', ACT: 'Actualise', LOS: 'Lost', CXL: 'Cancel', INQ: 'Back to inquiry',
};

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, can } = useAuth();
  const c = useColors();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['booking', id], queryFn: () => api<BookingDetail>(`/bookings/${id}`) });
  const eventLabel = useLabel('event_type');
  const sourceLabel = useLabel('source');
  const lostLabel = useLabel('lost_reason');
  const [pending, setPending] = useState<Status | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const b = q.data;

  const refresh = () => qc.invalidateQueries();
  const status = useMutation({
    mutationFn: (v: { status: Status; reason?: string }) => api(`/bookings/${id}/status`, { body: v }),
    onSuccess: () => { setPending(null); refresh(); },
  });

  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (!b) return <Screen><ErrorText error={q.error ?? new Error(t('Booking not found'))} /></Screen>;

  const covering = Boolean(me && !me.sees_all && b.owner_id && !me.team_ids.includes(b.owner_id) && b.created_by !== me.id);
  const editable = can('sell') && b.can_edit;
  const phone = b.contact_phone?.replace(/[^\d+]/g, '');

  return (
    <Screen>
      <Stack.Screen options={{ title: b.booking_no }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
        <View style={{ gap: 6 }}>
          <StatusBadge status={b.status} />
          <H1>{b.name}</H1>
          <T muted small>{b.booking_no} · {eventLabel(b.event_type)} · {sourceLabel(b.source)} · {b.owner_name ?? t("Unassigned")}</T>
        </View>

        {covering && (
          <Notice icon="people-outline">
            {b.can_edit ? t('You are covering for {name}. Changes are recorded on their behalf.', { name: b.owner_name ?? '' }) : t("You can view {name}'s booking while covering, but not change it.", { name: b.owner_name ?? '' })}
          </Notice>
        )}
        {b.conflicts.length > 0 && <Notice icon="warning-outline">{t("Room clash:")}{' '}{b.conflicts.map((x) => `${x.booking_name} (${x.space_name})`).join(', ')}</Notice>}

        {/* Reach the client in one tap */}
        {(phone || b.contact_email) && (
          <Card style={{ gap: 10 }}>
            <T bold>{b.contact_name ?? t("Client")}</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {phone && <Contact icon="call-outline" label={t("Call")} onPress={() => Linking.openURL(`tel:${phone}`)} />}
              {phone && <Contact icon="logo-whatsapp" label={t("WhatsApp")} onPress={() => Linking.openURL(`https://wa.me/${phone.replace(/^\+/, '')}`)} />}
              {b.contact_email && <Contact icon="mail-outline" label={t("Email")} onPress={() => Linking.openURL(`mailto:${b.contact_email}`)} />}
            </View>
          </Card>
        )}

        {editable && TRANSITIONS[b.status].length > 0 && (
          <Card style={{ gap: 10 }}>
            <T small muted bold>{t("Move to")}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {TRANSITIONS[b.status].map((s) => (
                <Button key={s} small title={t(ACTION_LABEL[s] ?? STATUS_LABEL[s])} kind={s === 'DEF' ? 'primary' : s === 'LOS' || s === 'CXL' ? 'danger' : 'default'}
                  busy={status.isPending && status.variables?.status === s}
                  onPress={() => (s === 'LOS' || s === 'CXL' ? setPending(s) : status.mutate({ status: s }))} />
              ))}
            </View>
            {pending && <ReasonPicker status={pending} busy={status.isPending} onCancel={() => setPending(null)}
              onSave={(reason) => status.mutate({ status: pending, reason })} />}
            <ErrorText error={status.error} />
          </Card>
        )}

        <Card style={{ gap: 8 }}>
          <Row k={t("Event date")} v={date(b.event_date)} />
          <Row k={t("Venue")} v={[b.venue_name, b.space_name ?? b.hall_text].filter(Boolean).join(' / ') || '—'} />
          <Row k={t("Guests")} v={b.pax ? String(b.pax) : '—'} />
          <Row k={t("Enquiry")} v={date(b.inquiry_date)} />
          <Row k={t("Next follow-up")} v={date(b.next_followup_date)} />
          {b.lost_reason && <Row k={t("Lost reason")} v={lostLabel(b.lost_reason)} />}
          {b.description ? <T small muted style={{ marginTop: 4 }}>{b.description}</T> : null}
        </Card>

        <Card style={{ gap: 8 }}>
          <Row k={t("Revenue")} v={money(b.revenue)} />
          <Row k={t("Gross margin")} v={`${money(b.gross_margin)}  ·  ${pct(b.margin_pct)}`} />
          <Row k={t("Net profit")} v={money(b.net_profit)} />
          <Row k={t("Paid")} v={money(b.paid)} />
          <Row k={t("Outstanding")} v={money(b.outstanding)} strong />
          {covering && <T small muted>{t("Payments and commissions stay with finance while you cover.")}</T>}
        </Card>

        <H2>{t("Follow-ups")}</H2>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {b.activities.length ? b.activities.map((a) => <ActivityRow key={a.id} a={a} showBooking={false} />)
            : <Empty icon="chatbubbles-outline">{t("No follow-ups yet.")}</Empty>}
        </Card>
        {editable && <AddFollowUp bookingId={b.id} />}

        {b.events.length > 0 && (
          <>
            <H2>{t("Events")}</H2>
            <Card style={{ gap: 10 }}>
              {b.events.map((e) => (
                <View key={e.id} style={{ gap: 2 }}>
                  <T bold>{e.name}</T>
                  <T small muted>{dateTime(e.start_at)} – {time(e.end_at)}{e.space_name ? ` · ${e.venue_name ?? ''} / ${e.space_name}` : ''}{e.expected_pax ? ` · ${t('{n} pax', { n: e.expected_pax })}` : ''}</T>
                </View>
              ))}
            </Card>
          </>
        )}

        <Pressable onPress={() => setShowHistory((h) => !h)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <Ionicons name={showHistory ? 'chevron-down' : 'chevron-forward'} size={16} color={c.text2} style={showHistory ? undefined : mirrored()} />
          <T muted bold>{t("History")}</T>
        </Pressable>
        {showHistory && (
          <Card style={{ gap: 10 }}>
            {[...b.history.map((h) => ({ at: h.changed_at, who: h.changed_by_name, behalf: h.on_behalf_of_name,
                text: h.from_status ? `${STATUS_LABEL[h.from_status]} → ${STATUS_LABEL[h.to_status]}` : t('Created as {status}', { status: STATUS_LABEL[h.to_status] }) })),
              ...b.log.map((l) => ({ at: l.created_at, who: l.actor_name, behalf: l.on_behalf_of_name, text: l.action[0].toUpperCase() + l.action.slice(1) })),
            ].sort((x, y) => y.at.localeCompare(x.at)).map((e, i) => (
              <View key={i} style={{ gap: 1 }}>
                <T>{e.text}</T>
                <T small muted>{dateTime(e.at)} · {e.who ?? '—'}{e.behalf ? ` ${t('on behalf of {name}', { name: e.behalf })}` : ''}</T>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <T muted>{k}</T>
      <T bold={strong} style={{ flexShrink: 1, textAlign: 'right' }}>{v}</T>
    </View>
  );
}

function Contact({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, borderRadius: 10, backgroundColor: pressed ? c.accentSoft : c.surface2 })}>
      <Ionicons name={icon} size={22} color={c.accent} />
      <Text style={{ color: c.text, fontSize: 12.5, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function ReasonPicker({ status, busy, onCancel, onSave }: { status: Status; busy: boolean; onCancel: () => void; onSave: (r: string) => void }) {
  const { data: lookups } = useLookups();
  const [reason, setReason] = useState<string | null>(null);
  const [text, setText] = useState('');
  return (
    <View style={{ gap: 10 }}>
      {status === 'LOS' ? (
        <Chips<string> label={t("Why was it lost?")} value={reason} onChange={setReason}
          options={(lookups?.lost_reason ?? []).filter((l) => l.is_active).map((l) => [l.code, lookupLabel(l)])} />
      ) : (
        <Field label={t("Why is it cancelled?")} value={text} onChangeText={setText} multiline />
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={t("Back")} onPress={onCancel} style={{ flex: 1 }} />
        <Button title={status === 'LOS' ? t("Mark lost") : t("Cancel booking")} kind="danger" busy={busy} style={{ flex: 1 }}
          disabled={status === 'LOS' ? !reason : !text.trim()} onPress={() => onSave(status === 'LOS' ? reason! : text.trim())} />
      </View>
    </View>
  );
}

type When = 'today' | 'tomorrow' | '3days' | 'week';
const WHEN: [When, string][] = [['today', 'Today 4 pm'], ['tomorrow', 'Tomorrow 10 am'], ['3days', 'In 3 days'], ['week', 'Next week']];

function AddFollowUp({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [type, setType] = useState<'followup' | 'call' | 'meeting'>('followup');
  const [when, setWhen] = useState<When>('tomorrow');
  const add = useMutation({
    mutationFn: () => {
      const day = today();
      const due = when === 'today' ? zonedIso(day, '16:00') : when === 'tomorrow' ? zonedIso(addDays(day, 1), '10:00')
        : when === '3days' ? zonedIso(addDays(day, 3), '10:00') : zonedIso(addDays(day, 7), '10:00');
      return api('/activities', { body: { booking_id: bookingId, type, subject: subject.trim(), due_at: due } });
    },
    onSuccess: () => { setSubject(''); qc.invalidateQueries(); },
  });
  return (
    <Card style={{ gap: 10 }}>
      <Field label={t("New follow-up")} value={subject} onChangeText={setSubject} placeholder={t("e.g. Send revised menu")} />
      <Chips<'followup' | 'call' | 'meeting'> value={type} onChange={setType} options={[['followup', 'Follow-up'], ['call', 'Call'], ['meeting', 'Meeting']]} />
      <Chips<When> value={when} onChange={setWhen} options={WHEN} />
      <ErrorText error={add.error} />
      <Button title={t("Add follow-up")} kind="primary" icon="add" disabled={!subject.trim()} busy={add.isPending} onPress={() => add.mutate()} />
    </Card>
  );
}
